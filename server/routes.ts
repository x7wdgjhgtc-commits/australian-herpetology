import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { registerUserRoutes } from "./userRoutes";
import { storage } from "./storage";

/**
 * Australian Herpetology backend proxy.
 * - Proxies + caches calls to iNaturalist v1 + ALA biocache + ALA BIE
 * - All responses are JSON
 * - In-memory LRU cache with TTL (sufficient for MVP; survives a single
 *   process lifetime, resets on redeploy)
 */

const INAT = "https://api.inaturalist.org/v1";
const ALA_BIOCACHE = "https://biocache-ws.ala.org.au/ws";
const ALA_BIE = "https://bie.ala.org.au/ws/species";
const ALA_NAMEMATCH = "https://api.ala.org.au/namematching/api/searchByClassification";

/**
 * Look up the scientific authority (e.g. "(Gray, 1841)") for a binomial name
 * via ALA's namematching service. Returns only when the match is exact at
 * species rank — we never want a genus-level higherMatch to leak in as the
 * authority for an unrecognised species (e.g. recently described taxa not
 * yet in ALA). Cached for 7 days.
 */
async function lookupAlaAuthority(
  scientificName: string | null | undefined,
): Promise<string | null> {
  const name = (scientificName || "").trim();
  if (!name || !name.includes(" ")) return null;
  try {
    const url = `${ALA_NAMEMATCH}?scientificName=${encodeURIComponent(name)}`;
    const data = (await fetchJson(url, 1000 * 60 * 60 * 24 * 7)) as {
      success?: boolean;
      matchType?: string;
      rank?: string;
      scientificNameAuthorship?: string | null;
    };
    if (!data?.success) return null;
    // Only accept species-level exact (or fuzzy) matches — reject higherMatch
    // where ALA falls back to a genus / family authority for an unknown species.
    const okMatch = data.matchType && data.matchType !== "higherMatch";
    const okRank = data.rank === "species" || data.rank === "subspecies";
    if (!okMatch || !okRank) return null;
    const author = (data.scientificNameAuthorship || "").trim();
    return author || null;
  } catch {
    return null;
  }
}

/**
 * Conservation-status jurisdictions we surface on the species profile.
 * Keyed in the same order they should render in the UI.
 * "AUS" is the federal (EPBC) listing; the rest are state/territory listings.
 */
export const CONSERVATION_JURISDICTIONS = [
  "AUS", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA",
] as const;
export type ConservationJurisdiction = (typeof CONSERVATION_JURISDICTIONS)[number];
export type ConservationStatusMap = Partial<
  Record<ConservationJurisdiction, { status: string; dr?: string }>
>;

/**
 * Look up federal + per-state conservation listings via ALA's BIE species
 * endpoint. Returns a jurisdiction-keyed dictionary like:
 *   { AUS: { status: "Vulnerable" }, NSW: { status: "Endangered" }, ... }
 * Cached 7 days. Missing/empty results return {}.
 */
