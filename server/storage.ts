import {
  users,
  sessions,
  records,
  suggestions,
  follows,
  likes,
  comments,
  commentLikes,
  notifications,
  observationNotes,
  noteLikes,
  noteComments,
  noteCommentLikes,
  speciesOverrides,
  adminAudit,
  inatObserverBlocks,
  speciesArticles,
  speciesAdminEntries,
  speciesRecords,
  speciesRangeCells,
  speciesRangePolygons,
  speciesRecordHidden,
  distributionImportJob,
} from "@shared/schema";
import type {
  User,
  Session,
  Record_,
  Suggestion,
  Follow,
  Like,
  Comment,
  Notification,
  ObservationNote,
  NoteComment,
  SpeciesOverride,
  AdminAudit,
  InatObserverBlock,
  SpeciesArticle,
  SpeciesAdminEntry,
  UserRole,
  SpeciesRecord,
  SpeciesRangeCell,
  SpeciesRangePolygon,
  SpeciesRecordHidden,
  DistributionImportJob,
} from "@shared/schema";
import {
  ROLE_LEVEL,
  resolveCapabilities,
  type AdminCapability,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

// DB_PATH lets the host mount a persistent disk and point us at it (e.g.
// Render mounts the disk at /var/data — set DB_PATH=/var/data/data.db).
// Defaults to `data.db` in CWD so local dev keeps working unchanged.
const DB_PATH = process.env.DB_PATH || "data.db";
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Bootstrap tables — drizzle-orm's `migrate` requires generated SQL, so we
// just create tables directly. Safe to call on every boot.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_data_url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    species_id INTEGER,
    species_name TEXT,
    species_common TEXT,
    notes TEXT,
    photo_data_url TEXT NOT NULL,
    lat TEXT,
    lng TEXT,
    place_guess TEXT,
    observed_on TEXT,
    camera_make TEXT,
    camera_model TEXT,
    lens TEXT,
    iso INTEGER,
    f_number TEXT,
    shutter TEXT,
    focal_length TEXT,
    exif_json TEXT,
    group_key TEXT,
    family_id INTEGER,
    family_name TEXT,
    genus TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS records_user_idx ON records(user_id);
  CREATE INDEX IF NOT EXISTS records_created_idx ON records(created_at);
  CREATE INDEX IF NOT EXISTS records_species_idx ON records(species_id);
`);

sqlite.exec(`

  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    species_id INTEGER,
    species_name TEXT NOT NULL,
    species_common TEXT,
    comment TEXT,
    group_key TEXT,
    family_id INTEGER,
    family_name TEXT,
    genus TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS suggestions_record_idx ON suggestions(record_id);
`);

// Defensive migrations for older data.db files that pre-date the taxonomy cols.
function ensureCol(table: string, col: string, ddl: string) {
  // Skip if the table hasn't been created yet — it'll be created later in this
  // file with the column already included, so the ALTER would be a no-op anyway.
  // Critical on fresh DBs (e.g. Render's empty persistent disk on first boot)
  // where ensureCol() calls can sequence before their CREATE TABLE blocks.
  const tableExists = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  if (!tableExists) return;
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((r) => r.name === col)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}
ensureCol("records", "group_key", "TEXT");
ensureCol("records", "parent_species_id", "INTEGER");
ensureCol("records", "family_id", "INTEGER");
ensureCol("records", "family_name", "TEXT");
ensureCol("records", "genus", "TEXT");
ensureCol("suggestions", "group_key", "TEXT");
ensureCol("suggestions", "family_id", "INTEGER");
ensureCol("suggestions", "family_name", "TEXT");
ensureCol("suggestions", "genus", "TEXT");
// Profile extras (cover photo, contact info)
ensureCol("users", "cover_data_url", "TEXT");
ensureCol("users", "website", "TEXT");
ensureCol("users", "location", "TEXT");
ensureCol("users", "instagram", "TEXT");
ensureCol("users", "twitter", "TEXT");
ensureCol("users", "facebook", "TEXT");
ensureCol("comments", "parent_id", "INTEGER");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS comment_likes_comment_user_uq
    ON comment_likes(comment_id, user_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    record_id INTEGER,
    comment_id INTEGER,
    snippet TEXT,
    read_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notifications_recipient_idx
    ON notifications(recipient_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
    ON notifications(recipient_id, read_at);

  CREATE TABLE IF NOT EXISTS observation_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    species_id INTEGER,
    parent_species_id INTEGER,
    species_name TEXT,
    species_common TEXT,
    group_key TEXT,
    family_id INTEGER,
    family_name TEXT,
    genus TEXT,
    title TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS observation_notes_user_idx
    ON observation_notes(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS observation_notes_species_idx
    ON observation_notes(species_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS observation_notes_created_idx
    ON observation_notes(created_at DESC);

  CREATE TABLE IF NOT EXISTS note_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS note_likes_note_user_uq
    ON note_likes(note_id, user_id);
  CREATE INDEX IF NOT EXISTS note_likes_note_idx ON note_likes(note_id);

  CREATE TABLE IF NOT EXISTS note_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    parent_id INTEGER,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS note_comments_note_idx ON note_comments(note_id);
  CREATE INDEX IF NOT EXISTS note_comments_created_idx ON note_comments(created_at);

  CREATE TABLE IF NOT EXISTS note_comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS note_comment_likes_comment_user_uq
    ON note_comment_likes(comment_id, user_id);
`);
ensureCol("notifications", "note_id", "INTEGER");
// Record extras (multi-photo, obscure location, license, condition, behaviour)
ensureCol("records", "photos_json", "TEXT");
ensureCol("records", "obscure_location", "INTEGER DEFAULT 0");
ensureCol("records", "license_code", "TEXT");
ensureCol("records", "condition_tag", "TEXT");
ensureCol("records", "behaviors_json", "TEXT");
// External-source dedupe + iNat connection
ensureCol("records", "external_id", "TEXT");
ensureCol("records", "external_source", "TEXT");
ensureCol("records", "external_url", "TEXT");
ensureCol("users", "inat_username", "TEXT");
ensureCol("users", "inat_last_import_at", "INTEGER");
ensureCol("users", "role", "TEXT DEFAULT 'none'");
ensureCol("users", "permissions_json", "TEXT");
ensureCol("users", "avatar_pos", "TEXT");
ensureCol("users", "cover_pos", "TEXT");
// Species-override profile-field columns (added 2026-06).
ensureCol("species_overrides", "scientific_name_override", "TEXT");
ensureCol("species_overrides", "authority_override", "TEXT");
ensureCol("species_overrides", "class_override", "TEXT");
ensureCol("species_overrides", "order_override", "TEXT");
ensureCol("species_overrides", "family_override", "TEXT");
ensureCol("species_overrides", "description_override", "TEXT");
ensureCol("species_overrides", "habitat_override", "TEXT");
ensureCol("species_overrides", "diet_override", "TEXT");
ensureCol("species_overrides", "size_override", "TEXT");
ensureCol("species_overrides", "conservation_override", "TEXT");
ensureCol("species_overrides", "total_length_override", "TEXT");
ensureCol("species_overrides", "snout_vent_override", "TEXT");
ensureCol("species_overrides", "body_length_override", "TEXT");
ensureCol("species_overrides", "dorsal_scales_override", "TEXT");
ensureCol("species_overrides", "ventral_scales_override", "TEXT");
ensureCol("species_overrides", "subcaudal_scales_override", "TEXT");
ensureCol("species_overrides", "anal_scale_override", "TEXT");
ensureCol("species_overrides", "lifecycle_override", "TEXT");
ensureCol("species_overrides", "behaviour_override", "TEXT");
ensureCol("species_overrides", "venom_override", "TEXT");
ensureCol("species_overrides", "range_override", "TEXT");
ensureCol("species_overrides", "identification_override", "TEXT");
ensureCol("species_overrides", "similar_species_override", "TEXT");
// Forced hero photo URL — admins can pin one of the iNat taxon_photos as the
// hero image regardless of source ordering. NULL means "use default precedence".
ensureCol("species_overrides", "forced_hero_photo_url", "TEXT");
try {
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_records_user_external ON records(user_id, external_id)`,
  );
} catch {}

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS records_group_idx ON records(group_key);
  CREATE INDEX IF NOT EXISTS records_family_idx ON records(family_id);
  CREATE INDEX IF NOT EXISTS records_genus_idx ON records(genus);

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    followee_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS follows_pair_uq ON follows(follower_id, followee_id);
  CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows(followee_id);

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS likes_record_user_uq ON likes(record_id, user_id);
  CREATE INDEX IF NOT EXISTS likes_record_idx ON likes(record_id);
  CREATE INDEX IF NOT EXISTS likes_user_idx ON likes(user_id);

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    parent_id INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_record_idx ON comments(record_id);
  CREATE INDEX IF NOT EXISTS comments_created_idx ON comments(created_at);

  CREATE TABLE IF NOT EXISTS species_overrides (
    species_id INTEGER PRIMARY KEY,
    common_name_override TEXT,
    notes_override TEXT,
    hero_record_id INTEGER,
    hidden_photos_json TEXT,
    updated_by INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON admin_audit(actor_id);
  CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at);

  CREATE TABLE IF NOT EXISTS species_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    date TEXT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    cell_lat_idx INTEGER NOT NULL,
    cell_lng_idx INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS species_records_source_uq ON species_records(source, source_id);
  CREATE INDEX IF NOT EXISTS species_records_species_idx ON species_records(species_id);
  CREATE INDEX IF NOT EXISTS species_records_species_cell_idx ON species_records(species_id, cell_lat_idx, cell_lng_idx);

  CREATE TABLE IF NOT EXISTS species_range_cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER NOT NULL,
    cell_lat_idx INTEGER NOT NULL,
    cell_lng_idx INTEGER NOT NULL,
    present INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS species_range_cells_uq ON species_range_cells(species_id, cell_lat_idx, cell_lng_idx);
  CREATE INDEX IF NOT EXISTS species_range_cells_species_idx ON species_range_cells(species_id);

  CREATE TABLE IF NOT EXISTS species_range_polygons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER NOT NULL,
    polygon_json TEXT NOT NULL,
    label TEXT,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS species_range_polygons_species_idx ON species_range_polygons(species_id);

  CREATE TABLE IF NOT EXISTS species_record_hidden (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL UNIQUE,
    species_id INTEGER NOT NULL,
    hidden_by INTEGER NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS species_record_hidden_species_idx ON species_record_hidden(species_id);

  CREATE TABLE IF NOT EXISTS inat_observer_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    label TEXT,
    blocked_by INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inat_observer_blocks_user_idx ON inat_observer_blocks(user_id);

  CREATE TABLE IF NOT EXISTS species_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER NOT NULL,
    uploader_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    citation TEXT NOT NULL,
    credit TEXT NOT NULL,
    file_data_url TEXT,
    file_name TEXT,
    external_url TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS species_articles_species_idx ON species_articles(species_id);
  CREATE INDEX IF NOT EXISTS species_articles_uploader_idx ON species_articles(uploader_user_id);

  CREATE TABLE IF NOT EXISTS species_admin_entries (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    scientific TEXT,
    common TEXT,
    "group" TEXT,
    family_id INTEGER,
    family_name TEXT,
    genus TEXT,
    authority TEXT,
    description TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    added_by INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    updated_by INTEGER,
    updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS species_admin_entries_source_idx ON species_admin_entries(source);
  CREATE INDEX IF NOT EXISTS species_admin_entries_hidden_idx ON species_admin_entries(hidden);

  CREATE TABLE IF NOT EXISTS distribution_import_job (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    total_species INTEGER NOT NULL,
    processed_species INTEGER NOT NULL,
    current_species_id INTEGER,
    current_species_name TEXT,
    total_records INTEGER NOT NULL,
    last_error TEXT,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
`);

