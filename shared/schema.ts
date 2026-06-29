import { sqliteTable, text, integer, uniqueIndex, index, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Users — registered accounts (email + bcrypt password)
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarDataUrl: text("avatar_data_url"), // base64 data URL
  coverDataUrl: text("cover_data_url"),   // base64 cover photo
  // CSS object-position values (e.g. "50% 30%"). Empty/null → default "50% 50%".
  avatarPos: text("avatar_pos"),
  coverPos: text("cover_pos"),
  website: text("website"),
  location: text("location"),
  instagram: text("instagram"),
  twitter: text("twitter"),
  facebook: text("facebook"),
  // iNaturalist connection (for record import)
  inatUsername: text("inat_username"),
  inatLastImportAt: integer("inat_last_import_at"),
  // Admin role: 'none' | 'moderator' | 'editor' | 'admin' | 'super-admin'
  role: text("role").default("none"),
  // Per-user capability overrides. JSON object with optional boolean keys for
  // every capability in ADMIN_CAPABILITIES. Unset keys fall back to the
  // role's default capability set. Super-admin manages this via the admin UI.
  permissionsJson: text("permissions_json"),
  createdAt: integer("created_at").notNull(),
});

export type UserRole = "none" | "moderator" | "editor" | "admin" | "super-admin";
export const ROLE_LEVEL: Record<UserRole, number> = {
  none: 0,
  moderator: 1,
  editor: 2,
  admin: 3,
  "super-admin": 4,
};

/**
 * Capability flags. Each capability is a boolean per user, optionally
 * overridden via `permissionsJson`. If a capability is not explicitly set
 * for a user, the default for their role applies (see ROLE_CAPABILITIES).
 *
 * Server enforces these; client UI only hides/disables controls.
 */
export const ADMIN_CAPABILITIES = [
  "deleteComments",
  "editRecords",
  "deleteRecords",
  "editSpecies",
  "hidePhotos",
  "editDistribution",
  "manageRoles",
] as const;
export type AdminCapability = typeof ADMIN_CAPABILITIES[number];
export type CapabilityMap = Partial<Record<AdminCapability, boolean>>;

/** Default capability set for each role. */
export const ROLE_CAPABILITIES: Record<UserRole, CapabilityMap> = {
  none: {},
  moderator: {
    deleteComments: true,
  },
  editor: {
    deleteComments: true,
    editRecords: true,
    editSpecies: true,
    editDistribution: true,
  },
  admin: {
    deleteComments: true,
    editRecords: true,
    editSpecies: true,
    deleteRecords: true,
    hidePhotos: true,
    editDistribution: true,
  },
  "super-admin": {
    deleteComments: true,
    editRecords: true,
    editSpecies: true,
    deleteRecords: true,
    hidePhotos: true,
    editDistribution: true,
    manageRoles: true,
  },
};

/** Friendly labels for the admin UI. */
export const CAPABILITY_LABELS: Record<AdminCapability, string> = {
  deleteComments: "Delete any user's comments",
  editRecords: "Edit any user's records",
  deleteRecords: "Delete any record",
  editSpecies: "Edit species profiles",
  hidePhotos: "Hide photos from species pages",
  editDistribution: "Edit distribution maps (import, grid, polygons, hide points)",
  manageRoles: "Manage roles & permissions",
};

/**
 * Resolve effective capabilities for a user. Explicit per-user permissions
 * override role defaults. Returns a CapabilityMap where every capability
 * key is present with a definite boolean value.
 */
export function resolveCapabilities(
  role: UserRole | string | null | undefined,
  permissionsJson: string | null | undefined,
): Record<AdminCapability, boolean> {
  const r = (role as UserRole) ?? "none";
  const base = ROLE_CAPABILITIES[r] ?? ROLE_CAPABILITIES.none;
  let overrides: CapabilityMap = {};
  if (permissionsJson) {
    try {
      const parsed = JSON.parse(permissionsJson);
      if (parsed && typeof parsed === "object") overrides = parsed;
    } catch {}
  }
  const out = {} as Record<AdminCapability, boolean>;
  for (const cap of ADMIN_CAPABILITIES) {
    out[cap] =
      typeof overrides[cap] === "boolean"
        ? (overrides[cap] as boolean)
        : !!base[cap];
  }
  return out;
}

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/**
 * Sessions — simple cookie-based session tokens
 */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export type Session = typeof sessions.$inferSelect;