async function lookupAlaConservationStatuses(
  scientificName: string | null | undefined,
): Promise<ConservationStatusMap> {
  const name = (scientificName || "").trim();
  if (!name || !name.includes(" ")) return {};
  try {
    const url = `https://bie-ws.ala.org.au/ws/species/${encodeURIComponent(name)}`;
    const data = (await fetchJson(url, 1000 * 60 * 60 * 24 * 7)) as {
      conservationStatuses?: Record<string, { status?: string; dr?: string }>;
    };
    const raw = data?.conservationStatuses;
    if (!raw || typeof raw !== "object") return {};
    const out: ConservationStatusMap = {};
    for (const j of CONSERVATION_JURISDICTIONS) {
      const row = raw[j];
      const status = row?.status?.trim();
      if (status) out[j] = { status, ...(row.dr ? { dr: row.dr } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

// AU place_id in iNaturalist
const AU_PLACE_ID = 6744;
// iconic_taxa we care about
const ICONIC = "Reptilia,Amphibia";

type CacheEntry = { value: unknown; expires: number };
const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 1000;

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  // refresh LRU position
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

async function fetchJson(url: string, ttlMs = 1000 * 60 * 60): Promise<unknown> {
  const cached = cacheGet(url);
  if (cached) return cached;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AustralianHerpetology/1.0 (field guide app)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Upstream ${res.status}: ${url}`);
  }
  const data = await res.json();
  cacheSet(url, data, ttlMs);
  return data;
}

function handleError(res: Response, err: unknown) {
  console.error(err);
  const message = err instanceof Error ? err.message : "Unknown upstream error";
  res.status(502).json({ error: message });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // User accounts, profiles, records, suggestions, follows, feed
  registerUserRoutes(app);

  /**
   * POST /api/admin/bootstrap
   * One-time recovery endpoint: promotes a username to super-admin when the
   * caller provides the correct ADMIN_BOOTSTRAP_TOKEN env var. Used after a
   * fresh deploy when the auto-seed (Willhunt) account isn't the one the
   * operator is logging in with. Disable by removing the env var.
   *
   * curl -X POST 'https://<host>/api/admin/bootstrap?username=USER&token=SECRET'
   */
  app.post("/api/admin/bootstrap", async (req: Request, res: Response) => {
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expected) {
      return res.status(404).json({ error: "bootstrap disabled" });
    }
    const provided = String(req.query.token || "");
    const username = String(req.query.username || "").trim();
    if (!provided || provided !== expected) {
      return res.status(403).json({ error: "invalid token" });
    }
    if (!username) {
      return res.status(400).json({ error: "username required" });
    }
    const user = storage.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: `no user named ${username}` });
    }
    storage.setUserRole(user.id, "super-admin");
    return res.json({ ok: true, userId: user.id, username, role: "super-admin" });
  });

  /**
   * GET /api/species
   * Query:
   *   q?         — text search
   *   group?     — 'reptiles' | 'amphibians' | 'snakes' | 'lizards' | 'turtles' | 'crocs' | 'frogs' | 'all'
   *   taxon_id?  — explicit iNat taxon id (family, genus, etc) — overrides group when present
   *   page?      — 1-based page index   (default 1)
   *   per_page?  — page size            (default 30, max 100)
   * Returns iNat species_counts filtered to AU.
   */
  app.get("/api/species", async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string | undefined)?.trim() || "";
      const group = (req.query.group as string | undefined) || "all";
      const taxonIdParam = (req.query.taxon_id as string | undefined)?.trim();
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const perPage = Math.min(
        100,
        Math.max(1, parseInt((req.query.per_page as string) || "30", 10)),
      );

      // Group → iNat root taxon id (when narrower than the iconic class).
      // Snakes=Serpentes 85553, Lizards=Sauria 85552, Turtles=Testudines 39532,
      // Crocs=Crocodylia 26039, Frogs=Anura 20979.
      const GROUP_TAXON: Record<string, number> = {
        snakes: 85553,
        lizards: 85552,
        turtles: 39532,
        crocs: 26039,
        frogs: 20979,
      };
      const groupTaxon = GROUP_TAXON[group];

      const iconic =
        group === "reptiles"
          ? "Reptilia"
          : group === "amphibians"
            ? "Amphibia"
            : ICONIC;

      const params = new URLSearchParams({
        place_id: String(AU_PLACE_ID),
        quality_grade: "research",
        page: String(page),
        per_page: String(perPage),
        locale: "en",
      });
      // taxon_id (explicit) beats group; group taxon beats iconic_taxa class.
      if (taxonIdParam) {
        params.set("taxon_id", taxonIdParam);
      } else if (groupTaxon) {
        params.set("taxon_id", String(groupTaxon));
      } else {
        params.set("iconic_taxa", iconic);
      }
      if (q) params.set("q", q);

      const url = `${INAT}/observations/species_counts?${params}`;
      const data = (await fetchJson(url, 1000 * 60 * 60 * 6)) as any; // 6h

      // Inject hero_photo_url onto each taxon so list views (Browse) match
      // the Species detail page. Precedence (admin-forced → admin-pinned →
      // top-liked) is computed by the bulk resolver; when it returns no
      // entry we leave hero_photo_url undefined and the client falls back
      // to the iNat default_photo.
      try {
        if (data && Array.isArray(data.results)) {
          const ids: number[] = data.results
            .map((r: any) => r?.taxon?.id)
            .filter((id: any) => typeof id === "number" && Number.isFinite(id));
          if (ids.length > 0) {
            const map = storage.resolveSpeciesHeroUrlsBulk(ids);
            for (const r of data.results) {
              const tid = r?.taxon?.id;
              if (typeof tid === "number") {
                const resolved = map.get(tid);
                if (resolved) r.taxon.hero_photo_url = resolved;
              }
            }
          }
        }
      } catch (e) {
        // Non-fatal — falls back to default_photo.
        console.warn("[species] hero resolution failed:", e);
      }

      res.json(data);
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/taxon/:id
   * Full iNat taxon record (description, ancestors, photos, conservation).
   *
   * Fallback: if iNat returns no results (e.g. the species is admin-added and
   * not yet on iNat — manual ids 90_000_000+ or recently described taxa) we
   * synthesize a minimal taxon payload from the species_admin_entries table
   * so the Species profile page can still render. Without this fallback the
   * page shows "Species not found." for our newest entries.
   */
  app.get("/api/taxon/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const url = `${INAT}/taxa/${encodeURIComponent(id)}?locale=en`;
      const data = (await fetchJson(url, 1000 * 60 * 60 * 24)) as {
        total_results?: number;
        results?: unknown[];
      };

      if (data && Array.isArray(data.results) && data.results.length > 0) {
        // Enrich the iNat taxon with the authority pulled from ALA (cached 7d).
        // Admin override (species_admin_entries.authority) wins over ALA so
        // editors can correct or update the citation — useful for very recent
        // taxonomic acts ALA hasn't ingested yet.
        const first = data.results[0] as { id?: number; name?: string };
        try {
          const numericId = typeof first?.id === "number" ? first.id : parseInt(id, 10);
          const admin = Number.isFinite(numericId)
            ? storage.getAdminSpeciesEntry(numericId)
            : null;
          const adminAuth = admin?.authority?.trim() || null;
          // Run authority + conservation lookups in parallel where possible —
          // both hit ALA but different endpoints, so the second isn't free.
          const [alaAuth, conservation] = await Promise.all([
            adminAuth ? Promise.resolve(null) : lookupAlaAuthority(first?.name),
            lookupAlaConservationStatuses(first?.name),
          ]);
          (first as Record<string, unknown>).authority = adminAuth || alaAuth || null;
          (first as Record<string, unknown>).conservation_statuses_au = conservation;
        } catch {
          (first as Record<string, unknown>).authority = null;
          (first as Record<string, unknown>).conservation_statuses_au = {};
        }
        res.json(data);
        return;
      }

      // iNat has nothing — try the admin/manual catalog.
      const numericId = parseInt(id, 10);
      if (!Number.isFinite(numericId)) {
        res.json(data);
        return;
      }
      const admin = storage.getAdminSpeciesEntry(numericId);
      if (!admin || admin.hidden) {
        res.json(data);
        return;
      }

      // Build a synthetic taxon. Ancestors mirror what Species.tsx reads
      // (it looks for rank='class', 'order', and 'family' by name).
      const groupToClass = (g: string | null | undefined): string | null => {
        if (g === "frogs") return "Amphibia";
        if (g === "snakes" || g === "lizards" || g === "turtles" || g === "crocs") return "Reptilia";
        return null;
      };
      const groupToOrder = (g: string | null | undefined): string | null => {
        if (g === "frogs") return "Anura";
        if (g === "snakes" || g === "lizards") return "Squamata";
        if (g === "turtles") return "Testudines";
        if (g === "crocs") return "Crocodilia";
        return null;
      };
      const className = groupToClass(admin.group);
      const orderName = groupToOrder(admin.group);
      const ancestors: Array<{ rank: string; name: string; id: number }> = [];
      if (className) ancestors.push({ rank: "class", name: className, id: 0 });
      if (orderName) ancestors.push({ rank: "order", name: orderName, id: 0 });
      if (admin.familyName) {
        ancestors.push({ rank: "family", name: admin.familyName, id: admin.familyId ?? 0 });
      }
      if (admin.genus) {
        ancestors.push({ rank: "genus", name: admin.genus, id: 0 });
      }

      const synthetic = {
        total_results: 1,
        page: 1,
        per_page: 30,
        results: [
          {
            id: admin.id,
            name: admin.scientific || "",
            rank: "species",
            preferred_common_name: admin.common || undefined,
            iconic_taxon_name: className === "Amphibia" ? "Amphibia" : "Reptilia",
            // Surface the admin description (if any) where Species.tsx looks
            // for the Wikipedia summary, so the species profile has content.
            wikipedia_summary: admin.description || null,
            wikipedia_url: null,
            default_photo: null,
            taxon_photos: [],
            ancestors,
            observations_count: 0,
            conservation_status: null,
            // Authority for manual/recently-described species — admin field
            // wins; fall back to ALA in case the name is in ALA but iNat hasn't
            // ingested it yet.
            authority:
              (admin.authority && admin.authority.trim()) ||
              (await lookupAlaAuthority(admin.scientific)) ||
              null,
            conservation_statuses_au: await lookupAlaConservationStatuses(
              admin.scientific,
            ),
          },
        ],
      };
      res.json(synthetic);
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/observations/:taxonId
   * Recent AU observations of a taxon, including photo + location + license.
   * Used for the species profile photo gallery (with location + credit).
   *
   * Query:
   *   per_page? (default 12, max 30)
   */
  app.get(
    "/api/observations/:taxonId",
    async (req: Request, res: Response) => {
      try {
        const taxonId = req.params.taxonId;
        const perPage = Math.min(
          30,
          Math.max(1, parseInt((req.query.per_page as string) || "12", 10)),
        );
        const block = storage.getInatBlocklistSnapshot();
        const params = new URLSearchParams({
          taxon_id: taxonId,
          place_id: String(AU_PLACE_ID),
          photos: "true",
          quality_grade: "research",
          per_page: String(perPage),
          // votes ordering surfaces the best photos
          order_by: "votes",
          order: "desc",
          locale: "en",
        });
        if (block.userIds) params.set("not_user_id", block.userIds);
        const url = `${INAT}/observations?${params}`;
        const data = (await fetchJson(url, 1000 * 60 * 60 * 6)) as {
          results?: Array<{ user?: { id?: number; login?: string } | null }>;
          [k: string]: unknown;
        };
        // Defence-in-depth: post-filter by login in case the cached payload
        // pre-dates a newer block entry that hasn't expired yet.
        if (block.logins.size && Array.isArray(data.results)) {
          data.results = data.results.filter((r) => {
            const login = r?.user?.login?.toLowerCase();
            return !login || !block.logins.has(login);
          });
        }
        res.json(data);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  /**
   * GET /api/distribution/:taxonId
   * Occurrence points for a taxon in Australia (lightweight) for distribution map.
   * Uses iNaturalist observations endpoint with only_id-ish fields.
   */
  app.get(
    "/api/distribution/:taxonId",
    async (req: Request, res: Response) => {
      try {
        const taxonId = req.params.taxonId;
        const block = storage.getInatBlocklistSnapshot();
        const params = new URLSearchParams({
          taxon_id: taxonId,
          place_id: String(AU_PLACE_ID),
          quality_grade: "research",
          geo: "true",
          per_page: "500",
          order_by: "observed_on",
          order: "desc",
        });
        if (block.userIds) params.set("not_user_id", block.userIds);
        const url = `${INAT}/observations?${params}`;
        const data = (await fetchJson(url, 1000 * 60 * 60 * 12)) as {
          results: Array<{
            id: number;
            location: string | null;
            observed_on: string | null;
            place_guess: string | null;
            user?: { id?: number; login?: string } | null;
          }>;
          total_results: number;
        };
        // Post-filter by login (the cache key already includes not_user_id,
        // but a newly-added block won't invalidate a still-warm entry).
        if (block.logins.size) {
          data.results = (data.results || []).filter((r) => {
            const login = r?.user?.login?.toLowerCase();
            return !login || !block.logins.has(login);
          });
        }
        // Project down to {lat, lng, id, date, place} so payload is small
        const points = (data.results || [])
          .map((r) => {
            if (!r.location) return null;
            const [lat, lng] = r.location.split(",").map(Number);
            if (!isFinite(lat) || !isFinite(lng)) return null;
            return {
              id: r.id,
              lat,
              lng,
              date: r.observed_on,
              place: r.place_guess,
            };
          })
          .filter(Boolean);
        res.json({
          total: data.total_results,
          returned: points.length,
          points,
        });
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  /**
   * GET /api/area
   * "What lives here?" — given a lat/lng + radius (km), return reptile +
   * amphibian species found in that area.
   *
   * Powered by ALA biocache facets — fast and authoritative for Australia.
   *
   * Query:
   *   lat       — required
   *   lng       — required
   *   radius?   — km, default 10, max 50
   *   group?    — 'reptiles' | 'amphibians' | 'all'
   */
  app.get("/api/area", async (req: Request, res: Response) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = Math.min(
        50,
        Math.max(1, parseFloat((req.query.radius as string) || "10")),
      );
      const group = (req.query.group as string | undefined) || "all";
      if (!isFinite(lat) || !isFinite(lng)) {
        return res.status(400).json({ error: "lat and lng are required" });
      }

      let classFilter = "(class:Reptilia OR class:Amphibia)";
      if (group === "reptiles") classFilter = "class:Reptilia";
      if (group === "amphibians") classFilter = "class:Amphibia";

      const params = new URLSearchParams({
        q: classFilter,
        lat: String(lat),
        lon: String(lng),
        radius: String(radius),
        pageSize: "0",
        facets: "species_guid",
        flimit: "200",
        // bias toward research-grade-like records
        fq: "geospatial_kosher:true",
      });
      const url = `${ALA_BIOCACHE}/occurrences/search?${params}`;
      const data = (await fetchJson(url, 1000 * 60 * 30)) as {
        totalRecords: number;
        facetResults: Array<{
          fieldName: string;
          fieldResult: Array<{ label: string; i18nCode?: string; count: number; fq?: string }>;
        }>;
      };
      const speciesFacet = (data.facetResults || []).find(
        (f) => f.fieldName === "species_guid",
      );
      const species = (speciesFacet?.fieldResult || []).map((r) => ({
        guid: r.label,
        count: r.count,
      }));
      res.json({
        center: { lat, lng },
        radius,
        totalRecords: data.totalRecords,
        species,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/ala-resolve
   * Given an ALA species GUID, resolve scientific name + common name +
   * (optionally) an iNat taxon_id for cross-linking. We do this by:
   *   1) ALA species detail call → scientificName, vernacularName
   *   2) iNat taxa search by name → taxon_id
   *
   * Query: guid (required)
   */
  app.get("/api/ala-resolve", async (req: Request, res: Response) => {
    try {
      const guid = req.query.guid as string;
      if (!guid) return res.status(400).json({ error: "guid required" });
      // Step 1: ALA species detail
      const alaUrl = `${ALA_BIE}/${encodeURIComponent(guid)}`;
      const ala = (await fetchJson(alaUrl, 1000 * 60 * 60 * 24)) as any;
      const sciName: string | null =
        ala?.taxonConcept?.nameString ||
        ala?.classification?.scientificName ||
        ala?.nameString ||
        null;
      const author: string | null = ala?.taxonConcept?.author || null;
      const commonName: string | null =
        ala?.commonNames?.[0]?.nameString ||
        ala?.classification?.commonName ||
        null;

      // Step 2: iNat lookup
      let inatId: number | null = null;
      let inatPhoto: string | null = null;
      if (sciName) {
        const inatUrl = `${INAT}/taxa?q=${encodeURIComponent(sciName)}&rank=species&per_page=1`;
        const inat = (await fetchJson(inatUrl, 1000 * 60 * 60 * 24)) as any;
        const first = inat?.results?.[0];
        if (first && first.name?.toLowerCase() === sciName.toLowerCase()) {
          inatId = first.id;
          inatPhoto = first.default_photo?.medium_url || null;
        }
      }

      res.json({
        guid,
        scientificName: sciName,
        author,
        commonName,
        inatId,
        inatPhoto,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/authority
   * Given a scientific name (binomial), look it up in ALA and return
   * the author (e.g. "(Gray, 1831)") plus authoritative classification.
   * Used by the species profile page so we always show "described by".
   */
  app.get("/api/authority", async (req: Request, res: Response) => {
    try {
      const name = (req.query.name as string | undefined)?.trim();
      if (!name) return res.status(400).json({ error: "name required" });
      // Primary path: ALA namematching (single fast call, returns authorship
      // directly). Still query the BIE detail endpoint for classification
      // fields (family/order/class) used by the species profile fallbacks.
      const author = await lookupAlaAuthority(name);
      let guid: string | null = null;
      let family: string | null = null;
      let order: string | null = null;
      let className: string | null = null;
      try {
        const autoUrl = `https://api.ala.org.au/species/search/auto?q=${encodeURIComponent(name)}&idxType=TAXON&limit=1`;
        const auto = (await fetchJson(autoUrl, 1000 * 60 * 60 * 24)) as any;
        const first = auto?.autoCompleteList?.[0];
        if (first?.guid) {
          guid = first.guid;
          const detailUrl = `${ALA_BIE}/${encodeURIComponent(first.guid)}`;
          const detail = (await fetchJson(detailUrl, 1000 * 60 * 60 * 24)) as any;
          family = detail?.classification?.family || null;
          order = detail?.classification?.order || null;
          className = detail?.classification?.class || null;
        }
      } catch {
        // Classification fetch is best-effort — authority alone is fine.
      }
      res.json({ name, guid, author, family, order, class: className });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/area-species
   * Same as /api/area but performs the iNat-resolve in a batched parallel
   * call so the client gets one tidy list of species with names + photos.
   * Limits resolution to top N (default 50) species by count.
   */
  app.get("/api/area-species", async (req: Request, res: Response) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = Math.min(
        50,
        Math.max(1, parseFloat((req.query.radius as string) || "10")),
      );
      const group = (req.query.group as string | undefined) || "all";
      const limit = Math.min(
        80,
        Math.max(1, parseInt((req.query.limit as string) || "50", 10)),
      );
      if (!isFinite(lat) || !isFinite(lng)) {
        return res.status(400).json({ error: "lat and lng are required" });
      }

      let classFilter = "(class:Reptilia OR class:Amphibia)";
      if (group === "reptiles") classFilter = "class:Reptilia";
      if (group === "amphibians") classFilter = "class:Amphibia";

      const params = new URLSearchParams({
        q: classFilter,
        lat: String(lat),
        lon: String(lng),
        radius: String(radius),
        pageSize: "0",
        facets: "species_guid",
        flimit: String(limit),
        fq: "geospatial_kosher:true",
      });
      const url = `${ALA_BIOCACHE}/occurrences/search?${params}`;
      const data = (await fetchJson(url, 1000 * 60 * 30)) as any;
      const speciesFacet = (data.facetResults || []).find(
        (f: any) => f.fieldName === "species_guid",
      );
      const facetRows: Array<{ label: string; count: number }> =
        speciesFacet?.fieldResult || [];

      // Resolve in parallel via cached /api/ala-resolve logic
      const resolved = await Promise.all(
        facetRows.map(async (row) => {
          try {
            const alaUrl = `${ALA_BIE}/${encodeURIComponent(row.label)}`;
            const ala = (await fetchJson(alaUrl, 1000 * 60 * 60 * 24)) as any;
            const sciName: string | null =
              ala?.taxonConcept?.nameString ||
              ala?.classification?.scientificName ||
              null;
            const commonName: string | null =
              ala?.commonNames?.[0]?.nameString ||
              ala?.classification?.commonName ||
              null;
            const rank: string | null =
              ala?.taxonConcept?.rankString ||
              ala?.classification?.rank ||
              null;
            const className: string | null =
              (ala?.classification?.class as string | undefined)?.toUpperCase() === 'AMPHIBIA'
                ? 'Amphibia'
                : (ala?.classification?.class as string | undefined)?.toUpperCase() === 'REPTILIA'
                ? 'Reptilia'
                : (ala?.classification?.class || null);
            const author: string | null = ala?.taxonConcept?.author || null;
            // Skip non-species rows
            if (!sciName) return null;
            if (rank && rank.toLowerCase() !== "species") return null;

            // Resolve iNat id + photo
            let inatId: number | null = null;
            let inatPhoto: string | null = null;
            try {
              const inatUrl = `${INAT}/taxa?q=${encodeURIComponent(sciName)}&rank=species&per_page=1`;
              const inat = (await fetchJson(
                inatUrl,
                1000 * 60 * 60 * 24,
              )) as any;
              const first = inat?.results?.[0];
              if (
                first &&
                first.name?.toLowerCase() === sciName.toLowerCase()
              ) {
                inatId = first.id;
                inatPhoto = first.default_photo?.medium_url || null;
              }
            } catch {
              // ignore — photo/id will be null
            }

            return {
              guid: row.label,
              count: row.count,
              scientificName: sciName,
              commonName,
              author,
              class: className,
              inatId,
              inatPhoto,
            };
          } catch {
            return null;
          }
        }),
      );

      const list = resolved.filter(Boolean) as Array<{
        guid: string;
        count: number;
        scientificName: string;
        commonName: string | null;
        author: string | null;
        class: string | null;
        inatId: number | null;
        inatPhoto: string | null;
      }>;

      // Override inatPhoto with the species-page hero when one exists, so the
      // map-search list shows the SAME primary image as the species profile
      // (admin-forced → admin-pinned → top-liked → fall back to iNat default).
      try {
        const inatIds = list
          .map((s) => s.inatId)
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
        if (inatIds.length > 0) {
          const map = storage.resolveSpeciesHeroUrlsBulk(inatIds);
          for (const s of list) {
            if (s.inatId != null) {
              const hero = map.get(s.inatId);
              if (hero) s.inatPhoto = hero;
            }
          }
        }
      } catch (e) {
        console.warn("[area-species] hero resolution failed:", e);
      }

      res.json({
        center: { lat, lng },
        radius,
        totalRecords: data.totalRecords,
        species: list,
      });
    } catch (err) {
      handleError(res, err);
    }
  });


  /**
   * GET /api/morphology
   * Query:
   *   name        — scientific binomial (required)
   *   group       — 'snake' | 'lizard' | 'amphibian' (required)
   *
   * Extracts morphological data from the full Wikipedia article:
   *   snake     — totalLength, snoutVent, dorsalScales, ventralScales,
   *               subcaudalScales, analScale
   *   lizard    — totalLength, snoutVent
   *   amphibian — size (body length)
   *
   * Each field is { value: string, source: string } or null.
   * The source is the verbatim Wikipedia sentence the value was lifted from.
   */
  app.get("/api/morphology", async (req: Request, res: Response) => {
    try {
      const name = (req.query.name as string | undefined)?.trim();
      const group = (req.query.group as string | undefined)?.trim().toLowerCase();
      if (!name) return res.status(400).json({ error: "name required" });
      if (!group || !["snake", "lizard", "amphibian"].includes(group)) {
        return res.status(400).json({ error: "group must be snake|lizard|amphibian" });
      }

      // Fetch full Wikipedia article via scientific name with redirects=1
      const wpUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(name.replace(/\s+/g, "_"))}`;
      const wp = (await fetchJson(wpUrl, 1000 * 60 * 60 * 24)) as any;
      const pages = wp?.query?.pages || {};
      const page = Object.values(pages)[0] as any;
      const text: string = page?.extract || "";

      if (!text || text.length < 100) {
        return res.json({ name, group, fields: {}, sourceUrl: null });
      }
      const sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;

      // Split into sentences. Also split on double-newlines (which delimit
      // Wikipedia section breaks) so we don't accidentally merge two sentences
      // across a heading like "=== Description ===".
      const sentences = text
        .split(/\n\s*\n+|(?<=[.!?])\s+(?=[A-Z(])/)
        .map((s) => s.replace(/={2,}\s*[^=]+={2,}/g, " ").trim())
        .filter((s) => s.length > 10 && s.length < 600);

      const findSentence = (patterns: RegExp[]): string | null => {
        for (const s of sentences) {
          for (const p of patterns) {
            if (p.test(s)) return s;
          }
        }
        return null;
      };

      // Like findSentence, but also requires the sentence to satisfy a
      // second filter (e.g. contains a digit). Returns first sentence that
      // passes BOTH the keyword and the filter.
      const findSentenceWith = (patterns: RegExp[], filter: RegExp): string | null => {
        for (const s of sentences) {
          for (const p of patterns) {
            if (p.test(s) && filter.test(s)) return s;
          }
        }
        return null;
      };

      const extractMeasure = (sentence: string, prefer: RegExp): string | null => {
        const m = sentence.match(prefer);
        return m ? m[0].trim() : null;
      };

      // Range or single measurement with metric units. Uses simple hyphen
      // characters; we normalize en/em dashes to hyphens before matching.
      const MEASURE_M_OR_CM = /(\d+(?:\.\d+)?\s*(?:to|-)\s*\d+(?:\.\d+)?\s*(?:m|cm|mm)(?:\s*\([^)]+\))?)|(\d+(?:\.\d+)?\s*(?:metres?|m|cm|mm)(?:\s*\([^)]+\))?)/i;
      const MEASURE_CM_MM = /(\d+(?:\.\d+)?\s*(?:to|-)\s*\d+(?:\.\d+)?\s*(?:cm|mm)(?:\s*\([^)]+\))?)|(\d+(?:\.\d+)?\s*(?:cm|mm)(?:\s*\([^)]+\))?)/i;
      // Normalize en/em dashes in a string to plain hyphens
      const norm = (s: string) => s.replace(/[\u2013\u2014]/g, "-");

      // "between 2 and 4 m" — a phrasing the simple regex misses
      const MEASURE_RANGE_BETWEEN = /between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*(metres?|m|cm|mm)\b/i;

      // Pull a length measurement from a sentence, preferring a "between X and
      // Y" range over individual measurements.
      const extractLength = (
        sentence: string,
        preferMetric: RegExp,
      ): string | null => {
        const n = norm(sentence);
        const between = n.match(MEASURE_RANGE_BETWEEN);
        if (between) return `${between[1]}-${between[2]} ${between[3]}`;
        const m = n.match(preferMetric);
        return m ? m[0].trim() : null;
      };

      const fields: Record<string, { value: string; source: string } | null> = {};

      // === Total length (snakes + lizards) ===
      if (group === "snake" || group === "lizard") {
        const sent = findSentenceWith(
          [
            /total length/i,
            /(grow|reach|reaches|reaching|attain|attains|up\s+to)[^.]{0,80}(metres?|m\s*\(|cm\s*\()/i,
            /(maximum|max\.?)[^.]{0,80}length/i,
          ],
          /\d/,
        );
        if (sent) {
          const value = extractLength(sent, MEASURE_M_OR_CM);
          fields.totalLength = value ? { value, source: sent } : null;
        } else {
          fields.totalLength = null;
        }
      }

      // === Snout-vent length (snakes + lizards) ===
      if (group === "snake" || group === "lizard") {
        // Require both an SVL keyword AND a metric measurement nearby —
        // otherwise we'll match a stray "snout" mention or a "13 million years
        // ago" false positive.
        const sent = findSentenceWith(
          [/snout[-\u2013\u2014\s]?(?:to[-\u2013\u2014\s]?)?vent/i, /\bSVL\b/],
          /\d+(?:\.\d+)?\s*(?:cm|mm|m\b)/i,
        );
        if (sent) {
          const n = norm(sent);
          // Prefer the measurement that's adjacent to the SVL keyword — the
          // same sentence often contains an unrelated "total length" figure.
          let value: string | null = null;
          // Pattern 1: "76.5 cm snout-vent length" / "24 cm snout to vent"
          let m = n.match(/(\d+(?:\.\d+)?\s*(?:cm|mm|m)\b(?:\s*\([^)]+\))?)\s+snout[-\s]?(?:to[-\s]?)?vent/i);
          if (m) value = m[1].trim();
          // Pattern 2: "snout-vent length [of] <measurement>" / "SVL of <measurement>"
          if (!value) {
            m = n.match(/(?:snout[-\s]?(?:to[-\s]?)?vent[^.]{0,80}?|SVL[^.]{0,40}?)(\d+(?:\.\d+)?\s*(?:cm|mm|m)\b(?:\s*\([^)]+\))?)/i);
            if (m) value = m[1].trim();
          }
          // Pattern 3: "<measurement> SVL"
          if (!value) {
            m = n.match(/(\d+(?:\.\d+)?\s*(?:cm|mm|m)\b(?:\s*\([^)]+\))?)\s+SVL/i);
            if (m) value = m[1].trim();
          }
          fields.snoutVent = value ? { value, source: sent } : null;
        } else {
          fields.snoutVent = null;
        }
      }

      // === Scale counts (snakes only) ===
      if (group === "snake") {
        // Dorsal scale rows at midbody
        const dorsalSent = findSentenceWith(
          [
            /dorsal scale(?:s)?\s+(?:rows\s+)?(?:at\s+)?midbody/i,
            /\d+\s+rows\s+of\s+dorsal\s+scales/i,
            /midbody[^.]{0,30}rows/i,
          ],
          /\d/,
        );
        if (dorsalSent) {
          const n = norm(dorsalSent);
          // Try several patterns
          let value: string | null = null;
          let m: RegExpMatchArray | null;
          m = n.match(/(\d+\s*(?:to|-)\s*\d+|\d+)\s+(?:rows\s+of\s+)?dorsal\s+scales/i);
          if (m) value = m[1];
          if (!value) {
            m = n.match(/dorsal\s+scales?[^.]{0,30}?(\d+\s*(?:to|-)\s*\d+|\d+)\s+rows?/i);
            if (m) value = m[1];
          }
          if (!value) {
            m = n.match(/(\d+\s*(?:to|-)\s*\d+|\d+)\s+rows?[^.]{0,20}midbody/i);
            if (m) value = m[1];
          }
          fields.dorsalScales = value
            ? { value: `${value} rows at midbody`, source: dorsalSent }
            : { value: "See description", source: dorsalSent };
        } else {
          fields.dorsalScales = null;
        }

        // Ventral scales — require a digit to skip color-pattern sentences
        const ventralSent = findSentenceWith(
          [/ventral scale/i, /\bventrals\b/i],
          /\d+\s*(?:to|-|\u2013|\u2014)?\s*\d*\s+ventral/i,
        );
        if (ventralSent) {
          const n = norm(ventralSent);
          const m = n.match(/(\d+\s*(?:to|-)\s*\d+|\d+)\s+ventral(?:s|\s+scales?)?/i);
          fields.ventralScales = m ? { value: m[1], source: ventralSent } : null;
        } else {
          fields.ventralScales = null;
        }

        // Subcaudal scales — require a digit
        const subSent = findSentenceWith([/subcaudal/i], /\d+\s*(?:to|-|\u2013|\u2014)?\s*\d*\s+(?:divided\s+|paired\s+|single\s+|undivided\s+)?subcaudal/i);
        if (subSent) {
          const n = norm(subSent);
          const m = n.match(/(\d+\s*(?:to|-)\s*\d+|\d+)\s+(?:divided\s+|paired\s+|single\s+|undivided\s+)?subcaudal/i);
          const qualMatch = n.match(/(divided|paired|single|undivided)\s+subcaudal/i);
          const qualifier = qualMatch ? ` (${qualMatch[1].toLowerCase()})` : "";
          fields.subcaudalScales = m
            ? { value: `${m[1]}${qualifier}`, source: subSent }
            : null;
        } else {
          fields.subcaudalScales = null;
        }

        // Anal scale / plate — require the divided/single/paired qualifier
        const analSent = findSentenceWith(
          [/anal\s+(?:plate|scale|shield)/i],
          /(divided|paired|single|undivided|entire)\s+anal\s+(?:plate|scale|shield)/i,
        );
        if (analSent) {
          const n = norm(analSent);
          const m = n.match(/(divided|paired|single|undivided|entire)\s+anal\s+(?:plate|scale|shield)/i);
          fields.analScale = m ? { value: m[1].toLowerCase(), source: analSent } : null;
        } else {
          fields.analScale = null;
        }
      }

      // === Amphibian size ===
      if (group === "amphibian") {
        const sent = findSentenceWith(
          [
            /(reaches|reach|grows|grow|grow\s+up|up\s+to|maximum|adult[s]?)[^.]{0,80}(cm|mm)/i,
            /(?:body\s+)?length[^.]{0,40}(cm|mm)/i,
            /\bsnout[-\u2013\u2014\s](?:to[-\u2013\u2014\s])?vent/i,
            /\bSVL\b/,
          ],
          /\d+(?:\.\d+)?\s*(?:cm|mm)/i,
        );
        if (sent) {
          const value = extractLength(sent, MEASURE_CM_MM);
          fields.size = value ? { value, source: sent } : null;
        } else {
          fields.size = null;
        }
      }

      res.json({ name, group, fields, sourceUrl });
    } catch (err) {
      handleError(res, err);
    }
  });

  return httpServer;
}
