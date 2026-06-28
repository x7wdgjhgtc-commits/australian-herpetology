// Enrich every subspecies in scripts/subspecies_catalog.json with prose from
// Wikipedia (primary). When no dedicated subspecies article exists, INHERIT
// from the parent species' overrides (species_overrides table) and prefix the
// description with a clear "Subspecies of …" note so users know it's the
// parent prose.
//
// Strategy:
//   1. Try Wikipedia title = scientific trinomial (e.g. "Morelia spilota cheynei").
//   2. If miss, try "<binomial> <subspecific epithet>" (some titles use spaces).
//   3. If still miss, inherit ALL parent overrides and prefix description with
//      "Subspecies of <Parent Common Name> (<Parent Scientific>). Until a
//      dedicated profile is written, the information below describes the parent
//      species." Use the parent's Wikipedia fields directly.
//   4. Throttle 1.1s between Wikipedia calls.
//
// Usage:
//   node scripts/enrich_subspecies.mjs              # full
//   node scripts/enrich_subspecies.mjs --pilot 5    # first 5
//   node scripts/enrich_subspecies.mjs --resume     # skip already-populated

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
const THROTTLE_MS = 1100;

const subspeciesList = JSON.parse(
  await fs.readFile(path.join(__dirname, 'subspecies_catalog.json'), 'utf8'),
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

const getParentOverride = db.prepare(
  `SELECT description_override, habitat_override, diet_override,
          lifecycle_override, behaviour_override, venom_override,
          range_override, identification_override, similar_species_override
     FROM species_overrides WHERE species_id = ?`,
);

const alreadyPopulated = new Set(
  db
    .prepare(
      `SELECT species_id FROM species_overrides
        WHERE description_override IS NOT NULL AND length(description_override) > 50`,
    )
    .all()
    .map((r) => r.species_id),
);

const UA = { 'User-Agent': 'aus-herp-app/1.0 (subspecies-enrichment; contact: hello@huntherpetology.com.au)' };

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

function parseExtract(text) {
  const sections = [];
  let currentHeading = null;
  let currentBody = [];
  const flush = () => {
    const body = currentBody.join('\n').trim();
    if (body) sections.push({ heading: currentHeading, body });
    currentBody = [];
  };
  const headingRe = /^(==+)\s*(.+?)\s*==+\s*$/;
  for (const line of text.split('\n')) {
    const m = line.match(headingRe);
    if (m) {
      flush();
      currentHeading = m[2].toLowerCase().trim();
    } else {
      currentBody.push(line);
    }
  }
  flush();
  const lead = sections.find((s) => s.heading === null)?.body || '';
  return { lead, sections };
}

function paragraphs(text, max) {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, max)
    .join('\n\n');
}

function pickSection(parsed, keywords, maxParas = 3) {
  for (const s of parsed.sections) {
    if (!s.heading) continue;
    if (keywords.some((k) => s.heading.includes(k))) {
      return paragraphs(s.body, maxParas);
    }
  }
  return null;
}

function leadSummary(parsed) {
  return paragraphs(parsed.lead, 2) || null;
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
    similar: pickSection(parsed, ['similar species', 'similar taxa']),
  };
}

let processed = 0;
let writtenFromWiki = 0;
let writtenFromParent = 0;
let skipped = 0;
let blank = 0;
const startedAt = Date.now();

const subset = PILOT ? subspeciesList.slice(0, PILOT) : subspeciesList;
console.log(
  `enriching ${subset.length} subspecies (resume=${RESUME}, alreadyPopulated=${alreadyPopulated.size})`,
);

for (const sub of subset) {
  processed += 1;
  if (RESUME && alreadyPopulated.has(sub.id)) {
    skipped += 1;
    if (processed % 25 === 0) {
      console.log(`[${processed}/${subset.length}] skipped recent: ${sub.scientific}`);
    }
    continue;
  }

  // 1. Try Wikipedia by trinomial scientific
  let extract = await wikipediaArticle(sub.scientific);
  // 2. Try by common name if present and distinct
  if (!extract && sub.common && sub.common !== sub.parentCommon) {
    extract = await wikipediaArticle(sub.common);
  }

  let fields = null;
  let source = 'wiki';
  if (extract) {
    const parsed = parseExtract(extract);
    fields = extractFields(parsed);
    const hasContent =
      fields.description || fields.identification || fields.habitat || fields.range;
    if (!hasContent) fields = null;
  }

  // 3. Fallback: inherit parent overrides
  if (!fields) {
    const parent = getParentOverride.get(sub.parentId);
    if (parent && parent.description_override) {
      const inheritedNote = `Subspecies of ${sub.parentCommon || sub.parentScientific} (${sub.parentScientific}). A dedicated profile for this subspecies has not yet been written — the information below describes the parent species.\n\n`;
      fields = {
        description: inheritedNote + parent.description_override,
        identification: parent.identification_override,
        habitat: parent.habitat_override,
        range: parent.range_override,
        diet: parent.diet_override,
        lifecycle: parent.lifecycle_override,
        behaviour: parent.behaviour_override,
        venom: parent.venom_override,
        similar: parent.similar_species_override,
      };
      source = 'parent';
    }
  }

  if (!fields) {
    blank += 1;
    console.log(`[${processed}/${subset.length}] BLANK (no wiki, no parent override): ${sub.scientific}`);
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    continue;
  }

  upsert.run({
    species_id: sub.id,
    description: fields.description,
    habitat: fields.habitat,
    diet: fields.diet,
    lifecycle: fields.lifecycle,
    behaviour: fields.behaviour,
    venom: fields.venom,
    range: fields.range,
    identification: fields.identification,
    similar: fields.similar,
    updated_by: null,
    updated_at: Date.now(),
  });

  if (source === 'wiki') writtenFromWiki += 1;
  else writtenFromParent += 1;

  const tag = source === 'wiki' ? '✓ WIKI' : '↳ PARENT';
  console.log(`[${processed}/${subset.length}] ${tag}: ${sub.scientific}`);
  await new Promise((r) => setTimeout(r, THROTTLE_MS));
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('\n──────────');
console.log(`processed: ${processed}`);
console.log(`  wrote from Wikipedia: ${writtenFromWiki}`);
console.log(`  wrote from parent:    ${writtenFromParent}`);
console.log(`  skipped (resume):     ${skipped}`);
console.log(`  blank:                ${blank}`);
console.log(`elapsed: ${elapsed}s`);
db.close();