/**
 * Records — user-submitted herp observations
 *
 * speciesName: scientific name or freeform if unknown
 * speciesId:   iNat taxon id when the user picked from the field guide; null for "unknown"
 * photoDataUrl: base64 image
 * exif: JSON-encoded EXIF camera info
 */
export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  speciesId: integer("species_id"),      // iNat taxon id, or null
  // When speciesId is a subspecies, parentSpeciesId is the parent species' iNat
  // id; otherwise null. Used to roll subspecies records up to species in tally/leaderboard.
  parentSpeciesId: integer("parent_species_id"),
  speciesName: text("species_name"),     // scientific name; null => unknown
  speciesCommon: text("species_common"), // cached common name
  notes: text("notes"),
  photoDataUrl: text("photo_data_url").notNull(),
  // Location
  lat: text("lat"),
  lng: text("lng"),
  placeGuess: text("place_guess"),
  // Camera / capture
  observedOn: text("observed_on"),       // ISO date string
  cameraMake: text("camera_make"),
  cameraModel: text("camera_model"),
  lens: text("lens"),
  iso: integer("iso"),
  fNumber: text("f_number"),
  shutter: text("shutter"),
  focalLength: text("focal_length"),
  exifJson: text("exif_json"),           // raw EXIF blob (JSON string)
  // Multi-photo: JSON array of base64 data URLs. photoDataUrl above remains the
  // primary/first photo for back-compat with feed/card displays.
  photosJson: text("photos_json"),
  // Privacy & permissions
  obscureLocation: integer("obscure_location").default(0),  // 0|1; when 1, public viewers see fuzzed coords (~10km)
  licenseCode: text("license_code"),                        // 'none' | 'all-rights-reserved' | 'cc-by' | 'cc-by-nc' | 'cc-by-sa'
  // Field observation metadata
  conditionTag: text("condition_tag"),                      // 'wild' | 'captive' | 'relocated' | 'roadkill' | 'rescue'
  behaviorsJson: text("behaviors_json"),                    // JSON array of behaviour strings
  // Taxonomy cache — derived from species ancestor_ids at create time.
  // Lets us count records by group/family/genus without re-fetching iNat.
  groupKey: text("group_key"),           // 'snakes' | 'lizards' | 'turtles' | 'crocs' | 'frogs'
  familyId: integer("family_id"),        // iNat family taxon id
  familyName: text("family_name"),       // scientific family name (e.g. 'Elapidae')
  genus: text("genus"),                  // first word of binomial
  // External source dedupe key — e.g. 'inat:344576011' for imported iNat observations
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalUrl: text("external_url"),
  createdAt: integer("created_at").notNull(),
});

export const insertRecordSchema = createInsertSchema(records).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertRecord = z.infer<typeof insertRecordSchema>;
export type Record_ = typeof records.$inferSelect;

/**
 * Suggestions — ID proposals from other users on a record
 */
export const suggestions = sqliteTable("suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordId: integer("record_id").notNull(),
  userId: integer("user_id").notNull(),    // who suggested
  speciesId: integer("species_id"),
  speciesName: text("species_name").notNull(),
  speciesCommon: text("species_common"),
  comment: text("comment"),
  // Taxonomy cache so accepting a suggestion can update the record without lookups
  groupKey: text("group_key"),
  familyId: integer("family_id"),
  familyName: text("family_name"),
  genus: text("genus"),
  createdAt: integer("created_at").notNull(),
});

export type Suggestion = typeof suggestions.$inferSelect;

/**
 * Follows — directed user-to-user relationships
 */
export const follows = sqliteTable(
  "follows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    followerId: integer("follower_id").notNull(),
    followeeId: integer("followee_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqPair: uniqueIndex("follows_pair_uq").on(t.followerId, t.followeeId),
  }),
);

export type Follow = typeof follows.$inferSelect;

/**
 * Likes — a viewer likes a record. Unique on (recordId, userId).
 */
export const likes = sqliteTable(
  "likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recordId: integer("record_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqRecordUser: uniqueIndex("likes_record_user_uq").on(t.recordId, t.userId),
  }),
);

export type Like = typeof likes.$inferSelect;

/**
 * Comments — Facebook-style free-text comments on a record.
 */
export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordId: integer("record_id").notNull(),
  userId: integer("user_id").notNull(),
  parentId: integer("parent_id"),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Comment = typeof comments.$inferSelect;

/**
 * Comment likes — a viewer likes a comment. Unique on (commentId, userId).
 */
export const commentLikes = sqliteTable(
  "comment_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commentId: integer("comment_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqCommentUser: uniqueIndex("comment_likes_comment_user_uq").on(
      t.commentId,
      t.userId,
    ),
  }),
);

