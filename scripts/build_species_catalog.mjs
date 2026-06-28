#!/usr/bin/env node
/**
 * Build species_catalog.json: enriches species_list.json with group + family + genus.
 *
 * Uses iNat's batch /v1/taxa/{id1,id2,...} endpoint to fetch up to 30 taxa
 * per request — ~40 requests total for 1207 species ≈ 45 seconds at 1100ms throttle.
 *
 * Idempotent: skips species already in the catalog unless --force.
 *
 * Usage:
 *   node scripts/build_species_catalog.mjs              # resume / build
 *   node scripts/build_species_catalog.mjs --force      # restart from scratch
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIST_PATH = path.join(HERE, "species_list.json");
const OUT_PATH = path.join(HERE, "species_catalog.json");

const GROUPS = [
  { value: "snakes",  taxonId: 85553 },
  { value: "lizards", taxonId: 85552 },
  { value: "turtles", taxonId: 39532 },
  { value: "crocs",   taxonId: 26039 },
  { value: "frogs",   taxonId: 20979 },
];
const FAMILIES = [
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
const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));
const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.taxonId, g.value]));

const INAT_BASE = "https://api.inaturalist.org/v1";
const THROTTLE_MS = 1100;
const BATCH_SIZE = 30;
const FORCE = process.argv.includes("--force");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function genusFromName(name) {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return /^[A-Z][a-zA-Z-]+$/.test(first || "") ? first : null;
}

async function fetchTaxa(ids) {
  const url = `${INAT_BASE}/taxa/${ids.join(",")}`;
  let backoff = 1000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "aus-herp-catalog/1.0" },
    });
    if (res.status === 429) {
      const retry = parseInt(res.headers.get("retry-after") || "5", 10);
      console.warn(`  → 429 — sleeping ${retry}s`);
      await sleep((retry || 5) * 1000);
      continue;
    }
    if (!res.ok) {
      console.warn(`  → HTTP ${res.status} — backoff ${backoff}ms`);
      await sleep(backoff);
      backoff *= 2;
      continue;
    }
    const body = await res.json();
    return body?.results || [];
  }
  return [];
}

function classify(taxon) {
  const ancestorIds = taxon?.ancestor_ids || [];
  let group = null;
  for (const a of ancestorIds) {
    const g = GROUP_BY_ID.get(a);
    if (g) { group = g; break; }
  }
  if (!group && taxon?.iconic_taxon_name === "Amphibia") group = "frogs";
  let family = null;
  for (const a of ancestorIds) {
    const f = FAMILY_BY_ID.get(a);
    if (f) { family = f; break; }
  }
  return { group, familyId: family?.id ?? null, familyName: family?.name ?? null };
}

async function main() {
  const list = JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
  let catalog = [];
  let doneIds = new Set();
  if (!FORCE && fs.existsSync(OUT_PATH)) {
    try {
      catalog = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
      doneIds = new Set(catalog.map((c) => c.id));
      console.log(`Resuming — ${doneIds.size}/${list.length} already done.`);
    } catch {}
  }

  const pending = list.filter((s) => !doneIds.has(s.id));
  console.log(`Pending: ${pending.length} species to fetch (batches of ${BATCH_SIZE}).`);

  const total = pending.length;
  let processed = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const ids = batch.map((s) => s.id);
    const results = await fetchTaxa(ids);
    const byId = new Map(results.map((t) => [t.id, t]));
    for (const s of batch) {
      const t = byId.get(s.id);
      if (!t) {
        catalog.push({
          id: s.id, scientific: s.scientific, common: s.common,
          group: null, familyId: null, familyName: null,
          genus: genusFromName(s.scientific),
        });
      } else {
        const c = classify(t);
        catalog.push({
          id: s.id,
          scientific: s.scientific,
          common: s.common,
          group: c.group,
          familyId: c.familyId,
          familyName: c.familyName,
          genus: genusFromName(s.scientific),
        });
      }
    }
    processed += batch.length;
    fs.writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2));
    console.log(`  [${processed}/${total}] catalog=${catalog.length} family=${catalog.filter(c => c.familyId).length} group=${catalog.filter(c => c.group).length}`);
    if (i + BATCH_SIZE < pending.length) await sleep(THROTTLE_MS);
  }
  console.log(`\nDONE. catalog=${catalog.length}, with family=${catalog.filter(c => c.familyId).length}, with group=${catalog.filter(c => c.group).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