export const db = drizzle(sqlite);

// ───────── public DTOs ─────────
export interface PublicUser {
  id: number;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarDataUrl: string | null;
  coverDataUrl: string | null;
  avatarPos: string | null;
  coverPos: string | null;
  website: string | null;
  location: string | null;
  instagram: string | null;
  twitter: string | null;
  facebook: string | null;
  role: UserRole;
  createdAt: number;
  capabilities: Record<AdminCapability, boolean>;
  followerCount?: number;
  followingCount?: number;
  recordCount?: number;
  isFollowing?: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    avatarDataUrl: u.avatarDataUrl,
    coverDataUrl: u.coverDataUrl,
    avatarPos: (u as any).avatarPos ?? null,
    coverPos: (u as any).coverPos ?? null,
    website: u.website,
    location: u.location,
    instagram: u.instagram,
    twitter: u.twitter,
    facebook: u.facebook,
    role: ((u as any).role as UserRole) || "none",
    createdAt: u.createdAt,
    capabilities: resolveCapabilities(
      ((u as any).role as UserRole) || "none",
      ((u as any).permissionsJson as string | null) ?? null,
    ),
  };
}

// ───────── storage class ─────────
export class DatabaseStorage {
  // --- Users ---
  getUser(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  getUserByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  getUserByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email)).get();
  }
  createUser(opts: {
    username: string;
    email: string;
    passwordHash: string;
    displayName?: string | null;
  }): User {
    const now = Date.now();
    return db
      .insert(users)
      .values({
        username: opts.username,
        email: opts.email,
        passwordHash: opts.passwordHash,
        displayName: opts.displayName ?? opts.username,
        bio: null,
        avatarDataUrl: null,
        createdAt: now,
      })
      .returning()
      .get();
  }
  updateUser(
    id: number,
    patch: Partial<
      Pick<
        User,
        | "displayName"
        | "bio"
        | "avatarDataUrl"
        | "coverDataUrl"
        | "website"
        | "location"
        | "instagram"
        | "twitter"
        | "facebook"
        | "inatUsername"
        | "inatLastImportAt"
      > & { role?: UserRole }
    >,
  ): User | undefined {
    db.update(users).set(patch as any).where(eq(users.id, id)).run();
    return this.getUser(id);
  }

  // --- iNaturalist auto-sync helpers ---
  /**
   * Return every user that has connected an iNaturalist account.
   * Used by the background auto-sync scheduler.
   */
  listUsersWithInat(): User[] {
    return db
      .select()
      .from(users)
      .where(sql`${users.inatUsername} IS NOT NULL AND ${users.inatUsername} != ''`)
      .all();
  }

  // --- External-source dedupe (e.g. iNat imports) ---
  findRecordByExternalId(userId: number, externalId: string): Record_ | undefined {
    return db
      .select()
      .from(records)
      .where(
        sql`${records.userId} = ${userId} AND ${records.externalId} = ${externalId}`,
      )
      .get();
  }

  searchUsers(q: string, limit = 12): User[] {
    const like = `%${q.toLowerCase()}%`;
    return db
      .select()
      .from(users)
      .where(
        sql`lower(${users.username}) LIKE ${like} OR lower(coalesce(${users.displayName},'')) LIKE ${like}`,
      )
      .limit(limit)
      .all();
  }

  // --- Sessions ---
  createSession(userId: number, token: string, ttlMs: number): Session {
    const now = Date.now();
    return db
      .insert(sessions)
      .values({
        token,
        userId,
        createdAt: now,
        expiresAt: now + ttlMs,
      })
      .returning()
      .get();
  }
  getSession(token: string): Session | undefined {
    const s = db.select().from(sessions).where(eq(sessions.token, token)).get();
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.deleteSession(token);
      return undefined;
    }
    return s;
  }
  deleteSession(token: string): void {
    db.delete(sessions).where(eq(sessions.token, token)).run();
  }

  // --- Records ---
  createRecord(opts: Omit<Record_, "id" | "createdAt">): Record_ {
    const now = Date.now();
    return db
      .insert(records)
      .values({ ...opts, createdAt: now })
      .returning()
      .get();
  }
  getRecord(id: number): Record_ | undefined {
    return db.select().from(records).where(eq(records.id, id)).get();
  }
  listRecordsByUser(userId: number, limit = 50): Record_[] {
    return db
      .select()
      .from(records)
      .where(eq(records.userId, userId))
      .orderBy(desc(records.createdAt))
      .limit(limit)
      .all();
  }
  listAllRecords(limit = 50): Record_[] {
    return db
      .select()
      .from(records)
      .orderBy(desc(records.createdAt))
      .limit(limit)
      .all();
  }
  /** Records of a given species, most-recent first. Includes records logged
   * at any subspecies of this species (matched via parent_species_id). */
  listRecordsBySpecies(speciesId: number, limit = 200): Record_[] {
    return db
      .select()
      .from(records)
      .where(
        or(
          eq(records.speciesId, speciesId),
          eq(records.parentSpeciesId, speciesId),
        ),
      )
      .orderBy(desc(records.createdAt))
      .limit(limit)
      .all();
  }
  listRecordsByUserIds(userIds: number[], limit = 50): Record_[] {
    if (userIds.length === 0) return [];
    return db
      .select()
      .from(records)
      .where(inArray(records.userId, userIds))
      .orderBy(desc(records.createdAt))
      .limit(limit)
      .all();
  }
  countRecordsByUser(userId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(records)
      .where(eq(records.userId, userId))
      .get();
    return r?.c ?? 0;
  }
  updateRecordSpecies(
    id: number,
    speciesId: number | null,
    speciesName: string | null,
    speciesCommon: string | null,
    taxonomy?: {
      groupKey?: string | null;
      familyId?: number | null;
      familyName?: string | null;
      genus?: string | null;
    },
  ): void {
    const patch: any = { speciesId, speciesName, speciesCommon };
    if (taxonomy) {
      patch.groupKey = taxonomy.groupKey ?? null;
      patch.familyId = taxonomy.familyId ?? null;
      patch.familyName = taxonomy.familyName ?? null;
      patch.genus = taxonomy.genus ?? null;
    }
    db.update(records).set(patch).where(eq(records.id, id)).run();
  }
  /**
   * Owner-driven update of a record. Only defined keys in `patch` are written.
   */
  updateRecord(
    id: number,
    patch: Partial<
      Pick<
        Record_,
        | "speciesId"
        | "speciesName"
        | "speciesCommon"
        | "notes"
        | "placeGuess"
        | "observedOn"
        | "lat"
        | "lng"
        | "obscureLocation"
        | "licenseCode"
        | "conditionTag"
        | "behaviorsJson"
        | "groupKey"
        | "familyId"
        | "familyName"
        | "genus"
      >
    >,
  ): void {
    const clean: any = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return;
    db.update(records).set(clean).where(eq(records.id, id)).run();
  }
  deleteRecord(id: number): void {
    db.delete(records).where(eq(records.id, id)).run();
    db.delete(suggestions).where(eq(suggestions.recordId, id)).run();
    db.delete(likes).where(eq(likes.recordId, id)).run();
    db.delete(comments).where(eq(comments.recordId, id)).run();
  }

  // --- Suggestions ---
  createSuggestion(opts: Omit<Suggestion, "id" | "createdAt">): Suggestion {
    return db
      .insert(suggestions)
      .values({ ...opts, createdAt: Date.now() })
      .returning()
      .get();
  }
  listSuggestionsForRecord(recordId: number): Suggestion[] {
    return db
      .select()
      .from(suggestions)
      .where(eq(suggestions.recordId, recordId))
      .orderBy(desc(suggestions.createdAt))
      .all();
  }
  deleteSuggestion(id: number): void {
    db.delete(suggestions).where(eq(suggestions.id, id)).run();
  }
  getSuggestion(id: number): Suggestion | undefined {
    return db.select().from(suggestions).where(eq(suggestions.id, id)).get();
  }

  // --- Follows ---
  createFollow(followerId: number, followeeId: number): void {
    if (followerId === followeeId) return;
    try {
      db.insert(follows)
        .values({ followerId, followeeId, createdAt: Date.now() })
        .run();
    } catch {
      // duplicate (unique pair) — silently ignore
    }
  }
  deleteFollow(followerId: number, followeeId: number): void {
    db.delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followeeId, followeeId),
        ),
      )
      .run();
  }
  isFollowing(followerId: number, followeeId: number): boolean {
    return !!db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followeeId, followeeId),
        ),
      )
      .get();
  }
  listFollowing(followerId: number): number[] {
    return db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, followerId))
      .all()
      .map((r) => r.id);
  }
  listFollowers(followeeId: number): number[] {
    return db
      .select({ id: follows.followerId })
      .from(follows)
      .where(eq(follows.followeeId, followeeId))
      .all()
      .map((r) => r.id);
  }
  countFollowers(userId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followeeId, userId))
      .get();
    return r?.c ?? 0;
  }
  countFollowing(userId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followerId, userId))
      .get();
    return r?.c ?? 0;
  }

  // Hydrate a user with social stats. If viewerId is provided, also include isFollowing.
  hydrate(u: User, viewerId?: number): PublicUser {
    return {
      ...toPublicUser(u),
      followerCount: this.countFollowers(u.id),
      followingCount: this.countFollowing(u.id),
      recordCount: this.countRecordsByUser(u.id),
      isFollowing: viewerId !== undefined ? this.isFollowing(viewerId, u.id) : false,
    };
  }

  hydrateMany(usersList: User[], viewerId?: number): PublicUser[] {
    return usersList.map((u) => this.hydrate(u, viewerId));
  }

  // ───────── Species tally / leaderboards ─────────

  /** How many records this user has of a given iNat species id. */
  countUserRecordsOfSpecies(userId: number, speciesId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(records)
      .where(and(eq(records.userId, userId), eq(records.speciesId, speciesId)))
      .get();
    return r?.c ?? 0;
  }

  /** Distinct iNat species ids this user has recorded (non-null). */
  listUserSpeciesIds(userId: number): number[] {
    return db
      .select({ id: records.speciesId })
      .from(records)
      .where(
        and(eq(records.userId, userId), sql`${records.speciesId} IS NOT NULL`),
      )
      .groupBy(records.speciesId)
      .all()
      .map((r) => r.id!)
      .filter((x): x is number => x !== null && x !== undefined);
  }

  /** Counts per species for a user — used by profile page. */
  speciesCountsByUser(
    userId: number,
  ): Array<{
    speciesId: number;
    speciesName: string | null;
    speciesCommon: string | null;
    groupKey: string | null;
    familyId: number | null;
    familyName: string | null;
    genus: string | null;
    count: number;
  }> {
    return db
      .select({
        speciesId: records.speciesId,
        speciesName: sql<string | null>`MAX(${records.speciesName})`,
        speciesCommon: sql<string | null>`MAX(${records.speciesCommon})`,
        groupKey: sql<string | null>`MAX(${records.groupKey})`,
        familyId: sql<number | null>`MAX(${records.familyId})`,
        familyName: sql<string | null>`MAX(${records.familyName})`,
        genus: sql<string | null>`MAX(${records.genus})`,
        count: sql<number>`count(*)`,
      })
      .from(records)
      .where(
        and(eq(records.userId, userId), sql`${records.speciesId} IS NOT NULL`),
      )
      .groupBy(records.speciesId)
      .all() as any;
  }

  /**
   * Top user (by record count) for a given species id.
   * Returns null if no one has recorded it.
   */
  topRecorderForSpecies(
    speciesId: number,
  ): { userId: number; count: number } | null {
    const row = db
      .select({
        userId: records.userId,
        count: sql<number>`count(*)`,
      })
      .from(records)
      .where(eq(records.speciesId, speciesId))
      .groupBy(records.userId)
      .orderBy(sql`count(*) DESC`)
      .limit(1)
      .get();
    if (!row) return null;
    return { userId: row.userId, count: row.count };
  }

  /**
   * Leaderboard: top N users by DISTINCT species count, optionally filtered
   * to a group / family id / genus.
   */
  leaderboardBySpecies(opts: {
    groupKey?: string | null;
    familyId?: number | null;
    genus?: string | null;
    limit?: number;
  }): Array<{ userId: number; speciesCount: number; recordCount: number }> {
    const limit = opts.limit ?? 3;
    const filters: any[] = [sql`${records.speciesId} IS NOT NULL`];
    if (opts.groupKey) filters.push(eq(records.groupKey, opts.groupKey));
    if (opts.familyId) filters.push(eq(records.familyId, opts.familyId));
    if (opts.genus) filters.push(eq(records.genus, opts.genus));
    // Use COALESCE(parent_species_id, species_id) so that two subspecies of
    // the same parent species count as one species.
    const speciesKey = sql`COALESCE(${records.parentSpeciesId}, ${records.speciesId})`;
    return db
      .select({
        userId: records.userId,
        speciesCount: sql<number>`count(DISTINCT ${speciesKey})`,
        recordCount: sql<number>`count(*)`,
      })
      .from(records)
      .where(and(...filters))
      .groupBy(records.userId)
      .orderBy(sql`count(DISTINCT ${speciesKey}) DESC, count(*) DESC`)
      .limit(limit)
      .all() as any;
  }

  /**
   * Same as above but ranks by raw record count for a single species
   * (used by the per-species "top recorder" board).
   * For a parent species this includes records at any subspecies under it.
   */
  topRecordersForSpecies(
    speciesId: number,
    limit = 3,
  ): Array<{ userId: number; recordCount: number }> {
    return db
      .select({
        userId: records.userId,
        recordCount: sql<number>`count(*)`,
      })
      .from(records)
      .where(
        or(
          eq(records.speciesId, speciesId),
          eq(records.parentSpeciesId, speciesId),
        ),
      )
      .groupBy(records.userId)
      .orderBy(sql`count(*) DESC`)
      .limit(limit)
      .all() as any;
  }

  /**
   * Top identifiers for a specific species: users who have posted ID
   * suggestions naming this species on records owned by someone else.
   * Mirrors `topRecordersForSpecies` (which counts records of this species)
   * but counts suggestions instead.
   *
   * `idCount` is the total suggestions naming this species, `acceptedCount`
   * is how many of those match the host record's current species_id (i.e.
   * effectively accepted by the record owner).
   *
   * Also rolls subspecies up to species: if the record's parent_species_id
   * matches the page's species, count the suggestion too. This mirrors how
   * `topRecordersForSpecies` rolls subspecies records into the parent.
   */
  topIdentifiersForSpecies(
    speciesId: number,
    limit = 3,
  ): Array<{ userId: number; idCount: number; acceptedCount: number }> {
    const rows = sqlite
      .prepare(
        `SELECT s.user_id AS userId,
                COUNT(*) AS idCount,
                SUM(CASE WHEN r.species_id IS NOT NULL
                          AND s.species_id IS NOT NULL
                          AND r.species_id = s.species_id
                         THEN 1 ELSE 0 END) AS acceptedCount
         FROM suggestions s
         JOIN records r ON r.id = s.record_id
         WHERE s.user_id != r.user_id
           AND (s.species_id = ?
                OR r.parent_species_id = ?)
         GROUP BY s.user_id
         ORDER BY idCount DESC, acceptedCount DESC
         LIMIT ?`,
      )
      .all(speciesId, speciesId, limit) as Array<{
        userId: number;
        idCount: number;
        acceptedCount: number;
      }>;
    return rows;
  }

  /**
   * IDs leaderboard — ranks users by suggestions they have posted on OTHER
   * users' records. Joins suggestions → records to scope by group/family/genus
   * of the host record. Excludes self-suggestions (which shouldn't happen but
   * is enforced just in case).
   *
   * Returns: { userId, idCount (total suggestions posted), acceptedCount
   * (suggestions where the host record now has the same species_id) }.
   */
  leaderboardByIds(opts: {
    groupKey?: string | null;
    familyId?: number | null;
    genus?: string | null;
    limit?: number;
  }): Array<{ userId: number; idCount: number; acceptedCount: number }> {
    const limit = opts.limit ?? 3;
    const where: string[] = ["s.user_id != r.user_id"];
    const params: any[] = [];
    if (opts.groupKey) {
      where.push("r.group_key = ?");
      params.push(opts.groupKey);
    }
    if (opts.familyId) {
      where.push("r.family_id = ?");
      params.push(opts.familyId);
    }
    if (opts.genus) {
      where.push("r.genus = ?");
      params.push(opts.genus);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = sqlite
      .prepare(
        `SELECT s.user_id AS userId,
                COUNT(*) AS idCount,
                SUM(CASE WHEN r.species_id IS NOT NULL
                          AND s.species_id IS NOT NULL
                          AND r.species_id = s.species_id
                         THEN 1 ELSE 0 END) AS acceptedCount
         FROM suggestions s
         JOIN records r ON r.id = s.record_id
         ${whereSql}
         GROUP BY s.user_id
         ORDER BY idCount DESC, acceptedCount DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{
        userId: number;
        idCount: number;
        acceptedCount: number;
      }>;
    return rows;
  }

  // ───────── Likes ─────────

  likeRecord(recordId: number, userId: number): boolean {
    try {
      db.insert(likes)
        .values({ recordId, userId, createdAt: Date.now() })
        .run();
      return true;
    } catch {
      return false;
    }
  }

  unlikeRecord(recordId: number, userId: number): boolean {
    const out = db
      .delete(likes)
      .where(and(eq(likes.recordId, recordId), eq(likes.userId, userId)))
      .run();
    return (out as any).changes > 0;
  }

  countLikes(recordId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(likes)
      .where(eq(likes.recordId, recordId))
      .get();
    return r?.c ?? 0;
  }

  hasLiked(recordId: number, userId: number): boolean {
    return !!db
      .select()
      .from(likes)
      .where(and(eq(likes.recordId, recordId), eq(likes.userId, userId)))
      .get();
  }

  countLikesForRecords(recordIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (recordIds.length === 0) return out;
    const rows = db
      .select({
        recordId: likes.recordId,
        c: sql<number>`count(*)`,
      })
      .from(likes)
      .where(inArray(likes.recordId, recordIds))
      .groupBy(likes.recordId)
      .all();
    for (const r of rows) out.set(r.recordId, r.c);
    return out;
  }

  likesByViewer(recordIds: number[], userId: number): Set<number> {
    const out = new Set<number>();
    if (recordIds.length === 0) return out;
    const rows = db
      .select({ recordId: likes.recordId })
      .from(likes)
      .where(and(inArray(likes.recordId, recordIds), eq(likes.userId, userId)))
      .all();
    for (const r of rows) out.add(r.recordId);
    return out;
  }

  /**
   * Top-liked record for a species (with a photo). Returns undefined if no
   * record for that species has any likes.
   */
  topLikedRecordForSpecies(speciesId: number): { record: Record_; likeCount: number } | undefined {
    const row = sqlite
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM likes l WHERE l.record_id = r.id) AS like_count
         FROM records r
         WHERE r.species_id = ?
           AND r.photo_data_url IS NOT NULL AND length(r.photo_data_url) > 0
         ORDER BY like_count DESC, r.created_at DESC
         LIMIT 1`,
      )
      .get(speciesId) as any;
    if (!row || !row.like_count) return undefined;
    const rec: Record_ = {
      id: row.id,
      userId: row.user_id,
      speciesId: row.species_id,
      speciesName: row.species_name,
      speciesCommon: row.species_common,
      notes: row.notes,
      photoDataUrl: row.photo_data_url,
      lat: row.lat,
      lng: row.lng,
      placeGuess: row.place_guess,
      observedOn: row.observed_on,
      cameraMake: row.camera_make,
      cameraModel: row.camera_model,
      lens: row.lens,
      iso: row.iso,
      fNumber: row.f_number,
      shutter: row.shutter,
      focalLength: row.focal_length,
      exifJson: row.exif_json,
      photosJson: row.photos_json,
      obscureLocation: row.obscure_location,
      licenseCode: row.license_code,
      conditionTag: row.condition_tag,
      behaviorsJson: row.behaviors_json,
      groupKey: row.group_key,
      familyId: row.family_id,
      familyName: row.family_name,
      genus: row.genus,
      externalId: row.external_id,
      externalSource: row.external_source,
      externalUrl: row.external_url,
      createdAt: row.created_at,
    } as any;
    return { record: rec, likeCount: row.like_count };
  }

  /** Get a record by explicit id (used for hero pin override). */
  getRecordWithLikeCount(id: number): { record: Record_; likeCount: number } | undefined {
    const r = this.getRecord(id);
    if (!r) return undefined;
    return { record: r, likeCount: this.countLikes(id) };
  }

  // ───────── Comments ─────────

  addComment(
    recordId: number,
    userId: number,
    body: string,
    parentId: number | null = null,
  ): Comment {
    return db
      .insert(comments)
      .values({ recordId, userId, parentId, body, createdAt: Date.now() })
      .returning()
      .get();
  }

  // ───────── Comment likes ─────────

  likeComment(commentId: number, userId: number): boolean {
    try {
      db.insert(commentLikes)
        .values({ commentId, userId, createdAt: Date.now() })
        .run();
      return true;
    } catch {
      return false;
    }
  }

  unlikeComment(commentId: number, userId: number): boolean {
    const out = db
      .delete(commentLikes)
      .where(
        and(
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.userId, userId),
        ),
      )
      .run();
    return (out as any).changes > 0;
  }

  hasLikedComment(commentId: number, userId: number): boolean {
    return !!db
      .select()
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.userId, userId),
        ),
      )
      .get();
  }

  countCommentLikes(commentId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(commentLikes)
      .where(eq(commentLikes.commentId, commentId))
      .get();
    return r?.c ?? 0;
  }

  countLikesForComments(commentIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (commentIds.length === 0) return out;
    const rows = db
      .select({
        commentId: commentLikes.commentId,
        c: sql<number>`count(*)`,
      })
      .from(commentLikes)
      .where(inArray(commentLikes.commentId, commentIds))
      .groupBy(commentLikes.commentId)
      .all();
    for (const r of rows) out.set(r.commentId, r.c);
    return out;
  }

  likedCommentIdsByUser(
    commentIds: number[],
    userId: number,
  ): Set<number> {
    const out = new Set<number>();
    if (commentIds.length === 0) return out;
    const rows = db
      .select({ commentId: commentLikes.commentId })
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.userId, userId),
          inArray(commentLikes.commentId, commentIds),
        ),
      )
      .all();
    for (const r of rows) out.add(r.commentId);
    return out;
  }

  // ───────── Original comment helpers continued ─────────

  listCommentsForRecord(recordId: number): Comment[] {
    return db
      .select()
      .from(comments)
      .where(eq(comments.recordId, recordId))
      .orderBy(comments.createdAt)
      .all();
  }

  getComment(id: number): Comment | undefined {
    return db.select().from(comments).where(eq(comments.id, id)).get();
  }

  deleteComment(id: number): void {
    // Cascade: delete child comments (replies) and their likes
    const children = db
      .select()
      .from(comments)
      .where(eq(comments.parentId, id))
      .all();
    const allIds = [id, ...children.map((c) => c.id)];
    if (allIds.length > 0) {
      db.delete(commentLikes)
        .where(inArray(commentLikes.commentId, allIds))
        .run();
      db.delete(comments).where(inArray(comments.id, allIds)).run();
    } else {
      db.delete(comments).where(eq(comments.id, id)).run();
    }
  }

  countCommentsForRecords(recordIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (recordIds.length === 0) return out;
    const rows = db
      .select({
        recordId: comments.recordId,
        c: sql<number>`count(*)`,
      })
      .from(comments)
      .where(inArray(comments.recordId, recordIds))
      .groupBy(comments.recordId)
      .all();
    for (const r of rows) out.set(r.recordId, r.c);
    return out;
  }

  // ───────── Admin / roles ─────────

  getUserRole(u: User | undefined | null): UserRole {
    if (!u) return "none";
    return (((u as any).role as UserRole) || "none");
  }

  hasRole(u: User | undefined | null, min: UserRole): boolean {
    return ROLE_LEVEL[this.getUserRole(u)] >= ROLE_LEVEL[min];
  }

  setUserRole(userId: number, role: UserRole): User | undefined {
    db.update(users).set({ role } as any).where(eq(users.id, userId)).run();
    return this.getUser(userId);
  }

  /**
   * Replace this user's explicit capability overrides. Pass `null` to clear
   * all overrides (effectively restoring role-default capabilities).
   * The caller is responsible for ensuring the JSON is shaped as a
   * `CapabilityMap` (Partial<Record<AdminCapability, boolean>>).
   */
  setUserPermissions(
    userId: number,
    permissionsJson: string | null,
  ): User | undefined {
    db.update(users)
      .set({ permissionsJson } as any)
      .where(eq(users.id, userId))
      .run();
    return this.getUser(userId);
  }

  /** Read the raw permissionsJson for a user, or null. */
  getUserPermissionsJson(userId: number): string | null {
    const u = this.getUser(userId);
    return ((u as any)?.permissionsJson as string | null) ?? null;
  }

  /**
   * Does this user (effective capabilities = role defaults + explicit
   * overrides) hold the given capability? Server-side authorization helper.
   */
  hasCapability(
    u: User | undefined | null,
    cap: AdminCapability,
  ): boolean {
    if (!u) return false;
    const caps = resolveCapabilities(
      ((u as any).role as UserRole) || "none",
      ((u as any).permissionsJson as string | null) ?? null,
    );
    return !!caps[cap];
  }

  listAllUsers(limit = 500): User[] {
    return db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .all();
  }

  listStaff(): User[] {
    return db
      .select()
      .from(users)
      .where(sql`${users.role} IS NOT NULL AND ${users.role} != 'none'`)
      .all();
  }

  // ───────── Species overrides ─────────

  getSpeciesOverride(speciesId: number): SpeciesOverride | undefined {
    return db
      .select()
      .from(speciesOverrides)
      .where(eq(speciesOverrides.speciesId, speciesId))
      .get();
  }

  /**
   * Resolves the hero photo URL for a species using the SAME precedence as
   * the Species detail page so list views (Browse / MapSearch) stay visually
   * consistent:
   *   1. Admin-forced taxon photo URL (override.forcedHeroPhotoUrl)
   *   2. Admin-pinned record (override.heroRecordId) — served via record proxy
   *   3. Top-liked user record with a photo — served via record proxy
   *   4. null — caller falls back to the iNat default_photo
   *
   * User-photo cases return a small URL of the form `/api/records/:id/photo`
   * instead of inlining ~150KB of base64 per row. This keeps the catalog
   * (1200+ rows) and Browse responses lean.
   */
  resolveSpeciesHeroUrl(speciesId: number): string | null {
    const override = this.getSpeciesOverride(speciesId);
    const forced = override?.forcedHeroPhotoUrl?.trim();
    if (forced) return forced;
    if (override?.heroRecordId) {
      const pinned = this.getRecord(override.heroRecordId);
      if (
        pinned &&
        pinned.speciesId === speciesId &&
        pinned.photoDataUrl &&
        pinned.photoDataUrl.length > 100
      ) {
        return `/api/records/${pinned.id}/photo`;
      }
    }
    const top = this.topLikedRecordForSpecies(speciesId);
    if (top && top.record.photoDataUrl && top.record.photoDataUrl.length > 100) {
      return `/api/records/${top.record.id}/photo`;
    }
    return null;
  }

  /**
   * Bulk version of resolveSpeciesHeroUrl — returns a Map keyed by species id
   * for only the species that have a non-default hero. Species missing from
   * the map should fall back to their iNat default_photo. Two cheap queries:
   * one to pull all relevant override rows, one to pull top-liked photos.
   */
  resolveSpeciesHeroUrlsBulk(speciesIds: number[]): Map<number, string> {
    const out = new Map<number, string>();
    if (speciesIds.length === 0) return out;
    // Deduplicate to keep SQL placeholder count tight.
    const ids = Array.from(new Set(speciesIds.filter((n) => Number.isFinite(n))));
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => "?").join(",");

    // 1. Pull overrides for these species in one query.
    const overrideRows = sqlite
      .prepare(
        `SELECT species_id, forced_hero_photo_url, hero_record_id
         FROM species_overrides
         WHERE species_id IN (${placeholders})`,
      )
      .all(...ids) as Array<{
        species_id: number;
        forced_hero_photo_url: string | null;
        hero_record_id: number | null;
      }>;
    const pendingPinned: number[] = []; // record ids to validate
    const pinnedToSpecies = new Map<number, number>();
    for (const r of overrideRows) {
      const forced = r.forced_hero_photo_url?.trim();
      if (forced) {
        out.set(r.species_id, forced);
        continue;
      }
      if (r.hero_record_id) {
        pendingPinned.push(r.hero_record_id);
        pinnedToSpecies.set(r.hero_record_id, r.species_id);
      }
    }
    // 2. Validate pinned records have a photo and belong to the species.
    if (pendingPinned.length > 0) {
      const pl = pendingPinned.map(() => "?").join(",");
      const pinnedRows = sqlite
        .prepare(
          `SELECT id, species_id, length(photo_data_url) AS plen
           FROM records
           WHERE id IN (${pl})`,
        )
        .all(...pendingPinned) as Array<{
          id: number;
          species_id: number | null;
          plen: number;
        }>;
      for (const p of pinnedRows) {
        const sid = pinnedToSpecies.get(p.id);
        if (!sid) continue;
        if (p.species_id === sid && (p.plen ?? 0) > 100) {
          out.set(sid, `/api/records/${p.id}/photo`);
        }
      }
    }

    // 3. For species without a forced/pinned hero yet, find top-liked record.
    const remaining = ids.filter((sid) => !out.has(sid));
    if (remaining.length > 0) {
      const pl = remaining.map(() => "?").join(",");
      // Window-style query: for each species_id, pick the record with the most
      // likes (ties broken by created_at desc) that has a photo.
      const rows = sqlite
        .prepare(
          `SELECT r.id, r.species_id, (
              SELECT COUNT(*) FROM likes l WHERE l.record_id = r.id
            ) AS like_count
           FROM records r
           WHERE r.species_id IN (${pl})
             AND r.photo_data_url IS NOT NULL
             AND length(r.photo_data_url) > 100
           ORDER BY r.species_id, like_count DESC, r.created_at DESC`,
        )
        .all(...remaining) as Array<{
          id: number;
          species_id: number;
          like_count: number;
        }>;
      // Keep only the first (highest-ranked) per species_id, and only if
      // it has at least one like — matches Species page behavior where
      // unliked photos don't promote past iNat default.
      const seen = new Set<number>();
      for (const row of rows) {
        if (seen.has(row.species_id)) continue;
        seen.add(row.species_id);
        if (row.like_count > 0) {
          out.set(row.species_id, `/api/records/${row.id}/photo`);
        }
      }
    }
    return out;
  }

  upsertSpeciesOverride(
    speciesId: number,
    actorId: number,
    patch: Partial<
      Pick<
        SpeciesOverride,
        | "commonNameOverride"
        | "notesOverride"
        | "heroRecordId"
        | "hiddenPhotosJson"
        | "scientificNameOverride"
        | "authorityOverride"
        | "classOverride"
        | "orderOverride"
        | "familyOverride"
        | "descriptionOverride"
        | "habitatOverride"
        | "dietOverride"
        | "sizeOverride"
        | "conservationOverride"
        | "totalLengthOverride"
        | "snoutVentOverride"
        | "bodyLengthOverride"
        | "dorsalScalesOverride"
        | "ventralScalesOverride"
        | "subcaudalScalesOverride"
        | "analScaleOverride"
        | "lifecycleOverride"
        | "behaviourOverride"
        | "venomOverride"
        | "rangeOverride"
        | "identificationOverride"
        | "similarSpeciesOverride"
        | "forcedHeroPhotoUrl"
      >
    >,
  ): SpeciesOverride {
    const existing = this.getSpeciesOverride(speciesId);
    const now = Date.now();
    if (existing) {
      const clean: any = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
      clean.updatedBy = actorId;
      clean.updatedAt = now;
      db.update(speciesOverrides)
        .set(clean)
        .where(eq(speciesOverrides.speciesId, speciesId))
        .run();
    } else {
      db.insert(speciesOverrides)
        .values({
          speciesId,
          commonNameOverride: patch.commonNameOverride ?? null,
          notesOverride: patch.notesOverride ?? null,
          heroRecordId: patch.heroRecordId ?? null,
          hiddenPhotosJson: patch.hiddenPhotosJson ?? null,
          scientificNameOverride: patch.scientificNameOverride ?? null,
          authorityOverride: patch.authorityOverride ?? null,
          classOverride: patch.classOverride ?? null,
          orderOverride: patch.orderOverride ?? null,
          familyOverride: patch.familyOverride ?? null,
          descriptionOverride: patch.descriptionOverride ?? null,
          habitatOverride: patch.habitatOverride ?? null,
          dietOverride: patch.dietOverride ?? null,
          sizeOverride: patch.sizeOverride ?? null,
          conservationOverride: patch.conservationOverride ?? null,
          totalLengthOverride: patch.totalLengthOverride ?? null,
          snoutVentOverride: patch.snoutVentOverride ?? null,
          bodyLengthOverride: patch.bodyLengthOverride ?? null,
          dorsalScalesOverride: patch.dorsalScalesOverride ?? null,
          ventralScalesOverride: patch.ventralScalesOverride ?? null,
          subcaudalScalesOverride: patch.subcaudalScalesOverride ?? null,
          analScaleOverride: patch.analScaleOverride ?? null,
          lifecycleOverride: patch.lifecycleOverride ?? null,
          behaviourOverride: patch.behaviourOverride ?? null,
          venomOverride: patch.venomOverride ?? null,
          rangeOverride: patch.rangeOverride ?? null,
          identificationOverride: patch.identificationOverride ?? null,
          similarSpeciesOverride: patch.similarSpeciesOverride ?? null,
          forcedHeroPhotoUrl: patch.forcedHeroPhotoUrl ?? null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .run();
    }
    return this.getSpeciesOverride(speciesId)!;
  }

  hideSpeciesPhoto(speciesId: number, actorId: number, photoUrl: string): SpeciesOverride {
    const existing = this.getSpeciesOverride(speciesId);
    let hidden: string[] = [];
    if (existing?.hiddenPhotosJson) {
      try {
        const parsed = JSON.parse(existing.hiddenPhotosJson);
        if (Array.isArray(parsed)) hidden = parsed.filter((x) => typeof x === "string");
      } catch {}
    }
    if (!hidden.includes(photoUrl)) hidden.push(photoUrl);
    return this.upsertSpeciesOverride(speciesId, actorId, {
      hiddenPhotosJson: JSON.stringify(hidden),
    });
  }

  unhideSpeciesPhoto(speciesId: number, actorId: number, photoUrl: string): SpeciesOverride | undefined {
    const existing = this.getSpeciesOverride(speciesId);
    if (!existing) return undefined;
    let hidden: string[] = [];
    if (existing.hiddenPhotosJson) {
      try {
        const parsed = JSON.parse(existing.hiddenPhotosJson);
        if (Array.isArray(parsed)) hidden = parsed.filter((x) => typeof x === "string");
      } catch {}
    }
    hidden = hidden.filter((u) => u !== photoUrl);
    return this.upsertSpeciesOverride(speciesId, actorId, {
      hiddenPhotosJson: hidden.length ? JSON.stringify(hidden) : null,
    });
  }

  // ───────── Audit log ─────────

  logAdminAction(
    actorId: number,
    action: string,
    targetType: string,
    targetId: string | number,
    detail?: any,
  ): void {
    db.insert(adminAudit)
      .values({
        actorId,
        action,
        targetType,
        targetId: String(targetId),
        detail: detail ? JSON.stringify(detail) : null,
        createdAt: Date.now(),
      })
      .run();
  }

  listAuditLog(limit = 50): AdminAudit[] {
    return db
      .select()
      .from(adminAudit)
      .orderBy(desc(adminAudit.createdAt))
      .limit(limit)
      .all();
  }

  // ───────── iNaturalist observer blocklist ─────────

  /**
   * Lookup-shaped getter used by every iNat-proxy endpoint to filter out
   * blocked observers. Returns a snapshot containing the comma-separated
   * `userIds` string (ready to splice into iNat's `not_user_id` query param)
   * and a `logins` Set for client-side post-filtering. Synchronous read —
   * better-sqlite3 plus the small table size make caching unnecessary.
   */
  getInatBlocklistSnapshot(): { userIds: string; logins: Set<string> } {
    const rows = db.select().from(inatObserverBlocks).all();
    const userIds = rows
      .map((r) => r.userId)
      .filter((id): id is number => typeof id === "number")
      .join(",");
    const logins = new Set(rows.map((r) => r.login.toLowerCase()));
    return { userIds, logins };
  }

  listInatBlocks(): InatObserverBlock[] {
    return db
      .select()
      .from(inatObserverBlocks)
      .orderBy(desc(inatObserverBlocks.createdAt))
      .all();
  }

  getInatBlockByLogin(login: string): InatObserverBlock | undefined {
    return db
      .select()
      .from(inatObserverBlocks)
      .where(eq(inatObserverBlocks.login, login.toLowerCase()))
      .get();
  }

  createInatBlock(input: {
    login: string;
    userId: number | null;
    label: string | null;
    note: string | null;
    blockedBy: number;
  }): InatObserverBlock {
    return db
      .insert(inatObserverBlocks)
      .values({
        login: input.login.toLowerCase(),
        userId: input.userId ?? null,
        label: input.label ?? null,
        note: input.note ?? null,
        blockedBy: input.blockedBy,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  deleteInatBlock(id: number): void {
    db.delete(inatObserverBlocks).where(eq(inatObserverBlocks.id, id)).run();
  }

  // ───────── Species articles ─────────

  listArticlesForSpecies(speciesId: number): SpeciesArticle[] {
    return db
      .select()
      .from(speciesArticles)
      .where(eq(speciesArticles.speciesId, speciesId))
      .orderBy(desc(speciesArticles.createdAt))
      .all();
  }

  getArticleById(id: number): SpeciesArticle | undefined {
    return db
      .select()
      .from(speciesArticles)
      .where(eq(speciesArticles.id, id))
      .get();
  }

  createSpeciesArticle(input: {
    speciesId: number;
    uploaderUserId: number;
    title: string;
    description: string | null;
    citation: string;
    credit: string;
    fileDataUrl: string | null;
    fileName: string | null;
    externalUrl: string | null;
  }): SpeciesArticle {
    return db
      .insert(speciesArticles)
      .values({
        speciesId: input.speciesId,
        uploaderUserId: input.uploaderUserId,
        title: input.title,
        description: input.description ?? null,
        citation: input.citation,
        credit: input.credit,
        fileDataUrl: input.fileDataUrl ?? null,
        fileName: input.fileName ?? null,
        externalUrl: input.externalUrl ?? null,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  deleteSpeciesArticle(id: number): void {
    db.delete(speciesArticles).where(eq(speciesArticles.id, id)).run();
  }

  // ───────── Species admin entries (add/edit/remove from catalog) ─────────

  listAdminSpeciesEntries(): SpeciesAdminEntry[] {
    return db
      .select()
      .from(speciesAdminEntries)
      .orderBy(desc(speciesAdminEntries.addedAt))
      .all();
  }

  getAdminSpeciesEntry(id: number): SpeciesAdminEntry | undefined {
    return db
      .select()
      .from(speciesAdminEntries)
      .where(eq(speciesAdminEntries.id, id))
      .get();
  }

  /**
   * Next manual species id, starting at 90_000_000 to keep well clear of
   * any iNat taxon id ever assigned.
   */
  nextManualSpeciesId(): number {
    const row = db
      .select({ maxId: sql<number>`MAX(${speciesAdminEntries.id})` })
      .from(speciesAdminEntries)
      .where(sql`${speciesAdminEntries.id} >= 90000000`)
      .get();
    const cur = row?.maxId ?? 0;
    return Math.max(90_000_000, cur + 1);
  }

  upsertAdminSpeciesEntry(input: {
    id: number;
    source: "inat" | "manual" | "catalog-hidden";
    scientific?: string | null;
    common?: string | null;
    group?: string | null;
    familyId?: number | null;
    familyName?: string | null;
    genus?: string | null;
    authority?: string | null;
    description?: string | null;
    hidden?: number;
    actorId: number;
  }): SpeciesAdminEntry {
    const now = Date.now();
    const existing = this.getAdminSpeciesEntry(input.id);
    if (existing) {
      const patch: any = { updatedBy: input.actorId, updatedAt: now };
      if (input.scientific !== undefined) patch.scientific = input.scientific;
      if (input.common !== undefined) patch.common = input.common;
      if (input.group !== undefined) patch.group = input.group;
      if (input.familyId !== undefined) patch.familyId = input.familyId;
      if (input.familyName !== undefined) patch.familyName = input.familyName;
      if (input.genus !== undefined) patch.genus = input.genus;
      if (input.authority !== undefined) patch.authority = input.authority;
      if (input.description !== undefined) patch.description = input.description;
      if (input.hidden !== undefined) patch.hidden = input.hidden;
      if (input.source !== undefined) patch.source = input.source;
      db.update(speciesAdminEntries)
        .set(patch)
        .where(eq(speciesAdminEntries.id, input.id))
        .run();
    } else {
      db.insert(speciesAdminEntries)
        .values({
          id: input.id,
          source: input.source,
          scientific: input.scientific ?? null,
          common: input.common ?? null,
          group: input.group ?? null,
          familyId: input.familyId ?? null,
          familyName: input.familyName ?? null,
          genus: input.genus ?? null,
          authority: input.authority ?? null,
          description: input.description ?? null,
          hidden: input.hidden ?? 0,
          addedBy: input.actorId,
          addedAt: now,
        })
        .run();
    }
    return this.getAdminSpeciesEntry(input.id)!;
  }

  deleteAdminSpeciesEntry(id: number): void {
    db.delete(speciesAdminEntries).where(eq(speciesAdminEntries.id, id)).run();
  }

  // ────────────────── Notifications ──────────────────

  /**
   * Create a notification. Returns the created row, or null if the actor
   * equals the recipient (we never notify users about their own actions).
   * Also dedupes record_like / comment_like so repeated like/unlike cycles
   * don’t spam the recipient — if an unread like notification already exists
   * from the same actor in the last hour, we skip.
   */
  createNotification(input: {
    recipientId: number;
    actorId: number;
    type:
      | "record_like"
      | "record_comment"
      | "comment_reply"
      | "comment_like"
      | "note_like"
      | "note_comment"
      | "note_comment_reply"
      | "note_comment_like";
    recordId?: number | null;
    commentId?: number | null;
    noteId?: number | null;
    snippet?: string | null;
  }): Notification | null {
    if (input.recipientId === input.actorId) return null;

    const now = Date.now();

    const isLikeType =
      input.type === "record_like" ||
      input.type === "comment_like" ||
      input.type === "note_like" ||
      input.type === "note_comment_like";
    if (isLikeType) {
      // Dedupe like notifications within the last hour.
      const since = now - 60 * 60 * 1000;
      const existing = db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, input.recipientId),
            eq(notifications.actorId, input.actorId),
            eq(notifications.type, input.type),
            input.recordId != null
              ? eq(notifications.recordId, input.recordId)
              : sql`record_id IS NULL`,
            input.commentId != null
              ? eq(notifications.commentId, input.commentId)
              : sql`comment_id IS NULL`,
            input.noteId != null
              ? eq(notifications.noteId, input.noteId)
              : sql`note_id IS NULL`,
            sql`created_at > ${since}`,
            sql`read_at IS NULL`,
          ),
        )
        .limit(1)
        .all();
      if (existing.length > 0) return existing[0];
    }

    return db
      .insert(notifications)
      .values({
        recipientId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        recordId: input.recordId ?? null,
        commentId: input.commentId ?? null,
        noteId: input.noteId ?? null,
        snippet: input.snippet ?? null,
        readAt: null,
        createdAt: now,
      })
      .returning()
      .get();
  }

  /**
   * Remove an unread like notification, used when a user unlikes within the
   * dedupe window so the like “event” disappears cleanly.
   */
  removeLikeNotification(input: {
    recipientId: number;
    actorId: number;
    type: "record_like" | "comment_like" | "note_like" | "note_comment_like";
    recordId?: number | null;
    commentId?: number | null;
    noteId?: number | null;
  }): void {
    db.delete(notifications)
      .where(
        and(
          eq(notifications.recipientId, input.recipientId),
          eq(notifications.actorId, input.actorId),
          eq(notifications.type, input.type),
          input.recordId != null
            ? eq(notifications.recordId, input.recordId)
            : sql`record_id IS NULL`,
          input.commentId != null
            ? eq(notifications.commentId, input.commentId)
            : sql`comment_id IS NULL`,
          input.noteId != null
            ? eq(notifications.noteId, input.noteId)
            : sql`note_id IS NULL`,
          sql`read_at IS NULL`,
        ),
      )
      .run();
  }

  listNotifications(
    recipientId: number,
    opts: { limit?: number; unreadOnly?: boolean } = {},
  ): Notification[] {
    const { limit = 50, unreadOnly = false } = opts;
    const where = unreadOnly
      ? and(eq(notifications.recipientId, recipientId), sql`read_at IS NULL`)
      : eq(notifications.recipientId, recipientId);
    return db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all();
  }

  countUnreadNotifications(recipientId: number): number {
    const row = db
      .select({ c: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(eq(notifications.recipientId, recipientId), sql`read_at IS NULL`),
      )
      .get();
    return Number(row?.c ?? 0);
  }

  markNotificationRead(id: number, recipientId: number): void {
    db.update(notifications)
      .set({ readAt: Date.now() })
      .where(
        and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)),
      )
      .run();
  }

  markNotificationUnread(id: number, recipientId: number): void {
    db.update(notifications)
      .set({ readAt: null })
      .where(
        and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)),
      )
      .run();
  }

  markAllNotificationsRead(recipientId: number): void {
    db.update(notifications)
      .set({ readAt: Date.now() })
      .where(
        and(eq(notifications.recipientId, recipientId), sql`read_at IS NULL`),
      )
      .run();
  }

  deleteNotification(id: number, recipientId: number): void {
    db.delete(notifications)
      .where(
        and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)),
      )
      .run();
  }

  // ───────── Observation notes ─────────

  createNote(opts: Omit<ObservationNote, "id" | "createdAt">): ObservationNote {
    return db
      .insert(observationNotes)
      .values({ ...opts, createdAt: Date.now() })
      .returning()
      .get();
  }

  getNote(id: number): ObservationNote | undefined {
    return db.select().from(observationNotes).where(eq(observationNotes.id, id)).get();
  }

  updateNote(id: number, patch: Partial<ObservationNote>): ObservationNote | undefined {
    const clean: any = {};
    for (const k of ["title", "body"]) {
      if (k in patch) clean[k] = (patch as any)[k];
    }
    if (Object.keys(clean).length === 0) return this.getNote(id);
    return db
      .update(observationNotes)
      .set(clean)
      .where(eq(observationNotes.id, id))
      .returning()
      .get();
  }

  deleteNote(id: number): void {
    // Cascade: delete all comments, comment likes, and note likes
    const cmts = db
      .select({ id: noteComments.id })
      .from(noteComments)
      .where(eq(noteComments.noteId, id))
      .all();
    const cmtIds = cmts.map((c) => c.id);
    if (cmtIds.length > 0) {
      db.delete(noteCommentLikes)
        .where(inArray(noteCommentLikes.commentId, cmtIds))
        .run();
    }
    db.delete(noteComments).where(eq(noteComments.noteId, id)).run();
    db.delete(noteLikes).where(eq(noteLikes.noteId, id)).run();
    db.delete(observationNotes).where(eq(observationNotes.id, id)).run();
  }

  listAllNotes(limit = 60): ObservationNote[] {
    return db
      .select()
      .from(observationNotes)
      .orderBy(desc(observationNotes.createdAt))
      .limit(limit)
      .all();
  }

  listNotesByUser(userId: number, limit = 100): ObservationNote[] {
    return db
      .select()
      .from(observationNotes)
      .where(eq(observationNotes.userId, userId))
      .orderBy(desc(observationNotes.createdAt))
      .limit(limit)
      .all();
  }

  listNotesByUserIds(userIds: number[], limit = 60): ObservationNote[] {
    if (userIds.length === 0) return [];
    return db
      .select()
      .from(observationNotes)
      .where(inArray(observationNotes.userId, userIds))
      .orderBy(desc(observationNotes.createdAt))
      .limit(limit)
      .all();
  }

  listNotesBySpecies(speciesId: number, limit = 100): ObservationNote[] {
    return db
      .select()
      .from(observationNotes)
      .where(
        or(
          eq(observationNotes.speciesId, speciesId),
          eq(observationNotes.parentSpeciesId, speciesId),
        ),
      )
      .orderBy(desc(observationNotes.createdAt))
      .limit(limit)
      .all();
  }

  countNotesByUser(userId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(observationNotes)
      .where(eq(observationNotes.userId, userId))
      .get();
    return r?.c ?? 0;
  }

  // ───────── Note likes ─────────

  likeNote(noteId: number, userId: number): boolean {
    try {
      db.insert(noteLikes)
        .values({ noteId, userId, createdAt: Date.now() })
        .run();
      return true;
    } catch {
      return false;
    }
  }

  unlikeNote(noteId: number, userId: number): boolean {
    const out = db
      .delete(noteLikes)
      .where(and(eq(noteLikes.noteId, noteId), eq(noteLikes.userId, userId)))
      .run();
    return (out as any).changes > 0;
  }

  countNoteLikes(noteId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(noteLikes)
      .where(eq(noteLikes.noteId, noteId))
      .get();
    return r?.c ?? 0;
  }

  hasLikedNote(noteId: number, userId: number): boolean {
    return !!db
      .select()
      .from(noteLikes)
      .where(and(eq(noteLikes.noteId, noteId), eq(noteLikes.userId, userId)))
      .get();
  }

  countLikesForNotes(noteIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (noteIds.length === 0) return out;
    const rows = db
      .select({
        noteId: noteLikes.noteId,
        c: sql<number>`count(*)`,
      })
      .from(noteLikes)
      .where(inArray(noteLikes.noteId, noteIds))
      .groupBy(noteLikes.noteId)
      .all();
    for (const r of rows) out.set(r.noteId, r.c);
    return out;
  }

  noteLikesByViewer(noteIds: number[], userId: number): Set<number> {
    const out = new Set<number>();
    if (noteIds.length === 0) return out;
    const rows = db
      .select({ noteId: noteLikes.noteId })
      .from(noteLikes)
      .where(and(inArray(noteLikes.noteId, noteIds), eq(noteLikes.userId, userId)))
      .all();
    for (const r of rows) out.add(r.noteId);
    return out;
  }

  // ───────── Note comments ─────────

  addNoteComment(
    noteId: number,
    userId: number,
    body: string,
    parentId: number | null = null,
  ): NoteComment {
    return db
      .insert(noteComments)
      .values({ noteId, userId, parentId, body, createdAt: Date.now() })
      .returning()
      .get();
  }

  listNoteComments(noteId: number): NoteComment[] {
    return db
      .select()
      .from(noteComments)
      .where(eq(noteComments.noteId, noteId))
      .orderBy(noteComments.createdAt)
      .all();
  }

  getNoteComment(id: number): NoteComment | undefined {
    return db.select().from(noteComments).where(eq(noteComments.id, id)).get();
  }

  deleteNoteComment(id: number): void {
    const children = db
      .select()
      .from(noteComments)
      .where(eq(noteComments.parentId, id))
      .all();
    const allIds = [id, ...children.map((c) => c.id)];
    if (allIds.length > 0) {
      db.delete(noteCommentLikes)
        .where(inArray(noteCommentLikes.commentId, allIds))
        .run();
      db.delete(noteComments).where(inArray(noteComments.id, allIds)).run();
    } else {
      db.delete(noteComments).where(eq(noteComments.id, id)).run();
    }
  }

  countCommentsForNotes(noteIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (noteIds.length === 0) return out;
    const rows = db
      .select({
        noteId: noteComments.noteId,
        c: sql<number>`count(*)`,
      })
      .from(noteComments)
      .where(inArray(noteComments.noteId, noteIds))
      .groupBy(noteComments.noteId)
      .all();
    for (const r of rows) out.set(r.noteId, r.c);
    return out;
  }

  // ───────── Note comment likes ─────────

  likeNoteComment(commentId: number, userId: number): boolean {
    try {
      db.insert(noteCommentLikes)
        .values({ commentId, userId, createdAt: Date.now() })
        .run();
      return true;
    } catch {
      return false;
    }
  }

  unlikeNoteComment(commentId: number, userId: number): boolean {
    const out = db
      .delete(noteCommentLikes)
      .where(
        and(
          eq(noteCommentLikes.commentId, commentId),
          eq(noteCommentLikes.userId, userId),
        ),
      )
      .run();
    return (out as any).changes > 0;
  }

  hasLikedNoteComment(commentId: number, userId: number): boolean {
    return !!db
      .select()
      .from(noteCommentLikes)
      .where(
        and(
          eq(noteCommentLikes.commentId, commentId),
          eq(noteCommentLikes.userId, userId),
        ),
      )
      .get();
  }

  countNoteCommentLikes(commentId: number): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(noteCommentLikes)
      .where(eq(noteCommentLikes.commentId, commentId))
      .get();
    return r?.c ?? 0;
  }

  countLikesForNoteComments(commentIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (commentIds.length === 0) return out;
    const rows = db
      .select({
        commentId: noteCommentLikes.commentId,
        c: sql<number>`count(*)`,
      })
      .from(noteCommentLikes)
      .where(inArray(noteCommentLikes.commentId, commentIds))
      .groupBy(noteCommentLikes.commentId)
      .all();
    for (const r of rows) out.set(r.commentId, r.c);
    return out;
  }

  noteCommentLikesByViewer(
    commentIds: number[],
    userId: number,
  ): Set<number> {
    const out = new Set<number>();
    if (commentIds.length === 0) return out;
    const rows = db
      .select({ commentId: noteCommentLikes.commentId })
      .from(noteCommentLikes)
      .where(
        and(
          eq(noteCommentLikes.userId, userId),
          inArray(noteCommentLikes.commentId, commentIds),
        ),
      )
      .all();
    for (const r of rows) out.add(r.commentId);
    return out;
  }

  // -------------------------------------------------------------------
  // Distribution: speciesRecords
  // -------------------------------------------------------------------

  /** Insert a single species record (returns inserted row, or undefined on conflict). */
  insertSpeciesRecord(input: {
    speciesId: number;
    lat: number;
    lng: number;
    date: string | null;
    source: "inat" | "ala";
    sourceId: string;
  }): SpeciesRecord | undefined {
    const cellLatIdx = Math.floor(input.lat / 0.5);
    const cellLngIdx = Math.floor(input.lng / 0.5);
    try {
      return db
        .insert(speciesRecords)
        .values({
          speciesId: input.speciesId,
          lat: input.lat,
          lng: input.lng,
          date: input.date,
          source: input.source,
          sourceId: input.sourceId,
          cellLatIdx,
          cellLngIdx,
          createdAt: Date.now(),
        })
        .returning()
        .get();
    } catch {
      return undefined;
    }
  }

  /**
   * Bulk insert with INSERT OR IGNORE on (source, source_id). Returns the
   * number of new rows actually inserted.
   */
  bulkInsertSpeciesRecords(
    rows: Array<{
      speciesId: number;
      lat: number;
      lng: number;
      date: string | null;
      source: "inat" | "ala";
      sourceId: string;
    }>,
  ): number {
    if (rows.length === 0) return 0;
    const stmt = sqlite.prepare(
      `INSERT OR IGNORE INTO species_records
         (species_id, lat, lng, date, source, source_id, cell_lat_idx, cell_lng_idx, created_at)
       VALUES (@speciesId, @lat, @lng, @date, @source, @sourceId, @cellLatIdx, @cellLngIdx, @createdAt)`,
    );
    const now = Date.now();
    let inserted = 0;
    const tx = sqlite.transaction((batch: typeof rows) => {
      for (const r of batch) {
        const cellLatIdx = Math.floor(r.lat / 0.5);
        const cellLngIdx = Math.floor(r.lng / 0.5);
        const info = stmt.run({
          speciesId: r.speciesId,
          lat: r.lat,
          lng: r.lng,
          date: r.date,
          source: r.source,
          sourceId: r.sourceId,
          cellLatIdx,
          cellLngIdx,
          createdAt: now,
        });
        if (info.changes > 0) inserted += 1;
      }
    });
    tx(rows);
    return inserted;
  }

  /** List species records for a species, excluding hidden ones. */
  getSpeciesRecords(
    speciesId: number,
    opts: { limit?: number; includeHidden?: boolean } = {},
  ): SpeciesRecord[] {
    const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
    if (opts.includeHidden) {
      return db
        .select()
        .from(speciesRecords)
        .where(eq(speciesRecords.speciesId, speciesId))
        .limit(limit)
        .all();
    }
    const sqlText = `
      SELECT r.* FROM species_records r
      WHERE r.species_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM species_record_hidden h WHERE h.record_id = r.id
        )
      LIMIT ?`;
    return sqlite.prepare(sqlText).all(speciesId, limit) as any as SpeciesRecord[];
  }

  /** Count species records for a species. */
  countSpeciesRecords(speciesId: number): number {
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM species_records WHERE species_id = ?`)
      .get(speciesId) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * Return every species_id that has at least one row in species_records.
   * Used by the bulk importer to skip already-imported species when resuming
   * a cancelled or restarted job.
   */
  getSpeciesIdsWithAnyRecords(): number[] {
    const rows = sqlite
      .prepare(`SELECT DISTINCT species_id AS id FROM species_records`)
      .all() as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  /** Delete all records for a species (used before re-import). */
  deleteSpeciesRecords(speciesId: number): number {
    const info = sqlite
      .prepare(`DELETE FROM species_records WHERE species_id = ?`)
      .run(speciesId);
    return info.changes;
  }

  /**
   * Aggregate records into 0.5° grid cells, excluding hidden records.
   * Returns map keyed by "latIdx,lngIdx" → count.
   */
  aggregateSpeciesGrid(speciesId: number): Map<string, number> {
    // Imported reference data (iNat / ALA) — pre-bucketed cells.
    // Matches the requested species OR any record whose parent_species_id
    // maps to it (subspecies rollup).
    const importedRows = sqlite
      .prepare(
        `SELECT r.cell_lat_idx AS latIdx, r.cell_lng_idx AS lngIdx, COUNT(*) AS c
         FROM species_records r
         WHERE r.species_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM species_record_hidden h WHERE h.record_id = r.id
           )
         GROUP BY r.cell_lat_idx, r.cell_lng_idx`,
      )
      .all(speciesId) as Array<{ latIdx: number; lngIdx: number; c: number }>;

    // Hunt Herpetology field records — compute cells on the fly from
    // lat/lng (stored as TEXT, may be empty). Include rows where
    // species_id OR parent_species_id matches so subspecies count toward
    // the parent species' map.
    const fieldRows = sqlite
      .prepare(
        `SELECT
           CAST(FLOOR(CAST(lat AS REAL) / 0.5) AS INTEGER) AS latIdx,
           CAST(FLOOR(CAST(lng AS REAL) / 0.5) AS INTEGER) AS lngIdx,
           COUNT(*) AS c
         FROM records
         WHERE (species_id = ? OR parent_species_id = ?)
           AND lat IS NOT NULL AND lng IS NOT NULL
           AND lat <> '' AND lng <> ''
         GROUP BY latIdx, lngIdx`,
      )
      .all(speciesId, speciesId) as Array<{ latIdx: number; lngIdx: number; c: number }>;

    const out = new Map<string, number>();
    for (const r of importedRows) {
      out.set(`${r.latIdx},${r.lngIdx}`, r.c);
    }
    for (const r of fieldRows) {
      const key = `${r.latIdx},${r.lngIdx}`;
      out.set(key, (out.get(key) ?? 0) + r.c);
    }
    return out;
  }

  /**
   * Hunt Herpetology field record points for a species (including
   * subspecies via parent_species_id). Lat/lng cast to REAL.
   */
  getFieldRecordPoints(speciesId: number): Array<{
    id: number;
    lat: number;
    lng: number;
    date: string | null;
  }> {
    return sqlite
      .prepare(
        `SELECT id,
                CAST(lat AS REAL) AS lat,
                CAST(lng AS REAL) AS lng,
                observed_on AS date
         FROM records
         WHERE (species_id = ? OR parent_species_id = ?)
           AND lat IS NOT NULL AND lng IS NOT NULL
           AND lat <> '' AND lng <> ''`,
      )
      .all(speciesId, speciesId) as Array<{
      id: number;
      lat: number;
      lng: number;
      date: string | null;
    }>;
  }

  // -------------------------------------------------------------------
  // Distribution: admin-edited range cells
  // -------------------------------------------------------------------

  /** All admin-edited range cells for a species. */
  getRangeCells(speciesId: number): SpeciesRangeCell[] {
    return db
      .select()
      .from(speciesRangeCells)
      .where(eq(speciesRangeCells.speciesId, speciesId))
      .all();
  }

  /** Upsert a single admin-edited cell. Returns the resulting row. */
  upsertRangeCell(input: {
    speciesId: number;
    cellLatIdx: number;
    cellLngIdx: number;
    present: boolean;
    createdBy: number;
  }): SpeciesRangeCell {
    const existing = db
      .select()
      .from(speciesRangeCells)
      .where(
        and(
          eq(speciesRangeCells.speciesId, input.speciesId),
          eq(speciesRangeCells.cellLatIdx, input.cellLatIdx),
          eq(speciesRangeCells.cellLngIdx, input.cellLngIdx),
        ),
      )
      .get();
    if (existing) {
      return db
        .update(speciesRangeCells)
        .set({ present: input.present })
        .where(eq(speciesRangeCells.id, existing.id))
        .returning()
        .get();
    }
    return db
      .insert(speciesRangeCells)
      .values({
        speciesId: input.speciesId,
        cellLatIdx: input.cellLatIdx,
        cellLngIdx: input.cellLngIdx,
        present: input.present,
        createdBy: input.createdBy,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  /** Remove an admin-edited cell row. */
  deleteRangeCell(
    speciesId: number,
    cellLatIdx: number,
    cellLngIdx: number,
  ): number {
    const info = db
      .delete(speciesRangeCells)
      .where(
        and(
          eq(speciesRangeCells.speciesId, speciesId),
          eq(speciesRangeCells.cellLatIdx, cellLatIdx),
          eq(speciesRangeCells.cellLngIdx, cellLngIdx),
        ),
      )
      .run();
    return info.changes;
  }

  // -------------------------------------------------------------------
  // Distribution: admin-drawn polygons
  // -------------------------------------------------------------------

  /** All admin polygons for a species. */
  getRangePolygons(speciesId: number): SpeciesRangePolygon[] {
    return db
      .select()
      .from(speciesRangePolygons)
      .where(eq(speciesRangePolygons.speciesId, speciesId))
      .all();
  }

  /** Insert a new admin polygon. polygonJson must be JSON of [[lng,lat], ...]. */
  insertRangePolygon(input: {
    speciesId: number;
    polygonJson: string;
    label: string | null;
    createdBy: number;
  }): SpeciesRangePolygon {
    return db
      .insert(speciesRangePolygons)
      .values({
        speciesId: input.speciesId,
        polygonJson: input.polygonJson,
        label: input.label,
        createdBy: input.createdBy,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  /** Delete an admin polygon by id. */
  deleteRangePolygon(id: number): number {
    const info = db
      .delete(speciesRangePolygons)
      .where(eq(speciesRangePolygons.id, id))
      .run();
    return info.changes;
  }

  // -------------------------------------------------------------------
  // Distribution: hidden individual records
  // -------------------------------------------------------------------

  /** Set of record ids that are currently hidden for a species. */
  getHiddenRecordIds(speciesId: number): Set<number> {
    const rows = db
      .select({ recordId: speciesRecordHidden.recordId })
      .from(speciesRecordHidden)
      .where(eq(speciesRecordHidden.speciesId, speciesId))
      .all();
    return new Set(rows.map((r) => r.recordId));
  }

  /** Hide a specific record (idempotent). */
  hideRecord(input: {
    recordId: number;
    speciesId: number;
    hiddenBy: number;
    reason: string | null;
  }): SpeciesRecordHidden | undefined {
    try {
      return db
        .insert(speciesRecordHidden)
        .values({
          recordId: input.recordId,
          speciesId: input.speciesId,
          hiddenBy: input.hiddenBy,
          reason: input.reason,
          createdAt: Date.now(),
        })
        .returning()
        .get();
    } catch {
      // Unique constraint on recordId — already hidden.
      return undefined;
    }
  }

  /** Unhide a record. */
  unhideRecord(recordId: number): number {
    const info = db
      .delete(speciesRecordHidden)
      .where(eq(speciesRecordHidden.recordId, recordId))
      .run();
    return info.changes;
  }

  // -------------------------------------------------------------------
  // Distribution: import job (single-row id=1)
  // -------------------------------------------------------------------

  /** Get the current import job state, or null if none has ever run. */
  getImportJob(): DistributionImportJob | undefined {
    return db
      .select()
      .from(distributionImportJob)
      .where(eq(distributionImportJob.id, 1))
      .get();
  }

  /** Upsert the single import job row (id=1). */
  upsertImportJob(input: {
    status: "idle" | "running" | "done" | "error";
    totalSpecies?: number;
    processedSpecies?: number;
    currentSpeciesId?: number | null;
    currentSpeciesName?: string | null;
    totalRecords?: number;
    lastError?: string | null;
    startedAt?: number | null;
    finishedAt?: number | null;
  }): DistributionImportJob {
    const existing = this.getImportJob();
    const now = Date.now();
    if (existing) {
      return db
        .update(distributionImportJob)
        .set({
          status: input.status,
          totalSpecies: input.totalSpecies ?? existing.totalSpecies,
          processedSpecies:
            input.processedSpecies ?? existing.processedSpecies,
          currentSpeciesId:
            input.currentSpeciesId !== undefined
              ? input.currentSpeciesId
              : existing.currentSpeciesId,
          currentSpeciesName:
            input.currentSpeciesName !== undefined
              ? input.currentSpeciesName
              : existing.currentSpeciesName,
          totalRecords: input.totalRecords ?? existing.totalRecords,
          lastError:
            input.lastError !== undefined
              ? input.lastError
              : existing.lastError,
          startedAt:
            input.startedAt !== undefined ? input.startedAt : existing.startedAt,
          finishedAt:
            input.finishedAt !== undefined
              ? input.finishedAt
              : existing.finishedAt,
          updatedAt: now,
        })
        .where(eq(distributionImportJob.id, 1))
        .returning()
        .get();
    }
    return db
      .insert(distributionImportJob)
      .values({
        id: 1,
        status: input.status,
        totalSpecies: input.totalSpecies ?? 0,
        processedSpecies: input.processedSpecies ?? 0,
        currentSpeciesId: input.currentSpeciesId ?? null,
        currentSpeciesName: input.currentSpeciesName ?? null,
        totalRecords: input.totalRecords ?? 0,
        lastError: input.lastError ?? null,
        startedAt: input.startedAt ?? null,
        updatedAt: now,
        finishedAt: input.finishedAt ?? null,
      })
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();