export type CommentLike = typeof commentLikes.$inferSelect;

/**
 * Notifications — emitted when a viewer likes a record, comments on a record,
 * likes a comment, or replies to a comment. `recipientId` is the user who
 * should see the notification (the host of the record / author of the comment).
 * `actorId` is the user whose action triggered it. `type` distinguishes the
 * event; `recordId` / `commentId` point to the related entities for routing.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id").notNull(),
    actorId: integer("actor_id").notNull(),
    // 'record_like' | 'record_comment' | 'comment_reply' | 'comment_like'
    // 'note_like' | 'note_comment' | 'note_comment_reply' | 'note_comment_like'
    type: text("type").notNull(),
    recordId: integer("record_id"),
    commentId: integer("comment_id"),
    noteId: integer("note_id"),
    // Optional snippet of body text for preview (e.g. comment body)
    snippet: text("snippet"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
);

export type Notification = typeof notifications.$inferSelect;

/**
 * Observation notes — scientific-article-style write-ups by a user about a
 * particular species (behaviour, ecology, morphology, husbandry, etc.).
 * Appear in the feed alongside records and on the species page.
 */
export const observationNotes = sqliteTable("observation_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  speciesId: integer("species_id"),
  // If speciesId is a subspecies, parentSpeciesId is the parent species' iNat id.
  parentSpeciesId: integer("parent_species_id"),
  speciesName: text("species_name"),
  speciesCommon: text("species_common"),
  // Taxonomy cache for filtering / fan-out
  groupKey: text("group_key"),
  familyId: integer("family_id"),
  familyName: text("family_name"),
  genus: text("genus"),
  title: text("title"),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type ObservationNote = typeof observationNotes.$inferSelect;

/**
 * Note likes — a viewer likes an observation note. Unique on (noteId, userId).
 */
export const noteLikes = sqliteTable(
  "note_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    noteId: integer("note_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqNoteUser: uniqueIndex("note_likes_note_user_uq").on(t.noteId, t.userId),
  }),
);

export type NoteLike = typeof noteLikes.$inferSelect;

/**
 * Note comments — two-level threaded comments on an observation note.
 */
export const noteComments = sqliteTable("note_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  noteId: integer("note_id").notNull(),
  userId: integer("user_id").notNull(),
  parentId: integer("parent_id"),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type NoteComment = typeof noteComments.$inferSelect;

/**
 * Likes on note comments — unique on (commentId, userId).
 */
export const noteCommentLikes = sqliteTable(
  "note_comment_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commentId: integer("comment_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqNoteCommentUser: uniqueIndex("note_comment_likes_comment_user_uq").on(
      t.commentId,
      t.userId,
    ),
  }),
);

export type NoteCommentLike = typeof noteCommentLikes.$inferSelect;

/**
 * Species overrides — admin/editor edits to species-level info displayed
 * on /species/:id. Keyed by iNat taxon id. All fields optional.
 */
export const speciesOverrides = sqliteTable("species_overrides", {
  speciesId: integer("species_id").primaryKey(),
  // Override common name shown on the species page
  commonNameOverride: text("common_name_override"),
  // Editor-written notes/summary that appears above the wiki summary
  notesOverride: text("notes_override"),
  // Pin a specific record id as the hero photo (overrides like-based selection)
  heroRecordId: integer("hero_record_id"),
  // Hidden iNat photo URLs (JSON array of strings). When set, those photos are
  // suppressed from the gallery / taxon_photos display.
  hiddenPhotosJson: text("hidden_photos_json"),
  // Profile field overrides — when set, replace the iNat-derived values
  // displayed on /species/:id. Leave null to use the upstream value.
  scientificNameOverride: text("scientific_name_override"),
  authorityOverride: text("authority_override"),
  classOverride: text("class_override"),
  orderOverride: text("order_override"),
  familyOverride: text("family_override"),
  descriptionOverride: text("description_override"),
  habitatOverride: text("habitat_override"),
  dietOverride: text("diet_override"),
  sizeOverride: text("size_override"),
  conservationOverride: text("conservation_override"),
  // Morphology field overrides — when set, replace the auto-parsed Wikipedia
  // values in the morphology / size section.
  totalLengthOverride: text("total_length_override"),
  snoutVentOverride: text("snout_vent_override"),
  bodyLengthOverride: text("body_length_override"),
  dorsalScalesOverride: text("dorsal_scales_override"),
  ventralScalesOverride: text("ventral_scales_override"),
  subcaudalScalesOverride: text("subcaudal_scales_override"),
  analScaleOverride: text("anal_scale_override"),
  // Extended natural-history overrides
  lifecycleOverride: text("lifecycle_override"),
  behaviourOverride: text("behaviour_override"),
  venomOverride: text("venom_override"),
  rangeOverride: text("range_override"),
  identificationOverride: text("identification_override"),
  similarSpeciesOverride: text("similar_species_override"),
  forcedHeroPhotoUrl: text("forced_hero_photo_url"),
  updatedBy: integer("updated_by"), // user id
  updatedAt: integer("updated_at"),
});

