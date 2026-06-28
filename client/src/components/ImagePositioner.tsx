import { useEffect, useRef, useState } from "react";
import { Move, RotateCcw } from "lucide-react";

/**
 * Lets the user drag inside a fixed-aspect frame to reposition an `object-fit:
 * cover` image. The image stays full-size; only its `object-position` changes.
 *
 * Returns the position as a CSS string like "50% 30%" via `onChange`. Default
 * is "50% 50%" (centered).
 *
 * Drag math:
 *   - We treat the position values as 0–100% on each axis.
 *   - As the cursor moves, we translate movement-pixels into percentage-points
 *     scaled by the visible frame size, so a full-frame drag covers the full
 *     0–100% range. We invert sign so dragging the image up moves the
 *     y-position toward 100% (revealing what was below).
 */
export function ImagePositioner({
  src,
  position,
  onChange,
  aspect = "16 / 6",
  rounded = "rounded-lg",
  testId,
}: {
  src: string;
  position: string | null | undefined;
  onChange: (next: string) => void;
  /** e.g. "16 / 6" for cover banner, "1 / 1" for avatar */
  aspect?: string;
  rounded?: string;
  testId?: string;
}) {
  const parsed = parsePosition(position);
  const [xy, setXy] = useState<{ x: number; y: number }>(parsed);
  // Keep latest xy in a ref so pointer handlers can read it without closure staleness.
  const xyRef = useRef<{ x: number; y: number }>(parsed);
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    rectW: number;
    rectH: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Keep local state in sync when the prop changes (e.g. user uploads a new image).
  useEffect(() => {
    const p = parsePosition(position);
    setXy(p);
    xyRef.current = p;
  }, [position]);

  function commit(next: { x: number; y: number }) {
    setXy(next);
    xyRef.current = next;
    onChange(`${round(next.x)}% ${round(next.y)}%`);
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = frameRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: xy.x,
      startY: xy.y,
      rectW: rect.width,
      rectH: rect.height,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    // Drag right → reveal what was on the left → x decreases. So invert sign.
    const nextX = clamp(d.startX - (dx / d.rectW) * 100, 0, 100);
    const nextY = clamp(d.startY - (dy / d.rectH) * 100, 0, 100);
    const next = { x: nextX, y: nextY };
    xyRef.current = next;
    setXy(next);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    commit(xyRef.current);
  }

  function reset() {
    commit({ x: 50, y: 50 });
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={frameRef}
        className={`relative w-full overflow-hidden border border-border bg-muted touch-none select-none cursor-move ${rounded}`}
        style={{ aspectRatio: aspect }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid={testId}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `${xy.x}% ${xy.y}%` }}
        />
        <div className="pointer-events-none absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-background/85 text-foreground/80 text-[10px] px-1.5 py-0.5 font-medium">
          <Move className="h-3 w-3" /> Drag to reposition
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          Position: {round(xy.x)}% × {round(xy.y)}%
        </span>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Center
        </button>
      </div>
    </div>
  );
}

function parsePosition(pos: string | null | undefined): { x: number; y: number } {
  if (!pos) return { x: 50, y: 50 };
  const m = pos.trim().match(/^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  if (!m) return { x: 50, y: 50 };
  return {
    x: clamp(parseFloat(m[1]), 0, 100),
    y: clamp(parseFloat(m[2]), 0, 100),
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round(n: number) {
  return Math.round(n);
}
