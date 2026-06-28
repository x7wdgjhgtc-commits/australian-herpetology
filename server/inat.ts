/**
 * iNaturalist import for herpetological records.
 *
 * Pulls a user's reptile+amphibian observations from the public iNat API and
 * inserts them as records. Dedupe key: `inat:{observation_id}`.
 *
 * No iNat OAuth — connection is by username only (read-only, public data).
 */

import { storage, sqlite } from "./storage";
import fs from "fs";
import path from "path";

const INAT_BASE = "https://api.inaturalist.org/v1";
// iNat iconic taxon names that count as "herpetological"
const HERP_ICONIC = new Set(["Reptilia", "Amphibia"]);

// Map iNat ancestor ids → our internal groupKey.
// Verified against iNat API on 2026-06-28:
//   85553 Serpentes (snakes suborder)
//   85552 Sauria (lizards suborder)
//   39532 Testudines (turtles order)
//   26039 Crocodylia (crocs order)
//   20979 Anura (frogs order; Amphibia class is 20978)
const GROUP_ANCESTORS: { id: number; key: string }[] = [
  { id: 85553, key: "snakes" },
  { id: 85552, key: "lizards" },
  { id: 39532, key: "turtles" },
  { id: 26039, key: "crocs" },
  { id: 20979, key: "frogs" },
];

// AU herp families — verified against iNat (mirrored from client/src/lib/taxonomy.ts).
const FAMILY_ANCESTORS: { id: number; name: string }[] = [
  { id: 30403,  name: "Elapidae" },
  { id: 32548,  name: "Typhlopidae" },
  { id: 67532,  name: "Pythonidae" },
  { id: 26504,  name: "Colubridae" },
  { id: 85829,  name: "Homalopsidae" },
  { id: 36982,  name: "Scincidae" },
  { id: 31096,  name: "Agamidae" },
  { id: 85737,  name: "Diplodactylidae" },
  { id: 33177,  name: "Gekkonidae" },
  { id: 36925,  name: "Pygopodidae" },
  { id: 39392,  name: "Varanidae" },
  { id: 85660,  name: "Carphodactylidae" },
  { id: 39588,  name: "Chelidae" },
  { id: 39657,  name: "Cheloniidae" },
  { id: 554973, name: "Pelodryadidae" },
  { id: 25222,  name: "Myobatrachidae" },
  { id: 22026,  name: "Limnodynastidae" },
  { id: 24736,  name: "Microhylidae" },
];

function deriveFamily(ancestorIds: number[] | undefined): { id: number | null; name: string | null } {
  if (!ancestorIds) return { id: null, name: null };
  for (const { id, name } of FAMILY_ANCESTORS) {
    if (ancestorIds.includes(id)) return { id, name };
  }
  return { id: null, name: null };
}

function deriveGroupKey(ancestorIds: number[] | undefined, iconic: string | undefined): string | null {
  if (!ancestorIds) return iconic === "Amphibia" ? "frogs" : null;
  for (const { id, key } of GROUP_ANCESTORS) {
    if (ancestorIds.includes(id)) return key;
  }
  if (iconic === "Amphibia") return "frogs";
  return null;
}

// Family is one rank above genus. iNat's lightweight observation payload DOES
// include `taxon.ancestor_ids`, so we can resolve it against the curated
// FAMILY_ANCESTORS list above without an extra API call.

interface InatPhoto {
  id: number;
  url?: string | null;
  license_code?: string | null;
}

interface InatTaxon {
  id?: number;
  name?: string;
  preferred_common_name?: string | null;
  iconic_taxon_name?: string | null;
  ancestor_ids?: number[];
  rank?: string;
}

interface InatObservation {
  id: number;
  observed_on?: string | null;
  observed_on_details?: { date?: string } | null;
  place_guess?: string | null;
  geojson?: { type?: string; coordinates?: [number, number] } | null;
  obscured?: boolean;
  geoprivacy?: string | null;
  taxon_geoprivacy?: string | null;
  license_code?: string | null;
  description?: string | null;
  taxon?: InatTaxon | null;
  photos?: InatPhoto[];
  uri?: string;
}

