import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, HelpCircle, ChevronDown, FlaskConical, FolderTree, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fetchSpecies, biggerPhoto, apiGetSubspeciesCatalog, apiGetCatalog, type SpeciesCountResult } from "@/lib/api";
import { classifySpecies } from "@/lib/taxonomy";
import { useMySpecies } from "@/lib/mySpecies";
import { SeenBadge } from "@/components/SeenBadge";
import { UnseenBadge } from "@/components/UnseenBadge";

export interface PickedSpecies {
  taxonId: number | null;        // null = unknown
  scientificName: string | null; // null = unknown
  commonName: string | null;
  groupKey?: string | null;
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
  // When the user has refined to a subspecies, taxonId is the subspecies id and
  // parentSpeciesId is the species id. Otherwise parentSpeciesId is null.
  parentSpeciesId?: number | null;
  rank?: "species" | "subspecies" | null;
}

interface Props {
  value: PickedSpecies | null;
  onChange: (v: PickedSpecies | null) => void;
  allowUnknown?: boolean;
}

export function SpeciesPicker({ value, onChange, allowUnknown = true }: Props) {
  const mySpecies = useMySpecies();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // 'main' = search list, 'undescribed' = enter undescribed-species form, 'genus' = browse-by-genus form
  const [mode, setMode] = useState<"main" | "undescribed" | "genus">("main");
  // Undescribed-species form fields
  const [undGenus, setUndGenus] = useState("");
  const [undCommon, setUndCommon] = useState("");
  // Genus-only browse query (separate from species search query)
  const [genusQ, setGenusQ] = useState("");
  const [dGenusQ, setDGenusQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDGenusQ(genusQ.trim()), 250);
    return () => clearTimeout(t);
  }, [genusQ]);

  // Catalog query for genus list. Loaded once either panel opens so the genus
  // typeahead works in both Undescribed and Genus-only modes. Uses the same
  // merged catalog as the field guide. Filtering happens client-side so the
  // user gets typeahead suggestions instantly without re-fetching.
  const { data: genusCatalogData, isFetching: genusFetching } = useQuery({
    queryKey: ["/api/species/catalog", "genus-picker"],
    queryFn: () => apiGetCatalog({}),
    enabled: mode === "genus" || mode === "undescribed",
    staleTime: 5 * 60_000,
  });

  // Group catalog rows by genus -> { genus, familyName, group, exemplar (count) }
  const genusOptions = useMemo(() => {
    const rows = genusCatalogData?.species ?? [];
    const map = new Map<string, { genus: string; familyName: string | null; familyId: number | null; group: string | null; count: number }>();
    for (const r of rows) {
      const g = r.genus || (r.scientific?.split(" ")[0] ?? null);
      if (!g) continue;
      const existing = map.get(g);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(g, {
          genus: g,
          familyName: r.familyName ?? null,
          familyId: r.familyId ?? null,
          group: r.group ?? null,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.genus.localeCompare(b.genus));
  }, [genusCatalogData]);

  // Debounce
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["species-picker", dq],
    queryFn: () => fetchSpecies(dq, "all", 1, 12),
    enabled: dq.length >= 2,
    staleTime: 60_000,
  });

  const results = useMemo<SpeciesCountResult[]>(() => data?.results ?? [], [data]);

  // When a species is picked, look up any subspecies in our AU catalog so the
  // user can optionally refine to a subspecies.
  const speciesIdForSubLookup = value && value.taxonId && value.rank !== "subspecies"
    ? value.taxonId
    : value?.parentSpeciesId ?? null;
  const { data: subspeciesData } = useQuery({
    queryKey: ["/api/subspecies/catalog", speciesIdForSubLookup, "picker"],
    queryFn: () => apiGetSubspeciesCatalog({ parentId: speciesIdForSubLookup! }),
    enabled: speciesIdForSubLookup != null,
  });
  const subs = subspeciesData?.subspecies ?? [];
  const [subsOpen, setSubsOpen] = useState(false);

  return (
    <div className="space-y-2">
      {value ? (
        <div className="rounded-md border border-border bg-card" data-testid="picked-species">
          <div className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            {value.taxonId === null ? (
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Unknown — let others suggest an ID</span>
              </div>
            ) : (
              <>
                <div className="font-medium truncate" data-testid="text-picked-common">
                  {value.commonName || value.scientificName}
                  {value.rank === "subspecies" && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/40">ssp.</span>
                  )}
                </div>
                {value.commonName && (
                  <div className="text-xs italic text-muted-foreground truncate" data-testid="text-picked-sci">
                    {value.scientificName}
                  </div>
                )}
              </>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setOpen(true);
              setSubsOpen(false);
              setMode("main");
              setUndGenus("");
              setUndCommon("");
              setGenusQ("");
            }}
            data-testid="button-clear-species"
          >
            <X className="h-4 w-4" />
          </Button>
          </div>
          {value.taxonId !== null && subs.length > 0 && (
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => setSubsOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground hover-elevate"
                data-testid="button-toggle-subspecies"
              >
                <span>
                  {value.rank === "subspecies"
                    ? `Change subspecies (${subs.length} known)`
                    : `Refine to a subspecies (${subs.length} known)`}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${subsOpen ? "rotate-180" : ""}`} />
              </button>
              {subsOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-border">
                  {value.rank === "subspecies" && value.parentSpeciesId && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover-elevate text-sm border-b border-border"
                      onClick={() => {
                        onChange({
                          taxonId: value.parentSpeciesId!,
                          scientificName: subs[0]?.parentScientific ?? null,
                          commonName: subs[0]?.parentCommon ?? null,
                          groupKey: value.groupKey,
                          familyId: value.familyId,
                          familyName: value.familyName,
                          genus: value.genus,
                          parentSpeciesId: null,
                          rank: "species",
                        });
                        setSubsOpen(false);
                      }}
                      data-testid="button-pick-no-subspecies"
                    >
                      <span className="text-muted-foreground">Just the species — no subspecies</span>
                    </button>
                  )}
                  {subs.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 hover-elevate text-sm ${
                        value.taxonId === sub.id ? "bg-accent/30" : ""
                      }`}
                      onClick={() => {
                        onChange({
                          taxonId: sub.id,
                          scientificName: sub.scientific,
                          commonName: sub.common,
                          groupKey: sub.group ?? value.groupKey ?? null,
                          familyId: sub.familyId ?? value.familyId ?? null,
                          familyName: sub.familyName ?? value.familyName ?? null,
                          genus: sub.genus ?? value.genus ?? null,
                          parentSpeciesId: sub.parentId,
                          rank: "subspecies",
                        });
                        setSubsOpen(false);
                      }}
                      data-testid={`button-pick-sub-${sub.id}`}
                    >
                      <div className="font-serif italic">{sub.scientific}</div>
                      {sub.common && (
                        <div className="text-xs text-muted-foreground">{sub.common}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {mode === "main" && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search species (e.g., carpet python, green tree frog)"
                className="pl-9"
                data-testid="input-species-search"
              />
            </div>
          )}
          {open && mode === "main" && (q.length >= 2 || allowUnknown) && (
            <div className="rounded-md border border-border bg-card overflow-hidden">
              {allowUnknown && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover-elevate flex items-center gap-3 border-b border-border"
                  onClick={() => {
                    onChange({ taxonId: null, scientificName: null, commonName: null });
                    setOpen(false);
                    setQ("");
                  }}
                  data-testid="button-pick-unknown"
                >
                  <HelpCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">Unknown / Help me ID</div>
                    <div className="text-xs text-muted-foreground">Others can suggest an ID later</div>
                  </div>
                </button>
              )}
              {allowUnknown && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover-elevate flex items-center gap-3 border-b border-border"
                  onClick={() => {
                    setMode("undescribed");
                    setUndGenus("");
                    setUndCommon("");
                  }}
                  data-testid="button-pick-undescribed"
                >
                  <FlaskConical className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">Undescribed species</div>
                    <div className="text-xs text-muted-foreground">Not yet formally described to science</div>
                  </div>
                </button>
              )}
              {allowUnknown && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover-elevate flex items-center gap-3 border-b border-border"
                  onClick={() => {
                    setMode("genus");
                    setGenusQ("");
                  }}
                  data-testid="button-pick-genus-only"
                >
                  <FolderTree className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">Genus only (e.g. <span className="italic">Varanus sp.</span>)</div>
                    <div className="text-xs text-muted-foreground">Pick a genus when the species is uncertain</div>
                  </div>
                </button>
              )}
              {isFetching && dq.length >= 2 && (
                <div className="px-3 py-3 text-sm text-muted-foreground">Searching…</div>
              )}
              {dq.length >= 2 && !isFetching && results.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted-foreground">No matches.</div>
              )}
              <div className="max-h-64 overflow-y-auto">
                {results.map((r) => {
                  const photo = biggerPhoto(r.taxon.default_photo?.url, "medium");
                  const tax = classifySpecies({
                    ancestorIds: r.taxon.ancestor_ids,
                    name: r.taxon.name,
                  });
                  const myCount = mySpecies.countsBySpecies.get(r.taxon.id) ?? 0;
                  return (
                    <button
                      key={r.taxon.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover-elevate flex items-center gap-3"
                      onClick={() => {
                        onChange({
                          taxonId: r.taxon.id,
                          scientificName: r.taxon.name,
                          commonName: r.taxon.preferred_common_name || null,
                          groupKey: tax.group,
                          familyId: tax.family?.id ?? null,
                          familyName: tax.family?.name ?? null,
                          genus: tax.genus,
                          parentSpeciesId: null,
                          rank: "species",
                        });
                        setOpen(false);
                        setQ("");
                      }}
                      data-testid={`button-pick-species-${r.taxon.id}`}
                    >
                      <div className="w-10 h-10 rounded bg-muted overflow-hidden shrink-0">
                        {photo && (
                          <img src={photo} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {myCount > 0 ? (
                            <SeenBadge count={myCount} variant="inline" />
                          ) : (
                            <UnseenBadge variant="inline" />
                          )}
                          {r.taxon.preferred_common_name || r.taxon.name}
                        </div>
                        <div className="text-xs italic text-muted-foreground truncate">
                          {r.taxon.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === "undescribed" && (
            <UndescribedPanel
              undGenus={undGenus}
              setUndGenus={setUndGenus}
              undCommon={undCommon}
              setUndCommon={setUndCommon}
              genusOptions={genusOptions}
              genusFetching={genusFetching}
              onCancel={() => {
                setMode("main");
                setUndGenus("");
                setUndCommon("");
              }}
              onSave={(picked) => {
                onChange(picked);
                setOpen(false);
                setMode("main");
                setUndGenus("");
                setUndCommon("");
              }}
            />
          )}

          {mode === "genus" && (
            <GenusPanel
              genusQ={genusQ}
              setGenusQ={setGenusQ}
              genusOptions={genusOptions}
              genusFetching={genusFetching}
              onCancel={() => {
                setMode("main");
                setGenusQ("");
              }}
              onPick={(picked) => {
                onChange(picked);
                setOpen(false);
                setMode("main");
                setGenusQ("");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genus typeahead — shared by Undescribed and Genus-only panels.
// As the user types, filters the merged-catalog genera client-side and shows
// matches. Picking a row populates the genus + carries family/group context.
// ---------------------------------------------------------------------------
interface GenusOption {
  genus: string;
  familyName: string | null;
  familyId: number | null;
  group: string | null;
  count: number;
}

function filterGenera(opts: GenusOption[], q: string): GenusOption[] {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return opts.slice(0, 40);
  // Prefix matches first, then substring matches.
  const prefix: GenusOption[] = [];
  const contains: GenusOption[] = [];
  for (const o of opts) {
    const g = o.genus.toLowerCase();
    if (g.startsWith(trimmed)) prefix.push(o);
    else if (g.includes(trimmed)) contains.push(o);
  }
  return [...prefix, ...contains].slice(0, 40);
}

function UndescribedPanel(props: {
  undGenus: string;
  setUndGenus: (v: string) => void;
  undCommon: string;
  setUndCommon: (v: string) => void;
  genusOptions: GenusOption[];
  genusFetching: boolean;
  onCancel: () => void;
  onSave: (picked: PickedSpecies) => void;
}) {
  const {
    undGenus,
    setUndGenus,
    undCommon,
    setUndCommon,
    genusOptions,
    genusFetching,
    onCancel,
    onSave,
  } = props;
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestions = useMemo(
    () => filterGenera(genusOptions, undGenus),
    [genusOptions, undGenus],
  );
  // Exact-match (if any) so we can carry family/group context onto the record.
  const exact = useMemo(
    () =>
      genusOptions.find(
        (g) => g.genus.toLowerCase() === undGenus.trim().toLowerCase(),
      ) || null,
    [genusOptions, undGenus],
  );

  const hasGenus = undGenus.trim().length > 0;
  const scientific = hasGenus
    ? `${undGenus.trim()} sp. (undescribed)`
    : "Undescribed species";

  return (
    <div
      className="rounded-md border border-border bg-card overflow-hidden"
      data-testid="panel-undescribed"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <div className="font-medium text-sm">Undescribed species</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid="button-undescribed-back"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
      </div>
      <div className="p-3 space-y-3">
        <div className="space-y-1.5 relative">
          <Label htmlFor="und-genus" className="text-xs">
            Genus{" "}
            <span className="text-muted-foreground font-normal">
              (optional, if known)
            </span>
          </Label>
          <Input
            id="und-genus"
            value={undGenus}
            onChange={(e) => {
              setUndGenus(e.target.value);
              setShowSuggest(true);
            }}
            onFocus={() => setShowSuggest(true)}
            placeholder="e.g. Varanus, Pseudonaja, Litoria"
            className="italic"
            autoComplete="off"
            data-testid="input-undescribed-genus"
          />
          {showSuggest && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
              {suggestions.map((g) => (
                <button
                  key={g.genus}
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover-elevate text-sm flex items-center justify-between gap-3"
                  onClick={() => {
                    setUndGenus(g.genus);
                    setShowSuggest(false);
                  }}
                  data-testid={`button-suggest-genus-und-${g.genus}`}
                >
                  <span className="font-serif italic">{g.genus}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {g.familyName || ""}
                    {g.count > 0 && ` · ${g.count} sp.`}
                  </span>
                </button>
              ))}
            </div>
          )}
          {showSuggest && genusFetching && suggestions.length === 0 && (
            <div className="text-xs text-muted-foreground px-1">
              Loading genera…
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="und-common" className="text-xs">
            Working name{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="und-common"
            value={undCommon}
            onChange={(e) => setUndCommon(e.target.value)}
            placeholder="e.g. Pilbara Rock Monitor sp. nov."
            data-testid="input-undescribed-common"
          />
        </div>
        <div className="text-xs text-muted-foreground px-1">
          Will be recorded as:{" "}
          <span className="font-serif italic text-foreground">{scientific}</span>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid="button-undescribed-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const genus = undGenus.trim() || null;
              onSave({
                taxonId: null,
                scientificName: scientific,
                commonName:
                  undCommon.trim() ||
                  (genus
                    ? `${genus} sp. (undescribed)`
                    : "Undescribed species"),
                groupKey: exact?.group ?? null,
                familyId: exact?.familyId ?? null,
                familyName: exact?.familyName ?? null,
                genus,
                parentSpeciesId: null,
                rank: "species",
              });
            }}
            data-testid="button-undescribed-save"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function GenusPanel(props: {
  genusQ: string;
  setGenusQ: (v: string) => void;
  genusOptions: GenusOption[];
  genusFetching: boolean;
  onCancel: () => void;
  onPick: (picked: PickedSpecies) => void;
}) {
  const { genusQ, setGenusQ, genusOptions, genusFetching, onCancel, onPick } = props;
  const filtered = useMemo(
    () => filterGenera(genusOptions, genusQ),
    [genusOptions, genusQ],
  );

  return (
    <div
      className="rounded-md border border-border bg-card overflow-hidden"
      data-testid="panel-genus"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <div className="font-medium text-sm">Pick a genus</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid="button-genus-back"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
      </div>
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={genusQ}
            onChange={(e) => setGenusQ(e.target.value)}
            placeholder="Type a genus (e.g. Varanus, Litoria, Ctenotus)"
            className="pl-9 italic"
            autoComplete="off"
            data-testid="input-genus-search"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto border-t border-border">
        {genusFetching && filtered.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Loading genera…
          </div>
        )}
        {!genusFetching && filtered.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            No genera match.
          </div>
        )}
        {filtered.map((g) => (
          <button
            key={g.genus}
            type="button"
            className="w-full text-left px-3 py-2 hover-elevate flex items-center justify-between gap-3"
            onClick={() =>
              onPick({
                taxonId: null,
                scientificName: `${g.genus} sp.`,
                commonName: `${g.genus} sp.`,
                groupKey: g.group ?? null,
                familyId: g.familyId ?? null,
                familyName: g.familyName ?? null,
                genus: g.genus,
                parentSpeciesId: null,
                rank: "species",
              })
            }
            data-testid={`button-pick-genus-${g.genus}`}
          >
            <div className="min-w-0">
              <div className="font-serif italic">{g.genus} sp.</div>
              <div className="text-xs text-muted-foreground truncate">
                {g.familyName || "—"}
                {g.group && ` · ${g.group}`}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {g.count} species
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
