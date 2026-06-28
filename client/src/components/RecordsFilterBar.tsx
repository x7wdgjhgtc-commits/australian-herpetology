import { useMemo } from "react";
import { LayoutGrid, List, X, HelpCircle } from "lucide-react";
import type { AppRecord, ConditionTag } from "@/lib/api";
import { CONDITION_OPTIONS } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ViewMode = "grid" | "list";

export interface RecordFilters {
  group: string; // "all" | "snakes" | "lizards" | "turtles" | "crocs" | "frogs"
  year: string; // "all" | "YYYY"
  condition: string; // "all" | ConditionTag value
  needsId: boolean;
}

export const EMPTY_FILTERS: RecordFilters = {
  group: "all",
  year: "all",
  condition: "all",
  needsId: false,
};

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All groups" },
  { value: "snakes", label: "Snakes" },
  { value: "lizards", label: "Lizards" },
  { value: "turtles", label: "Turtles" },
  { value: "crocs", label: "Crocs" },
  { value: "frogs", label: "Frogs" },
];

export function applyFilters(
  records: AppRecord[],
  f: RecordFilters,
): AppRecord[] {
  return records.filter((r) => {
    if (f.group !== "all" && r.groupKey !== f.group) return false;
    if (f.year !== "all") {
      const ts = r.observedOn ? new Date(r.observedOn).getTime() : r.createdAt;
      const year = String(new Date(ts).getUTCFullYear());
      if (year !== f.year) return false;
    }
    if (f.condition !== "all" && r.conditionTag !== f.condition) return false;
    if (f.needsId && r.speciesName) return false;
    return true;
  });
}

function uniqueYears(records: AppRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const ts = r.observedOn ? new Date(r.observedOn).getTime() : r.createdAt;
    if (Number.isFinite(ts)) set.add(String(new Date(ts).getUTCFullYear()));
  }
  return Array.from(set).sort((a, b) => Number(b) - Number(a));
}

export function RecordsFilterBar({
  records,
  filters,
  onFiltersChange,
  view,
  onViewChange,
  showViewToggle = true,
  resultCount,
}: {
  records: AppRecord[];
  filters: RecordFilters;
  onFiltersChange: (next: RecordFilters) => void;
  view?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
  showViewToggle?: boolean;
  resultCount: number;
}) {
  const years = useMemo(() => uniqueYears(records), [records]);
  const active =
    filters.group !== "all" ||
    filters.year !== "all" ||
    filters.condition !== "all" ||
    filters.needsId;

  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-4"
      data-testid="records-filter-bar"
    >
      {/* Group */}
      <Select
        value={filters.group}
        onValueChange={(v) => onFiltersChange({ ...filters, group: v })}
      >
        <SelectTrigger
          className="h-9 w-[130px]"
          data-testid="select-filter-group"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Year */}
      <Select
        value={filters.year}
        onValueChange={(v) => onFiltersChange({ ...filters, year: v })}
      >
        <SelectTrigger
          className="h-9 w-[110px]"
          data-testid="select-filter-year"
        >
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All years</SelectItem>
          {years.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Condition */}
      <Select
        value={filters.condition}
        onValueChange={(v) => onFiltersChange({ ...filters, condition: v })}
      >
        <SelectTrigger
          className="h-9 w-[150px]"
          data-testid="select-filter-condition"
        >
          <SelectValue placeholder="Condition" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any condition</SelectItem>
          {CONDITION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Needs ID toggle */}
      <Button
        type="button"
        variant={filters.needsId ? "default" : "outline"}
        size="sm"
        onClick={() =>
          onFiltersChange({ ...filters, needsId: !filters.needsId })
        }
        data-testid="button-filter-needs-id"
        aria-pressed={filters.needsId}
      >
        <HelpCircle className="h-4 w-4 mr-1.5" />
        Needs ID
      </Button>

      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          data-testid="button-filter-clear"
        >
          <X className="h-4 w-4 mr-1" /> Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="text-filter-result-count"
        >
          {resultCount} {resultCount === 1 ? "record" : "records"}
        </span>
        {showViewToggle && view && onViewChange && (
          <div
            className="inline-flex rounded-md border border-border overflow-hidden"
            role="group"
            aria-label="View"
          >
            <button
              type="button"
              onClick={() => onViewChange("grid")}
              className={
                "px-2.5 h-9 text-xs flex items-center gap-1 " +
                (view === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover-elevate")
              }
              aria-pressed={view === "grid"}
              data-testid="button-view-grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewChange("list")}
              className={
                "px-2.5 h-9 text-xs flex items-center gap-1 border-l border-border " +
                (view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover-elevate")
              }
              aria-pressed={view === "list"}
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