/**
 * Resolve and validate an iNat username. Returns the canonical `login` field
 * (iNat usernames are case-insensitive but stored lowercase) or throws.
 */
export async function resolveInatUser(username: string): Promise<{ login: string; id: number; name: string | null }> {
  const trimmed = username.trim().replace(/^@/, "");
  if (!trimmed) throw new Error("Username required");
  const url = `${INAT_BASE}/users/${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) throw new Error(`iNaturalist user "${trimmed}" not found`);
  if (!res.ok) throw new Error(`iNaturalist API error (${res.status})`);
  const body: any = await res.json();
  const user = body?.results?.[0];
  if (!user || !user.login) throw new Error(`iNaturalist user "${trimmed}" not found`);
  return { login: user.login, id: user.id, name: user.name ?? null };
}

/** Map iNat license_code → our LicenseCode enum. Falls back to null. */
function mapLicense(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c === "cc-by") return "cc-by";
  if (c === "cc-by-nc" || c === "cc-by-nc-nd" || c === "cc-by-nc-sa") return "cc-by-nc";
  if (c === "cc-by-sa") return "cc-by-sa";
  if (c === "cc0") return "cc-by"; // closest analogue we expose
  return "all-rights-reserved";
}

/** Pull all herp observations for a user, paginating through the API. */
async function fetchHerpObservations(login: string): Promise<InatObservation[]> {
  const all: InatObservation[] = [];
  const perPage = 100;
  // Hard cap: 10 pages = 1000 obs. Enough for nearly every hobbyist account.
  const maxPages = 10;
  let page = 1;
  while (page <= maxPages) {
    const url =
      `${INAT_BASE}/observations` +
      `?user_login=${encodeURIComponent(login)}` +
      `&iconic_taxa=Reptilia,Amphibia` +
      `&per_page=${perPage}&page=${page}` +
      `&order=desc&order_by=observed_on`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`iNat fetch failed (${res.status})`);
    const body: any = await res.json();
    const results: InatObservation[] = body?.results ?? [];
    all.push(...results);
    if (results.length < perPage) break;
    page += 1;
  }
  return all;
}

/** Download a photo URL and return a `data:` URL (base64). Quietly returns null on failure. */
async function photoToDataUrl(rawUrl: string): Promise<string | null> {
  try {
    // iNat default `square.jpg` → use `medium.jpg` for a reasonable size (~500px wide)
    const url = rawUrl.replace(/\/square\.(jpe?g|png|gif)/i, "/medium.$1");
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    // Hard cap each photo at ~600 KB to keep DB tidy
    if (buf.byteLength > 600 * 1024) {
      // refuse to import oversized photos rather than truncating
      return null;
    }
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export interface ImportSummary {
  scanned: number;
  imported: number;
  skipped: number;       // already present (matched by external_id)
  failed: number;        // photo download or transform errors
  inatLogin: string;
}

/**
 * Sync herp observations from iNat into our DB for the given user.
 * Skips observations already imported (matched by `external_id`).
 */
export async function syncInatForUser(userId: number, login: string): Promise<ImportSummary> {
  const summary: ImportSummary = { scanned: 0, imported: 0, skipped: 0, failed: 0, inatLogin: login };
  const observations = await fetchHerpObservations(login);
  summary.scanned = observations.length;

  for (const obs of observations) {
    const externalId = `inat:${obs.id}`;
    if (storage.findRecordByExternalId(userId, externalId)) {
      summary.skipped += 1;
      continue;
    }

    // Must be herp (defensive — server filter already restricts)
    const iconic = obs.taxon?.iconic_taxon_name ?? null;
    if (iconic && !HERP_ICONIC.has(iconic)) continue;

    // Must have at least one photo
    const photoUrls = (obs.photos ?? [])
      .map((p) => p.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 10);
    if (photoUrls.length === 0) continue;

    // Download photos to base64. If primary photo fails, skip this obs entirely.
    const photoDataUrls: string[] = [];
    for (const u of photoUrls) {
      const d = await photoToDataUrl(u);
      if (d) photoDataUrls.push(d);
    }
    if (photoDataUrls.length === 0) {
      summary.failed += 1;
      continue;
    }

    // Coordinates: iNat returns [lng, lat] in geojson. If `obscured`, iNat has
    // already coarsened them — we don't store an extra obscure flag in that case
    // because the displayed coords are already public-safe.
    let lat: string | null = null;
    let lng: string | null = null;
    const coords = obs.geojson?.coordinates;
    if (coords && coords.length === 2) {
      lng = String(coords[0]);
      lat = String(coords[1]);
    }

    // Species / subspecies. iNat observations identified at the subspecies
    // rank (e.g. Morelia spilota mcdowelli) should still link to a profile —
    // we store the subspecies id in speciesId and the parent species' iNat
    // id in parentSpeciesId so tallies/leaderboards/Search all work.
    const taxon = obs.taxon ?? null;
    const rank = taxon?.rank ?? null;
    let speciesId: number | null = null;
    let parentSpeciesId: number | null = null;
    if (rank === "species" || rank === "subspecies") {
      speciesId = taxon?.id ?? null;
      if (rank === "subspecies") {
        // ancestor_ids is ordered root→leaf; the last entry equal to taxon.id
        // (or in some payloads omitted) — the species parent is the entry
        // immediately before the subspecies id, or the last ancestor id.
        const ancestors = taxon?.ancestor_ids ?? [];
        if (ancestors.length > 0) {
          const last = ancestors[ancestors.length - 1];
          parentSpeciesId =
            last === taxon?.id
              ? (ancestors[ancestors.length - 2] ?? null)
              : last;
        }
      }
    }
    const speciesName = taxon?.name ?? null;
    const speciesCommon = taxon?.preferred_common_name ?? null;
    const genus = speciesName ? speciesName.split(" ")[0] : null;
    const groupKey = deriveGroupKey(taxon?.ancestor_ids, iconic ?? undefined);
    const family = deriveFamily(taxon?.ancestor_ids);

    // Date
    const observedOn = obs.observed_on ?? obs.observed_on_details?.date ?? null;

    // License
    const licenseCode = mapLicense(obs.license_code);

    // Notes / description
    const notes = obs.description?.trim() || null;

    try {
      storage.createRecord({
        userId,
        speciesId,
        speciesName,
        speciesCommon,
        notes,
        photoDataUrl: photoDataUrls[0],
        lat,
        lng,
        placeGuess: obs.place_guess ?? null,
        observedOn,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        fNumber: null,
        shutter: null,
        focalLength: null,
        exifJson: null,
        photosJson: JSON.stringify(photoDataUrls),
        // iNat already returns obscured coords when geoprivacy demands it, so
        // we don't double-fuzz. obscureLocation stays 0.
        obscureLocation: 0,
        licenseCode,
        conditionTag: null,
        behaviorsJson: null,
        groupKey,
        familyId: family.id,
        familyName: family.name,
        genus,
        externalId,
        externalSource: "inat",
        externalUrl: obs.uri ?? `https://www.inaturalist.org/observations/${obs.id}`,
        parentSpeciesId,
      } as any);
      summary.imported += 1;
    } catch {
      summary.failed += 1;
    }
  }

  storage.updateUser(userId, { inatLastImportAt: Date.now() });
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// One-shot backfill: previously-imported subspecies-rank iNat records have
// species_id=NULL because the old syncer rejected non-species ranks. This
// pass resolves them via the subspecies catalog by matching species_name
// and sets species_id + parent_species_id so the records show up on
// profiles and tallies. Safe to call on every startup — idempotent.
// ─────────────────────────────────────────────────────────────────────────

