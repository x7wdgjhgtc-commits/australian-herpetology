import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import L from "leaflet";
import australiaOutline from "@/lib/australiaOutline.json";
import australiaStates from "@/lib/australiaStates.json";
import type { AppRecord } from "@/lib/api";
import { MapPinOff } from "lucide-react";

interface Props {
  records: AppRecord[];
  height?: number;
}

interface PinRecord {
  id: number;
  lat: number;
  lng: number;
  obscured: boolean;
  speciesCommon: string | null;
  speciesName: string | null;
  observedOn: string | null;
  photo: string | null;
  groupKey: string | null;
}

// Hue per top-level group so reptiles / amphibians / inverts read at a glance.
function pinStyle(group: string | null): { color: string; fill: string; label: string } {
  switch (group) {
    case "reptiles":
      return { color: "hsl(20 80% 28%)", fill: "hsl(20 85% 55%)", label: "Reptile" };
    case "amphibians":
      return { color: "hsl(140 60% 25%)", fill: "hsl(140 70% 45%)", label: "Amphibian" };
    case "mammals":
      return { color: "hsl(30 50% 25%)", fill: "hsl(30 60% 50%)", label: "Mammal" };
    case "birds":
      return { color: "hsl(200 70% 30%)", fill: "hsl(200 75% 55%)", label: "Bird" };
    case "fish":
      return { color: "hsl(220 70% 30%)", fill: "hsl(220 75% 55%)", label: "Fish" };
    case "invertebrates":
      return { color: "hsl(280 55% 30%)", fill: "hsl(280 60% 55%)", label: "Invertebrate" };
    case "plants":
      return { color: "hsl(95 55% 25%)", fill: "hsl(95 60% 45%)", label: "Plant" };
    default:
      return { color: "hsl(0 0% 25%)", fill: "hsl(36 70% 55%)", label: "Record" };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function UserActivityMap({ records, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pointLayerRef = useRef<L.LayerGroup | null>(null);
  const [, setLocation] = useLocation();
  const setLocationRef = useRef(setLocation);
  useEffect(() => {
    setLocationRef.current = setLocation;
  }, [setLocation]);

  // Build the displayable point list once per records change.
  const pins = useMemo<PinRecord[]>(() => {
    const out: PinRecord[] = [];
    for (const r of records) {
      const lat = r.lat == null ? NaN : Number(r.lat);
      const lng = r.lng == null ? NaN : Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        id: r.id,
        lat,
        lng,
        obscured: !!r.obscured,
        speciesCommon: r.speciesCommon,
        speciesName: r.speciesName,
        observedOn: r.observedOn,
        photo: r.photoDataUrl || (r.photos && r.photos[0]) || null,
        groupKey: r.groupKey,
      });
    }
    return out;
  }, [records]);

  // Initialise Leaflet once. Same self-hosted vector basemap treatment as
  // the species distribution map: ocean fill, land outline, state borders,
  // 10° graticule, scale bar.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      worldCopyJump: false,
      attributionControl: false,
    });
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
    if (ausBounds.isValid()) {
      map.fitBounds(ausBounds, { padding: [8, 8] });
    } else {
      map.setView([-25, 134], 4);
    }
    pointLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      pointLayerRef.current = null;
    };
  }, []);

  // Render / refresh markers whenever pins change.
  useEffect(() => {
    const layer = pointLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (pins.length === 0) return;

    const bounds = L.latLngBounds([]);
    for (const p of pins) {
      const style = pinStyle(p.groupKey);
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        weight: 1.5,
        color: style.color,
        fillColor: style.fill,
        fillOpacity: 0.9,
      });
      const title = p.speciesCommon || p.speciesName || "Untitled record";
      const sub = p.speciesCommon && p.speciesName ? `<i>${escapeHtml(p.speciesName)}</i>` : "";
      const date = p.observedOn ? escapeHtml(p.observedOn) : "no date";
      const obscured = p.obscured
        ? `<div style="color:hsl(20 70% 40%);font-size:10px;margin-top:2px">Approximate location</div>`
        : "";
      marker.bindTooltip(
        `<div style="font-size:12px;max-width:200px"><b>${escapeHtml(title)}</b><br/>${sub}<div style="opacity:.7;margin-top:2px">${style.label} · ${date}</div>${obscured}</div>`,
        { sticky: true, direction: "top", offset: [0, -6] },
      );
      marker.on("click", () => {
        setLocationRef.current(`/r/${p.id}`);
      });
      marker.addTo(layer);
      bounds.extend([p.lat, p.lng]);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
  }, [pins]);

  const missingCount = records.length - pins.length;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        data-testid="map-user-activity"
        className="isolate relative w-full rounded-md border border-border overflow-hidden"
        style={{ height }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          <span data-testid="text-activity-pin-count">
            {pins.length} record{pins.length === 1 ? "" : "s"} on map
          </span>
          {missingCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MapPinOff className="h-3 w-3" />
              {missingCount} without coordinates
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {(["reptiles", "amphibians", "birds", "mammals", "invertebrates"] as const).map((g) => {
            const s = pinStyle(g);
            return (
              <span key={g} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border"
                  style={{ background: s.fill, borderColor: s.color }}
                />
                {s.label}s
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
