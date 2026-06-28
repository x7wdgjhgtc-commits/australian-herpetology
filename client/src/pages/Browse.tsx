import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, X, LayoutGrid, List, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import {
  fetchSpecies,
  apiGetCatalog,
  type SpeciesGroup,
  type SpeciesListResponse,
  type SpeciesCountResult,
  type CatalogSpecies,
} from "@/lib/api";
import {
  GROUPS,
  FAMILIES,
  familiesForGroup,
  classifySpecies,
  type HerpGroup,
  type FamilyDef,
} from "@/lib/taxonomy";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMySpecies } from "@/lib/mySpecies";
import { SeenBadge } from "@/components/SeenBadge";
import { UnseenBadge } from "@/components/UnseenBadge";

// "All" + the five vernacular groups
const TOP_GROUPS: { value: SpeciesGroup; label: string }[] = [
  { value: "all", label: "All" },
  ...GROUPS.map((g) => ({ value: g.value as SpeciesGroup, label: g.label })),
];

export default function Browse() {
  const mySpecies = useMySpecies();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [group, setGroup] = useState<SpeciesGroup>("all");
  // Drill-down: family (iNat id) and genus name. Filter the loaded
  // species client-side once a group is selected (server returns whole group).
  const [familyId, setFamilyId] = useState<number | null>(null);
  const [genus, setGenus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  // Collapsible filter shelf — hide the group/family/genus chip rows when
  // collapsed so the search bar + active filters stay visible but the shelf
  // doesn't dominate the screen, especially on mobile. Search bar and the
  // "active filter chips" row remain visible in both states.
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Reset deeper filters when group changes
  useEffect(() => {
    setFamilyId(null);
    setGenus(null);
  }, [group]);
  // Reset genus when family changes
  useEffect(() => {
    setGenus(null);
  }, [familyId]);

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const perPage = 30;

  // For family drill-down we pass the family's taxon_id directly to iNat
  // (server-side filter — efficient). Genus is filtered client-side from
  // the returned binomial because genus IDs aren't curated.
  const taxonIdForFetch = familyId ?? undefined;

  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<SpeciesListResponse>({
    queryKey: ["/api/species", debouncedQ, group, taxonIdForFetch, "infinite"],
    queryFn: ({ pageParam = 1 }) =>
      fetchSpecies(debouncedQ, group, pageParam as number, perPage, taxonIdForFetch),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.results.length, 0);
      return fetched < lastPage.total_results ? allPages.length + 1 : undefined;
    },
  });

  const allLoaded = useMemo(
    () => data?.pages.flatMap((p) => p.results) ?? [],
    [data],
  );

  // Pull the merged catalog so admin-added species (newly described taxa,
  // species not yet on iNat, manual entries) appear alongside the iNat list.
  // Filtered server-side by group/family/q so we only fetch what we need.
  const catalogQuery = useQuery({
    queryKey: [
      "/api/species/catalog",
      "browse-overlay",
      group,
      familyId,
      debouncedQ,
    ],
    queryFn: () =>
      apiGetCatalog({
        group:
          group === "all" || group === "reptiles" || group === "amphibians"
            ? undefined
            : group,
        familyId: familyId ?? undefined,
        q: debouncedQ || undefined,
      }),
    staleTime: 60_000,
  });

  // Convert a catalog row into the SpeciesCountResult shape Browse already
  // renders. Used only for rows the iNat search didn't return.
  const catalogToResult = (c: CatalogSpecies): SpeciesCountResult => ({
    count: 0,
    taxon: {
      id: c.id,
      name: c.scientific,
      preferred_common_name: c.common ?? undefined,
      rank: "species",
      iconic_taxon_name:
        c.group === "frogs" ? "Amphibia" : c.group ? "Reptilia" : undefined,
      default_photo: null,
      // Carry the server-resolved hero (admin-forced → admin-pinned →
      // top-liked) onto catalog-only entries so they show the same
      // primary image as the Species detail page when one exists.
      hero_photo_url: c.heroPhotoUrl ?? null,
      ancestor_ids: [],
    },
  });

  // Unified species list. The merged catalog (admin entries + shipped CATALOG)
  // is the SOLE source of truth — iNat was only used to seed the foundation.
  // Every catalog row is rendered identically regardless of origin. We overlay
  // iNat default_photo URLs from the iNat infinite-scroll fetch onto matching
  // ids purely as a photo source for cards that don't have a server-resolved
  // hero. Ordering: alphabetical by scientific name so admin and iNat species
  // interleave naturally.
  const merged = useMemo<SpeciesCountResult[]>(() => {
    // Index iNat results by id so we can lift their default_photo onto the
    // matching catalog row.
    const inatById = new Map<number, SpeciesCountResult>();
    for (const r of allLoaded) inatById.set(r.taxon.id, r);

    const rows: SpeciesCountResult[] = [];
    for (const c of catalogQuery.data?.species ?? []) {
      // When a super-group filter is active, restrict to its sub-groups.
      if (group === "reptiles" && c.group && !(
        c.group === "snakes" || c.group === "lizards" || c.group === "turtles" || c.group === "crocs"
      )) continue;
      if (group === "amphibians" && c.group !== "frogs") continue;

      const base = catalogToResult(c);
      const inat = inatById.get(c.id);
      if (inat) {
        // Lift iNat photo + observation count onto the catalog row when
        // available. The catalog row's heroPhotoUrl still wins in the card.
        base.count = inat.count;
        base.taxon.default_photo = inat.taxon.default_photo ?? null;
        base.taxon.iconic_taxon_name =
          inat.taxon.iconic_taxon_name ?? base.taxon.iconic_taxon_name;
        base.taxon.observations_count = inat.taxon.observations_count;
        base.taxon.ancestor_ids = inat.taxon.ancestor_ids ?? [];
      }
      rows.push(base);
    }

    rows.sort((a, b) => {
      const aName = (a.taxon.preferred_common_name || a.taxon.name || "").toLowerCase();
      const bName = (b.taxon.preferred_common_name || b.taxon.name || "").toLowerCase();
      return aName.localeCompare(bName);
    });
    return rows;
  }, [allLoaded, catalogQuery.data, group]);

  // Filter by genus client-side if set
  const flat = useMemo(() => {
    if (!genus) return merged;
    return merged.filter((r) => {
      const first = r.taxon.name?.trim().split(/\s+/)[0];
      return first === genus;
    });
  }, [merged, genus]);

  // Use the merged-catalog total so admin-added species count toward the
  // headline tally. Falls back to the iNat total while the catalog query is
  // loading so the number doesn't flash to 0.
  const total =
    catalogQuery.data?.total ?? data?.pages?.[0]?.total_results ?? 0;

  // Available families: when a group is selected, list its families.
  // When "All" is selected, no family selector is shown.
  const availableFamilies: FamilyDef[] = useMemo(() => {
    if (group === "all" || group === "reptiles" || group === "amphibians") return [];
    return familiesForGroup(group as HerpGroup);
  }, [group]);

  // Available genera: derived from the loaded species' binomials.
  // We compute counts so users see which genera are well-represented.
  const availableGenera = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of merged) {
      const g = r.taxon.name?.trim().split(/\s+/)[0];
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  }, [merged]);

  // Infinite-scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetching) {
          fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);

  // Eagerly drain pages when a genus filter is active so client-side filtering
  // doesn't leave the user staring at a near-empty grid.
  useEffect(() => {
    if (genus && hasNextPage && !isFetching && flat.length < 24) {
      fetchNextPage();
    }
  }, [genus, hasNextPage, isFetching, flat.length, fetchNextPage]);

  // Showing N · total catalog count is always the merged catalog size for the
  // current group/family/search scope. Genus narrows further client-side.
  const showingCount = flat.length;
  const labelTotal = genus
    ? `${showingCount.toLocaleString()} of ${merged.length.toLocaleString()} species`
    : `${merged.length.toLocaleString()} species`;

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = [];
    if (group !== "all") {
      const g = TOP_GROUPS.find((x) => x.value === group);
      chips.push({
        key: "g",
        label: g?.label ?? group,
        onClear: () => setGroup("all"),
      });
    }
    if (familyId) {
      const f = FAMILIES.find((x) => x.id === familyId);
      if (f) chips.push({ key: "f", label: f.name, onClear: () => setFamilyId(null) });
    }
    if (genus) {
      chips.push({ key: "ge", label: genus, onClear: () => setGenus(null) });
    }
    return chips;
  }, [group, familyId, genus]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1
          className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight"
          data-testid="text-browse-title"
        >
          Species
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {merged.length ? `${labelTotal} in the Australian herpetofauna` : "Browse the Australian herpetofauna"}
        </p>
      </div>

      {/* Sticky filter shelf */}
      <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/95 backdrop-blur border-b border-border mb-6 space-y-3">
        {/* Search + view toggle */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, e.g. carpet python, water dragon, bell frog"
              className="w-full pl-10 pr-4 py-2.5 rounded-md border border-input bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-search"
            />
          </div>
          {/* Collapse / expand the chip filters */}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="browse-filter-chips"
            title={filtersOpen ? "Hide filters" : "Show filters"}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-input bg-card text-sm self-start sm:self-auto transition-colors",
              filtersOpen
                ? "text-foreground"
                : "text-foreground/70 hover-elevate",
            )}
            data-testid="button-toggle-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
            {filtersOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <div className="inline-flex rounded-md border border-input bg-card overflow-hidden self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              aria-label="Grid view"
              title="Grid view"
              className={cn(
                "px-3 py-2 inline-flex items-center justify-center text-sm transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/70 hover-elevate",
              )}
              data-testid="button-view-grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              aria-label="List view"
              title="List view"
              className={cn(
                "px-3 py-2 inline-flex items-center justify-center text-sm transition-colors border-l border-input",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/70 hover-elevate",
              )}
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Group / family / genus chips — hidden when filters are collapsed.
            The active-filter chips row below stays visible regardless so the
            user always sees what's filtered. */}
        {filtersOpen && (
        <div id="browse-filter-chips" className="space-y-3">
        {/* Top-level group chips */}
        <div className="flex flex-wrap gap-1.5">
          {TOP_GROUPS.map((g) => (
            <button
              key={g.value}
              onClick={() => setGroup(g.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors",
                group === g.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground/80 border-border hover-elevate",
              )}
              data-testid={`button-filter-${g.value}`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Family chips (only when a vernacular group is selected) */}
        {availableFamilies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
              Family
            </span>
            <button
              onClick={() => setFamilyId(null)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border",
                familyId === null
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground/70 border-border hover-elevate",
              )}
              data-testid="button-family-all"
            >
              All families
            </button>
            {availableFamilies.map((f) => (
              <button
                key={f.id}
                onClick={() => setFamilyId(f.id)}
                title={f.common}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border italic",
                  familyId === f.id
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground/70 border-border hover-elevate",
                )}
                data-testid={`button-family-${f.id}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        {/* Genus chips (only when family is selected OR group is selected — derived from loaded data) */}
        {group !== "all" && availableGenera.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
              Genus
            </span>
            <button
              onClick={() => setGenus(null)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border",
                genus === null
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground/70 border-border hover-elevate",
              )}
              data-testid="button-genus-all"
            >
              All genera
            </button>
            {availableGenera.slice(0, 40).map((g) => (
              <button
                key={g.name}
                onClick={() => setGenus(g.name)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border italic inline-flex items-center gap-1",
                  genus === g.name
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground/70 border-border hover-elevate",
                )}
                data-testid={`button-genus-${g.name}`}
              >
                {g.name}
                <span className="not-italic text-[10px] opacity-70">{g.count}</span>
              </button>
            ))}
            {availableGenera.length > 40 && (
              <span className="text-[10px] text-muted-foreground italic">
                + {availableGenera.length - 40} more (load more results to reveal)
              </span>
            )}
          </div>
        )}
        </div>
        )}

        {/* Active filter chips with clear-individual buttons */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
              Filters
            </span>
            {activeChips.map((c) => (
              <button
                key={c.key}
                onClick={c.onClear}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15"
                data-testid={`chip-active-${c.key}`}
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
            ))}
            <button
              onClick={() => {
                setGroup("all");
                setFamilyId(null);
                setGenus(null);
              }}
              className="text-[11px] text-muted-foreground underline ml-1"
              data-testid="button-clear-all"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {(isLoading || (catalogQuery.isLoading && merged.length === 0)) ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="aspect-square rounded-lg" />
                <Skeleton className="h-3 w-3/4 mt-2" />
                <Skeleton className="h-3 w-1/2 mt-1" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-14 w-14 rounded-md shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : flat.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-no-results">
          No species match those filters. Try clearing the genus or family selection.
        </div>
      ) : (
        <>
          {viewMode === "grid" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {flat.map((r) => {
              const tax = classifySpecies({
                ancestorIds: r.taxon.ancestor_ids,
                name: r.taxon.name,
              });
              const myCount = mySpecies.countsBySpecies.get(r.taxon.id) ?? 0;
              const groupLabelText =
                tax.group === "snakes" ? "Snake"
                : tax.group === "lizards" ? "Lizard"
                : tax.group === "turtles" ? "Turtle"
                : tax.group === "crocs" ? "Croc"
                : tax.group === "frogs" ? "Frog"
                : r.taxon.iconic_taxon_name === "Amphibia" ? "Amphibian"
                : "Reptile";
              return (
                <Link
                  key={r.taxon.id}
                  href={`/species/${r.taxon.id}`}
                  className="group block"
                  data-testid={`card-browse-${r.taxon.id}`}
                >
                  <div className="aspect-square rounded-lg overflow-hidden border border-border bg-muted relative">
                    {(r.taxon.hero_photo_url || r.taxon.default_photo?.medium_url) ? (
                      <img
                        src={r.taxon.hero_photo_url || r.taxon.default_photo!.medium_url!}
                        alt={r.taxon.preferred_common_name || r.taxon.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">
                        No photo
                      </div>
                    )}
                    <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-card/90 backdrop-blur px-1.5 py-0.5 rounded text-foreground/70">
                      {groupLabelText}
                    </div>
                    <div className="absolute top-2 right-2">
                      {myCount > 0 ? (
                        <SeenBadge count={myCount} variant="dot" />
                      ) : (
                        <UnseenBadge variant="dot" />
                      )}
                    </div>
                    {tax.family && (
                      <div className="absolute bottom-2 left-2 right-2 text-[10px] tracking-wide bg-card/90 backdrop-blur px-1.5 py-0.5 rounded text-foreground/70 italic truncate">
                        {tax.family.name}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 px-1">
                    <div className="font-medium text-sm leading-tight line-clamp-1">
                      {r.taxon.preferred_common_name || r.taxon.name}
                    </div>
                    <div className="text-xs italic text-muted-foreground line-clamp-1">
                      {r.taxon.name}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          )}
          {viewMode === "list" && (
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-card">
            {flat.map((r) => {
              const tax = classifySpecies({
                ancestorIds: r.taxon.ancestor_ids,
                name: r.taxon.name,
              });
              const myCount = mySpecies.countsBySpecies.get(r.taxon.id) ?? 0;
              const groupLabelText =
                tax.group === "snakes" ? "Snake"
                : tax.group === "lizards" ? "Lizard"
                : tax.group === "turtles" ? "Turtle"
                : tax.group === "crocs" ? "Croc"
                : tax.group === "frogs" ? "Frog"
                : r.taxon.iconic_taxon_name === "Amphibia" ? "Amphibian"
                : "Reptile";
              return (
                <Link
                  key={r.taxon.id}
                  href={`/species/${r.taxon.id}`}
                  className="group flex items-center gap-3 p-3 hover-elevate"
                  data-testid={`row-browse-${r.taxon.id}`}
                >
                  <div className="relative h-14 w-14 shrink-0 rounded-md overflow-hidden border border-border bg-muted">
                    {(r.taxon.hero_photo_url || r.taxon.default_photo?.medium_url) ? (
                      <img
                        src={r.taxon.hero_photo_url || r.taxon.default_photo!.medium_url!}
                        alt={r.taxon.preferred_common_name || r.taxon.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-muted-foreground text-[10px]">
                        No photo
                      </div>
                    )}
                    <div className="absolute -top-1 -right-1">
                      {myCount > 0 ? (
                        <SeenBadge count={myCount} variant="dot" />
                      ) : (
                        <UnseenBadge variant="dot" className="w-4 h-4" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-sm leading-tight truncate">
                        {r.taxon.preferred_common_name || r.taxon.name}
                      </div>
                      <span className="text-[10px] uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded text-foreground/70 shrink-0">
                        {groupLabelText}
                      </span>
                    </div>
                    <div className="text-xs italic text-muted-foreground truncate">
                      {r.taxon.name}
                      {tax.family && (
                        <span className="not-italic"> · {tax.family.name}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          )}
          <div ref={sentinelRef} className="h-12" />
          {isFetching && hasNextPage && (
            <div className="text-center text-sm text-muted-foreground py-6">
              Loading more…
            </div>
          )}
        </>
      )}
    </div>
  );
}