interface SubcatEntry {
  id: number;
  scientific: string;
  common: string | null;
  parentId: number | null;
  group: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
}

interface SpeciesCatEntry {
  id: number;
  scientific: string;
  common: string | null;
  group: string | null;
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
}

function loadJson<T>(filenames: string[]): T | null {
  for (const fn of filenames) {
    const candidates = [
      path.resolve(process.cwd(), `scripts/${fn}`),
      path.resolve(__dirname, `../scripts/${fn}`),
      path.resolve(__dirname, `./${fn}`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, "utf8")) as T;
        } catch {
          // try next
        }
      }
    }
  }
  return null;
}

let _backfillRan = false;
export function backfillSubspeciesRecords(): { scanned: number; updated: number } {
  const result = { scanned: 0, updated: 0 };
  if (_backfillRan) return result;
  _backfillRan = true;

  const subcat = loadJson<SubcatEntry[]>(["subspecies_catalog.json"]) ?? [];
  const speciescat = loadJson<SpeciesCatEntry[]>(["species_catalog.json"]) ?? [];
  if (subcat.length === 0 && speciescat.length === 0) return result;

  const subById = new Map<number, SubcatEntry>();
  const subByName = new Map<string, SubcatEntry>();
  for (const e of subcat) {
    subById.set(e.id, e);
    subByName.set(e.scientific, e);
  }
  const speciesById = new Map<number, SpeciesCatEntry>();
  for (const e of speciescat) speciesById.set(e.id, e);

  // Pass 1: resolve species_id from species_name for subspecies-rank rows
  // that were imported with species_id=NULL (old syncer rejected non-species).
  const nullRows = sqlite
    .prepare(
      `SELECT id, species_name FROM records
       WHERE external_source='inat' AND species_id IS NULL AND species_name IS NOT NULL`,
    )
    .all() as Array<{ id: number; species_name: string }>;
  result.scanned += nullRows.length;
  if (nullRows.length > 0) {
    const upd1 = sqlite.prepare(
      `UPDATE records SET species_id=?, parent_species_id=? WHERE id=?`,
    );
    const tx1 = sqlite.transaction((batch: typeof nullRows) => {
      for (const r of batch) {
        const e = subByName.get(r.species_name);
        if (!e) continue;
        upd1.run(e.id, e.parentId ?? null, r.id);
        result.updated += 1;
      }
    });
    tx1(nullRows);
  }

  // Pass 2: fix taxonomy (group_key, family_id, family_name, genus,
  // parent_species_id) on records that have species_id but missing or
  // wrong taxonomy fields. Join species_id against catalogs and overwrite.
  const taxoRows = sqlite
    .prepare(
      `SELECT id, species_id, group_key, family_id, family_name, genus, parent_species_id
       FROM records
       WHERE species_id IS NOT NULL`,
    )
    .all() as Array<{
    id: number;
    species_id: number;
    group_key: string | null;
    family_id: number | null;
    family_name: string | null;
    genus: string | null;
    parent_species_id: number | null;
  }>;
  result.scanned += taxoRows.length;
  const upd2 = sqlite.prepare(
    `UPDATE records SET group_key=?, family_id=?, family_name=?, genus=?, parent_species_id=? WHERE id=?`,
  );
  const tx2 = sqlite.transaction((batch: typeof taxoRows) => {
    for (const r of batch) {
      const sub = subById.get(r.species_id);
      const sp = speciesById.get(r.species_id);
      const ent = sub ?? sp;
      if (!ent) continue;
      const want = {
        group_key: ent.group ?? null,
        family_id: ent.familyId ?? null,
        family_name: ent.familyName ?? null,
        genus: ent.genus ?? null,
        parent_species_id: sub ? sub.parentId ?? null : r.parent_species_id,
      };
      if (
        r.group_key === want.group_key &&
        r.family_id === want.family_id &&
        r.family_name === want.family_name &&
        r.genus === want.genus &&
        r.parent_species_id === want.parent_species_id
      ) {
        continue;
      }
      upd2.run(
        want.group_key,
        want.family_id,
        want.family_name,
        want.genus,
        want.parent_species_id,
        r.id,
      );
      result.updated += 1;
    }
  });
  tx2(taxoRows);

  console.log(
    `[inat backfill] scanned ${result.scanned} rows, updated ${result.updated} records (species_id + taxonomy)`,
  );
  return result;
}
