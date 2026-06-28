// Enumerate all AU research-grade reptile + amphibian species from iNaturalist.
// Outputs: scripts/species_list.json  [{ id, scientific, common }]

import fs from 'node:fs/promises';

const AU_PLACE_ID = 6744;
const PER_PAGE = 200;
const ICONIC = ['Reptilia', 'Amphibia'];

async function fetchPage(iconic, page) {
  const url = `https://api.inaturalist.org/v1/observations/species_counts?place_id=${AU_PLACE_ID}&quality_grade=research&iconic_taxa=${iconic}&per_page=${PER_PAGE}&page=${page}&locale=en`;
  const r = await fetch(url, { headers: { 'User-Agent': 'aus-herp-app/1.0 enrichment' } });
  if (!r.ok) throw new Error(`iNat ${iconic} p${page}: ${r.status}`);
  return r.json();
}

const all = [];
const seen = new Set();
for (const iconic of ICONIC) {
  let page = 1;
  while (true) {
    const data = await fetchPage(iconic, page);
    const results = data.results || [];
    if (results.length === 0) break;
    for (const row of results) {
      const t = row.taxon;
      if (!t || !t.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push({
        id: t.id,
        scientific: t.name,
        common: t.preferred_common_name || null,
        rank: t.rank,
        iconic,
      });
    }
    console.log(`${iconic} page ${page}: +${results.length} (total ${all.length})`);
    if (results.length < PER_PAGE) break;
    page += 1;
    await new Promise((res) => setTimeout(res, 400)); // throttle
  }
}

await fs.writeFile(
  new URL('./species_list.json', import.meta.url),
  JSON.stringify(all, null, 2),
);
console.log(`wrote ${all.length} species`);
