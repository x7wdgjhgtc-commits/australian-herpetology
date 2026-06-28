import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import {
  apiGetUserSpecies,
  fetchSpeciesTotal,
  apiGetCatalog,
  apiGetSubspeciesCatalog,
  type UserSpeciesResponse,
  type UserSpeciesCount,
  type CatalogSpecies,
  type CatalogSubspecies,
} from "@/lib/api";
import {
  GROUPS,
  FAMILIES,
  type HerpGroup,
  type FamilyDef,
} from "@/lib/taxonomy";
import { Skeleton } from "@/components/ui/skeleton";

const REPTILE_GROUPS: HerpGroup[] = ["snakes", "lizards", "turtles", "crocs"];
const AMPHIBIAN_GROUPS: HerpGroup[] = ["frogs"];

/**
 * A horizontal progress bar showing N of total species recorded.
 */
function Bar({
  numerator,
  denominator,
  label,
  sublabel,
  loading,
  tone = "primary",
  testId,
}: {
  numerator: number;
  denominator: number | null;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  loading?: boolean;
  tone?: "primary" | "muted";
  testId?: string;
}) {
  const pct =
    denominator && denominator > 0
      ? Math.min(100, Math.round((numerator / denominator) * 100))
      : 0;
  const barColor = tone === "primary" ? "bg-primary" : "bg-foreground/40";
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{label}</div>
          {sublabel && (
            <div className="text-[11px] text-muted-foreground truncate">
              {sublabel}
            </div>
          )}
        </div>
        <div className="text-sm tabular-nums shrink-0">
          {loading ? (
            <Skeleton className="h-4 w-12 inline-block" />
          ) : (
            <>
              <span className="font-semibold">{numerator}</span>
              {denominator != null && (
                <span className="text-muted-foreground">
                  {" "}
                  / {denominator}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SpeciesTally({ username }: { username: string }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<HerpGroup>>(
    new Set(),
  );
  // Families are collapsed by default — clicking the family bar reveals its genera.
  const [expandedFamilies, setExpandedFamilies] = useState<Set<number>>(new Set());
  // Genus keys are unique strings; we expand them to fetch the catalog list.
  const [expandedGenera, setExpandedGenera] = useState<Set<string>>(new Set());

  const userSpeciesQ = useQuery<UserSpeciesResponse>({
    queryKey: ["/api/users", username, "species"],
    queryFn: () => apiGetUserSpecies(username),
    enabled: !!username,
  });

  // Denominators — total AU species per scope
  const totalAllQ = useQuery({
    queryKey: ["/api/species/total", "all"],
    queryFn: () => fetchSpeciesTotal({ group: undefined }),
    staleTime: 1000 * 60 * 30,
  });

  // Per-group totals
  const groupTotalsQs = GROUPS.map((g) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["/api/species/total", "group", g.value],
      queryFn: () => fetchSpeciesTotal({ group: g.value }),
      staleTime: 1000 * 60 * 30,
    }),
  );

  // Per-family totals
  const familyTotalsQs = FAMILIES.map((f) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["/api/species/total", "family", f.id],
      queryFn: () => fetchSpeciesTotal({ taxonId: f.id }),
      staleTime: 1000 * 60 * 30,
    }),
  );

  // Per-family subspecies counts (from our local catalog). We add this to
  // the iNat species_count so the denominator includes subspecies, matching
  // the numerator which counts each subspecies as a separate tick.
  const familySubCountsQs = FAMILIES.map((f) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["/api/subspecies/catalog", "family-count", f.id],
      queryFn: () =>
        apiGetSubspeciesCatalog({ familyId: f.id }).then((r) => r.total),
      staleTime: 1000 * 60 * 30,
    }),
  );

  const counts = userSpeciesQ.data?.counts || [];
  // Fast lookup: which iNat species ids has this user recorded?
  const recordedIds = useMemo(
    () => new Set((userSpeciesQ.data?.speciesIds || []).filter((x): x is number => x != null)),
    [userSpeciesQ.data],
  );

  // Aggregate user counts by group and by family
  const { byGroup, byFamily, byGenus, allUserSpeciesCount } = useMemo(() => {
    const byGroup = new Map<string, number>();
    const byFamily = new Map<number, number>();
    const byGenus = new Map<string, { count: number; familyId: number | null; familyName: string | null; groupKey: string | null }>();
    const speciesIds = new Set<number>();
    for (const c of counts) {
      speciesIds.add(c.speciesId);
      if (c.groupKey) byGroup.set(c.groupKey, (byGroup.get(c.groupKey) || 0) + 1);
      if (c.familyId != null)
        byFamily.set(c.familyId, (byFamily.get(c.familyId) || 0) + 1);
      if (c.genus) {
        const prev = byGenus.get(c.genus);
        byGenus.set(c.genus, {
          count: (prev?.count || 0) + 1,
          familyId: c.familyId ?? prev?.familyId ?? null,
          familyName: c.familyName ?? prev?.familyName ?? null,
          groupKey: c.groupKey ?? prev?.groupKey ?? null,
        });
      }
    }
    return { byGroup, byFamily, byGenus, allUserSpeciesCount: speciesIds.size };
  }, [counts]);

  // Reptile / amphibian sums (clientside sum over groups)
  const reptileUserCount = REPTILE_GROUPS.reduce(
    (acc, g) => acc + (byGroup.get(g) || 0),
    0,
  );
  const amphibianUserCount = AMPHIBIAN_GROUPS.reduce(
    (acc, g) => acc + (byGroup.get(g) || 0),
    0,
  );
  const reptileTotal = REPTILE_GROUPS.reduce((acc, g) => {
    const i = GROUPS.findIndex((x) => x.value === g);
    return acc + (groupTotalsQs[i]?.data || 0);
  }, 0);
  const amphibianTotal = AMPHIBIAN_GROUPS.reduce((acc, g) => {
    const i = GROUPS.findIndex((x) => x.value === g);
    return acc + (groupTotalsQs[i]?.data || 0);
  }, 0);

  const toggleGroup = (g: HerpGroup) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const toggleFamily = (id: number) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGenus = (key: string) => {
    setExpandedGenera((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isLoading = userSpeciesQ.isLoading;

  return (
    <div className="border border-border rounded-lg bg-card p-5 space-y-5" data-testid="card-species-tally">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold">Species tally</h2>
        <Link
          href="/leaderboard"
          className="text-xs text-primary hover:underline"
          data-testid="link-leaderboard"
        >
          View leaderboards →
        </Link>
      </div>

      {/* Headline: All */}
      <Bar
        label="All AU herps"
        sublabel="Unique species recorded"
        numerator={allUserSpeciesCount}
        denominator={totalAllQ.data ?? null}
        loading={isLoading || totalAllQ.isLoading}
        testId="bar-all"
      />

      {/* Reptiles / Amphibians */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Bar
          label="Reptiles"
          sublabel="Snakes, lizards, turtles, crocs"
          numerator={reptileUserCount}
          denominator={reptileTotal || null}
          loading={isLoading}
          testId="bar-reptiles"
        />
        <Bar
          label="Amphibians"
          sublabel="Frogs"
          numerator={amphibianUserCount}
          denominator={amphibianTotal || null}
          loading={isLoading}
          testId="bar-amphibians"
        />
      </div>

      {/* By group, expandable to family + genus */}
      <div className="space-y-3 pt-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Breakdown by group
        </div>
        {GROUPS.map((g, gi) => {
          const groupUserCount = byGroup.get(g.value) || 0;
          const groupTotal = groupTotalsQs[gi]?.data ?? null;
          const expanded = expandedGroups.has(g.value);
          const families = FAMILIES.filter((f) => f.group === g.value);

          return (
            <div key={g.value}>
              <button
                type="button"
                onClick={() => toggleGroup(g.value)}
                className="w-full text-left hover-elevate rounded-md p-2 -mx-2"
                data-testid={`toggle-group-${g.value}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Bar
                      label={g.label}
                      sublabel={g.blurb}
                      numerator={groupUserCount}
                      denominator={groupTotal}
                      loading={isLoading || groupTotalsQs[gi]?.isLoading}
                    />
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="ml-6 pl-3 border-l border-border space-y-3 mt-2 mb-3">
                  {families.length === 0 && (
                    <div className="text-xs text-muted-foreground italic">
                      No tracked families in this group.
                    </div>
                  )}
                  {families.map((f) => {
                    const famIdx = FAMILIES.findIndex((x) => x.id === f.id);
                    return (
                      <FamilyBlock
                        key={f.id}
                        family={f}
                        famUserCount={byFamily.get(f.id) || 0}
                        famTotal={(() => {
                          const t = familyTotalsQs[famIdx]?.data;
                          if (t == null) return null;
                          return t + (familySubCountsQs[famIdx]?.data ?? 0);
                        })()}
                        famLoading={isLoading || familyTotalsQs[famIdx]?.isLoading}
                        userGenera={Array.from(byGenus.entries())
                          .filter(([, v]) => v.familyId === f.id)
                          .map(([genus, v]) => ({ genus, count: v.count }))}
                        recordedIds={recordedIds}
                        expandedGenera={expandedGenera}
                        toggleGenus={toggleGenus}
                        isExpanded={expandedFamilies.has(f.id)}
                        onToggle={() => toggleFamily(f.id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Species drilldown — each recorded taxon = one tick, no record count */}
      {counts.length > 0 && (
        <details className="pt-2 border-t border-border">
          <summary className="cursor-pointer text-sm font-medium py-2 hover:text-primary">
            All recorded species ({counts.length})
          </summary>
          <ul className="mt-2 space-y-1 max-h-72 overflow-auto pr-2">
            {counts
              .slice()
              .sort((a, b) =>
                (a.speciesCommon || a.speciesName || "").localeCompare(
                  b.speciesCommon || b.speciesName || "",
                ),
              )
              .map((c) => (
                <li
                  key={c.speciesId}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`row-species-${c.speciesId}`}
                >
                  <Check
                    className="h-3 w-3 text-emerald-600 shrink-0"
                    strokeWidth={3}
                    aria-label="Recorded"
                  />
                  <Link
                    href={`/species/${c.speciesId}`}
                    className="hover:text-primary hover:underline truncate min-w-0"
                  >
                    {c.speciesCommon || c.speciesName || `Species ${c.speciesId}`}
                  </Link>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FamilyBlock — renders one family bar + lazy-loaded list of genera, each with
// expand/collapse to show every species in the catalog. Recorded species get a
// green tick.
// ─────────────────────────────────────────────────────────────────────────────
interface FamilyBlockProps {
  family: FamilyDef;
  famUserCount: number;
  famTotal: number | null;
  famLoading: boolean | undefined;
  userGenera: Array<{ genus: string; count: number }>;
  recordedIds: Set<number>;
  expandedGenera: Set<string>;
  toggleGenus: (key: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

function FamilyBlock({
  family,
  famUserCount,
  famTotal,
  famLoading,
  userGenera,
  recordedIds,
  expandedGenera,
  toggleGenus,
  isExpanded,
  onToggle,
}: FamilyBlockProps) {
  // Fetch the full catalog under this family — only when the family bar is
  // actually expanded by the user. Cached for 30 min.
  const catalogQ = useQuery({
    queryKey: ["/api/species/catalog", "family", family.id],
    queryFn: () => apiGetCatalog({ familyId: family.id }),
    staleTime: 1000 * 60 * 30,
    enabled: isExpanded,
  });

  // Fetch subspecies under this family so we can nest them under their parent
  // species in the drilldown. Each subspecies = its own tick.
  const subspeciesQ = useQuery({
    queryKey: ["/api/subspecies/catalog", "family", family.id],
    queryFn: () => apiGetSubspeciesCatalog({ familyId: family.id }),
    staleTime: 1000 * 60 * 30,
    enabled: isExpanded,
  });

  // Group subspecies by parent species id for O(1) lookup during render.
  const subsByParent = useMemo(() => {
    const m = new Map<number, CatalogSubspecies[]>();
    for (const s of subspeciesQ.data?.subspecies || []) {
      if (s.parentId == null) continue;
      if (!m.has(s.parentId)) m.set(s.parentId, []);
      m.get(s.parentId)!.push(s);
    }
    return m;
  }, [subspeciesQ.data]);

  // Combine user-recorded genera + catalog genera into a unified list of
  // genus rows. Catalog wins for ordering; any user genera not in catalog
  // (rare — usually means a record with no species_id match) appear first.
  const generaRows = useMemo(() => {
    const byGenus = new Map<
      string,
      { genus: string; species: CatalogSpecies[]; userCount: number }
    >();
    for (const sp of catalogQ.data?.species || []) {
      const g = sp.genus || "(unknown)";
      if (!byGenus.has(g)) byGenus.set(g, { genus: g, species: [], userCount: 0 });
      byGenus.get(g)!.species.push(sp);
    }
    for (const ug of userGenera) {
      if (!byGenus.has(ug.genus)) {
        byGenus.set(ug.genus, { genus: ug.genus, species: [], userCount: 0 });
      }
      byGenus.get(ug.genus)!.userCount = ug.count;
    }
    // Sort: genera with at least one tick first (by tick count desc), then
    // alphabetical for the rest. Tick count includes subspecies ticks so a
    // user with only subspecies records still gets credit on the genus header.
    return Array.from(byGenus.values())
      .map((row) => {
        let ticked = 0;
        let total = 0;
        for (const s of row.species) {
          total += 1;
          if (recordedIds.has(s.id)) ticked += 1;
          const subs = subsByParent.get(s.id) || [];
          for (const ss of subs) {
            total += 1;
            if (recordedIds.has(ss.id)) ticked += 1;
          }
        }
        return { ...row, ticked, total };
      })
      .sort((a, b) => {
        if (a.ticked !== b.ticked) return b.ticked - a.ticked;
        return a.genus.localeCompare(b.genus);
      });
  }, [catalogQ.data, userGenera, recordedIds, subsByParent]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left hover-elevate rounded-md p-1.5 -mx-1.5"
        data-testid={`toggle-family-${family.id}`}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <Bar
              label={family.name}
              sublabel={family.common}
              numerator={famUserCount}
              denominator={famTotal}
              loading={famLoading}
              tone="muted"
              testId={`bar-family-${family.id}`}
            />
          </div>
        </div>
      </button>
      {isExpanded && (generaRows.length > 0 || catalogQ.isLoading) && (
        <div className="ml-2 pl-3 border-l border-dashed border-border space-y-1">
          {catalogQ.isLoading && generaRows.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic py-1">
              Loading species…
            </div>
          )}
          {generaRows.map((row) => {
            const genusKey = `${family.id}::${row.genus}`;
            const isOpen = expandedGenera.has(genusKey);
            const total = (row as any).total ?? row.species.length;
            return (
              <div key={genusKey}>
                <button
                  type="button"
                  onClick={() => toggleGenus(genusKey)}
                  className="w-full text-left flex items-center gap-2 py-1 px-1 -mx-1 rounded hover-elevate text-xs"
                  data-testid={`toggle-genus-${family.id}-${row.genus}`}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="italic font-serif text-foreground/85 flex-1 min-w-0 truncate">
                    {row.genus}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    <span className="font-semibold text-foreground">{row.ticked}</span>
                    {total > 0 && <span> / {total}</span>}
                  </span>
                </button>
                {isOpen && total > 0 && (
                  <ul className="ml-5 pl-3 border-l border-dashed border-border/70 space-y-0.5 mt-0.5 mb-1.5">
                    {row.species
                      .slice()
                      .sort((a, b) => a.scientific.localeCompare(b.scientific))
                      .map((sp) => {
                        const ticked = recordedIds.has(sp.id);
                        const subs = (subsByParent.get(sp.id) || [])
                          .slice()
                          .sort((a, b) => a.scientific.localeCompare(b.scientific));
                        return (
                          <li
                            key={sp.id}
                            className="text-[11px] py-0.5"
                            data-testid={`row-species-tick-${sp.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-3 shrink-0 flex items-center justify-center">
                                {ticked ? (
                                  <Check
                                    className="h-3 w-3 text-emerald-600"
                                    strokeWidth={3}
                                    aria-label="Recorded"
                                  />
                                ) : (
                                  <span
                                    className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground/50"
                                    aria-label="Not yet recorded"
                                  />
                                )}
                              </span>
                              <Link
                                href={`/species/${sp.id}`}
                                className={`min-w-0 flex-1 truncate hover:text-primary hover:underline ${
                                  ticked ? "text-foreground font-medium" : "text-muted-foreground"
                                }`}
                              >
                                <span className="italic font-serif">{sp.scientific}</span>
                                {sp.common && (
                                  <span className="not-italic font-sans"> · {sp.common}</span>
                                )}
                              </Link>
                            </div>
                            {subs.length > 0 && (
                              <ul className="ml-5 mt-0.5 space-y-0.5">
                                {subs.map((ss) => {
                                  const stTicked = recordedIds.has(ss.id);
                                  const parts = ss.scientific.split(" ");
                                  const epithet = parts.length >= 3 ? parts.slice(2).join(" ") : ss.scientific;
                                  return (
                                    <li
                                      key={ss.id}
                                      className="flex items-center gap-2"
                                      data-testid={`row-subspecies-tick-${ss.id}`}
                                    >
                                      <span className="w-3 shrink-0 flex items-center justify-center">
                                        {stTicked ? (
                                          <Check
                                            className="h-3 w-3 text-emerald-600"
                                            strokeWidth={3}
                                            aria-label="Recorded"
                                          />
                                        ) : (
                                          <span
                                            className="h-2 w-2 rounded-full border border-dashed border-muted-foreground/50"
                                            aria-label="Not yet recorded"
                                          />
                                        )}
                                      </span>
                                      <Link
                                        href={`/species/${ss.id}`}
                                        className={`min-w-0 flex-1 truncate hover:text-primary hover:underline ${
                                          stTicked ? "text-foreground font-medium" : "text-muted-foreground"
                                        }`}
                                      >
                                        <span className="italic font-serif text-foreground/70">ssp. {epithet}</span>
                                        {ss.common && (
                                          <span className="not-italic font-sans"> · {ss.common}</span>
                                        )}
                                      </Link>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                )}
                {isOpen && total === 0 && (
                  <div className="ml-5 pl-3 text-[11px] text-muted-foreground italic py-1">
                    No species in catalog for this genus yet.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
