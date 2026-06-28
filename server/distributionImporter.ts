/**
 * Distribution importer service.
 *
 * Pulls research-grade, geo-tagged observations for an AU herp species from
 * iNaturalist v1 and ALA biocache, dedupes by (source, sourceId), and bulk
 * inserts into the speciesRecords table. Supports per-species imports and a
 * single in-process background job that walks the entire catalog.
 *
 * Design constraints:
 *  - Polite to both APIs: small per-page sizes, sequential page walks per
 *    species, short delays between species.
 *  - Idempotent: bulkInsertSpeciesRecords uses INSERT OR IGNORE so reruns
 *    don't duplicate.
 *  - Single-job: only one bulk import may run at a time.
 */

import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────
// External API constants
// ─────────────────────────────────────────────────────────────────────────

const INAT = "https://api.inaturalist.org/v1";
const ALA_BIOCACHE = "https://biocache-ws.ala.org.au/ws";
// iNat AU place_id (matches the constant used in server/routes.ts)
const AU_PLACE_ID = 6744;

// Page sizes — keep modest to play nicely with both APIs.
const INAT_PER_PAGE = 200; // iNat max 200 for /observations
const ALA_PAGE_SIZE = 300; // ALA's pageSize, must use startIndex pagination

// Hard safety cap so a single species never pulls forever (very few species
// will have anywhere near this many AU geotagged research-grade records).
// We deliberately cap each source to a *broad sample* — enough records to
// build a faithful 0.5° distribution map without pulling every observation.
// A single source page (200 iNat / 300 ALA) already covers most species'
// full range; 2 pages gives broad coverage even for very common taxa, while
// keeping the bulk job tractable (≈seconds per species rather than minutes).
const MAX_INAT_PAGES = 2; // up to 400 iNat records per species
const MAX_ALA_PAGES = 2;  // up to 600 ALA records per species

// Polite delays
const INTER_REQUEST_MS = 250;
const INTER_SPECIES_MS = 400;

// AU bounding box — used to filter ALA results that might leak across (very
// rare, but biocache occasionally returns shifted coords).
const AU_BBOX = { latMin: -44, latMax: -9, lngMin: 112, lngMax: 154 };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withinAU(lat: number, lng: number): boolean {
  return (
    lat >= AU_BBOX.latMin &&
    lat <= AU_BBOX.latMax &&
    lng >= AU_BBOX.lngMin &&
    lng <= AU_BBOX.lngMax
  );
}

