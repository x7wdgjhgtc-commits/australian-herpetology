import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Crosshair, Loader2 } from "lucide-react";
import australiaOutline from "@/lib/australiaOutline.json";

interface Props {
  /** Current latitude as string (free-text — empty = no point yet). */
  lat: string;
  /** Current longitude as string. */
  lng: string;
  /**
   * Called when the user moves the marker (click, drag, or geolocation).
   * `placeGuess` may be null if reverse geocoding fails or hasn't completed yet.
   */
  onChange: (next: { lat: string; lng: string; placeGuess: string | null }) => void;
  height?: number;
}

/**
 * Interactive Leaflet map for picking a record's location.
 *
 * UX:
 *   - Click anywhere on the map to drop a marker (or move it).
 *   - Drag the marker to fine-tune.
 *   - "Use my location" button fills from the browser's geolocation API.
 *   - After every move, lat/lng are pushed up via onChange, and Nominatim
 *     reverse-geocode is fired (debounced) to suggest a place name.
 *
 * The map keeps its own marker layer; lat/lng props are the source of truth
 * so external edits (typed coords, EXIF-extracted) sync back into the marker.
 */
export default function LocationPicker({ lat, lng, onChange, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const geocodeTimerRef = useRef<number | null>(null);
  const lastReportedRef = useRef<string>(""); // dedupe: stringified "lat,lng"
  const [geolocating, setGeolocating] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);

  // Initial mount — set up the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      worldCopyJump: false,
      attributionControl: false,
    });

    // Self-hosted Australia outline as basemap — the deploy iframe CSP
    // (img-src 'self') blocks remote tile servers, so we draw a vector
    // basemap from a bundled GeoJSON instead.
    const baseLayer = L.geoJSON(australiaOutline as GeoJSON.Feature, {
      style: {
        color: "hsl(140 25% 35%)",
        weight: 1,
        fillColor: "hsl(40 30% 92%)",
        fillOpacity: 1,
      },
      interactive: false,
    }).addTo(map);
    const ausBounds = baseLayer.getBounds();
    const fitAustralia = () => {
      if (ausBounds.isValid()) {
        map.fitBounds(ausBounds, { padding: [8, 8] });
      } else {
        map.setView([-25, 134], 4);
      }
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      setMarker(e.latlng.lat, e.latlng.lng, true);
    });

    mapRef.current = map;
    // If we already have lat/lng (e.g. from EXIF) when mounted, zoom in to it.
    const initialLat = parseFloat(lat);
    const initialLng = parseFloat(lng);
    if (isFinite(initialLat) && isFinite(initialLng)) {
      placeMarker(initialLat, initialLng);
      map.setView([initialLat, initialLng], 9);
    } else {
      fitAustralia();
    }

    // Refit on container resize so Australia always stays in view when
    // there is no pin yet.
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!markerRef.current) fitAustralia();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      if (geocodeTimerRef.current !== null) {
        window.clearTimeout(geocodeTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker when external lat/lng changes (e.g. typing in the inputs,
  // EXIF, "Use my location").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const flLat = parseFloat(lat);
    const flLng = parseFloat(lng);
    if (!isFinite(flLat) || !isFinite(flLng)) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    const key = `${flLat.toFixed(6)},${flLng.toFixed(6)}`;
    if (key === lastReportedRef.current) return; // came from our own onChange — skip
    placeMarker(flLat, flLng);
    // Recenter only if the new point is offscreen
    if (!map.getBounds().contains([flLat, flLng])) {
      map.setView([flLat, flLng], Math.max(map.getZoom(), 11));
    }
  }, [lat, lng]);

  function placeMarker(la: number, ln: number) {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([la, ln]);
    } else {
      const marker = L.marker([la, ln], { draggable: true });
      marker.addTo(map);
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        setMarker(ll.lat, ll.lng, true);
      });
      markerRef.current = marker;
    }
  }

  /**
   * Update the marker AND emit onChange. If reverseGeocode is true, kick off
   * a debounced reverse-geocode lookup and update placeGuess when it returns.
   */
  function setMarker(la: number, ln: number, reverseGeocode: boolean) {
    placeMarker(la, ln);
    const latStr = la.toFixed(6);
    const lngStr = ln.toFixed(6);
    lastReportedRef.current = `${latStr},${lngStr}`;
    onChange({ lat: latStr, lng: lngStr, placeGuess: null });

    if (reverseGeocode) {
      if (geocodeTimerRef.current !== null) {
        window.clearTimeout(geocodeTimerRef.current);
      }
      setReverseLoading(true);
      geocodeTimerRef.current = window.setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${ln}&zoom=14&accept-language=en-AU`;
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return;
          const data: {
            display_name?: string;
            address?: Record<string, string>;
          } = await res.json();
          // Build a short, human-friendly label: suburb/town + state
          const a = data.address || {};
          const locality =
            a.suburb || a.town || a.village || a.hamlet || a.city || a.locality;
          const region = a.state || a.region || a.county;
          const country = a.country_code === "au" ? "AU" : a.country;
          const short =
            [locality, region, country].filter(Boolean).join(", ") ||
            data.display_name ||
            "";
          if (short) {
            onChange({ lat: latStr, lng: lngStr, placeGuess: short });
          }
        } catch {
          // ignore — user can still type a place name manually
        } finally {
          setReverseLoading(false);
        }
      }, 600);
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      alert("Geolocation isn't available in this browser.");
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeolocating(false);
        setMarker(pos.coords.latitude, pos.coords.longitude, true);
        const m = mapRef.current;
        if (m) m.setView([pos.coords.latitude, pos.coords.longitude], 14);
      },
      (err) => {
        setGeolocating(false);
        alert(`Couldn't get your location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Click the map to place a pin, or drag the pin to fine-tune.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={useMyLocation}
          disabled={geolocating}
          data-testid="button-use-my-location"
        >
          {geolocating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crosshair className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Use my location</span>
        </Button>
      </div>
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-border overflow-hidden"
        style={{ height }}
        data-testid="map-location-picker"
      />
      {reverseLoading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Looking up place name…
        </p>
      )}
    </div>
  );
}
