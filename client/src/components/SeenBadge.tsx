/**
 * Green tick badge for a species the viewer has already recorded.
 *
 * Variants:
 *   - "dot"   = circular badge with checkmark (default, for thumbnail overlays)
 *   - "chip"  = pill with checkmark + count text (for list rows / detail)
 *   - "inline"= small inline checkmark only
 *
 * Renders nothing when count is 0 (so it stays out of the way of unseen species).
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SeenBadgeProps {
  count: number;
  variant?: "dot" | "chip" | "inline";
  className?: string;
}

export function SeenBadge({ count, variant = "dot", className }: SeenBadgeProps) {
  if (!count || count <= 0) return null;

  if (variant === "inline") {
    return (
      <span
        title={`You've recorded this ${count} ${count === 1 ? "time" : "times"}`}
        data-testid="badge-seen-inline"
        className={cn(
          "inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white",
          className,
        )}
      >
        <Check className="w-3 h-3" strokeWidth={3} />
      </span>
    );
  }

  if (variant === "chip") {
    return (
      <span
        title={`You've recorded this ${count} ${count === 1 ? "time" : "times"}`}
        data-testid="badge-seen-chip"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium",
          className,
        )}
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white">
          <Check className="w-3 h-3" strokeWidth={3} />
        </span>
        Seen
        <span className="opacity-80">·</span>
        <span className="tabular-nums">{count}</span>
      </span>
    );
  }

  // dot
  return (
    <span
      title={`You've recorded this ${count} ${count === 1 ? "time" : "times"}`}
      data-testid="badge-seen-dot"
      className={cn(
        "inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white shadow-sm ring-2 ring-card",
        className,
      )}
    >
      <Check className="w-3.5 h-3.5" strokeWidth={3} />
    </span>
  );
}