export type SpeciesOverride = typeof speciesOverrides.$inferSelect;

/**
 * Audit log — lightweight record of admin actions.
 */
export const adminAudit = sqliteTable("admin_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: integer("actor_id").notNull(),
  action: text("action").notNull(),  // 'role.change' | 'record.delete' | 'comment.delete' | 'species.edit' | 'species.hide_photo' | 'record.edit'
  targetType: text("target_type").notNull(), // 'user' | 'record' | 'comment' | 'species'
  targetId: text("target_id").notNull(),     // stringified id or username
  detail: text("detail"),                    // free-form JSON string
  createdAt: integer("created_at").notNull(),
});

export type AdminAudit = typeof adminAudit.$inferSelect;

/**
 * Admin-curated blocklist of iNaturalist observers whose observations must
 * never appear anywhere in the app — photo galleries, recent observations,
 * distribution map points, etc. Keyed by iNat `login` (the stable handle
 * used in URLs); we also cache the resolved numeric `userId` so we can pass
 * `not_user_id=...` to iNat for cheap server-side filtering.
 *
 * The `label` column stores the human-friendly display name resolved at
 * add-time, so the admin UI can show "Tom Frisby" alongside the handle
 * without round-tripping to iNat on every render.
 */
export const inatObserverBlocks = sqliteTable("inat_observer_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  login: text("login").notNull().unique(),     // lowercased iNat login
  userId: integer("user_id"),                  // resolved iNat numeric id (nullable if lookup failed)
  label: text("label"),                        // display name at add-time
  blockedBy: integer("blocked_by").notNull(),  // admin user.id
  note: text("note"),                          // optional reason
  createdAt: integer("created_at").notNull(),
});

export type InatObserverBlock = typeof inatObserverBlocks.$inferSelect;

/**
 * Species occurrence records imported from external sources (iNat + ALA).
 * Deduped on (sourceId, source) and on (speciesId, latRound, lngRound, date).
 */
export const speciesRecords = sqliteTable(
  "species_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    speciesId: integer("species_id").notNull(),     // iNat taxon id
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    date: text("date"),                              // ISO date string (or null)
    source: text("source").notNull(),                // 'inat' | 'ala'
    sourceId: text("source_id").notNull(),           // external observation id
    // 0.5° grid indices precomputed for fast aggregation
    cellLatIdx: integer("cell_lat_idx").notNull(),
    cellLngIdx: integer("cell_lng_idx").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqSourceRow: uniqueIndex("species_records_source_uq").on(t.source, t.sourceId),
    bySpecies: index("species_records_species_idx").on(t.speciesId),
    bySpeciesCell: index("species_records_species_cell_idx").on(
      t.speciesId,
      t.cellLatIdx,
      t.cellLngIdx,
    ),
  }),
);

export type SpeciesRecord = typeof speciesRecords.$inferSelect;

/**
 * Admin-edited grid cells. present=true means admin explicitly marked
 * the cell as present (overrides absence of data). present=false means
 * admin explicitly removed/hid the cell (overrides record presence).
 */
export const speciesRangeCells = sqliteTable(
  "species_range_cells",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    speciesId: integer("species_id").notNull(),
    cellLatIdx: integer("cell_lat_idx").notNull(),
    cellLngIdx: integer("cell_lng_idx").notNull(),
    present: integer("present", { mode: "boolean" }).notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqSpeciesCell: uniqueIndex("species_range_cells_uq").on(
      t.speciesId,
      t.cellLatIdx,
      t.cellLngIdx,
    ),
    bySpecies: index("species_range_cells_species_idx").on(t.speciesId),
  }),
);

export type SpeciesRangeCell = typeof speciesRangeCells.$inferSelect;

/**
 * Admin-drawn range polygon overlays. polygonJson is GeoJSON-style
 * array of [lng, lat] pairs (one polygon per row; multiple rows allowed).
 */
