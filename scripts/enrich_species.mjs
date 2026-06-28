// Enrich every species in scripts/species_list.json with prose from Wikipedia
// (primary) and supplement with ALA (habitats, conservation, common name when
// missing). Writes results into species_overrides via direct sqlite3 UPSERT.
//
// Fields populated (overwrite mode):
//   description_override        - lead summary (paragraph 1-2 of article)
//   habitat_override            - "Habitat" / "Distribution and habitat" section
//   diet_override               - "Diet" / "Feeding" section
//   lifecycle_override          - "Reproduction" / "Breeding" / "Life cycle"
//   behaviour_override          - "Behaviour" / "Ecology" section
//   venom_override              - "Venom" / "Toxicity" section (snakes only-ish)
//   range_override              - "Distribution" / "Range" section
//   identification_override     - "Description" section (morphology prose)
//   similar_species_override    - "Similar species" section if present
//
// Strategy:
//   1. Fetch full Wikipedia article via prop=extracts&explaintext=1&redirects=1
//      using scientific name; if 0 chars, try preferred_common_name.
//   2. explaintext keeps section headings as "Section name\n" lines on their own.
//      Split text on "\n\n" then walk and group into {heading -> text} buckets.
//   3. Map known headings to fields. Take first 2 paragraphs of each.
//   4. Description override = first 2 paragraphs of the LEAD (before any heading).
//   5. ALA: pull conservationStatuses + commonNameSingle (informational only,
//      not written to overrides because those fields aren't in the override table).
//
// Usage:
//   node scripts/enrich_species.mjs              # full job
//   node scripts/enrich_species.mjs --pilot 5    # first 5 only
//   node scripts/enrich_species.mjs --resume     # skip species already populated
//
// Throttling: 350 ms between species (≈170 req/min worst case across Wiki+ALA).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const PILOT = args.includes('--pilot') ? parseInt(args[args.indexOf('--pilot') + 1] || '5', 10) : null;
const RESUME = args.includes('--resume');
const THROTTLE_MS = 1100; // Wikipedia API courtesy: ~55 req/min sustained

const speciesList = JSON.parse(
  await fs.readFile(path.join(__dirname, 'species_list.json'), 'utf8'),
);

const db = new Database(path.join(PROJECT_ROOT, 'data.db'));
db.pragma('journal_mode = WAL');

const upsert = db.prepare(`
  INSERT INTO species_overrides (
    species_id, description_override, habitat_override, diet_override,
    lifecycle_override, behaviour_override, venom_override,
    range_override, identification_override, similar_species_override,
    updated_by, updated_at
  ) VALUES (
    @species_id, @description, @habitat, @diet,
    @lifecycle, @behaviour, @venom,
    @range, @identification, @similar,
    @updated_by, @updated_at
  )
  ON CONFLICT(species_id) DO UPDATE SET
    description_override     = excluded.description_override,
    habitat_override         = excluded.habitat_override,
    diet_override            = excluded.diet_override,
    lifecycle_override       = excluded.lifecycle_override,
    behaviour_override       = excluded.behaviour_override,
    venom_override           = excluded.venom_override,
    range_override           = excluded.range_override,
    identification_override  = excluded.identification_override,
    similar_species_override = excluded.similar_species_override,
    updated_at               = excluded.updated_at
`);

const alreadyPopulated = new Set(
  db
    .prepare(
      `SELECT species_id FROM species_overrides
        WHERE description_override IS NOT NULL AND length(description_override) > 50`,
    )
    .all()
    .map((r) => r.species_id),
);

const UA = { 'User-Agent': 'aus-herp-app/1.0 (data-enrichment; contact: hello@huntherpetology.com.au)' };

async function fetchJsonWithRetry(url, { maxAttempts = 4, baseDelayMs = 600 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 429 || r.status === 503) {
        const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
        console.log(`  [rate-limit ${r.status}] backing off ${wait}ms (attempt ${attempt})`);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      clearTimeout(t);
      if (attempt === maxAttempts) return null;
      await new Promise((res) => setTimeout(res, baseDelayMs * 2 ** attempt));
    }
  }
  return null;
}

// Wikipedia rejects subspecies trinomials sometimes. Strip third word.
function binomial(name) {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
}

async function wikipediaArticle(title) {
  if (!title) return null;
  const u = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
  const d = await fetchJsonWithRetry(u);
  if (!d) return null;
  const pages = d.query?.pages || {};
  const page = Object.values(pages)[0];
  if (page?.missing !== undefined) return null;
  const extract = page?.extract || '';
  if (extract.length < 100) return null;
  return extract;
}

