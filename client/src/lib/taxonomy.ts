/**
 * Curated taxonomy for Australian herpetofauna.
 *
 * Maps iNaturalist taxon IDs (which appear in every species' `ancestor_ids`)
 * to human-readable group and family names. This lets us derive
 * group / family / genus for every species without extra round-trips.
 *
 * Family IDs were verified by enumerating every research-grade AU species
 * and inspecting which family-rank ancestor IDs they share.
 */

export type HerpGroup = "snakes" | "lizards" | "turtles" | "crocs" | "frogs";

export interface GroupDef {
  value: HerpGroup;
  label: string;
  /** iNat root taxon for this group — used in the API filter */
  taxonId: number;
  /** Description for the chip tooltip */
  blurb: string;
}

export const GROUPS: GroupDef[] = [
  { value: "snakes",  label: "Snakes",  taxonId: 85553, blurb: "Suborder Serpentes" },
  { value: "lizards", label: "Lizards", taxonId: 85552, blurb: "Suborder Sauria" },
  { value: "turtles", label: "Turtles", taxonId: 39532, blurb: "Order Testudines" },
  { value: "crocs",   label: "Crocs",   taxonId: 26039, blurb: "Order Crocodylia" },
  { value: "frogs",   label: "Frogs",   taxonId: 20979, blurb: "Order Anura" },
];

export interface FamilyDef {
  id: number;
  name: string;       // scientific family name
  common: string;     // English common name
  group: HerpGroup;
}

/**
 * AU herp families verified against iNaturalist data.
 * Counts (research-grade AU species) shown in comments.
 */
export const FAMILIES: FamilyDef[] = [
  // --- Snakes ---
  { id: 30403,  name: "Elapidae",      common: "Elapids",                 group: "snakes" },  // 128
  { id: 32548,  name: "Typhlopidae",   common: "Blind snakes",            group: "snakes" },  // 29
  { id: 67532,  name: "Pythonidae",    common: "Pythons",                 group: "snakes" },  // 16
  { id: 26504,  name: "Colubridae",    common: "Colubrids",               group: "snakes" },  // 7
  { id: 85829,  name: "Homalopsidae",  common: "Mud snakes",              group: "snakes" },  // 5
  { id: 26175,  name: "Acrochordidae", common: "File snakes",             group: "snakes" },  // 2

  // --- Lizards ---
  { id: 36982,  name: "Scincidae",          common: "Skinks",             group: "lizards" }, // 239
  { id: 31096,  name: "Agamidae",           common: "Dragons",            group: "lizards" }, // 73
  { id: 85737,  name: "Diplodactylidae",    common: "Australasian geckos",group: "lizards" }, // 73
  { id: 33177,  name: "Gekkonidae",         common: "Typical geckos",     group: "lizards" }, // 35
  { id: 36925,  name: "Pygopodidae",        common: "Legless lizards",    group: "lizards" }, // 29
  { id: 39392,  name: "Varanidae",          common: "Monitors (goannas)", group: "lizards" }, // 28
  { id: 85660,  name: "Carphodactylidae",   common: "Thick-tailed geckos",group: "lizards" }, // 23

  // --- Turtles ---
  { id: 39588,  name: "Chelidae",      common: "Side-necked turtles",     group: "turtles" }, // 24
  { id: 39657,  name: "Cheloniidae",   common: "Sea turtles",             group: "turtles" }, // 5

  // --- Crocs ---
  // (Crocodylidae exists in AU but didn't show up as family rank — handled by group filter alone)

  // --- Frogs ---
  { id: 554973, name: "Pelodryadidae",   common: "Australasian tree frogs", group: "frogs" }, // 90
  { id: 25222,  name: "Myobatrachidae",  common: "Australian ground frogs", group: "frogs" }, // 76
  { id: 22026,  name: "Limnodynastidae", common: "Foam-nesting frogs",      group: "frogs" }, // 42
  { id: 24736,  name: "Microhylidae",    common: "Narrow-mouthed frogs",    group: "frogs" }, // 18
];

// Quick lookup
const FAMILY_BY_ID = new Map<number, FamilyDef>(FAMILIES.map((f) => [f.id, f]));
const GROUP_BY_VALUE = new Map<HerpGroup, GroupDef>(GROUPS.map((g) => [g.value, g]));

/** Group → list of families */
export function familiesForGroup(group: HerpGroup): FamilyDef[] {
  return FAMILIES.filter((f) => f.group === group);
}

/** Resolve a species' group from its ancestor IDs. */
export function groupFromAncestors(
  ancestorIds: number[] | undefined,
): HerpGroup | null {
  if (!ancestorIds) return null;
  for (const g of GROUPS) {
    if (ancestorIds.includes(g.taxonId)) return g.value;
  }
  return null;
}

/** Resolve a species' family from its ancestor IDs. */
export function familyFromAncestors(
  ancestorIds: number[] | undefined,
): FamilyDef | null {
  if (!ancestorIds) return null;
  for (const id of ancestorIds) {
    const f = FAMILY_BY_ID.get(id);
    if (f) return f;
  }
  return null;
}

/** Genus from a binomial: "Pseudonaja textilis" → "Pseudonaja" */
export function genusFromName(name: string | undefined): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  if (!first || !/^[A-Z][a-zA-Z-]+$/.test(first)) return null;
  return first;
}

export interface TaxonomyRow {
  group: HerpGroup | null;
  family: FamilyDef | null;
  genus: string | null;
}

export function classifySpecies(opts: {
  ancestorIds?: number[];
  name?: string;
}): TaxonomyRow {
  return {
    group: groupFromAncestors(opts.ancestorIds),
    family: familyFromAncestors(opts.ancestorIds),
    genus: genusFromName(opts.name),
  };
}

export function getGroup(g: HerpGroup): GroupDef | undefined {
  return GROUP_BY_VALUE.get(g);
}

export function getFamily(id: number): FamilyDef | undefined {
  return FAMILY_BY_ID.get(id);
}
