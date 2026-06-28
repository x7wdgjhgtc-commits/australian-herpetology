/**
 * Grey dashed-circle placeholder for a species the viewer has NOT yet recorded.
 *
 * Mirrors SeenBadge variants so the two can swap 1:1 based on whether the user
 * has the species in their tally:
 *   - "dot"    = circular dashed outline (for thumbnail overlays)
 *   - "chip"   = pill with dashed-circle + "Not yet" text
 *   - "inline" = small inline dashed circle only
 *
 * The intent is that *every* species reference in the app shows either the
 * green seen-tick or this grey dashed-circle, so the visual recorded/unrecorded
 * distinction is consistent across Browse, Map search, Species detail, etc.
 */
import { cn } from "@/lib/utils";

export interface UnseenBadgeProps {
  variant?: "dot" | "chip" | "inline";
  className?: string;
}

export function UnseenBadge({ variant = "dot", className }: UnseenBadgeProps) {
  if (variant === "inline") {
    return (
      <span
        title="Not yet recorded"
        aria-label="Not yet recorded"
        data-testid="badge-unseen-inline"
        className={cn(
          "inline-block w-3 h-3 rounded-full border border-dashed border-muted-foreground/60 bg-transparent shrink-0",
          className,
        )}
      />
    );
  }

  if (variant === "chip") {
    return (
      <span
        title="Not yet recorded"
        data-testid="badge-unseen-chip"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-xs font-medium",
          className,
        )}
      >
        <span className="inline-block w-3 h-3 rounded-full border border-dashed border-muted-foreground/70" />
        Not yet
      </span>
    );
  }

  // dot
  return (
    <span
      title="Not yet recorded"
      aria-label="Not yet recorded"
      data-testid="badge-unseen-dot"
      className={cn(
        "inline-block w-6 h-6 rounded-full border border-dashed border-muted-foreground/60 bg-card/70 backdrop-blur-sm shadow-sm ring-2 ring-card",
        className,
      )}
    />
  );
}
