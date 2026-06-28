#!/usr/bin/env node
/**
 * One-off backfill: populate group_key, family_id, family_name, genus on
 * existing `records` rows by joining records.species_id against the catalog.
 *
 * Safe to run multiple times — uses COALESCE pattern and only updates rows
 * whose taxonomy differs from the catalog.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");
const DB_PATH = path.join(ROOT, "data.db");
const CATALOG_PATH = path.join(HERE, "species_catalog.json");

if (!fs.existsSync(CATALOG_PATH)) {
  console.error("species_catalog.json missing — run build_species_catalog.mjs first.");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const byId = new Map(catalog.map((c) => [c.id, c]));
console.log(`Catalog: ${catalog.length} species`);

const db = new Database(DB_PATH);
const rows = db
  .prepare("SELECT id, species_id, group_key, family_id, family_name, genus FROM records")
  .all();
console.log(`Records: ${rows.length}`);

const upd = db.prepare(
  "UPDATE records SET group_key = ?, family_id = ?, family_name = ?, genus = COALESCE(?, genus) WHERE id = ?",
);
let updated = 0;
let skipped = 0;
let noCatalog = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    if (!r.species_id) { skipped++; continue; }
    const c = byId.get(r.species_id);
    if (!c) { noCatalog++; continue; }
    const needs =
      r.group_key !== c.group ||
      r.family_id !== c.familyId ||
      r.family_name !== c.familyName ||
      !r.genus;
    if (!needs) { skipped++; continue; }
    upd.run(c.group, c.familyId, c.familyName, c.genus, r.id);
    updated++;
  }
});
tx();

console.log(`Updated: ${updated}, skipped (already correct): ${skipped}, no catalog match: ${noCatalog}`);

// Post-update sanity check
const check = db
  .prepare(
    "SELECT COUNT(*) AS total, COUNT(species_id) AS w_sp, COUNT(group_key) AS w_g, COUNT(family_id) AS w_f, COUNT(genus) AS w_ge FROM records",
  )
  .get();
console.log("After:", check);

const byGroup = db.prepare("SELECT group_key, COUNT(*) FROM records GROUP BY group_key").all();
console.log("By group:", byGroup);

const byFamily = db
  .prepare("SELECT family_name, COUNT(*) FROM records GROUP BY family_name ORDER BY COUNT(*) DESC LIMIT 15")
  .all();
console.log("Top families:", byFamily);

db.close();