export const speciesRangePolygons = sqliteTable(
  "species_range_polygons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    speciesId: integer("species_id").notNull(),
    polygonJson: text("polygon_json").notNull(),
    label: text("label"),
    createdBy: integer("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    bySpecies: index("species_range_polygons_species_idx").on(t.speciesId),
  }),
);

export type SpeciesRangePolygon = typeof speciesRangePolygons.$inferSelect;

/**
 * Hidden individual record points (admin-suppressed). When a record id
 * is in this table, it must be excluded from public density + map display.
 */
export const speciesRecordHidden = sqliteTable(
  "species_record_hidden",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recordId: integer("record_id").notNull().unique(),
    speciesId: integer("species_id").notNull(),
    hiddenBy: integer("hidden_by").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    bySpecies: index("species_record_hidden_species_idx").on(t.speciesId),
  }),
);

export type SpeciesRecordHidden = typeof speciesRecordHidden.$inferSelect;

/**
 * Distribution import job state — single-row table tracking progress
 * of the background bulk-import job.
 */
export const distributionImportJob = sqliteTable("distribution_import_job", {
  id: integer("id").primaryKey(), // always 1
  status: text("status").notNull(), // 'idle' | 'running' | 'done' | 'error'
  totalSpecies: integer("total_species").notNull(),
  processedSpecies: integer("processed_species").notNull(),
  currentSpeciesId: integer("current_species_id"),
  currentSpeciesName: text("current_species_name"),
  totalRecords: integer("total_records").notNull(),
  lastError: text("last_error"),
  startedAt: integer("started_at"),
  updatedAt: integer("updated_at").notNull(),
  finishedAt: integer("finished_at"),
});

export type DistributionImportJob = typeof distributionImportJob.$inferSelect;

/**
 * Scientific articles uploaded for a species. Any signed-in user can
 * contribute. Each article has either a base64 PDF (fileDataUrl) or an
 * external URL (or both). Title + citation + credit are required.
 */
export const speciesArticles = sqliteTable(
  "species_articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    speciesId: integer("species_id").notNull(),
    uploaderUserId: integer("uploader_user_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // Full bibliographic citation (authors, year, journal, vol, pp, DOI)
    citation: text("citation").notNull(),
    // Credit / attribution line
    credit: text("credit").notNull(),
    // One of these two must be present
    fileDataUrl: text("file_data_url"),
    fileName: text("file_name"),
    externalUrl: text("external_url"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    bySpecies: index("species_articles_species_idx").on(t.speciesId),
    byUploader: index("species_articles_uploader_idx").on(t.uploaderUserId),
  }),
);

export type SpeciesArticle = typeof speciesArticles.$inferSelect;

/**
 * Admin-managed species entries. Two roles:
 *  1) Add a species not in the shipped catalog (manual or from iNat).
 *  2) Hide a catalog species from app listings (set hidden=1, no other fields).
 *
 * id is the species id used everywhere else in the app:
 *  - For inat-sourced rows, id == iNat taxon id (matches catalog convention)
 *  - For manual rows, id is auto-assigned in the 90_000_000+ range to avoid
 *    collision with any iNat taxon id.
 */
export const speciesAdminEntries = sqliteTable("species_admin_entries", {
  id: integer("id").primaryKey(),
  source: text("source").notNull(), // 'inat' | 'manual' | 'catalog-hidden'
  scientific: text("scientific"),
  common: text("common"),
  group: text("group"), // 'snakes'|'lizards'|'turtles'|'crocs'|'frogs'
  familyId: integer("family_id"),
  familyName: text("family_name"),
  genus: text("genus"),
  authority: text("authority"),
  description: text("description"),
  hidden: integer("hidden").notNull().default(0), // 0|1
  addedBy: integer("added_by").notNull(),
  addedAt: integer("added_at").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: integer("updated_at"),
});

export type SpeciesAdminEntry = typeof speciesAdminEntries.$inferSelect;

/**
 * Persistent cache for upstream JSON responses (iNat + ALA).
 *
 * The point of this cache is to stop the server from re-fetching the same
 * upstream payloads on every request. Once a URL has been fetched once,
 * subsequent reads come from SQLite — which means the in-memory layer can
 * stay small (a tiny LRU) and OOMs stop.
 *
 * - url:       full upstream URL (primary key, includes query string)
 * - payload:   JSON-stringified response body
 * - fetchedAt: ms epoch — used for diagnostics + admin TTL refresh logic
 */
export const apiCache = sqliteTable("api_cache", {
  url: text("url").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export type ApiCacheEntry = typeof apiCache.$inferSelect;
