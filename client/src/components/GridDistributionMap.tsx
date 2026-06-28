import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchDistributionGrid,
  apiUpsertRangeCell,
  apiDeleteRangeCell,
  apiAddRangePolygon,
  apiDeleteRangePolygon,
  apiHideRecord,
  type DistributionGridResponse,
  type DistributionGridCell,
  type DistributionGridPolygon,
  type DistributionGridPoint,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Hand, MapPinOff, Pentagon, MousePointerClick, Trash2 } from "lucide-react";
import australiaOutline from "@/lib/australiaOutline.json";
import australiaStates from "@/lib/australiaStates.json";

interface Props {
  speciesId: number;
  isAdmin?: boolean;
  height?: number;
}

type EditTool = "none" | "cell" | "polygon" | "hide" | "delete";

type DeleteTarget =
  | { kind: "polygon"; id: number; label?: string }
  | { kind: "cell"; latIdx: number; lngIdx: number; count: number }
  | { kind: "point"; id: number; source: string };

const CELL_SIZE = 0.5; // degrees

/**
 * Density shading: light → dark on a green ramp. We compute relative
 * intensity from cell.count / maxCount so popular species don't blow
 * out the scale.
 */
function cellColor(cell: DistributionGridCell, maxCount: number): string {
  if (cell.source === "admin" && cell.count === 0) {
    // Admin-added empty cell — show as pale lavender
    return "hsl(280 50% 72%)";
  }
  // Two-stop yellow → green ramp (log scale to compress popular species)
  const ratio = maxCount > 0 ? Math.log10(1 + cell.count) / Math.log10(1 + maxCount) : 0;
  const hue = 60 + (145 - 60) * ratio;
  const lightness = 75 - 40 * ratio;
  const saturation = 55 + 10 * ratio;
  return `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}

function cellBoundsLatLng(latIdx: number, lngIdx: number): L.LatLngBoundsLiteral {
  const lat0 = latIdx * CELL_SIZE;
  const lng0 = lngIdx * CELL_SIZE;
  return [
    [lat0, lng0],
    [lat0 + CELL_SIZE, lng0 + CELL_SIZE],
  ];
}

function cellIndexFromLatLng(lat: number, lng: number): { latIdx: number; lngIdx: number } {
  return {
    latIdx: Math.floor(lat / CELL_SIZE),
    lngIdx: Math.floor(lng / CELL_SIZE),
  };
}

export default function GridDistributionMap({ speciesId, isAdmin, height = 520 }: Props) {
  const { toast } = useToast();
  const [tool, setTool] = useState<EditTool>("none");
  // Live polygon-drawing state
  const [drawingPoints, setDrawingPoints] = useState<Array<[number, number]>>([]);
  // Cell-mode pending action
  const [busy, setBusy] = useState(false);
  // Pending delete confirmation (AlertDialog) — window.confirm is blocked in iframe
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  // Everyone sees individual record points on the species map. The hide /
  // edit tools remain admin-only — a non-admin click just opens the record.
  const includePoints = true;
  const queryKey = ["/api/species/distribution-grid", speciesId, { points: includePoints }];

  const { data, isLoading, error } = useQuery<DistributionGridResponse>({
    queryKey,
    queryFn: () => fetchDistributionGrid(speciesId, { points: includePoints }),
  });

  // ─── Map refs ──────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const cellLayerRef = useRef<L.LayerGroup | null>(null);
  const polyLayerRef = useRef<L.LayerGroup | null>(null);
  const pointLayerRef = useRef<L.LayerGroup | null>(null);
  const drawingLayerRef = useRef<L.LayerGroup | null>(null);

  // Read latest tool inside map click handler without re-binding
  const toolRef = useRef<EditTool>(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  const drawingPointsRef = useRef(drawingPoints);
  useEffect(() => {
    drawingPointsRef.current = drawingPoints;
  }, [drawingPoints]);
  // Refs so the mount-time map click handler can read fresh isAdmin
  // and call the latest toggleCell mutation without re-binding.
  const isAdminRef = useRef(isAdmin);
  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);
  const toggleCellRef = useRef<
    | ((p: { latIdx: number; lngIdx: number; currentlyPresent: boolean }) => void)
    | null
  >(null);
  // Cell count ref so the ResizeObserver knows whether data is present
  // without re-binding when `data` changes.
  const cellCountRef = useRef(0);
  useEffect(() => {
    cellCountRef.current = data?.cells.length ?? 0;
  }, [data]);

  // ─── Mutations ─────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const toggleCell = useMutation({
    mutationFn: async ({
      latIdx,
      lngIdx,
      currentlyPresent,
    }: {
      latIdx: number;
      lngIdx: number;
      currentlyPresent: boolean;
    }) => {
      if (currentlyPresent) {
        return apiUpsertRangeCell(speciesId, latIdx, lngIdx, false);
      }
      return apiUpsertRangeCell(speciesId, latIdx, lngIdx, true);
    },
    onSuccess: (_d, vars) => {
      invalidate();
      toast({
        title: vars.currentlyPresent ? "Square removed" : "Square added",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Cell edit failed", description: e.message, variant: "destructive" }),
  });
  // Keep ref pointing at the latest mutate function for the map click handler.
  useEffect(() => {
    toggleCellRef.current = (p) => toggleCell.mutate(p);
  }, [toggleCell]);

  const clearCellOverride = useMutation({
    mutationFn: ({ latIdx, lngIdx }: { latIdx: number; lngIdx: number }) =>
      apiDeleteRangeCell(speciesId, latIdx, lngIdx),
    onSuccess: invalidate,
  });

  const addPolygon = useMutation({
    mutationFn: (polygon: Array<[number, number]>) =>
      apiAddRangePolygon(speciesId, polygon),
    onSuccess: () => {
      setDrawingPoints([]);
      invalidate();
      toast({ title: "Polygon saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Polygon save failed", description: e.message, variant: "destructive" }),
  });

  const deletePolygon = useMutation({
    mutationFn: (id: number) => apiDeleteRangePolygon(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Polygon deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Polygon delete failed", description: e.message, variant: "destructive" }),
  });

  const hidePoint = useMutation({
    mutationFn: (recordId: number) => apiHideRecord(recordId, speciesId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Point hidden" });
    },
    onError: (e: Error) =>
      toast({ title: "Hide failed", description: e.message, variant: "destructive" }),
  });

  // ─── Initialize Leaflet map once ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      worldCopyJump: false,
      attributionControl: false,
    });
    // Bundled Australia outline as basemap. Remote tile servers are
    // blocked by the deploy iframe CSP (img-src 'self'), so we draw a
    // self-hosted vector basemap instead.
    // Ocean fill behind everything
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
    // State / territory boundaries (subtle dashed)
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
    // 10° graticule
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
    // Always fit Australia in the viewport on mount.
    const ausBounds = baseLayer.getBounds();
    if (ausBounds.isValid()) {
      map.fitBounds(ausBounds, { padding: [8, 8] });
    } else {
      map.setView([-25, 134], 4);
    }
    // Refit on container resize so the outline always fills the box.
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (ausBounds.isValid() && cellCountRef.current === 0) {
        map.fitBounds(ausBounds, { padding: [8, 8] });
      }
    });
    ro.observe(containerRef.current);
    cellLayerRef.current = L.layerGroup().addTo(map);
    polyLayerRef.current = L.layerGroup().addTo(map);
    pointLayerRef.current = L.layerGroup().addTo(map);
    drawingLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Map-click handler — handles polygon point capture and cell add
    map.on("click", (e: L.LeafletMouseEvent) => {
      const t = toolRef.current;
      if (t === "polygon") {
        const next: [number, number] = [e.latlng.lng, e.latlng.lat];
        setDrawingPoints([...drawingPointsRef.current, next]);
        return;
      }
      if (t === "cell" && isAdminRef.current) {
        // Click landed on empty map (no cell rectangle absorbed it).
        // Compute the cell index and add a new admin square here.
        const { latIdx, lngIdx } = cellIndexFromLatLng(e.latlng.lat, e.latlng.lng);
        toggleCellRef.current?.({ latIdx, lngIdx, currentlyPresent: false });
      }
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      cellLayerRef.current = null;
      polyLayerRef.current = null;
      pointLayerRef.current = null;
      drawingLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Cursor reflects current tool ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (tool === "polygon") containerRef.current.style.cursor = "crosshair";
    else if (tool === "cell") containerRef.current.style.cursor = "pointer";
    else if (tool === "hide") containerRef.current.style.cursor = "not-allowed";
    else containerRef.current.style.cursor = "";
  }, [tool]);

  // ─── Render cells ─────────────────────────────────────────────────────
  useEffect(() => {
    const layer = cellLayerRef.current;
    if (!layer || !data) return;
    layer.clearLayers();
    const maxCount = data.maxCount;
    for (const c of data.cells) {
      const bounds = cellBoundsLatLng(c.latIdx, c.lngIdx);
      const rect = L.rectangle(bounds, {
        color: "hsl(140 30% 24%)",
        weight: 0.6,
        opacity: 0.6,
        fillColor: cellColor(c, maxCount),
        fillOpacity: c.source === "admin" && c.count === 0 ? 0.55 : 0.65,
      });
      const badge =
        c.source === "admin"
          ? `<span style="color:hsl(280 50% 35%);font-size:11px;">admin-edited</span>`
          : "";
      rect.bindTooltip(
        `<div style="font-size:12px"><b>${c.count}</b> record${c.count === 1 ? "" : "s"}<br/>${badge}</div>`,
        { sticky: true },
      );
      rect.on("click", (ev: L.LeafletMouseEvent) => {
        // Don't open tooltip-as-click in cell-edit; just stop propagation
        // so the map's click (polygon) handler doesn't also fire.
        const t = toolRef.current;
        if (!isAdmin || t === "none") return;
        if (t === "cell") {
          L.DomEvent.stopPropagation(ev);
          // Open shadcn confirm dialog before removing the square.
          setPendingDelete({
            kind: "cell",
            latIdx: c.latIdx,
            lngIdx: c.lngIdx,
            count: c.count,
          });
        }
      });
      rect.addTo(layer);
    }
  }, [data, isAdmin, toggleCell]);

  // ─── Render polygons ──────────────────────────────────────────────────
  useEffect(() => {
    const layer = polyLayerRef.current;
    if (!layer || !data) return;
    layer.clearLayers();
    for (const p of data.polygons) {
      if (!Array.isArray(p.polygon) || p.polygon.length < 3) continue;
      // Stored as [lng,lat] pairs; Leaflet wants [lat,lng]
      const latlngs = p.polygon.map(([lng, lat]) => [lat, lng] as [number, number]);
      const poly = L.polygon(latlngs, {
        color: "hsl(20 70% 45%)",
        weight: 2,
        fillColor: "hsl(20 70% 55%)",
        fillOpacity: 0.18,
      });
      poly.bindTooltip(p.label ?? "Range polygon", { sticky: true });
      if (isAdmin) {
        poly.on("click", (ev: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(ev);
          const t = toolRef.current;
          // Don't intercept while drawing a new polygon
          if (t === "polygon") return;
          // Open shadcn confirm dialog (window.confirm is blocked in iframe)
          setPendingDelete({
            kind: "polygon",
            id: p.id,
            label: p.label ?? undefined,
          });
        });
        // Hint that polygon is clickable
        poly.on("mouseover", () => {
          poly.setStyle({ fillOpacity: 0.32, weight: 3 });
        });
        poly.on("mouseout", () => {
          poly.setStyle({ fillOpacity: 0.18, weight: 2 });
        });
      }
      poly.addTo(layer);
    }
  }, [data, isAdmin, deletePolygon]);

  // ─── Render raw points (admin only) ────────────────────────────────────
  useEffect(() => {
    const layer = pointLayerRef.current;
    if (!layer || !data) return;
    layer.clearLayers();
    const points = data.points ?? [];
    const sourceStyle = (src: string) => {
      if (src === "app") {
        return { color: "hsl(20 75% 32%)", fill: "hsl(20 85% 55%)", label: "Field record" };
      }
      if (src === "ala") {
        return { color: "hsl(220 70% 28%)", fill: "hsl(220 75% 55%)", label: "ALA" };
      }
      return { color: "hsl(36 80% 28%)", fill: "hsl(36 85% 55%)", label: "iNaturalist" };
    };
    for (const pt of points) {
      const style = sourceStyle(pt.source);
      const marker = L.circleMarker([pt.lat, pt.lng], {
        radius: pt.source === "app" ? 4 : 3,
        weight: 1,
        color: style.color,
        fillColor: style.fill,
        fillOpacity: 0.85,
      });
      marker.bindTooltip(
        `<div style="font-size:11px"><b>${style.label}</b> #${pt.id}<br/>${pt.date ?? "no date"}</div>`,
        { sticky: true },
      );
      marker.on("click", (ev: L.LeafletMouseEvent) => {
        const t = toolRef.current;
        if (isAdminRef.current && t === "hide") {
          L.DomEvent.stopPropagation(ev);
          setPendingDelete({
            kind: "point",
            id: pt.id,
            source: pt.source,
          });
        }
      });
      marker.addTo(layer);
    }
  }, [data, isAdmin, hidePoint]);

  // ─── Render live polygon drawing preview ──────────────────────────────
  useEffect(() => {
    const layer = drawingLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (drawingPoints.length === 0) return;
    const latlngs = drawingPoints.map(
      ([lng, lat]) => [lat, lng] as [number, number],
    );
    // Show points + connecting line
    for (const p of latlngs) {
      L.circleMarker(p, {
        radius: 4,
        weight: 2,
        color: "hsl(20 70% 45%)",
        fillColor: "hsl(36 80% 60%)",
        fillOpacity: 1,
      }).addTo(layer);
    }
    if (latlngs.length >= 2) {
      L.polyline(latlngs, {
        color: "hsl(20 70% 45%)",
        weight: 2,
        dashArray: "4 4",
      }).addTo(layer);
    }
    if (latlngs.length >= 3) {
      // Close the polygon preview
      L.polyline([latlngs[latlngs.length - 1], latlngs[0]], {
        color: "hsl(20 70% 45%)",
        weight: 2,
        dashArray: "2 6",
        opacity: 0.5,
      }).addTo(layer);
    }
  }, [drawingPoints]);

  // ─── Auto-fit bounds once data arrives ────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !data) return;
    if (data.cells.length === 0) return;
    const bounds = L.latLngBounds(
      data.cells.flatMap((c) => {
        const [sw, ne] = cellBoundsLatLng(c.latIdx, c.lngIdx);
        return [
          L.latLng(sw[0], sw[1]),
          L.latLng(ne[0], ne[1]),
        ];
      }),
    );
    mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
  }, [data?.speciesId, data?.cells.length]);

  const totalCells = data?.cells.length ?? 0;
  const totalRecords = data?.cells.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div className="space-y-3" data-testid="grid-distribution-map">
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Edit:</span>
          <Button
            size="sm"
            variant={tool === "none" ? "default" : "outline"}
            onClick={() => setTool("none")}
            data-testid="button-tool-pan"
          >
            <Hand className="h-3.5 w-3.5 mr-1.5" /> View
          </Button>
          <Button
            size="sm"
            variant={tool === "cell" ? "default" : "outline"}
            onClick={() => setTool("cell")}
            data-testid="button-tool-cell"
          >
            <MousePointerClick className="h-3.5 w-3.5 mr-1.5" /> Add / remove square
          </Button>
          <Button
            size="sm"
            variant={tool === "polygon" ? "default" : "outline"}
            onClick={() => {
              setTool("polygon");
              setDrawingPoints([]);
            }}
            data-testid="button-tool-polygon"
          >
            <Pentagon className="h-3.5 w-3.5 mr-1.5" /> Draw polygon
          </Button>
          <Button
            size="sm"
            variant={tool === "hide" ? "default" : "outline"}
            onClick={() => setTool("hide")}
            data-testid="button-tool-hide"
          >
            <MapPinOff className="h-3.5 w-3.5 mr-1.5" /> Hide point
          </Button>
          {tool === "polygon" && drawingPoints.length > 0 && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDrawingPoints(drawingPoints.slice(0, -1))}
                data-testid="button-polygon-undo"
              >
                Undo last
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={drawingPoints.length < 3 || addPolygon.isPending}
                onClick={() => addPolygon.mutate(drawingPoints)}
                data-testid="button-polygon-save"
              >
                Save polygon ({drawingPoints.length} pts)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDrawingPoints([])}
                data-testid="button-polygon-cancel"
              >
                Cancel
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Badge variant="outline" data-testid="text-grid-cells">
              {totalCells} cells
            </Badge>
            <Badge variant="outline" data-testid="text-grid-records">
              {totalRecords} records
            </Badge>
            {data?.polygons.length ? (
              <Badge variant="outline">{data.polygons.length} polygons</Badge>
            ) : null}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="isolate relative w-full rounded-lg border border-border overflow-hidden bg-muted/30"
        style={{ height }}
        data-testid="map-grid-distribution"
      />
      {isAdmin && tool === "cell" && (
        <p className="text-xs text-muted-foreground" data-testid="text-cell-help">
          Click an existing square to remove it, or click an empty area of the
          map to add a new 0.5° square at that location. Use polygon mode for
          larger custom-shaped ranges.
        </p>
      )}
      {isAdmin && tool === "hide" && (
        <p className="text-xs text-muted-foreground">
          Click an individual observation point (small dot) to hide it from
          the public density map. Hidden points stay in the database.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">
          Could not load distribution: {(error as Error).message}
        </p>
      )}
      {isLoading && !data && (
        <p className="text-xs text-muted-foreground">Loading map…</p>
      )}
      {data && data.cells.length === 0 && data.polygons.length === 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="text-distribution-empty"
        >
          No distribution data yet for this species. Add a field record with a
          location, or {isAdmin ? (
            <>run a distribution import from the admin panel.</>
          ) : (
            <>ask an admin to import reference data from iNaturalist / ALA.</>
          )}
        </p>
      )}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-delete-geometry">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "polygon" && "Delete this range polygon?"}
              {pendingDelete?.kind === "cell" && "Remove this distribution square?"}
              {pendingDelete?.kind === "point" && "Hide this observation point?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "polygon" && (
                <>
                  {pendingDelete.label
                    ? `“${pendingDelete.label}” will be removed from this species map.`
                    : "This custom range polygon will be removed from the map."}{" "}
                  This cannot be undone.
                </>
              )}
              {pendingDelete?.kind === "cell" && (
                <>
                  The {pendingDelete.count}-record square will be hidden from the
                  density map. You can re-add a square in the same spot later.
                </>
              )}
              {pendingDelete?.kind === "point" && (
                <>
                  This {pendingDelete.source.toUpperCase()} observation will be
                  hidden from the public density map. The record stays in the
                  database.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-delete-confirm"
              onClick={() => {
                const target = pendingDelete;
                if (!target) return;
                if (target.kind === "polygon") {
                  deletePolygon.mutate(target.id);
                } else if (target.kind === "cell") {
                  toggleCell.mutate({
                    latIdx: target.latIdx,
                    lngIdx: target.lngIdx,
                    currentlyPresent: true,
                  });
                } else if (target.kind === "point") {
                  hidePoint.mutate(target.id);
                }
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