// Parse explaintext output into { lead: string, sections: [{heading, body}] }.
// explaintext keeps section headings as `== Heading ==` / `=== Subheading ===`
// markers inline at the start of each section block. Walk all blocks and
// every time we see `^==+ ... ==+` at the start, that’s a heading; the rest of
// that block plus following blocks until the next heading become the body.
function parseExtract(text) {
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const out = { lead: '', sections: [] };
  let current = null;
  const HEADING_RE = /^(={2,})\s*([^=\n]+?)\s*\1\s*\n?/;
  for (const block of blocks) {
    const m = block.match(HEADING_RE);
    if (m) {
      if (current) out.sections.push(current);
      const heading = m[2].trim().toLowerCase();
      const rest = block.slice(m[0].length).trim();
      current = { heading, body: rest };
    } else if (current) {
      current.body += (current.body ? '\n\n' : '') + block;
    } else {
      out.lead += (out.lead ? '\n\n' : '') + block;
    }
  }
  if (current) out.sections.push(current);
  return out;
}

function pickSection(parsed, keywords, maxParas = 3) {
  for (const sec of parsed.sections) {
    for (const kw of keywords) {
      if (sec.heading.includes(kw)) {
        const paras = sec.body.split(/\n\s*\n+/).slice(0, maxParas).join('\n\n').trim();
        if (paras.length > 30) return paras;
      }
    }
  }
  return null;
}

function leadSummary(parsed) {
  if (!parsed.lead) return null;
  const paras = parsed.lead.split(/\n\s*\n+/).slice(0, 2).join('\n\n').trim();
  if (paras.length < 50) return null;
  // Strip leading citations like [1] and convert curly quotes
  return paras.replace(/\[\d+\]/g, '').trim();
}

function extractFields(parsed) {
  return {
    description: leadSummary(parsed),
    identification: pickSection(parsed, ['description', 'morphology', 'appearance'], 4),
    habitat: pickSection(parsed, ['habitat'], 3),
    range: pickSection(parsed, ['distribution', 'range', 'geographic']),
    diet: pickSection(parsed, ['diet', 'feeding', 'food', 'prey']),
    lifecycle: pickSection(parsed, ['reproduction', 'breeding', 'life cycle', 'lifecycle', 'life history']),
    behaviour: pickSection(parsed, ['behaviour', 'behavior', 'ecology', 'activity']),
    venom: pickSection(parsed, ['venom', 'toxicity', 'envenomation', 'bite']),
    similar: pickSection(parsed, ['similar species', 'similar taxa', 'taxonomy and similar']),
  };
}

let processed = 0;
let written = 0;
let skipped = 0;
let blank = 0;
const startedAt = Date.now();

const subset = PILOT ? speciesList.slice(0, PILOT) : speciesList;
console.log(
  `enriching ${subset.length} species (resume=${RESUME}, alreadyPopulated=${alreadyPopulated.size})`,
);

for (const sp of subset) {
  processed += 1;
  if (RESUME && alreadyPopulated.has(sp.id)) {
    skipped += 1;
    if (processed % 50 === 0) {
      console.log(`[${processed}/${subset.length}] skipped recent: ${sp.scientific}`);
    }
    continue;
  }

  // Try in order: full scientific, stripped binomial, common name.
  let extract = await wikipediaArticle(sp.scientific);
  if (!extract) {
    const bn = binomial(sp.scientific);
    if (bn && bn !== sp.scientific) {
      extract = await wikipediaArticle(bn);
    }
  }
  if (!extract && sp.common) {
    extract = await wikipediaArticle(sp.common);
  }

  if (!extract) {
    blank += 1;
    console.log(`[${processed}/${subset.length}] NO WIKI: ${sp.scientific}`);
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    continue;
  }

  const parsed = parseExtract(extract);
  const fields = extractFields(parsed);

  // Only write if we got at least description OR identification OR habitat
  const hasContent =
    fields.description || fields.identification || fields.habitat || fields.range;
  if (!hasContent) {
    blank += 1;
    console.log(`[${processed}/${subset.length}] NO FIELDS: ${sp.scientific}`);
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    continue;
  }

  upsert.run({
    species_id: sp.id,
    description: fields.description,
    habitat: fields.habitat,
    diet: fields.diet,
    lifecycle: fields.lifecycle,
    behaviour: fields.behaviour,
    venom: fields.venom,
    range: fields.range,
    identification: fields.identification,
    similar: fields.similar,
    updated_by: 2, // Willhunt (super-admin)
    updated_at: Date.now(),
  });
  written += 1;

  if (processed % 25 === 0 || processed === subset.length || PILOT) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(
      `[${processed}/${subset.length}] written=${written} blank=${blank} skipped=${skipped} elapsed=${elapsed}s — ${sp.scientific}`,
    );
    if (PILOT) {
      console.log('  desc:', (fields.description || '').slice(0, 120).replace(/\n/g, ' '));
      console.log('  habitat:', (fields.habitat || '').slice(0, 120).replace(/\n/g, ' '));
      console.log('  diet:', (fields.diet || '').slice(0, 80).replace(/\n/g, ' '));
      console.log('  venom:', (fields.venom || '').slice(0, 80).replace(/\n/g, ' '));
    }
  }

  await new Promise((r) => setTimeout(r, THROTTLE_MS));
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log(
  `\nDONE: processed=${processed} written=${written} blank=${blank} skipped=${skipped} elapsed=${elapsed}s`,
);
db.close();
