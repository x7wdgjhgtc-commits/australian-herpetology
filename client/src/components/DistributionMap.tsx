import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { DistributionPoint } from "@/lib/api";

interface Props {
  points: DistributionPoint[];
  height?: number;
}

/**
 * Leaflet map showing distribution points clustered as small circle markers.
 * We bypass react-leaflet's StrictMode quirks by mounting manually.
 */
export default function DistributionMap({ points, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const bounds = useMemo(() => {
    if (!points.length) return null;
    return L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
  }, [points]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      worldCopyJump: false,
    }).setView([-25, 134], 4);
    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      },
    ).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render points whenever they change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Clear previous markers
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });
    points.forEach((p) => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 4,
        weight: 1,
        color: "hsl(140 30% 24%)",
        fillColor: "hsl(36 60% 50%)",
        fillOpacity: 0.85,
      });
      const date = p.date
        ? new Date(p.date).toLocaleDateString("en-AU", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "Date unknown";
      const place = p.place ? `<div>${escapeHtml(p.place)}</div>` : "";
      marker.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
           ${place}
           <div style="color:hsl(30 14% 38%);margin-top:2px">${date}</div>
           <a href="https://www.inaturalist.org/observations/${p.id}" target="_blank" rel="noopener" style="color:hsl(140 30% 24%);font-weight:500;">View observation →</a>
         </div>`,
      );
      marker.addTo(map);
    });
    if (bounds) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });
    }
  }, [points, bounds]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg border border-border overflow-hidden"
      style={{ height }}
      data-testid="map-distribution"
    />
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
