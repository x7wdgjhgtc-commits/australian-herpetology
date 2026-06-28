// Enumerate all AU reptile + amphibian SUBSPECIES from iNaturalist.
// Outputs: scripts/subspecies_list.json
//
// Strategy: iNat's /v1/taxa endpoint returns all subspecies globally for a
// given class taxon (Reptilia 26036, Amphibia 20978). We paginate through
// every page (~3000 reptile, ~few-hundred amphibian) and keep only the
// subspecies whose parent species is in our AU species catalog.
//
// This is dramatically faster than per-parent queries (32 calls vs 1207) and
// avoids the iNat rate limit (429) we hit with the per-parent strategy.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PER_PAGE = 200;
const UA = { 'User-Agent': 'aus-herp-app/1.0 subspecies-enumerator' };

const speciesCatalog = JSON.parse(
  await fs.readFile(path.join(__dirname, 'species_catalog.json'), 'utf8'),
);
const speciesById = new Map(speciesCatalog.map((s) => [s.id, s]));
console.log(`loaded ${speciesCatalog.length} parent species from catalog`);

async function fetchJson(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) {
      const wait = 8000 * (i + 1);
      console.warn(`  ${r.status} on ${url.slice(0, 90)}… — wait ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    throw new Error(`${r.status} on ${url}`);
  }
  throw new Error(`giving up on ${url}`);
}

// iNat /v1/taxa caps at id_above pagination beyond ~10k; pages 1-50 are safe
// for our class sizes (<5k subs).
async function fetchAllSubspecies(classTaxonId, label) {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const url = `https://api.inaturalist.org/v1/taxa?taxon_id=${classTaxonId}&rank=subspecies&is_active=true&per_page=${PER_PAGE}&page=${page}&locale=en`;
    const data = await fetchJson(url);
    const results = data.results || [];
    if (results.length === 0) break;
    for (const t of results) {
      if (!t || !t.id || t.rank !== 'subspecies') continue;
      out.push({
        id: t.id,
        scientific: t.name,
        common: t.preferred_common_name || null,
        parentId: t.parent_id || null,
        ancestorIds: t.ancestor_ids || [],
        iconic: label,
      });
    }
    console.log(`  ${label} p${page}: +${results.length} (running ${out.length}, total_results ${data.total_results})`);
    if (results.length < PER_PAGE) break;
    if (out.length >= (data.total_results || 0)) break;
    await new Promise((res) => setTimeout(res, 1100)); // ~55 req/min — safe
  }
  return out;
}

console.log('\n== Fetching all reptile subspecies ==');
const reptileSubs = await fetchAllSubspecies(26036, 'Reptilia');

console.log('\n== Fetching all amphibian subspecies ==');
const amphibianSubs = await fetchAllSubspecies(20978, 'Amphibia');

const allSubs = [...reptileSubs, ...amphibianSubs];
console.log(`\ntotal subspecies globally: ${allSubs.length}`);

// Filter to AU: parent species must be in our catalog.
const auSubs = [];
let droppedNonAu = 0;
let droppedNoParent = 0;
for (const sub of allSubs) {
  if (!sub.parentId) { droppedNoParent++; continue; }
  const parent = speciesById.get(sub.parentId);
  if (!parent) { droppedNonAu++; continue; }
  auSubs.push({
    id: sub.id,
    scientific: sub.scientific,
    common: sub.common,
    parentId: sub.parentId,
    parentScientific: parent.scientific,
    parentCommon: parent.common,
    group: parent.group,
    familyId: parent.familyId,
    familyName: parent.familyName,
    genus: parent.genus,
    iconic: sub.iconic,
  });
}

auSubs.sort((a, b) => a.scientific.localeCompare(b.scientific));

console.log(`\nAU subspecies: ${auSubs.length}`);
console.log(`  dropped (parent not in AU catalog): ${droppedNonAu}`);
console.log(`  dropped (no parent_id): ${droppedNoParent}`);

// Quick group breakdown
const byGroup = {};
for (const s of auSubs) byGroup[s.group] = (byGroup[s.group] || 0) + 1;
console.log('group breakdown:', byGroup);

await fs.writeFile(
  path.join(__dirname, 'subspecies_list.json'),
  JSON.stringify(auSubs, null, 2),
);
console.log('wrote scripts/subspecies_list.json');
