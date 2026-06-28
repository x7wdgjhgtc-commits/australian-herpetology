import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import L from "leaflet";
import australiaOutline from "@/lib/australiaOutline.json";
import australiaStates from "@/lib/australiaStates.json";
import { fetchAreaSpecies, type AreaSpeciesResponse, type SpeciesGroup } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMySpecies } from "@/lib/mySpecies";
import { SeenBadge } from "@/components/SeenBadge";
import { UnseenBadge } from "@/components/UnseenBadge";

const GROUPS: { value: SpeciesGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reptiles", label: "Reptiles" },
  { value: "amphibians", label: "Amphibians" },
];

export default function MapSearch() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(10);
  const [group, setGroup] = useState<SpeciesGroup>("all");

  const searchMutation = useMutation<AreaSpeciesResponse, Error, { lat: number; lng: number; radius: number; group: SpeciesGroup }>({
    mutationFn: (vars) => fetchAreaSpecies(vars.lat, vars.lng, vars.radius, vars.group),
  });

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    });

    // Self-hosted Australia outline as basemap. The deploy iframe CSP
    // (img-src 'self') blocks remote tile servers, so we draw a vector
    // basemap from bundled GeoJSON instead.
    L.rectangle([[-90, -180], [90, 360]], {
      stroke: false,
      fillColor: "hsl(205 35% 88%)",
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
    const baseLayer = L.geoJSON(australiaOutline as GeoJSON.Feature, {
      style: {
        color: "hsl(140 25% 35%)",
        weight: 1.2,
        fillColor: "hsl(45 38% 93%)",
        fillOpacity: 1,
      },
      interactive: false,
    }).addTo(map);
    L.geoJSON(australiaStates as GeoJSON.GeoJsonObject, {
      style: {
        color: "hsl(140 18% 45%)",
        weight: 0.8,
        dashArray: "3 3",
        opacity: 0.55,
        fill: false,
      },
      interactive: false,
    }).addTo(map);
    const gridLayer = L.layerGroup().addTo(map);
    const gridStyle = {
      color: "hsl(140 15% 55%)",
      weight: 0.4,
      opacity: 0.35,
      interactive: false,
    } as L.PolylineOptions;
    for (let lat = -50; lat <= 0; lat += 10) {
      L.polyline([[lat, 100], [lat, 165]], gridStyle).addTo(gridLayer);
    }
    for (let lng = 110; lng <= 160; lng += 10) {
      L.polyline([[-45, lng], [-8, lng]], gridStyle).addTo(gridLayer);
    }
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    const ausBounds = baseLayer.getBounds();
    const fitAustralia = () => {
      if (ausBounds.isValid()) {
        map.fitBounds(ausBounds, { padding: [8, 8] });
      } else {
        map.setView([-25, 134], 4);
      }
    };
    fitAustralia();

    map.on("click", (e: L.LeafletMouseEvent) => {
      setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    // Refit on container resize while there's no pin so the whole
    // continent stays visible regardless of viewport.
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!markerRef.current) fitAustralia();
    });
    ro.observe(containerRef.current);

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update pin + circle visualization
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pin) return;

    if (markerRef.current) markerRef.current.remove();
    if (circleRef.current) circleRef.current.remove();

    markerRef.current = L.marker([pin.lat, pin.lng]).addTo(map);
    circleRef.current = L.circle([pin.lat, pin.lng], {
      radius: radius * 1000, // km → m
      color: "hsl(140 30% 24%)",
      fillColor: "hsl(36 60% 50%)",
      fillOpacity: 0.12,
      weight: 2,
    }).addTo(map);

    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 8), { duration: 0.6 });
  }, [pin, radius]);

  // Auto-trigger search when pin or radius/group changes (debounced)
  useEffect(() => {
    if (!pin) return;
    const t = setTimeout(() => {
      searchMutation.mutate({ lat: pin.lat, lng: pin.lng, radius, group });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, radius, group]);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const data = searchMutation.data;

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 py-0 sm:py-8">
      <div className="px-4 sm:px-0 mb-4 sm:mb-6 pt-6 sm:pt-0">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight" data-testid="text-map-title">
          Map search
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Tap anywhere on the map of Australia. We'll list every reptile and amphibian recorded within your chosen radius, drawn live from the Atlas of Living Australia.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-0 lg:gap-6">
        {/* Map */}
        <div className="lg:col-span-7 relative">
          <div
            ref={containerRef}
            className="w-full border-y lg:border lg:rounded-lg border-border overflow-hidden"
            style={{ height: 360 }}
            data-testid="map-area-search"
          />

          {/* Controls overlay */}
          <div className="absolute top-3 left-3 z-[400] flex flex-col gap-2">
            <button
              onClick={useMyLocation}
              className="px-3 py-2 rounded-md bg-card border border-border shadow-sm text-sm font-medium hover-elevate flex items-center gap-2"
              data-testid="button-use-location"
            >
              <Crosshair className="h-4 w-4" /> My location
            </button>
          </div>

          {!pin && (
            <div className="absolute inset-x-3 bottom-3 z-[400] bg-card/95 backdrop-blur border border-border rounded-md p-3 text-sm shadow-md flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              Tap the map to pin a location.
            </div>
          )}
        </div>

        {/* Results panel */}
        <div className="lg:col-span-5 px-4 sm:px-0 mt-4 lg:mt-0">
          {/* Filters */}
          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs uppercase tracking-wider text-muted-foreground w-16">Radius</label>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value, 10))}
                className="flex-1 accent-primary"
                data-testid="input-radius"
              />
              <div className="text-sm font-medium tabular-nums w-12 text-right">{radius} km</div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs uppercase tracking-wider text-muted-foreground w-16">Show</label>
              <div className="flex gap-1 bg-background border border-border rounded-md p-1 flex-1">
                {GROUPS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setGroup(g.value)}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded text-sm font-medium hover-elevate",
                      group === g.value
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/70",
                    )}
                    data-testid={`button-area-filter-${g.value}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Results */}
          {!pin ? (
            <div className="text-center text-sm text-muted-foreground py-12 border border-dashed border-border rounded-lg">
              Pick a spot on the map to start.
            </div>
          ) : searchMutation.isPending ? (
            <div className="space-y-3" data-testid="state-loading">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking up species in this area…
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <Skeleton className="h-14 w-14 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : searchMutation.isError ? (
            <div className="text-sm text-destructive border border-destructive/30 rounded-lg p-4">
              Couldn't load species for this area. Try again in a moment.
            </div>
          ) : data && data.species.length === 0 ? (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
              No records within {radius} km. Try widening the radius.
            </div>
          ) : data ? (
            <ResultsList data={data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ResultsList({ data }: { data: AreaSpeciesResponse }) {
  const mySpecies = useMySpecies();
  return (
    <div data-testid="list-area-results">
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div className="text-sm">
          <span className="font-medium" data-testid="text-species-count">{data.species.length}</span>
          <span className="text-muted-foreground"> species in {data.radius} km · {data.totalRecords.toLocaleString()} records</span>
        </div>
      </div>
      <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {data.species.map((s) => {
          const Wrapper: any = s.inatId
            ? ({ children, ...rest }: any) => (
                <Link href={`/species/${s.inatId}`} {...rest}>
                  {children}
                </Link>
              )
            : "div";
          return (
            <Wrapper
              key={s.guid}
              className={cn(
                "flex items-center gap-3 p-2 rounded-md border border-border bg-card",
                s.inatId && "hover-elevate cursor-pointer",
              )}
              data-testid={`row-area-species-${s.guid.replace(/[^a-z0-9]/gi, "-")}`}
            >
              <div className="h-14 w-14 rounded-md overflow-hidden bg-muted shrink-0">
                {s.inatPhoto ? (
                  <img
                    src={s.inatPhoto}
                    alt={s.commonName || s.scientificName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-[10px] text-muted-foreground text-center">No photo</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm leading-tight line-clamp-1 flex items-center gap-1.5">
                  {s.inatId ? (
                    (mySpecies.countsBySpecies.get(s.inatId) ?? 0) > 0 ? (
                      <SeenBadge
                        count={mySpecies.countsBySpecies.get(s.inatId) ?? 0}
                        variant="inline"
                      />
                    ) : (
                      <UnseenBadge variant="inline" />
                    )
                  ) : null}
                  {s.commonName || s.scientificName}
                </div>
                <div className="text-xs italic text-muted-foreground line-clamp-1">
                  {s.scientificName}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {s.class === "Amphibia" ? "Amphibian" : "Reptile"}
                </div>
                <div className="text-sm font-medium tabular-nums">{s.count}</div>
              </div>
            </Wrapper>
          );
        })}
      </ul>
    </div>
  );
}