async function fetchJsonRetry(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "AustralianHerpetology/1.0 (distribution importer)",
          Accept: "application/json",
        },
      });
      if (res.status === 429 || res.status >= 500) {
        // Backoff and retry on rate-limit / 5xx
        await sleep(1000 * (i + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Upstream ${res.status}: ${url}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr ?? new Error(`Fetch failed: ${url}`);
}

// ─────────────────────────────────────────────────────────────────────────
// iNaturalist fetch
// ─────────────────────────────────────────────────────────────────────────

interface NormalizedRecord {
  speciesId: number;
  lat: number;
  lng: number;
  date: string | null;
  source: "inat" | "ala";
  sourceId: string;
}

/**
 * Fetch all research-grade geotagged AU observations for an iNat taxon id.
 * Returns normalized records.
 */
export async function fetchInatRecords(speciesId: number): Promise<NormalizedRecord[]> {
  const out: NormalizedRecord[] = [];
  let page = 1;
  while (page <= MAX_INAT_PAGES) {
    const params = new URLSearchParams({
      taxon_id: String(speciesId),
      place_id: String(AU_PLACE_ID),
      quality_grade: "research",
      geo: "true",
      per_page: String(INAT_PER_PAGE),
      page: String(page),
      // Default order (created_at desc) gives a more geographically diverse
      // broad sample than "id asc" (which would cluster on the earliest
      // observations and miss recently colonised areas).
    });
    const url = `${INAT}/observations?${params}`;
    const data = (await fetchJsonRetry(url)) as {
      total_results?: number;
      results?: Array<{
        id?: number;
        observed_on?: string | null;
        geojson?: { coordinates?: [number, number] };
        location?: string | null;
      }>;
    };
    const results = data.results ?? [];
    if (results.length === 0) break;
    for (const r of results) {
      let lat: number | null = null;
      let lng: number | null = null;
      if (r.geojson?.coordinates && r.geojson.coordinates.length === 2) {
        // GeoJSON: [lng, lat]
        lng = r.geojson.coordinates[0];
        lat = r.geojson.coordinates[1];
      } else if (r.location) {
        const parts = r.location.split(",").map((s) => parseFloat(s.trim()));
        if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
          lat = parts[0];
          lng = parts[1];
        }
      }
      if (lat == null || lng == null) continue;
      if (!withinAU(lat, lng)) continue;
      if (r.id == null) continue;
      out.push({
        speciesId,
        lat,
        lng,
        date: r.observed_on ?? null,
        source: "inat",
        sourceId: String(r.id),
      });
    }
    if (results.length < INAT_PER_PAGE) break;
    page += 1;
    await sleep(INTER_REQUEST_MS);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// ALA biocache fetch
// ─────────────────────────────────────────────────────────────────────────

/**
 * ALA biocache search. We query by scientific name (much more reliable than
 * lsid-matching across taxon backbones). Returns normalized records.
 *
 * speciesId here is the iNat taxon id used to key the record back to the
 * species — the ALA observation itself is identified by its own occurrence
 * uuid stored as sourceId.
 */
export async function fetchAlaRecords(
  speciesId: number,
  scientificName: string,
): Promise<NormalizedRecord[]> {
  const out: NormalizedRecord[] = [];
  let startIndex = 0;
  let pages = 0;
  while (pages < MAX_ALA_PAGES) {
    const params = new URLSearchParams({
      // Quote the scientific name to keep multi-word matches intact
      q: `taxon_name:"${scientificName}"`,
      fq: "geospatial_kosher:true",
      pageSize: String(ALA_PAGE_SIZE),
      startIndex: String(startIndex),
      sort: "id",
      dir: "asc",
    });
    const url = `${ALA_BIOCACHE}/occurrences/search?${params}`;
    const data = (await fetchJsonRetry(url)) as {
      totalRecords?: number;
      occurrences?: Array<{
        uuid?: string;
        decimalLatitude?: number;
        decimalLongitude?: number;
        eventDate?: number | string | null;
      }>;
    };
    const occ = data.occurrences ?? [];
    if (occ.length === 0) break;
    for (const r of occ) {
      const lat = r.decimalLatitude;
      const lng = r.decimalLongitude;
      if (lat == null || lng == null) continue;
      if (!withinAU(lat, lng)) continue;
      if (!r.uuid) continue;
      let date: string | null = null;
      if (typeof r.eventDate === "number") {
        date = new Date(r.eventDate).toISOString().slice(0, 10);
      } else if (typeof r.eventDate === "string") {
        date = r.eventDate.slice(0, 10);
      }
      out.push({
        speciesId,
        lat,
        lng,
        date,
        source: "ala",
        sourceId: r.uuid,
      });
    }
    if (occ.length < ALA_PAGE_SIZE) break;
    startIndex += occ.length;
    pages += 1;
    await sleep(INTER_REQUEST_MS);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Import a single species (iNat + ALA + dedupe + bulk insert)
// ─────────────────────────────────────────────────────────────────────────

export interface SpeciesImportResult {
  speciesId: number;
  scientific: string;
  fetched: number; // total raw rows from both sources
  inserted: number; // newly inserted (post-dedupe)
  skipped: number; // already present
  errors: string[];
}

/**
 * Run a full fetch + insert for one species. Safe to re-run — duplicates
 * are silently skipped at the DB level.
 */
export async function importSpecies(opts: {
  speciesId: number;
  scientific: string;
  sources?: Array<"inat" | "ala">;
}): Promise<SpeciesImportResult> {
  const result: SpeciesImportResult = {
    speciesId: opts.speciesId,
    scientific: opts.scientific,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };
  const sources = opts.sources ?? ["inat", "ala"];

  let inatRows: NormalizedRecord[] = [];
  let alaRows: NormalizedRecord[] = [];

  if (sources.includes("inat")) {
    try {
      inatRows = await fetchInatRecords(opts.speciesId);
    } catch (e) {
      result.errors.push(`iNat: ${(e as Error).message}`);
    }
  }
  if (sources.includes("ala")) {
    try {
      alaRows = await fetchAlaRecords(opts.speciesId, opts.scientific);
    } catch (e) {
      result.errors.push(`ALA: ${(e as Error).message}`);
    }
  }

  const combined = inatRows.concat(alaRows);
  result.fetched = combined.length;

  // The DB layer dedupes on (source, sourceId). Cross-source dedupe (same
  // physical observation reported by both iNat and ALA) is not attempted
  // here — the grid aggregation tolerates a small amount of duplication.
  if (combined.length === 0) return result;

  const inserted = storage.bulkInsertSpeciesRecords(combined);
  result.inserted = inserted;
  result.skipped = combined.length - inserted;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Catalog loading (for bulk-import job)
// ─────────────────────────────────────────────────────────────────────────

interface CatalogEntry {
  id: number;
  scientific: string;
  common: string | null;
  group: string | null;
}

function loadJsonFromCandidates<T>(filenames: string[]): T | null {
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
          // fall through
        }
      }
    }
  }
  return null;
}

// Loads species catalog AND merges subspecies catalog so bulk imports include
// every taxon that the app exposes a profile/distribution page for.
function loadCatalog(): CatalogEntry[] {
  const species = loadJsonFromCandidates<CatalogEntry[]>(["species_catalog.json"]) ?? [];
  const subs = loadJsonFromCandidates<Array<{ id: number; scientific: string; common: string | null; group?: string | null }>>(["subspecies_catalog.json"]) ?? [];
  const merged: CatalogEntry[] = [...species];
  const seen = new Set(species.map((s) => s.id));
  for (const s of subs) {
    if (seen.has(s.id)) continue;
    merged.push({
      id: s.id,
      scientific: s.scientific,
      common: s.common ?? null,
      group: s.group ?? null,
    });
    seen.add(s.id);
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────
// Background bulk-import job
// ─────────────────────────────────────────────────────────────────────────

let JOB_RUNNING = false;
let JOB_CANCEL = false;

export function isJobRunning(): boolean {
  return JOB_RUNNING;
}

export function cancelJob(): void {
  if (JOB_RUNNING) JOB_CANCEL = true;
}

/**
 * Start a background bulk import. Returns immediately; progress can be
 * polled via storage.getImportJob(). Subsequent calls while a job is
 * running are no-ops.
 */
export function startBulkImport(opts: {
  triggeredBy: number;
  sources?: Array<"inat" | "ala">;
  /**
   * When true (default), species that already have any records in the DB
   * are skipped — lets a cancelled/restarted job resume cheaply without
   * re-hitting iNat/ALA for thousands of already-imported taxa. Set to
   * false to force a full re-fetch.
   */
  skipExisting?: boolean;
}): { started: boolean; reason?: string } {
  if (JOB_RUNNING) return { started: false, reason: "already_running" };
  const fullCatalog = loadCatalog();
  if (fullCatalog.length === 0) {
    return { started: false, reason: "catalog_empty" };
  }
  const skipExisting = opts.skipExisting !== false;
  let catalog = fullCatalog;
  if (skipExisting) {
    const alreadyImported = new Set(storage.getSpeciesIdsWithAnyRecords());
    catalog = fullCatalog.filter((c) => !alreadyImported.has(c.id));
  }

  JOB_RUNNING = true;
  JOB_CANCEL = false;

  // Reset job state in DB
  storage.upsertImportJob({
    status: "running",
    totalSpecies: catalog.length,
    processedSpecies: 0,
    currentSpeciesId: null,
    currentSpeciesName: null,
    totalRecords: 0,
    lastError: null,
    startedAt: Date.now(),
    finishedAt: null,
  });

  // Fire and forget
  void (async () => {
    let totalRecords = 0;
    let processed = 0;
    try {
      for (const entry of catalog) {
        if (JOB_CANCEL) break;
        storage.upsertImportJob({
          status: "running",
          processedSpecies: processed,
          currentSpeciesId: entry.id,
          currentSpeciesName: entry.scientific,
          totalRecords,
        });
        try {
          const r = await importSpecies({
            speciesId: entry.id,
            scientific: entry.scientific,
            sources: opts.sources,
          });
          totalRecords += r.inserted;
        } catch (e) {
          // Don't abort the entire job for a single failure — log it
          console.error(
            `[distributionImporter] species ${entry.id} failed:`,
            (e as Error).message,
          );
        }
        processed += 1;
        await sleep(INTER_SPECIES_MS);
      }
      storage.upsertImportJob({
        status: JOB_CANCEL ? "idle" : "done",
        processedSpecies: processed,
        totalRecords,
        currentSpeciesId: null,
        currentSpeciesName: null,
        finishedAt: Date.now(),
      });
    } catch (e) {
      storage.upsertImportJob({
        status: "error",
        processedSpecies: processed,
        totalRecords,
        lastError: (e as Error).message,
        finishedAt: Date.now(),
      });
    } finally {
      JOB_RUNNING = false;
      JOB_CANCEL = false;
    }
  })();

  return { started: true };
}

/** Catalog size (used to show "import all 1207 species" button). */
export function getCatalogSize(): number {
  return loadCatalog().length;
}
