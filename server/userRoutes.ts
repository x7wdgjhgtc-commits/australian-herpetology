import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { storage, sqlite, type PublicUser } from "./storage";
import type { User } from "@shared/schema";
import { resolveInatUser, syncInatForUser } from "./inat";
import {
  startBulkImport,
  cancelJob,
  isJobRunning,
  getCatalogSize,
  importSpecies,
} from "./distributionImporter";
import {
  ROLE_LEVEL,
  ADMIN_CAPABILITIES,
  resolveCapabilities,
  type UserRole,
  type AdminCapability,
  type CapabilityMap,
} from "@shared/schema";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Module-scope name→speciesId map populated by registerUserRoutes after the
// species catalog loads. publicRecord uses it to fill in a speciesId when
// a stored record only has speciesName, so the client can link to the
// species profile.
const NAME_TO_SPECIES_ID = new Map<string, number>();
function nameKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}
export function resolveSpeciesIdByName(
  speciesName: string | null | undefined,
  speciesCommon: string | null | undefined,
): number | null {
  if (NAME_TO_SPECIES_ID.size === 0) return null;
  const sci = nameKey(speciesName);
  if (sci && NAME_TO_SPECIES_ID.has(sci)) return NAME_TO_SPECIES_ID.get(sci)!;
  // Try scientific name stripped to first two words (binomial) for subspecies entries
  if (sci) {
    const parts = sci.split(/\s+/);
    if (parts.length >= 2) {
      const binom = parts.slice(0, 2).join(" ");
      if (NAME_TO_SPECIES_ID.has(binom)) return NAME_TO_SPECIES_ID.get(binom)!;
    }
  }
  const com = nameKey(speciesCommon);
  if (com && NAME_TO_SPECIES_ID.has(com)) return NAME_TO_SPECIES_ID.get(com)!;
  return null;
}

// Attach user to express request type
declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

function readToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) {
    const session = storage.getSession(token);
    if (session) {
      const user = storage.getUser(session.userId);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

function requireRole(min: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!storage.hasRole(req.user, min)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Gate a route by a capability flag. Capability resolution combines the
 * user's role defaults with any explicit per-user overrides set by a
 * super-admin via PATCH /api/admin/users/:username/permissions.
 *
 * Super-admins implicitly hold every capability and bypass the check.
 */
function requireCapability(cap: AdminCapability) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Super-admins always pass.
    if (storage.hasRole(req.user, "super-admin")) {
      next();
      return;
    }
    if (!storage.hasCapability(req.user, cap)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

// Validation schemas
const signupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Username must be alphanumeric or underscores"),
  email: z.string().email(),
  password: z.string().min(6).max(200),
  displayName: z.string().min(1).max(80).optional(),
});

// Login accepts either an email address or a username via the `email` field
// (kept for backwards compatibility) or via the dedicated `emailOrUsername` field.
const loginSchema = z
  .object({
    email: z.string().min(1).optional(),
    emailOrUsername: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((v) => !!(v.email || v.emailOrUsername), {
    message: "Email or username is required",
    path: ["email"],
  });

const profilePatchSchema = z.object({
  displayName: z.string().max(80).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarDataUrl: z.string().nullable().optional(),
  coverDataUrl: z.string().nullable().optional(),
  // CSS object-position strings (e.g. "50% 30%"). Max 32 chars to keep tidy.
  avatarPos: z.string().max(32).nullable().optional(),
  coverPos: z.string().max(32).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  instagram: z.string().max(80).nullable().optional(),
  twitter: z.string().max(80).nullable().optional(),
  facebook: z.string().max(120).nullable().optional(),
});

const LICENSE_CODES = ["none", "all-rights-reserved", "cc-by", "cc-by-nc", "cc-by-sa"] as const;
const CONDITION_TAGS = ["wild", "captive", "relocated", "roadkill", "rescue"] as const;

const recordCreateSchema = z.object({
  speciesId: z.number().nullable().optional(),
  parentSpeciesId: z.number().nullable().optional(),
  speciesName: z.string().nullable().optional(),
  speciesCommon: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  photoDataUrl: z.string().min(1),
  photos: z.array(z.string().min(1)).max(10).optional(),
  lat: z.string().nullable().optional(),
  lng: z.string().nullable().optional(),
  placeGuess: z.string().nullable().optional(),
  observedOn: z.string().nullable().optional(),
  cameraMake: z.string().nullable().optional(),
  cameraModel: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  iso: z.number().int().nullable().optional(),
  fNumber: z.string().nullable().optional(),
  shutter: z.string().nullable().optional(),
  focalLength: z.string().nullable().optional(),
  exifJson: z.string().nullable().optional(),
  // Taxonomy cache — sent by client when species is known
  groupKey: z.string().nullable().optional(),
  familyId: z.number().nullable().optional(),
  familyName: z.string().nullable().optional(),
  genus: z.string().nullable().optional(),
  // New: privacy, license, condition, behaviours
  obscureLocation: z.boolean().optional(),
  licenseCode: z.enum(LICENSE_CODES).nullable().optional(),
  conditionTag: z.enum(CONDITION_TAGS).nullable().optional(),
  behaviors: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const recordSpeciesPatchSchema = z.object({
  speciesId: z.number().nullable().optional(),
  speciesName: z.string().nullable().optional(),
  speciesCommon: z.string().nullable().optional(),
  groupKey: z.string().nullable().optional(),
  familyId: z.number().nullable().optional(),
  familyName: z.string().nullable().optional(),
  genus: z.string().nullable().optional(),
});

const recordEditSchema = z.object({
  speciesId: z.number().nullable().optional(),
  speciesName: z.string().nullable().optional(),
  speciesCommon: z.string().nullable().optional(),
  groupKey: z.string().nullable().optional(),
  familyId: z.number().nullable().optional(),
  familyName: z.string().nullable().optional(),
  genus: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  placeGuess: z.string().nullable().optional(),
  observedOn: z.string().nullable().optional(),
  lat: z.string().nullable().optional(),
  lng: z.string().nullable().optional(),
  obscureLocation: z.boolean().optional(),
  licenseCode: z.enum(LICENSE_CODES).nullable().optional(),
  conditionTag: z.enum(CONDITION_TAGS).nullable().optional(),
  behaviors: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(1000),
  parentId: z.number().int().positive().nullable().optional(),
});

const noteCreateSchema = z.object({
  speciesId: z.number().int().positive().nullable().optional(),
  parentSpeciesId: z.number().int().positive().nullable().optional(),
  speciesName: z.string().min(1).max(300).nullable().optional(),
  speciesCommon: z.string().max(300).nullable().optional(),
  groupKey: z.string().max(80).nullable().optional(),
  familyId: z.number().int().positive().nullable().optional(),
  familyName: z.string().max(200).nullable().optional(),
  genus: z.string().max(200).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  body: z.string().min(1).max(20000),
});

const noteEditSchema = z.object({
  title: z.string().max(300).nullable().optional(),
  body: z.string().min(1).max(20000).optional(),
});

const noteCommentSchema = z.object({
  body: z.string().min(1).max(1000),
  parentId: z.number().int().positive().nullable().optional(),
});

const speciesOverridePatchSchema = z.object({
  commonNameOverride: z.string().max(200).nullable().optional(),
  notesOverride: z.string().max(4000).nullable().optional(),
  heroRecordId: z.number().nullable().optional(),
  scientificNameOverride: z.string().max(200).nullable().optional(),
  authorityOverride: z.string().max(200).nullable().optional(),
  classOverride: z.string().max(120).nullable().optional(),
  orderOverride: z.string().max(120).nullable().optional(),
  familyOverride: z.string().max(120).nullable().optional(),
  descriptionOverride: z.string().max(8000).nullable().optional(),
  habitatOverride: z.string().max(2000).nullable().optional(),
  dietOverride: z.string().max(2000).nullable().optional(),
  sizeOverride: z.string().max(2000).nullable().optional(),
  conservationOverride: z.string().max(200).nullable().optional(),
  totalLengthOverride: z.string().max(200).nullable().optional(),
  snoutVentOverride: z.string().max(200).nullable().optional(),
  bodyLengthOverride: z.string().max(200).nullable().optional(),
  dorsalScalesOverride: z.string().max(200).nullable().optional(),
  ventralScalesOverride: z.string().max(200).nullable().optional(),
  subcaudalScalesOverride: z.string().max(200).nullable().optional(),
  analScaleOverride: z.string().max(200).nullable().optional(),
  lifecycleOverride: z.string().max(4000).nullable().optional(),
  behaviourOverride: z.string().max(4000).nullable().optional(),
  venomOverride: z.string().max(4000).nullable().optional(),
  rangeOverride: z.string().max(4000).nullable().optional(),
  identificationOverride: z.string().max(4000).nullable().optional(),
  similarSpeciesOverride: z.string().max(2000).nullable().optional(),
});

const ROLE_VALUES = ["none", "moderator", "editor", "admin", "super-admin"] as const;
const roleAssignmentSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

const photoUrlSchema = z.object({ photoUrl: z.string().min(1).max(2000) });

const suggestionSchema = z.object({
  speciesId: z.number().nullable().optional(),
  speciesName: z.string().min(1),
  speciesCommon: z.string().nullable().optional(),
  comment: z.string().max(500).nullable().optional(),
  groupKey: z.string().nullable().optional(),
  familyId: z.number().nullable().optional(),
  familyName: z.string().nullable().optional(),
  genus: z.string().nullable().optional(),
});

// Stable per-record fuzz: snaps to a ~0.1° (≈11km) grid + small deterministic jitter (±0.04°)
function fuzzCoord(value: number, recordId: number, axis: "lat" | "lng"): number {
  if (!Number.isFinite(value)) return value;
  const cell = Math.round(value * 10) / 10;
  const seed = recordId * 9301 + (axis === "lat" ? 49297 : 33179);
  const jitter = (((seed % 233280) / 233280) - 0.5) * 0.08;
  return Math.round((cell + jitter) * 10000) / 10000;
}

function publicRecord(
  r: any,
  author?: PublicUser,
  viewerId?: number | null,
  meta?: { likeCount?: number; likedByMe?: boolean; commentCount?: number },
) {
  // Parse photos array; fall back to legacy single photoDataUrl
  let photos: string[] = [];
  if (r.photosJson) {
    try {
      const parsed = JSON.parse(r.photosJson);
      if (Array.isArray(parsed)) photos = parsed.filter((x: any) => typeof x === "string" && x.length > 0);
    } catch {}
  }
  if (photos.length === 0 && r.photoDataUrl) photos = [r.photoDataUrl];

  // Parse behaviors array
  let behaviors: string[] = [];
  if (r.behaviorsJson) {
    try {
      const parsed = JSON.parse(r.behaviorsJson);
      if (Array.isArray(parsed)) behaviors = parsed.filter((x: any) => typeof x === "string");
    } catch {}
  }

  // Apply obscure logic
  const obscureFlag = r.obscureLocation === 1 || r.obscureLocation === true;
  const isOwner = viewerId != null && viewerId === r.userId;
  let outLat = r.lat;
  let outLng = r.lng;
  let obscured = false;
  if (obscureFlag && !isOwner) {
    const latN = r.lat != null ? parseFloat(r.lat) : NaN;
    const lngN = r.lng != null ? parseFloat(r.lng) : NaN;
    if (Number.isFinite(latN)) outLat = String(fuzzCoord(latN, r.id, "lat"));
    if (Number.isFinite(lngN)) outLng = String(fuzzCoord(lngN, r.id, "lng"));
    obscured = Number.isFinite(latN) || Number.isFinite(lngN);
  }

  // Fall back to catalog lookup when the stored record has no speciesId
  const resolvedSpeciesId =
    r.speciesId ?? resolveSpeciesIdByName(r.speciesName, r.speciesCommon);

  return {
    id: r.id,
    userId: r.userId,
    speciesId: resolvedSpeciesId,
    speciesName: r.speciesName,
    speciesCommon: r.speciesCommon,
    notes: r.notes,
    photoDataUrl: photos[0] ?? r.photoDataUrl ?? null,
    photos,
    lat: outLat,
    lng: outLng,
    placeGuess: r.placeGuess,
    observedOn: r.observedOn,
    cameraMake: r.cameraMake,
    cameraModel: r.cameraModel,
    lens: r.lens,
    iso: r.iso,
    fNumber: r.fNumber,
    shutter: r.shutter,
    focalLength: r.focalLength,
    groupKey: r.groupKey,
    familyId: r.familyId,
    familyName: r.familyName,
    genus: r.genus,
    obscureLocation: obscureFlag,
    obscured,
    licenseCode: r.licenseCode ?? null,
    conditionTag: r.conditionTag ?? null,
    behaviors,
    likeCount: meta?.likeCount ?? 0,
    likedByMe: meta?.likedByMe ?? false,
    commentCount: meta?.commentCount ?? 0,
    createdAt: r.createdAt,
    author: author ?? null,
  };
}

function enrichRecordsForList(
  recordsList: any[],
  viewerId: number | undefined,
  authors: Map<number, PublicUser>,
) {
  const ids = recordsList.map((r) => r.id);
  const likeCounts = storage.countLikesForRecords(ids);
  const commentCounts = storage.countCommentsForRecords(ids);
  const viewerLikes = viewerId ? storage.likesByViewer(ids, viewerId) : new Set<number>();
  return recordsList.map((r) =>
    publicRecord(r, authors.get(r.userId), viewerId, {
      likeCount: likeCounts.get(r.id) ?? 0,
      commentCount: commentCounts.get(r.id) ?? 0,
      likedByMe: viewerLikes.has(r.id),
    }),
  );
}

function publicNote(
  n: any,
  author?: PublicUser,
  _viewerId?: number | null,
  meta?: { likeCount?: number; likedByMe?: boolean; commentCount?: number },
) {
  return {
    id: n.id,
    userId: n.userId,
    speciesId: n.speciesId ?? null,
    parentSpeciesId: n.parentSpeciesId ?? null,
    speciesName: n.speciesName ?? null,
    speciesCommon: n.speciesCommon ?? null,
    groupKey: n.groupKey ?? null,
    familyId: n.familyId ?? null,
    familyName: n.familyName ?? null,
    genus: n.genus ?? null,
    title: n.title ?? null,
    body: n.body,
    createdAt: n.createdAt,
    author: author ?? null,
    likeCount: meta?.likeCount ?? 0,
    likedByMe: meta?.likedByMe ?? false,
    commentCount: meta?.commentCount ?? 0,
  };
}

function enrichNotesForList(
  notesList: any[],
  viewerId: number | undefined,
  authors: Map<number, PublicUser>,
) {
  const ids = notesList.map((n) => n.id);
  const likeCounts = storage.countLikesForNotes(ids);
  const commentCounts = storage.countCommentsForNotes(ids);
  const viewerLikes = viewerId
    ? storage.noteLikesByViewer(ids, viewerId)
    : new Set<number>();
  return notesList.map((n) =>
    publicNote(n, authors.get(n.userId), viewerId, {
      likeCount: likeCounts.get(n.id) ?? 0,
      commentCount: commentCounts.get(n.id) ?? 0,
      likedByMe: viewerLikes.has(n.id),
    }),
  );
}

function authorMap(userIds: number[]): Map<number, PublicUser> {
  const m = new Map<number, PublicUser>();
  for (const id of Array.from(new Set(userIds))) {
    const u = storage.getUser(id);
    if (u) {
      m.set(id, {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        bio: null,
        avatarDataUrl: u.avatarDataUrl,
        coverDataUrl: (u as any).coverDataUrl ?? null,
        avatarPos: (u as any).avatarPos ?? null,
        coverPos: (u as any).coverPos ?? null,
        website: null,
        location: null,
        instagram: null,
        twitter: null,
        facebook: null,
        role: (((u as any).role) || "none") as any,
        createdAt: u.createdAt,
      } as any);
    }
  }
  return m;
}

export function registerUserRoutes(app: Express) {
  // Attach user to every request (read-only). Routes that need auth use requireAuth.
  app.use(loadUser);

  // ───────── Auth ─────────
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const body = signupSchema.parse(req.body);
      if (storage.getUserByUsername(body.username)) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }
      if (storage.getUserByEmail(body.email)) {
        res.status(400).json({ error: "Email already registered" });
        return;
      }
      const passwordHash = await bcrypt.hash(body.password, 10);
      const user = storage.createUser({
        username: body.username,
        email: body.email,
        passwordHash,
        displayName: body.displayName ?? body.username,
      });
      // Every new account auto-follows Will Hunt (the platform owner, id=2)
      // so brand-new users land on a populated feed instead of an empty one.
      // createFollow is idempotent and short-circuits on self-follow, so it's
      // safe even when Will himself signs up.
      try {
        storage.createFollow(user.id, 2);
      } catch {
        /* non-fatal — signup must still succeed */
      }
      const token = crypto.randomBytes(32).toString("hex");
      storage.createSession(user.id, token, SESSION_TTL_MS);
      res.json({ token, user: storage.hydrate(user) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const body = loginSchema.parse(req.body);
      const identifier = (body.emailOrUsername ?? body.email ?? "").trim();
      // Treat input as an email if it contains an @, otherwise as a username.
      // Fall back to the other lookup if the first one misses.
      const looksLikeEmail = identifier.includes("@");
      let user = looksLikeEmail
        ? storage.getUserByEmail(identifier)
        : storage.getUserByUsername(identifier);
      if (!user) {
        user = looksLikeEmail
          ? storage.getUserByUsername(identifier)
          : storage.getUserByEmail(identifier);
      }
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      storage.createSession(user.id, token, SESSION_TTL_MS);
      res.json({ token, user: storage.hydrate(user) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    if (req.sessionToken) storage.deleteSession(req.sessionToken);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    res.json({ user: storage.hydrate(req.user) });
  });

  // ───────── Profiles ─────────
  app.get("/api/users/search", (req: Request, res: Response) => {
    const q = ((req.query.q as string) || "").trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }
    const users = storage.searchUsers(q, 20);
    res.json({ users: storage.hydrateMany(users, req.user?.id) });
  });

  app.get("/api/users/:username", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: storage.hydrate(u, req.user?.id) });
  });

  app.get("/api/users/:username/records", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Allow ?limit= override; default to a high cap that covers any realistic
    // herp life-list (previous default of 100 was hiding records).
    const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 5000)
      : 2000;
    const records = storage.listRecordsByUser(u.id, limit);
    const author: PublicUser = {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      bio: null,
      avatarDataUrl: u.avatarDataUrl,
      coverDataUrl: (u as any).coverDataUrl ?? null,
      avatarPos: (u as any).avatarPos ?? null,
      coverPos: (u as any).coverPos ?? null,
      website: null,
      location: null,
      instagram: null,
      twitter: null,
      facebook: null,
      role: (((u as any).role) || "none") as any,
      createdAt: u.createdAt,
    } as any;
    const viewerId = req.user?.id;
    const authors = new Map<number, PublicUser>([[u.id, author]]);
    res.json({ records: enrichRecordsForList(records, viewerId, authors) });
  });

  app.get("/api/users/:username/followers", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const ids = storage.listFollowers(u.id);
    const users = ids
      .map((id) => storage.getUser(id))
      .filter((x): x is User => !!x);
    res.json({ users: storage.hydrateMany(users, req.user?.id) });
  });

  app.get("/api/users/:username/following", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const ids = storage.listFollowing(u.id);
    const users = ids
      .map((id) => storage.getUser(id))
      .filter((x): x is User => !!x);
    res.json({ users: storage.hydrateMany(users, req.user?.id) });
  });

  // ───────── iNaturalist integration ─────────
  app.get("/api/me/inat", requireAuth, (req: Request, res: Response) => {
    const u = req.user!;
    res.json({
      inatUsername: u.inatUsername ?? null,
      inatLastImportAt: u.inatLastImportAt ?? null,
    });
  });

  app.post("/api/me/inat/connect", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = z.object({ username: z.string().min(1).max(60) }).parse(req.body);
      const inat = await resolveInatUser(body.username);
      storage.updateUser(req.user!.id, { inatUsername: inat.login });
      const summary = await syncInatForUser(req.user!.id, inat.login);
      res.json({
        inatUsername: inat.login,
        inatLastImportAt: Date.now(),
        summary,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Could not connect iNaturalist account" });
    }
  });

  app.post("/api/me/inat/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const login = req.user!.inatUsername;
      if (!login) {
        res.status(400).json({ error: "No iNaturalist account connected" });
        return;
      }
      const summary = await syncInatForUser(req.user!.id, login);
      res.json({
        inatUsername: login,
        inatLastImportAt: Date.now(),
        summary,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Sync failed" });
    }
  });

  app.delete("/api/me/inat", requireAuth, (req: Request, res: Response) => {
    storage.updateUser(req.user!.id, { inatUsername: null as any, inatLastImportAt: null as any });
    res.json({ ok: true });
  });

  app.patch("/api/me", requireAuth, (req: Request, res: Response) => {
    try {
      const patch = profilePatchSchema.parse(req.body);
      const updated = storage.updateUser(req.user!.id, patch);
      if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user: storage.hydrate(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Update failed" });
    }
  });

  // ───────── Follow / Unfollow ─────────
  app.post("/api/users/:username/follow", requireAuth, (req: Request, res: Response) => {
    const target = storage.getUserByUsername(req.params.username);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.id === req.user!.id) {
      res.status(400).json({ error: "You can't follow yourself" });
      return;
    }
    storage.createFollow(req.user!.id, target.id);
    res.json({ user: storage.hydrate(target, req.user!.id) });
  });

  app.delete("/api/users/:username/follow", requireAuth, (req: Request, res: Response) => {
    const target = storage.getUserByUsername(req.params.username);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    storage.deleteFollow(req.user!.id, target.id);
    res.json({ user: storage.hydrate(target, req.user!.id) });
  });

  // ───────── Records ─────────
  app.post("/api/records", requireAuth, (req: Request, res: Response) => {
    try {
      const body = recordCreateSchema.parse(req.body);
      // Normalise photos[]: prefer explicit array, else fall back to legacy single field
      const photoList = (body.photos && body.photos.length > 0)
        ? body.photos
        : [body.photoDataUrl];
      const primaryPhoto = photoList[0];
      const photosJson = JSON.stringify(photoList);
      const behaviorsJson = body.behaviors && body.behaviors.length > 0
        ? JSON.stringify(body.behaviors)
        : null;
      const created = storage.createRecord({
        userId: req.user!.id,
        speciesId: body.speciesId ?? null,
        parentSpeciesId: body.parentSpeciesId ?? null,
        speciesName: body.speciesName ?? null,
        speciesCommon: body.speciesCommon ?? null,
        notes: body.notes ?? null,
        photoDataUrl: primaryPhoto,
        photosJson,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        placeGuess: body.placeGuess ?? null,
        observedOn: body.observedOn ?? null,
        cameraMake: body.cameraMake ?? null,
        cameraModel: body.cameraModel ?? null,
        lens: body.lens ?? null,
        iso: body.iso ?? null,
        fNumber: body.fNumber ?? null,
        shutter: body.shutter ?? null,
        focalLength: body.focalLength ?? null,
        exifJson: body.exifJson ?? null,
        groupKey: body.groupKey ?? null,
        familyId: body.familyId ?? null,
        familyName: body.familyName ?? null,
        genus: body.genus ?? null,
        obscureLocation: body.obscureLocation ? 1 : 0,
        licenseCode: body.licenseCode ?? null,
        conditionTag: body.conditionTag ?? null,
        behaviorsJson,
      } as any);
      const author = authorMap([created.userId]).get(created.userId);
      res.json({ record: publicRecord(created, author, req.user!.id) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Create failed" });
    }
  });

  app.get("/api/records", (req: Request, res: Response) => {
    const speciesIdParam = req.query.speciesId as string | undefined;
    const limitParam = req.query.limit as string | undefined;
    const limit = Math.min(
      500,
      Math.max(1, parseInt(limitParam || "60", 10) || 60),
    );
    let records;
    if (speciesIdParam) {
      const sid = parseInt(speciesIdParam, 10);
      if (!Number.isFinite(sid)) {
        res.status(400).json({ error: "speciesId must be a number" });
        return;
      }
      records = storage.listRecordsBySpecies(sid, limit);
    } else {
      records = storage.listAllRecords(limit);
    }
    const authors = authorMap(records.map((r) => r.userId));
    const viewerId = req.user?.id;
    res.json({ records: enrichRecordsForList(records, viewerId, authors) });
  });

  // Serve a record's photo as binary so list endpoints can return tiny
  // URLs (e.g. `/api/records/123/photo`) instead of inlining ~150KB of
  // base64 per row. Public-readable: lists call this without auth.
  //
  // The photo column stores a data URL like `data:image/jpeg;base64,...`;
  // decode the base64 once and stream the raw bytes back with the proper
  // content-type so browsers cache it normally.
  app.get("/api/records/:id/photo", (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid record id" });
      return;
    }
    const r = storage.getRecord(id);
    if (!r || !r.photoDataUrl) {
      res.status(404).end();
      return;
    }
    // Prefer the first entry of photosJson when present (multi-photo records
    // store the same canonical primary at index 0).
    let dataUrl: string = r.photoDataUrl;
    try {
      const arr = (r as any).photosJson ? JSON.parse((r as any).photosJson) : null;
      if (Array.isArray(arr) && typeof arr[0] === "string" && arr[0].startsWith("data:")) {
        dataUrl = arr[0];
      }
    } catch {}
    // Parse "data:<mime>;base64,<payload>". Reject anything malformed.
    const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
    if (!m) {
      res.status(404).end();
      return;
    }
    const contentType = m[1] || "image/jpeg";
    let buf: Buffer;
    try {
      buf = Buffer.from(m[2], "base64");
    } catch {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buf.length));
    // Records are immutable in practice (photo never re-encoded), so cache
    // aggressively. Browse/MapSearch refetch their lists, not the photos.
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.end(buf);
  });

  app.get("/api/records/:id", (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    const author = authorMap([r.userId]).get(r.userId);
    const suggestionsRaw = storage.listSuggestionsForRecord(r.id);
    const sAuthors = authorMap(suggestionsRaw.map((s) => s.userId));
    const enrichedSugs = suggestionsRaw.map((s) => ({
      id: s.id,
      recordId: s.recordId,
      speciesId: s.speciesId,
      speciesName: s.speciesName,
      speciesCommon: s.speciesCommon,
      comment: s.comment,
      createdAt: s.createdAt,
      user: sAuthors.get(s.userId) ?? null,
    }));
    const viewerId = req.user?.id;
    const likeCount = storage.countLikes(r.id);
    const likedByMe = viewerId ? storage.hasLiked(r.id, viewerId) : false;
    const commentsRaw = storage.listCommentsForRecord(r.id);
    const cAuthors = authorMap(commentsRaw.map((c) => c.userId));
    const cIds = commentsRaw.map((c) => c.id);
    const cLikeCounts = storage.countLikesForComments(cIds);
    const cLikedByMe = viewerId
      ? storage.likedCommentIdsByUser(cIds, viewerId)
      : new Set<number>();
    const enrichedComments = commentsRaw.map((c) => ({
      id: c.id,
      recordId: c.recordId,
      parentId: (c as any).parentId ?? null,
      body: c.body,
      createdAt: c.createdAt,
      user: cAuthors.get(c.userId) ?? null,
      likeCount: cLikeCounts.get(c.id) ?? 0,
      likedByMe: cLikedByMe.has(c.id),
    }));
    res.json({
      record: publicRecord(r, author, viewerId, {
        likeCount,
        likedByMe,
        commentCount: enrichedComments.length,
      }),
      suggestions: enrichedSugs,
      comments: enrichedComments,
    });
  });

  app.patch("/api/records/:id", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    const isOwner = r.userId === req.user!.id;
    // Either the owner edits their own record, or any user with the
    // editRecords capability (granted by role default or super-admin
    // override) edits any record.
    const canEdit = storage.hasCapability(req.user, "editRecords");
    if (!isOwner && !canEdit) {
      res.status(403).json({ error: "Not allowed to edit this record" });
      return;
    }
    try {
      const body = recordEditSchema.parse(req.body);
      const patch: any = {};
      for (const k of [
        "speciesId",
        "speciesName",
        "speciesCommon",
        "groupKey",
        "familyId",
        "familyName",
        "genus",
        "notes",
        "placeGuess",
        "observedOn",
        "lat",
        "lng",
        "licenseCode",
        "conditionTag",
      ]) {
        if ((body as any)[k] !== undefined) patch[k] = (body as any)[k];
      }
      if (body.obscureLocation !== undefined) {
        patch.obscureLocation = body.obscureLocation ? 1 : 0;
      }
      if (body.behaviors !== undefined) {
        patch.behaviorsJson = JSON.stringify(body.behaviors);
      }
      storage.updateRecord(id, patch);
      if (!isOwner) {
        storage.logAdminAction(
          req.user!.id,
          "record.edit",
          "record",
          id,
          JSON.stringify({ keys: Object.keys(patch) }),
        );
      }
      const updated = storage.getRecord(id)!;
      const author = authorMap([updated.userId]).get(updated.userId);
      const viewerId = req.user?.id;
      res.json({
        record: publicRecord(updated, author, viewerId, {
          likeCount: storage.countLikes(id),
          likedByMe: viewerId ? storage.hasLiked(id, viewerId) : false,
          commentCount: storage.countCommentsForRecords([id]).get(id) ?? 0,
        }),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Update failed" });
    }
  });

  app.delete("/api/records/:id", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    const isOwner = r.userId === req.user!.id;
    const canDelete = storage.hasCapability(req.user, "deleteRecords");
    if (!isOwner && !canDelete) {
      res.status(403).json({ error: "Not allowed to delete this record" });
      return;
    }
    storage.deleteRecord(id);
    if (!isOwner) {
      storage.logAdminAction(req.user!.id, "record.delete", "record", id, null);
    }
    res.json({ ok: true });
  });

  // ───────── Suggestions ─────────
  app.post(
    "/api/records/:id/suggestions",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const r = storage.getRecord(id);
      if (!r) {
        res.status(404).json({ error: "Record not found" });
        return;
      }
      try {
        const body = suggestionSchema.parse(req.body);
        const created = storage.createSuggestion({
          recordId: id,
          userId: req.user!.id,
          speciesId: body.speciesId ?? null,
          speciesName: body.speciesName,
          speciesCommon: body.speciesCommon ?? null,
          comment: body.comment ?? null,
          groupKey: body.groupKey ?? null,
          familyId: body.familyId ?? null,
          familyName: body.familyName ?? null,
          genus: body.genus ?? null,
        } as any);
        const author = authorMap([created.userId]).get(created.userId);
        res.json({
          suggestion: {
            id: created.id,
            recordId: created.recordId,
            speciesId: created.speciesId,
            speciesName: created.speciesName,
            speciesCommon: created.speciesCommon,
            comment: created.comment,
            createdAt: created.createdAt,
            user: author ?? null,
          },
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Suggest failed" });
      }
    },
  );

  // Accept a suggestion: copies the suggestion's species onto the record.
  // Only the record owner can accept.
  app.post(
    "/api/records/:id/suggestions/:sid/accept",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const sid = parseInt(req.params.sid, 10);
      const r = storage.getRecord(id);
      if (!r) {
        res.status(404).json({ error: "Record not found" });
        return;
      }
      if (r.userId !== req.user!.id) {
        res.status(403).json({ error: "Only the owner can accept a suggestion" });
        return;
      }
      const s = storage.getSuggestion(sid);
      if (!s || s.recordId !== id) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }
      storage.updateRecordSpecies(
        id,
        s.speciesId ?? null,
        s.speciesName,
        s.speciesCommon ?? null,
        {
          groupKey: (s as any).groupKey ?? null,
          familyId: (s as any).familyId ?? null,
          familyName: (s as any).familyName ?? null,
          genus: (s as any).genus ?? null,
        },
      );
      const updated = storage.getRecord(id)!;
      const author = authorMap([updated.userId]).get(updated.userId);
      res.json({ record: publicRecord(updated, author, req.user?.id) });
    },
  );

  app.delete(
    "/api/records/:id/suggestions/:sid",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const sid = parseInt(req.params.sid, 10);
      const s = storage.getSuggestion(sid);
      if (!s || s.recordId !== id) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }
      const r = storage.getRecord(id);
      // suggester OR record owner can delete
      if (s.userId !== req.user!.id && r?.userId !== req.user!.id) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      storage.deleteSuggestion(sid);
      res.json({ ok: true });
    },
  );

  // ───────── Species tally / leaderboards ─────────

  // GET /api/users/:username/species — that user's species counts (tally bars)
  app.get("/api/users/:username/species", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const counts = storage.speciesCountsByUser(u.id);
    res.json({
      userId: u.id,
      speciesIds: counts.map((c) => c.speciesId),
      counts,
    });
  });

  // GET /api/users/:username/rankings — the user's rank across every scope
  // (overall, by group). Returns { username, total: { rank, totalEntrants },
  // groups: [{ key, label, rank, totalEntrants, speciesCount, recordCount }],
  // families: [{ familyId, familyName, rank, totalEntrants, speciesCount, recordCount }] }.
  // Only includes scopes where the user has at least one species recorded.
  app.get("/api/users/:username/rankings", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const computeRank = (
      rows: Array<{ userId: number; speciesCount: number; recordCount: number }>,
      userId: number,
    ) => {
      const idx = rows.findIndex((r) => r.userId === userId);
      if (idx === -1) return null;
      return {
        rank: idx + 1,
        totalEntrants: rows.length,
        speciesCount: rows[idx].speciesCount,
        recordCount: rows[idx].recordCount,
      };
    };

    // Overall leaderboard — distinct species across all groups.
    const overall = storage.leaderboardBySpecies({ limit: 1000 });
    const total = computeRank(overall, u.id);

    // Per-group rankings
    const GROUP_DEFS: Array<{ key: string; label: string }> = [
      { key: "snakes", label: "Snakes" },
      { key: "lizards", label: "Lizards" },
      { key: "turtles", label: "Turtles" },
      { key: "crocs", label: "Crocs" },
      { key: "frogs", label: "Frogs" },
    ];
    const groups: Array<{
      key: string;
      label: string;
      rank: number;
      totalEntrants: number;
      speciesCount: number;
      recordCount: number;
    }> = [];
    for (const g of GROUP_DEFS) {
      const rows = storage.leaderboardBySpecies({ groupKey: g.key, limit: 1000 });
      const r = computeRank(rows, u.id);
      if (r) groups.push({ key: g.key, label: g.label, ...r });
    }

    // Per-family rankings — only families this user has at least 1 record in.
    // Pull the user's family list from their records, then compute rank for each.
    const userFamilies = sqlite
      .prepare(
        `SELECT DISTINCT family_id as familyId, family_name as familyName
         FROM records
         WHERE user_id = ? AND family_id IS NOT NULL
         ORDER BY family_name`,
      )
      .all(u.id) as Array<{ familyId: number; familyName: string }>;

    const families: Array<{
      familyId: number;
      familyName: string;
      rank: number;
      totalEntrants: number;
      speciesCount: number;
      recordCount: number;
    }> = [];
    for (const f of userFamilies) {
      const rows = storage.leaderboardBySpecies({ familyId: f.familyId, limit: 1000 });
      const r = computeRank(rows, u.id);
      if (r) families.push({ familyId: f.familyId, familyName: f.familyName, ...r });
    }
    // Sort families by best (lowest) rank then highest species count.
    families.sort((a, b) => a.rank - b.rank || b.speciesCount - a.speciesCount);

    res.json({ username: u.username, total, groups, families });
  });

  // GET /api/me/species — current viewer's species id set (for green-tick badges)
  app.get("/api/me/species", (req: Request, res: Response) => {
    if (!req.user) {
      res.json({ speciesIds: [], counts: [] });
      return;
    }
    const counts = storage.speciesCountsByUser(req.user.id);
    res.json({
      userId: req.user.id,
      speciesIds: counts.map((c) => c.speciesId),
      counts,
    });
  });

  // GET /api/species/:speciesId/stats — top recorders + my count
  app.get("/api/species/:speciesId/stats", (req: Request, res: Response) => {
    const speciesId = parseInt(req.params.speciesId, 10);
    if (!Number.isFinite(speciesId)) {
      res.status(400).json({ error: "Invalid species id" });
      return;
    }
    const top = storage.topRecordersForSpecies(speciesId, 3);
    const ids = storage.topIdentifiersForSpecies(speciesId, 3);
    const authors = authorMap([
      ...top.map((t) => t.userId),
      ...ids.map((t) => t.userId),
    ]);
    const myCount = req.user
      ? storage.countUserRecordsOfSpecies(req.user.id, speciesId)
      : 0;
    res.json({
      speciesId,
      myCount,
      topRecorders: top.map((t) => ({
        user: authors.get(t.userId) ?? null,
        recordCount: t.recordCount,
      })),
      topIdentifiers: ids.map((t) => ({
        user: authors.get(t.userId) ?? null,
        idCount: t.idCount,
        acceptedCount: t.acceptedCount,
      })),
    });
  });

  // GET /api/leaderboard?scope=...&familyId=...&genus=...
  app.get("/api/leaderboard", (req: Request, res: Response) => {
    const scope = (req.query.scope as string | undefined) || "all";
    const familyId = req.query.familyId
      ? parseInt(req.query.familyId as string, 10)
      : null;
    const genus = (req.query.genus as string | undefined) || null;
    const limit = Math.min(
      10,
      Math.max(1, parseInt((req.query.limit as string) || "3", 10)),
    );

    let rows: Array<{ userId: number; speciesCount: number; recordCount: number }> = [];
    if (genus) {
      rows = storage.leaderboardBySpecies({ genus, limit });
    } else if (familyId) {
      rows = storage.leaderboardBySpecies({ familyId, limit });
    } else if (scope === "reptiles" || scope === "amphibians") {
      const groupsIn = scope === "reptiles"
        ? "'snakes','lizards','turtles','crocs'"
        : "'frogs'";
      rows = sqlite
        .prepare(
          `SELECT user_id as userId,
                  COUNT(DISTINCT species_id) as speciesCount,
                  COUNT(*) as recordCount
           FROM records
           WHERE species_id IS NOT NULL
             AND group_key IN (${groupsIn})
           GROUP BY user_id
           ORDER BY speciesCount DESC, recordCount DESC
           LIMIT ?`,
        )
        .all(limit) as any;
    } else if (["snakes", "lizards", "turtles", "crocs", "frogs"].includes(scope)) {
      rows = storage.leaderboardBySpecies({ groupKey: scope, limit });
    } else {
      rows = storage.leaderboardBySpecies({ limit });
    }

    const authors = authorMap(rows.map((r) => r.userId));
    res.json({
      scope,
      familyId,
      genus,
      entries: rows.map((r) => ({
        user: authors.get(r.userId) ?? null,
        speciesCount: r.speciesCount,
        recordCount: r.recordCount,
      })),
    });
  });

  // GET /api/leaderboard-ids?scope=...&familyId=...&genus=...
  // Ranks users by ID suggestions they have posted on other users' records.
  app.get("/api/leaderboard-ids", (req: Request, res: Response) => {
    const scope = (req.query.scope as string | undefined) || "all";
    const familyId = req.query.familyId
      ? parseInt(req.query.familyId as string, 10)
      : null;
    const genus = (req.query.genus as string | undefined) || null;
    const limit = Math.min(
      10,
      Math.max(1, parseInt((req.query.limit as string) || "3", 10)),
    );

    let rows: Array<{ userId: number; idCount: number; acceptedCount: number }> = [];
    if (genus) {
      rows = storage.leaderboardByIds({ genus, limit });
    } else if (familyId) {
      rows = storage.leaderboardByIds({ familyId, limit });
    } else if (scope === "reptiles" || scope === "amphibians") {
      const groupsIn = scope === "reptiles"
        ? "'snakes','lizards','turtles','crocs'"
        : "'frogs'";
      rows = sqlite
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
             AND r.group_key IN (${groupsIn})
           GROUP BY s.user_id
           ORDER BY idCount DESC, acceptedCount DESC
           LIMIT ?`,
        )
        .all(limit) as any;
    } else if (["snakes", "lizards", "turtles", "crocs", "frogs"].includes(scope)) {
      rows = storage.leaderboardByIds({ groupKey: scope, limit });
    } else {
      rows = storage.leaderboardByIds({ limit });
    }

    const authors = authorMap(rows.map((r) => r.userId));
    res.json({
      scope,
      familyId,
      genus,
      entries: rows.map((r) => ({
        user: authors.get(r.userId) ?? null,
        idCount: Number(r.idCount) || 0,
        acceptedCount: Number(r.acceptedCount) || 0,
      })),
    });
  });

  // ───────── Species catalog (curated AU herp species reference) ─────────
  // The catalog is built once by scripts/build_species_catalog.mjs and shipped
  // alongside the server. It powers the species-drilldown tier in the tally,
  // showing every known AU species under each genus with a tick where the
  // viewer has recorded it.
  interface CatalogEntry {
    id: number;
    scientific: string;
    common: string | null;
    group: string | null;
    familyId: number | null;
    familyName: string | null;
    genus: string | null;
  }
  interface SubspeciesCatalogEntry extends CatalogEntry {
    parentId: number;
    parentScientific: string;
    parentCommon: string | null;
  }
  let CATALOG: CatalogEntry[] = [];
  let SUBCATALOG: SubspeciesCatalogEntry[] = [];
  try {
    // Try multiple locations so it works in dev (cwd=project root) AND when
    // the bundled server is started from elsewhere.
    const candidates = [
      path.resolve(process.cwd(), "scripts/species_catalog.json"),
      path.resolve(__dirname, "../scripts/species_catalog.json"),
      path.resolve(__dirname, "./species_catalog.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        CATALOG = JSON.parse(fs.readFileSync(p, "utf8"));
        console.log(`[catalog] loaded ${CATALOG.length} species from ${p}`);
        break;
      }
    }
    if (CATALOG.length === 0) {
      console.warn("[catalog] species_catalog.json not found \u2014 drilldown will be empty until the catalog is built");
    }
  } catch (e) {
    console.warn("[catalog] failed to load:", e);
  }
  try {
    const subCandidates = [
      path.resolve(process.cwd(), "scripts/subspecies_catalog.json"),
      path.resolve(__dirname, "../scripts/subspecies_catalog.json"),
      path.resolve(__dirname, "./subspecies_catalog.json"),
    ];
    for (const p of subCandidates) {
      if (fs.existsSync(p)) {
        SUBCATALOG = JSON.parse(fs.readFileSync(p, "utf8"));
        console.log(`[catalog] loaded ${SUBCATALOG.length} subspecies from ${p}`);
        break;
      }
    }
  } catch (e) {
    console.warn("[catalog] failed to load subspecies:", e);
  }

  // Populate the name→id resolver used by publicRecord to fill in
  // speciesId for stored records that only have a species name.
  for (const entry of CATALOG) {
    if (entry.scientific) NAME_TO_SPECIES_ID.set(nameKey(entry.scientific), entry.id);
    if (entry.common) NAME_TO_SPECIES_ID.set(nameKey(entry.common), entry.id);
  }
  for (const entry of SUBCATALOG) {
    if (entry.scientific) NAME_TO_SPECIES_ID.set(nameKey(entry.scientific), entry.parentId);
    if (entry.common) NAME_TO_SPECIES_ID.set(nameKey(entry.common), entry.parentId);
  }
  console.log(`[catalog] name resolver populated with ${NAME_TO_SPECIES_ID.size} entries`);

  // ───────── Bootstrap of manual taxa that aren't on iNat ─────────
  // These were originally added through the admin UI but the persistent
  // disk has been reset enough times that we now keep them in source so
  // they survive any reseed / volume swap. Each upsert only writes when the
  // id is missing — admin edits made afterwards are preserved.
  const MANUAL_BOOTSTRAP: Array<{
    id: number;
    scientific: string;
    common: string;
    group: string;
    familyId: number;
    familyName: string;
    genus: string;
  }> = [
    { id: 90000000, scientific: "Varanus phosphoros", common: "Yellow-headed Rock Monitor", group: "lizards", familyId: 39392, familyName: "Varanidae", genus: "Varanus" },
    { id: 90000001, scientific: "Varanus iridis", common: "Rainbow Rock Monitor", group: "lizards", familyId: 39392, familyName: "Varanidae", genus: "Varanus" },
    { id: 90000002, scientific: "Varanus umbra", common: "Orange-headed Rock Monitor", group: "lizards", familyId: 39392, familyName: "Varanidae", genus: "Varanus" },
    { id: 90000003, scientific: "Lampropholis isla", common: "Scawfell Island Sunskink", group: "lizards", familyId: 36982, familyName: "Scincidae", genus: "Lampropholis" },
    { id: 90000004, scientific: "Nactus simakal", common: "Dauan Island Gecko", group: "lizards", familyId: 33177, familyName: "Gekkonidae", genus: "Nactus" },
  ];
  try {
    let bootstrapped = 0;
    for (const m of MANUAL_BOOTSTRAP) {
      if (!storage.getAdminSpeciesEntry(m.id)) {
        storage.upsertAdminSpeciesEntry({
          id: m.id,
          source: "manual",
          scientific: m.scientific,
          common: m.common,
          group: m.group,
          familyId: m.familyId,
          familyName: m.familyName,
          genus: m.genus,
          actorId: 0,
        });
        bootstrapped++;
      }
    }
    if (bootstrapped > 0) {
      console.log(`[catalog] bootstrapped ${bootstrapped} manual species into admin entries`);
    }
  } catch (e) {
    console.warn("[catalog] manual species bootstrap failed:", e);
  }

  /**
   * Merge the shipped CATALOG with admin entries:
   *  - Admin entries with source 'inat' or 'manual' are appended (or replace
   *    a catalog row with the same id, allowing admin edits to override).
   *  - Admin entries with hidden=1 are removed from the merged list.
   *  - Source 'catalog-hidden' rows simply suppress an existing catalog row.
   */
  function buildMergedCatalog(): CatalogEntry[] {
    const admin = storage.listAdminSpeciesEntries();
    const hiddenIds = new Set<number>();
    const replacements = new Map<number, CatalogEntry>();
    const additions: CatalogEntry[] = [];
    for (const a of admin) {
      if (a.hidden) {
        hiddenIds.add(a.id);
        continue;
      }
      const entry: CatalogEntry = {
        id: a.id,
        scientific: a.scientific ?? "",
        common: a.common ?? null,
        group: a.group ?? null,
        familyId: a.familyId ?? null,
        familyName: a.familyName ?? null,
        genus: a.genus ?? null,
      };
      if (CATALOG.some((c) => c.id === a.id)) {
        replacements.set(a.id, entry);
      } else {
        additions.push(entry);
      }
    }
    const base = CATALOG.filter((c) => !hiddenIds.has(c.id)).map((c) =>
      replacements.get(c.id) ?? c,
    );
    return [...base, ...additions];
  }

  // GET /api/species/catalog
  // Optional filters: group, familyId, genus, q
  // Returns: { species: CatalogEntry[] }
  //
  // Cached in-process for 60s keyed by filter params. The hero-URL bulk
  // resolve is the expensive part (3 queries against species_overrides /
  // records / likes for ~1200 ids). A short TTL keeps the browse page snappy
  // while admin edits still propagate within a minute.
  const catalogCache = new Map<string, { at: number; body: unknown }>();
  const CATALOG_TTL_MS = 60_000;
  app.get("/api/species/catalog", (req: Request, res: Response) => {
    const group = (req.query.group as string) || null;
    const familyId = req.query.familyId ? parseInt(req.query.familyId as string, 10) : null;
    const genus = (req.query.genus as string) || null;
    const q = ((req.query.q as string) || "").toLowerCase().trim();
    const cacheKey = `${group ?? ""}|${familyId ?? ""}|${genus ?? ""}|${q}`;
    const cached = catalogCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
      res.set("Cache-Control", "private, max-age=60");
      res.json(cached.body);
      return;
    }
    let rows = buildMergedCatalog();
    if (group) rows = rows.filter((r) => r.group === group);
    if (familyId) rows = rows.filter((r) => r.familyId === familyId);
    if (genus) rows = rows.filter((r) => r.genus === genus);
    if (q) rows = rows.filter((r) =>
      (r.scientific || "").toLowerCase().includes(q) ||
      (r.common || "").toLowerCase().includes(q),
    );
    let enriched: Array<
      (typeof rows)[number] & { heroPhotoUrl: string | null }
    > = rows.map((r) => ({ ...r, heroPhotoUrl: null }));
    try {
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const map = storage.resolveSpeciesHeroUrlsBulk(ids);
        enriched = rows.map((r) => ({
          ...r,
          heroPhotoUrl: map.get(r.id) ?? null,
        }));
      }
    } catch (e) {
      console.warn("[catalog] hero resolution failed:", e);
    }
    const body = { species: enriched, total: enriched.length };
    catalogCache.set(cacheKey, { at: Date.now(), body });
    res.set("Cache-Control", "private, max-age=60");
    res.json(body);
  });

  // Public read-only diagnostic so we can verify what's in production
  // without shell access. Returns counts + a small sample of admin
  // species entries. No sensitive data — just ids, names, source flags.
  app.get("/api/species/catalog/_diag", (_req: Request, res: Response) => {
    try {
      const admin = storage.listAdminSpeciesEntries();
      const sample = admin.slice(0, 20).map((a) => ({
        id: a.id,
        scientific: a.scientific,
        common: a.common,
        group: a.group,
        source: a.source,
        hidden: a.hidden,
      }));
      const merged = buildMergedCatalog();
      res.json({
        adminEntriesTotal: admin.length,
        adminEntriesHidden: admin.filter((a) => a.hidden).length,
        manualIds: admin.filter((a) => a.id >= 90000000).map((a) => a.id),
        mergedTotal: merged.length,
        catalogShippedTotal: CATALOG.length,
        sample,
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Common-name aliases that herpers use but iNat doesn't store. Keyed by
  // subspecies iNat id. Searches by `q` also match these aliases.
  const SUBSPECIES_ALIASES: Record<number, string[]> = {
    32170: ["Top End Carpet Python", "Northern Carpet Python"], // M. s. variegata
    32183: ["Murray-Darling Carpet Python", "Centralian Carpet Python"], // M. s. metcalfei
    32174: ["Eastern Carpet Python"], // M. s. mcdowelli
    32172: ["North Queensland Carpet Python"], // M. s. cheynei
    32175: ["Southern Carpet Python"], // M. s. spilota (Diamond)
    37457: ["Centralian Bluetongue"], // Tiliqua scincoides intermedia
  };

  // GET /api/subspecies/catalog
  // Optional filters: parentId, group, familyId, genus, q
  // Returns: { subspecies: SubspeciesCatalogEntry[] }
  app.get("/api/subspecies/catalog", (req: Request, res: Response) => {
    const parentId = req.query.parentId ? parseInt(req.query.parentId as string, 10) : null;
    const group = (req.query.group as string) || null;
    const familyId = req.query.familyId ? parseInt(req.query.familyId as string, 10) : null;
    const genus = (req.query.genus as string) || null;
    const q = ((req.query.q as string) || "").toLowerCase().trim();
    let rows = SUBCATALOG.map((r) => ({
      ...r,
      aliases: SUBSPECIES_ALIASES[r.id] ?? [],
    }));
    if (parentId) rows = rows.filter((r) => r.parentId === parentId);
    if (group) rows = rows.filter((r) => r.group === group);
    if (familyId) rows = rows.filter((r) => r.familyId === familyId);
    if (genus) rows = rows.filter((r) => r.genus === genus);
    if (q) rows = rows.filter((r) =>
      (r.scientific || "").toLowerCase().includes(q) ||
      (r.common || "").toLowerCase().includes(q) ||
      (r.parentScientific || "").toLowerCase().includes(q) ||
      (r.aliases ?? []).some((a: string) => a.toLowerCase().includes(q)),
    );
    res.json({ subspecies: rows, total: rows.length });
  });

  // GET /api/admin/backfill-record-taxonomy (admin+ only)
  // Backfills group_key, family_id, family_name on existing records by joining
  // records.species_id against the catalog. Fixes records imported before the
  // family-derivation bug was fixed.
  app.post(
    "/api/admin/backfill-record-taxonomy",
    requireAuth,
    (req: Request, res: Response) => {
      if ((req.user as any)?.role !== "super-admin" && (req.user as any)?.role !== "admin") {
        res.status(403).json({ error: "Admin only" });
        return;
      }
      if (CATALOG.length === 0) {
        res.status(503).json({ error: "Catalog not loaded" });
        return;
      }
      const byId = new Map<number, CatalogEntry>(CATALOG.map((c) => [c.id, c]));
      let updated = 0;
      let skipped = 0;
      const all = sqlite
        .prepare("SELECT id, species_id, group_key, family_id, family_name, genus FROM records")
        .all() as Array<{
          id: number; species_id: number | null; group_key: string | null;
          family_id: number | null; family_name: string | null; genus: string | null;
        }>;
      const upd = sqlite.prepare(
        "UPDATE records SET group_key = ?, family_id = ?, family_name = ?, genus = COALESCE(?, genus) WHERE id = ?",
      );
      const tx = sqlite.transaction(() => {
        for (const r of all) {
          if (!r.species_id) { skipped++; continue; }
          const c = byId.get(r.species_id);
          if (!c) { skipped++; continue; }
          // Only update if at least one taxonomy field is missing/stale.
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
      res.json({ updated, skipped, totalCatalog: CATALOG.length });
    },
  );

  // ───────── Feed ─────────
  app.get("/api/feed", requireAuth, (req: Request, res: Response) => {
    const ids = storage.listFollowing(req.user!.id);
    // Include the viewer's own records too — feels natural.
    ids.push(req.user!.id);
    const records = storage.listRecordsByUserIds(ids, 60);
    const authors = authorMap(records.map((r) => r.userId));
    const viewerId = req.user!.id;
    res.json({ records: enrichRecordsForList(records, viewerId, authors) });
  });

  // ───────── Likes ─────────
  app.post("/api/records/:id/like", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    storage.likeRecord(id, req.user!.id);
    storage.createNotification({
      recipientId: r.userId,
      actorId: req.user!.id,
      type: "record_like",
      recordId: id,
    });
    res.json({ liked: true, likeCount: storage.countLikes(id) });
  });

  app.delete("/api/records/:id/like", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    storage.unlikeRecord(id, req.user!.id);
    storage.removeLikeNotification({
      recipientId: r.userId,
      actorId: req.user!.id,
      type: "record_like",
      recordId: id,
    });
    res.json({ liked: false, likeCount: storage.countLikes(id) });
  });

  // ───────── Comments ─────────
  app.get("/api/records/:id/comments", (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    const rows = storage.listCommentsForRecord(id);
    const authors = authorMap(rows.map((c) => c.userId));
    const cIds = rows.map((c) => c.id);
    const likeCounts = storage.countLikesForComments(cIds);
    const likedByMe = req.user
      ? storage.likedCommentIdsByUser(cIds, req.user.id)
      : new Set<number>();
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        recordId: c.recordId,
        parentId: (c as any).parentId ?? null,
        body: c.body,
        createdAt: c.createdAt,
        user: authors.get(c.userId) ?? null,
        likeCount: likeCounts.get(c.id) ?? 0,
        likedByMe: likedByMe.has(c.id),
      })),
    });
  });

  app.post("/api/records/:id/comments", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const r = storage.getRecord(id);
    if (!r) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    try {
      const body = commentSchema.parse(req.body);
      let parentId: number | null = body.parentId ?? null;
      if (parentId != null) {
        const parent = storage.getComment(parentId);
        if (!parent || parent.recordId !== id) {
          res.status(400).json({ error: "Invalid parent comment" });
          return;
        }
        // Flatten: if replying to a reply, attach to the top-level parent.
        if ((parent as any).parentId) {
          parentId = (parent as any).parentId;
        }
      }
      const created = storage.addComment(
        id,
        req.user!.id,
        body.body,
        parentId,
      );
      const author = authorMap([created.userId]).get(created.userId);

      // Emit notifications.
      const snippet = body.body.slice(0, 140);
      if (parentId != null) {
        // Reply to a comment → notify the parent comment’s author.
        const parent = storage.getComment(parentId);
        if (parent && parent.userId !== req.user!.id) {
          storage.createNotification({
            recipientId: parent.userId,
            actorId: req.user!.id,
            type: "comment_reply",
            recordId: id,
            commentId: created.id,
            snippet,
          });
        }
        // Also notify the record owner (if distinct from parent author + actor).
        if (
          r.userId !== req.user!.id &&
          (!parent || r.userId !== parent.userId)
        ) {
          storage.createNotification({
            recipientId: r.userId,
            actorId: req.user!.id,
            type: "record_comment",
            recordId: id,
            commentId: created.id,
            snippet,
          });
        }
      } else {
        // Top-level comment → notify the record owner.
        storage.createNotification({
          recipientId: r.userId,
          actorId: req.user!.id,
          type: "record_comment",
          recordId: id,
          commentId: created.id,
          snippet,
        });
      }
      res.json({
        comment: {
          id: created.id,
          recordId: created.recordId,
          parentId: (created as any).parentId ?? null,
          body: created.body,
          createdAt: created.createdAt,
          user: author ?? null,
          likeCount: 0,
          likedByMe: false,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Comment failed" });
    }
  });

  // Like / unlike a comment
  app.post(
    "/api/comments/:cid/like",
    requireAuth,
    (req: Request, res: Response) => {
      const cid = parseInt(req.params.cid, 10);
      const c = storage.getComment(cid);
      if (!c) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      storage.likeComment(cid, req.user!.id);
      storage.createNotification({
        recipientId: c.userId,
        actorId: req.user!.id,
        type: "comment_like",
        recordId: c.recordId,
        commentId: cid,
      });
      res.json({
        liked: true,
        likeCount: storage.countCommentLikes(cid),
      });
    },
  );

  app.delete(
    "/api/comments/:cid/like",
    requireAuth,
    (req: Request, res: Response) => {
      const cid = parseInt(req.params.cid, 10);
      const c = storage.getComment(cid);
      if (!c) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      storage.unlikeComment(cid, req.user!.id);
      storage.removeLikeNotification({
        recipientId: c.userId,
        actorId: req.user!.id,
        type: "comment_like",
        recordId: c.recordId,
        commentId: cid,
      });
      res.json({
        liked: false,
        likeCount: storage.countCommentLikes(cid),
      });
    },
  );

  app.delete(
    "/api/records/:id/comments/:commentId",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const cid = parseInt(req.params.commentId, 10);
      const c = storage.getComment(cid);
      if (!c || c.recordId !== id) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      const r = storage.getRecord(id);
      const isCommenter = c.userId === req.user!.id;
      const isRecordOwner = r?.userId === req.user!.id;
      const canDelete = storage.hasCapability(req.user, "deleteComments");
      if (!isCommenter && !isRecordOwner && !canDelete) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      storage.deleteComment(cid);
      if (!isCommenter && !isRecordOwner) {
        storage.logAdminAction(req.user!.id, "comment.delete", "comment", cid, null);
      }
      res.json({ ok: true });
    },
  );

  // ───────── Species top photo + overrides (public) ─────────
  app.get("/api/species/:speciesId/top-photo", (req: Request, res: Response) => {
    const speciesId = parseInt(req.params.speciesId, 10);
    if (!Number.isFinite(speciesId)) {
      res.status(400).json({ error: "Invalid species id" });
      return;
    }
    const pickPhoto = (rec: any): string | null => {
      try {
        const arr = rec.photosJson ? JSON.parse(rec.photosJson) : null;
        if (Array.isArray(arr) && arr.length > 0) return arr[0];
      } catch {}
      return rec.photoDataUrl ?? null;
    };
    const override = storage.getSpeciesOverride(speciesId);
    if (override?.heroRecordId) {
      const pinned = storage.getRecord(override.heroRecordId);
      if (pinned && pinned.speciesId === speciesId) {
        const author = authorMap([pinned.userId]).get(pinned.userId);
        res.json({
          photoDataUrl: pickPhoto(pinned),
          recordId: pinned.id,
          likeCount: storage.countLikes(pinned.id),
          author: author ?? null,
          pinned: true,
        });
        return;
      }
    }
    const top = storage.topLikedRecordForSpecies(speciesId);
    if (!top) {
      res.json({ photoDataUrl: null });
      return;
    }
    const author = authorMap([top.record.userId]).get(top.record.userId);
    res.json({
      photoDataUrl: pickPhoto(top.record),
      recordId: top.record.id,
      likeCount: top.likeCount,
      author: author ?? null,
      pinned: false,
    });
  });

  app.get("/api/species/:speciesId/overrides", (req: Request, res: Response) => {
    const speciesId = parseInt(req.params.speciesId, 10);
    if (!Number.isFinite(speciesId)) {
      res.status(400).json({ error: "Invalid species id" });
      return;
    }
    const o = storage.getSpeciesOverride(speciesId);
    if (!o) {
      res.json({
        override: {
          speciesId,
          commonNameOverride: null,
          notesOverride: null,
          heroRecordId: null,
          hiddenPhotos: [],
          scientificNameOverride: null,
          authorityOverride: null,
          classOverride: null,
          orderOverride: null,
          familyOverride: null,
          descriptionOverride: null,
          habitatOverride: null,
          dietOverride: null,
          sizeOverride: null,
          conservationOverride: null,
          totalLengthOverride: null,
          snoutVentOverride: null,
          bodyLengthOverride: null,
          dorsalScalesOverride: null,
          ventralScalesOverride: null,
          subcaudalScalesOverride: null,
          analScaleOverride: null,
          lifecycleOverride: null,
          behaviourOverride: null,
          venomOverride: null,
          rangeOverride: null,
          identificationOverride: null,
          similarSpeciesOverride: null,
          forcedHeroPhotoUrl: null,
          updatedAt: null,
        },
      });
      return;
    }
    let hidden: string[] = [];
    try {
      const arr = o.hiddenPhotosJson ? JSON.parse(o.hiddenPhotosJson) : null;
      if (Array.isArray(arr)) hidden = arr.filter((x) => typeof x === "string");
    } catch {}
    res.json({
      override: {
        speciesId: o.speciesId,
        commonNameOverride: o.commonNameOverride,
        notesOverride: o.notesOverride,
        heroRecordId: o.heroRecordId,
        hiddenPhotos: hidden,
        scientificNameOverride: (o as any).scientificNameOverride ?? null,
        authorityOverride: (o as any).authorityOverride ?? null,
        classOverride: (o as any).classOverride ?? null,
        orderOverride: (o as any).orderOverride ?? null,
        familyOverride: (o as any).familyOverride ?? null,
        descriptionOverride: (o as any).descriptionOverride ?? null,
        habitatOverride: (o as any).habitatOverride ?? null,
        dietOverride: (o as any).dietOverride ?? null,
        sizeOverride: (o as any).sizeOverride ?? null,
        conservationOverride: (o as any).conservationOverride ?? null,
        totalLengthOverride: (o as any).totalLengthOverride ?? null,
        snoutVentOverride: (o as any).snoutVentOverride ?? null,
        bodyLengthOverride: (o as any).bodyLengthOverride ?? null,
        dorsalScalesOverride: (o as any).dorsalScalesOverride ?? null,
        ventralScalesOverride: (o as any).ventralScalesOverride ?? null,
        subcaudalScalesOverride: (o as any).subcaudalScalesOverride ?? null,
        analScaleOverride: (o as any).analScaleOverride ?? null,
        lifecycleOverride: (o as any).lifecycleOverride ?? null,
        behaviourOverride: (o as any).behaviourOverride ?? null,
        venomOverride: (o as any).venomOverride ?? null,
        rangeOverride: (o as any).rangeOverride ?? null,
        identificationOverride: (o as any).identificationOverride ?? null,
        similarSpeciesOverride: (o as any).similarSpeciesOverride ?? null,
        forcedHeroPhotoUrl: (o as any).forcedHeroPhotoUrl ?? null,
        updatedAt: o.updatedAt,
      },
    });
  });

  // ───────── Admin endpoints ─────────
  app.get("/api/admin/users", requireRole("moderator"), (_req: Request, res: Response) => {
    const all = storage.listAllUsers(500);
    res.json({
      users: all.map((u: any) => {
        const permissionsJson = (u.permissionsJson as string | null) ?? null;
        let permissions: CapabilityMap | null = null;
        if (permissionsJson) {
          try {
            const parsed = JSON.parse(permissionsJson);
            if (parsed && typeof parsed === "object") permissions = parsed as CapabilityMap;
          } catch {
            permissions = null;
          }
        }
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          email: u.email ?? null,
          avatarDataUrl: u.avatarDataUrl ?? null,
          role: (u.role || "none") as UserRole,
          createdAt: u.createdAt,
          permissions,
          capabilities: resolveCapabilities((u.role || "none") as UserRole, permissionsJson),
        };
      }),
    });
  });

  app.post(
    "/api/admin/users/:username/role",
    requireCapability("manageRoles"),
    (req: Request, res: Response) => {
      try {
        const body = roleAssignmentSchema.parse(req.body);
        const target = storage.getUserByUsername(req.params.username);
        if (!target) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        if (target.id === req.user!.id && body.role !== "super-admin") {
          res.status(400).json({ error: "You cannot demote yourself" });
          return;
        }
        storage.setUserRole(target.id, body.role);
        storage.logAdminAction(
          req.user!.id,
          "role.set",
          "user",
          target.id,
          JSON.stringify({ username: target.username, role: body.role }),
        );
        res.json({ user: { id: target.id, username: target.username, role: body.role } });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Role update failed" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:username/permissions",
    requireCapability("manageRoles"),
    (req: Request, res: Response) => {
      try {
        const target = storage.getUserByUsername(req.params.username);
        if (!target) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        const raw = req.body?.permissions;
        let cleanJson: string | null = null;
        let clean: CapabilityMap = {};
        if (raw !== null && raw !== undefined) {
          if (typeof raw !== "object" || Array.isArray(raw)) {
            res.status(400).json({ error: "permissions must be an object or null" });
            return;
          }
          for (const k of Object.keys(raw)) {
            if (!ADMIN_CAPABILITIES.includes(k as AdminCapability)) {
              res.status(400).json({ error: `Unknown capability: ${k}` });
              return;
            }
            const v = (raw as any)[k];
            if (typeof v !== "boolean") {
              res.status(400).json({ error: `Capability ${k} must be boolean` });
              return;
            }
            (clean as any)[k] = v;
          }
          cleanJson = Object.keys(clean).length === 0 ? null : JSON.stringify(clean);
        }
        // Self-lockout guard: cannot revoke own manageRoles
        if (target.id === req.user!.id && clean.manageRoles === false) {
          res.status(400).json({ error: "You cannot revoke your own manage-roles permission" });
          return;
        }
        storage.setUserPermissions(target.id, cleanJson);
        storage.logAdminAction(
          req.user!.id,
          "permissions.set",
          "user",
          target.id,
          JSON.stringify({ username: target.username, permissions: clean }),
        );
        const role = (target.role || "none") as UserRole;
        res.json({
          user: {
            id: target.id,
            username: target.username,
            role,
            permissions: cleanJson ? clean : null,
            capabilities: resolveCapabilities(role, cleanJson),
          },
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Permission update failed" });
      }
    },
  );

  app.get("/api/admin/audit", requireRole("moderator"), (_req: Request, res: Response) => {
    const rows = storage.listAuditLog(100);
    const authors = authorMap(rows.map((r) => r.actorId));
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        actor: authors.get(r.actorId) ?? null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        detail: r.detail,
        createdAt: r.createdAt,
      })),
    });
  });

  // ───── iNaturalist observer blocklist ─────
  // List, add, and remove iNat observers whose observations should never
  // appear anywhere in the app. Add resolves the login → numeric user id via
  // iNat's autocomplete endpoint so we can pass `not_user_id=...` for cheap
  // server-side filtering on subsequent iNat proxy calls.

  app.get(
    "/api/admin/inat-blocks",
    requireRole("moderator"),
    (_req: Request, res: Response) => {
      const rows = storage.listInatBlocks();
      const authors = authorMap(rows.map((r) => r.blockedBy));
      res.json({
        blocks: rows.map((r) => ({
          id: r.id,
          login: r.login,
          userId: r.userId,
          label: r.label,
          note: r.note,
          blockedBy: authors.get(r.blockedBy) ?? null,
          createdAt: r.createdAt,
        })),
      });
    },
  );

  const inatBlockCreateSchema = z.object({
    login: z.string().trim().min(1).max(64),
    note: z.string().trim().max(500).optional().nullable(),
  });

  app.post(
    "/api/admin/inat-blocks",
    requireRole("moderator"),
    async (req: Request, res: Response) => {
      try {
        const body = inatBlockCreateSchema.parse(req.body);
        // Normalize: strip a leading @ and lowercase.
        const login = body.login.replace(/^@/, "").toLowerCase();
        if (!/^[a-z0-9_\-.]+$/.test(login)) {
          res.status(400).json({ error: "Login contains invalid characters" });
          return;
        }
        if (storage.getInatBlockByLogin(login)) {
          res.status(409).json({ error: "That iNat user is already blocked" });
          return;
        }
        // Resolve login → numeric id + display name via iNat. Best-effort:
        // if the lookup fails we still persist the block (login-based
        // post-filter is sufficient on its own).
        let userId: number | null = null;
        let label: string | null = null;
        try {
          const r = await fetch(
            `https://api.inaturalist.org/v1/users/autocomplete?q=${encodeURIComponent(login)}&per_page=5`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (r.ok) {
            const data = (await r.json()) as {
              results?: Array<{ id: number; login: string; name?: string | null }>;
            };
            const match = (data.results || []).find(
              (u) => u.login?.toLowerCase() === login,
            );
            if (match) {
              userId = match.id;
              label = match.name?.trim() || match.login;
            }
          }
        } catch {
          /* offline / timeout — keep going without numeric id */
        }
        const row = storage.createInatBlock({
          login,
          userId,
          label,
          note: body.note ?? null,
          blockedBy: req.user!.id,
        });
        storage.logAdminAction(
          req.user!.id,
          "inat_block.add",
          "inat_observer",
          row.id,
          { login, userId, label },
        );
        res.json({
          block: {
            id: row.id,
            login: row.login,
            userId: row.userId,
            label: row.label,
            note: row.note,
            createdAt: row.createdAt,
          },
          resolved: userId !== null,
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Failed to add block" });
      }
    },
  );

  app.delete(
    "/api/admin/inat-blocks/:id",
    requireRole("moderator"),
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      storage.deleteInatBlock(id);
      storage.logAdminAction(
        req.user!.id,
        "inat_block.remove",
        "inat_observer",
        id,
        null,
      );
      res.json({ ok: true });
    },
  );

  // ─────── Admin: species management (add / edit / hide / remove) ───────
  // List returns BOTH catalog species and admin entries merged, so admins see
  // every species the app knows about, where it came from, and any overrides.

  app.get(
    "/api/admin/species",
    requireRole("editor"),
    (req: Request, res: Response) => {
      const admin = storage.listAdminSpeciesEntries();
      const adminById = new Map(admin.map((a) => [a.id, a]));
      const q = ((req.query.q as string) || "").toLowerCase().trim();
      const group = (req.query.group as string) || "";
      type Row = {
        id: number;
        scientific: string;
        common: string | null;
        group: string | null;
        familyName: string | null;
        genus: string | null;
        source: "catalog" | "inat" | "manual" | "catalog-edited";
        hidden: boolean;
        authority?: string | null;
        description?: string | null;
      };
      const out: Row[] = [];
      for (const c of CATALOG) {
        const a = adminById.get(c.id);
        if (a) {
          out.push({
            id: c.id,
            scientific: a.scientific ?? c.scientific,
            common: a.common ?? c.common,
            group: a.group ?? c.group,
            familyName: a.familyName ?? c.familyName,
            genus: a.genus ?? c.genus,
            source: a.source === "catalog-hidden" ? "catalog" : "catalog-edited",
            hidden: !!a.hidden,
            authority: a.authority ?? null,
            description: a.description ?? null,
          });
        } else {
          out.push({
            id: c.id,
            scientific: c.scientific,
            common: c.common,
            group: c.group,
            familyName: c.familyName,
            genus: c.genus,
            source: "catalog",
            hidden: false,
          });
        }
      }
      const catalogIds = new Set(CATALOG.map((c) => c.id));
      for (const a of admin) {
        if (catalogIds.has(a.id)) continue;
        out.push({
          id: a.id,
          scientific: a.scientific ?? "",
          common: a.common,
          group: a.group,
          familyName: a.familyName,
          genus: a.genus,
          source: a.source === "inat" ? "inat" : "manual",
          hidden: !!a.hidden,
          authority: a.authority,
          description: a.description,
        });
      }
      let rows = out;
      if (group) rows = rows.filter((r) => r.group === group);
      if (q) {
        rows = rows.filter(
          (r) =>
            (r.scientific || "").toLowerCase().includes(q) ||
            (r.common || "").toLowerCase().includes(q) ||
            (r.familyName || "").toLowerCase().includes(q) ||
            (r.genus || "").toLowerCase().includes(q),
        );
      }
      rows.sort((a, b) => (a.scientific || "").localeCompare(b.scientific || ""));
      res.json({ species: rows, total: rows.length });
    },
  );

  // GET /api/admin/inat-taxon-lookup?q=...
  app.get(
    "/api/admin/inat-taxon-lookup",
    requireRole("editor"),
    async (req: Request, res: Response) => {
      const q = ((req.query.q as string) || "").trim();
      if (!q) {
        res.json({ results: [] });
        return;
      }
      try {
        const r = await fetch(
          `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(q)}&rank=species&per_page=5&locale=en`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!r.ok) {
          res.json({ results: [] });
          return;
        }
        const data = (await r.json()) as { results?: any[] };
        const results = (data.results || []).map((t) => {
          const family = (t.ancestors || []).find((a: any) => a.rank === "family");
          let groupVal: string | null = null;
          const iconic = (t.iconic_taxon_name || "").toLowerCase();
          if (iconic === "amphibia") groupVal = "frogs";
          else if (iconic === "reptilia") {
            const orderName = (t.ancestors || []).find((a: any) => a.rank === "order")?.name;
            if (orderName === "Squamata") {
              const fam = family?.name || "";
              const snakeFamilies = ["Elapidae", "Pythonidae", "Colubridae", "Boidae", "Typhlopidae", "Hydrophiidae", "Acrochordidae", "Homalopsidae"];
              groupVal = snakeFamilies.includes(fam) ? "snakes" : "lizards";
            } else if (orderName === "Testudines") groupVal = "turtles";
            else if (orderName === "Crocodylia") groupVal = "crocs";
            else groupVal = "lizards";
          }
          return {
            id: t.id,
            scientific: t.name,
            common: t.preferred_common_name || null,
            rank: t.rank,
            group: groupVal,
            familyId: family?.id ?? null,
            familyName: family?.name ?? null,
            genus: (t.name || "").split(" ")[0] || null,
            observationsCount: t.observations_count ?? 0,
          };
        });
        res.json({ results });
      } catch (err: any) {
        res.status(502).json({ error: err?.message || "iNat lookup failed" });
      }
    },
  );

  const adminSpeciesUpsertSchema = z
    .object({
      id: z.number().int().positive().optional(),
      source: z.enum(["inat", "manual"]),
      scientific: z.string().trim().min(1).max(200),
      common: z.string().trim().max(200).optional().nullable(),
      group: z.enum(["snakes", "lizards", "turtles", "crocs", "frogs"]),
      familyId: z.number().int().positive().optional().nullable(),
      familyName: z.string().trim().max(120).optional().nullable(),
      genus: z.string().trim().max(120).optional().nullable(),
      authority: z.string().trim().max(200).optional().nullable(),
      description: z.string().trim().max(5000).optional().nullable(),
    })
    .refine((d) => d.source !== "inat" || !!d.id, {
      message: "iNat species require an iNat taxon id",
      path: ["id"],
    });

  app.post(
    "/api/admin/species",
    requireRole("editor"),
    (req: Request, res: Response) => {
      try {
        const body = adminSpeciesUpsertSchema.parse(req.body);
        const id = body.source === "inat" ? body.id! : storage.nextManualSpeciesId();
        const row = storage.upsertAdminSpeciesEntry({
          id,
          source: body.source,
          scientific: body.scientific,
          common: body.common ?? null,
          group: body.group,
          familyId: body.familyId ?? null,
          familyName: body.familyName ?? null,
          genus: body.genus ?? (body.scientific.split(" ")[0] || null),
          authority: body.authority ?? null,
          description: body.description ?? null,
          hidden: 0,
          actorId: req.user!.id,
        });
        storage.logAdminAction(
          req.user!.id,
          "species.add",
          "species",
          id,
          { source: body.source, scientific: body.scientific },
        );
        if (body.scientific) NAME_TO_SPECIES_ID.set(nameKey(body.scientific), id);
        if (body.common) NAME_TO_SPECIES_ID.set(nameKey(body.common), id);
        res.json({ species: row });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Could not add species" });
      }
    },
  );

  app.patch(
    "/api/admin/species/:id",
    requireRole("editor"),
    (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: "Invalid species id" });
          return;
        }
        const body = z
          .object({
            scientific: z.string().trim().min(1).max(200).optional(),
            common: z.string().trim().max(200).optional().nullable(),
            group: z.enum(["snakes", "lizards", "turtles", "crocs", "frogs"]).optional(),
            familyName: z.string().trim().max(120).optional().nullable(),
            genus: z.string().trim().max(120).optional().nullable(),
            authority: z.string().trim().max(200).optional().nullable(),
            description: z.string().trim().max(5000).optional().nullable(),
            hidden: z.boolean().optional(),
          })
          .parse(req.body);
        const existing = storage.getAdminSpeciesEntry(id);
        const catalogRow = CATALOG.find((c) => c.id === id);
        const source = existing?.source ?? (catalogRow ? "inat" : "manual");
        const row = storage.upsertAdminSpeciesEntry({
          id,
          source: source as any,
          scientific: body.scientific ?? existing?.scientific ?? catalogRow?.scientific,
          common: body.common !== undefined ? body.common : existing?.common ?? catalogRow?.common,
          group: body.group ?? existing?.group ?? catalogRow?.group ?? null,
          familyId: existing?.familyId ?? catalogRow?.familyId ?? null,
          familyName: body.familyName !== undefined ? body.familyName : existing?.familyName ?? catalogRow?.familyName ?? null,
          genus: body.genus !== undefined ? body.genus : existing?.genus ?? catalogRow?.genus ?? null,
          authority: body.authority !== undefined ? body.authority : existing?.authority,
          description: body.description !== undefined ? body.description : existing?.description,
          hidden: body.hidden !== undefined ? (body.hidden ? 1 : 0) : undefined,
          actorId: req.user!.id,
        });
        storage.logAdminAction(req.user!.id, "species.edit", "species", id, body);
        res.json({ species: row });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Could not update species" });
      }
    },
  );

  app.post(
    "/api/admin/species/:id/hide",
    requireRole("editor"),
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      const hide = req.body?.hidden !== false;
      const existing = storage.getAdminSpeciesEntry(id);
      const catalogRow = CATALOG.find((c) => c.id === id);
      const source = existing?.source ?? (catalogRow ? "catalog-hidden" : "manual");
      storage.upsertAdminSpeciesEntry({
        id,
        source: source as any,
        scientific: existing?.scientific ?? catalogRow?.scientific ?? "",
        common: existing?.common ?? catalogRow?.common ?? null,
        group: existing?.group ?? catalogRow?.group ?? null,
        familyId: existing?.familyId ?? catalogRow?.familyId ?? null,
        familyName: existing?.familyName ?? catalogRow?.familyName ?? null,
        genus: existing?.genus ?? catalogRow?.genus ?? null,
        hidden: hide ? 1 : 0,
        actorId: req.user!.id,
      });
      storage.logAdminAction(req.user!.id, hide ? "species.hide" : "species.unhide", "species", id, null);
      res.json({ ok: true, hidden: hide });
    },
  );

  app.delete(
    "/api/admin/species/:id",
    requireRole("editor"),
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      const existing = storage.getAdminSpeciesEntry(id);
      if (!existing) {
        res.json({ ok: true });
        return;
      }
      storage.deleteAdminSpeciesEntry(id);
      storage.logAdminAction(
        req.user!.id,
        "species.delete",
        "species",
        id,
        { source: existing.source, scientific: existing.scientific },
      );
      res.json({ ok: true });
    },
  );

  // ─────── Species articles ─────────────────────────────
  // Anyone can read; any signed-in user can upload. Uploader (or any
  // moderator+) can delete. PDFs come as base64 data URLs (≤ 10 MB).

  app.get(
    "/api/species/:speciesId/articles",
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.speciesId, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      const rows = storage.listArticlesForSpecies(speciesId);
      const authors = authorMap(rows.map((r) => r.uploaderUserId));
      res.json({
        articles: rows.map((r) => ({
          id: r.id,
          speciesId: r.speciesId,
          title: r.title,
          description: r.description,
          citation: r.citation,
          credit: r.credit,
          fileName: r.fileName,
          // Don't blast the (potentially huge) base64 PDF in the list payload;
          // expose only an `hasFile` boolean and a per-article download URL.
          hasFile: !!r.fileDataUrl,
          externalUrl: r.externalUrl,
          createdAt: r.createdAt,
          uploader: authors.get(r.uploaderUserId) ?? null,
        })),
      });
    },
  );

  // Stream the base64 PDF back as a real binary attachment.
  app.get(
    "/api/articles/:id/download",
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const article = storage.getArticleById(id);
      if (!article || !article.fileDataUrl) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const m = article.fileDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        res.status(500).json({ error: "Malformed file" });
        return;
      }
      const [, mime, b64] = m;
      const buf = Buffer.from(b64, "base64");
      const safeName = (article.fileName || `article-${id}.pdf`).replace(
        /[^A-Za-z0-9._\- ]/g,
        "_",
      );
      res.setHeader("Content-Type", mime || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${safeName}"`,
      );
      res.send(buf);
    },
  );

  const articleCreateSchema = z
    .object({
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(4000).optional().nullable(),
      citation: z.string().trim().min(1).max(2000),
      credit: z.string().trim().min(1).max(500),
      fileDataUrl: z.string().optional().nullable(),
      fileName: z.string().trim().max(255).optional().nullable(),
      externalUrl: z.string().trim().max(2000).optional().nullable(),
    })
    .refine(
      (v) =>
        (v.fileDataUrl && v.fileDataUrl.length) ||
        (v.externalUrl && v.externalUrl.length),
      { message: "Provide a PDF or a link" },
    );

  app.post(
    "/api/species/:speciesId/articles",
    requireAuth,
    (req: Request, res: Response) => {
      try {
        const speciesId = parseInt(req.params.speciesId, 10);
        if (!Number.isFinite(speciesId)) {
          res.status(400).json({ error: "Invalid species id" });
          return;
        }
        const body = articleCreateSchema.parse(req.body);

        // Validate file: must be a PDF data URL, ≤ 10 MB raw
        let fileDataUrl: string | null = null;
        let fileName: string | null = null;
        if (body.fileDataUrl) {
          const m = body.fileDataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!m) {
            res.status(400).json({ error: "File must be a base64 data URL" });
            return;
          }
          const [, mime, b64] = m;
          if (mime !== "application/pdf") {
            res.status(400).json({ error: "Only PDF files are accepted" });
            return;
          }
          // base64 string length ≈ 4/3 of raw size; cap raw bytes at 10 MB.
          const approxBytes = Math.floor((b64.length * 3) / 4);
          if (approxBytes > 10 * 1024 * 1024) {
            res.status(413).json({ error: "PDF must be 10 MB or smaller" });
            return;
          }
          fileDataUrl = body.fileDataUrl;
          fileName = body.fileName?.trim() || "article.pdf";
        }

        // Validate external URL if provided
        let externalUrl: string | null = null;
        if (body.externalUrl) {
          const trimmed = body.externalUrl.trim();
          // accept https URLs or DOI strings (10.xxxx/...)
          const looksLikeUrl = /^https?:\/\//i.test(trimmed);
          const looksLikeDoi = /^10\.\d{4,9}\/\S+$/i.test(trimmed);
          if (!looksLikeUrl && !looksLikeDoi) {
            res.status(400).json({
              error: "Link must be an https URL or a DOI (10.xxxx/...)",
            });
            return;
          }
          externalUrl = looksLikeDoi
            ? `https://doi.org/${trimmed}`
            : trimmed;
        }

        const created = storage.createSpeciesArticle({
          speciesId,
          uploaderUserId: req.user!.id,
          title: body.title,
          description: body.description ?? null,
          citation: body.citation,
          credit: body.credit,
          fileDataUrl,
          fileName,
          externalUrl,
        });

        const uploader = authorMap([created.uploaderUserId]).get(
          created.uploaderUserId,
        );
        res.json({
          article: {
            id: created.id,
            speciesId: created.speciesId,
            title: created.title,
            description: created.description,
            citation: created.citation,
            credit: created.credit,
            fileName: created.fileName,
            hasFile: !!created.fileDataUrl,
            externalUrl: created.externalUrl,
            createdAt: created.createdAt,
            uploader: uploader ?? null,
          },
        });
      } catch (err: any) {
        res
          .status(400)
          .json({ error: err?.message || "Failed to upload article" });
      }
    },
  );

  app.delete(
    "/api/articles/:id",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const article = storage.getArticleById(id);
      if (!article) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const me = req.user!;
      const isUploader = article.uploaderUserId === me.id;
      const isMod =
        ROLE_LEVEL[(me.role as UserRole) ?? "none"] >= ROLE_LEVEL.moderator;
      if (!isUploader && !isMod) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      storage.deleteSpeciesArticle(id);
      if (isMod && !isUploader) {
        storage.logAdminAction(
          me.id,
          "species_article.remove",
          "species_article",
          id,
          { title: article.title, speciesId: article.speciesId },
        );
      }
      res.json({ ok: true });
    },
  );

  app.patch(
    "/api/admin/species/:speciesId",
    requireCapability("editSpecies"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.speciesId, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      try {
        const body = speciesOverridePatchSchema.parse(req.body);
        const updated = storage.upsertSpeciesOverride(speciesId, req.user!.id, body);
        storage.logAdminAction(
          req.user!.id,
          "species.override",
          "species",
          speciesId,
          JSON.stringify(body),
        );
        res.json({ override: updated });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Update failed" });
      }
    },
  );

  app.post(
    "/api/admin/species/:speciesId/hide-photo",
    requireCapability("hidePhotos"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.speciesId, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      try {
        const body = photoUrlSchema.parse(req.body);
        const updated = storage.hideSpeciesPhoto(speciesId, req.user!.id, body.photoUrl);
        storage.logAdminAction(
          req.user!.id,
          "species.hide-photo",
          "species",
          speciesId,
          JSON.stringify({ photoUrl: body.photoUrl }),
        );
        res.json({ override: updated });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Hide failed" });
      }
    },
  );

  app.post(
    "/api/admin/species/:speciesId/unhide-photo",
    requireCapability("hidePhotos"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.speciesId, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      try {
        const body = photoUrlSchema.parse(req.body);
        const updated = storage.unhideSpeciesPhoto(speciesId, req.user!.id, body.photoUrl);
        storage.logAdminAction(
          req.user!.id,
          "species.unhide-photo",
          "species",
          speciesId,
          JSON.stringify({ photoUrl: body.photoUrl }),
        );
        res.json({ override: updated ?? null });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Unhide failed" });
      }
    },
  );

  /**
   * Admin: pin a specific iNat taxon photo as the species hero, or clear the
   * pin by passing photoUrl=null. The pin overrides the default precedence
   * (top-rated user record → first observation → default photo).
   */
  app.post(
    "/api/admin/species/:speciesId/force-hero-photo",
    requireCapability("hidePhotos"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.speciesId, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      try {
        const body = z
          .object({ photoUrl: z.string().min(1).max(2000).nullable() })
          .parse(req.body);
        const updated = storage.upsertSpeciesOverride(speciesId, req.user!.id, {
          forcedHeroPhotoUrl: body.photoUrl,
        });
        storage.logAdminAction(
          req.user!.id,
          body.photoUrl ? "species.force-hero-photo" : "species.clear-hero-photo",
          "species",
          speciesId,
          JSON.stringify({ photoUrl: body.photoUrl }),
        );
        res.json({ override: updated });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "Force-hero failed" });
      }
    },
  );

  // ───────── Notifications ─────────

  // GET /api/notifications?limit=&unread=1
  app.get("/api/notifications", requireAuth, (req: Request, res: Response) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const unreadOnly = String(req.query.unread ?? "") === "1";
    const rows = storage.listNotifications(req.user!.id, { limit, unreadOnly });
    const actors = authorMap(rows.map((n) => n.actorId));
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        recordId: n.recordId,
        commentId: n.commentId,
        snippet: n.snippet,
        readAt: n.readAt,
        createdAt: n.createdAt,
        actor: actors.get(n.actorId) ?? null,
      })),
      unreadCount: storage.countUnreadNotifications(req.user!.id),
    });
  });

  // GET /api/notifications/unread-count — cheap polling endpoint
  app.get(
    "/api/notifications/unread-count",
    requireAuth,
    (req: Request, res: Response) => {
      res.json({ unreadCount: storage.countUnreadNotifications(req.user!.id) });
    },
  );

  // POST /api/notifications/:id/read
  app.post(
    "/api/notifications/:id/read",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      storage.markNotificationRead(id, req.user!.id);
      res.json({
        ok: true,
        unreadCount: storage.countUnreadNotifications(req.user!.id),
      });
    },
  );

  // POST /api/notifications/:id/unread
  app.post(
    "/api/notifications/:id/unread",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      storage.markNotificationUnread(id, req.user!.id);
      res.json({
        ok: true,
        unreadCount: storage.countUnreadNotifications(req.user!.id),
      });
    },
  );

  // POST /api/notifications/read-all
  app.post(
    "/api/notifications/read-all",
    requireAuth,
    (req: Request, res: Response) => {
      storage.markAllNotificationsRead(req.user!.id);
      res.json({ ok: true, unreadCount: 0 });
    },
  );

  // DELETE /api/notifications/:id
  app.delete(
    "/api/notifications/:id",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      storage.deleteNotification(id, req.user!.id);
      res.json({
        ok: true,
        unreadCount: storage.countUnreadNotifications(req.user!.id),
      });
    },
  );

  // ───────── Observation notes ─────────

  app.post("/api/notes", requireAuth, (req: Request, res: Response) => {
    try {
      const body = noteCreateSchema.parse(req.body);
      const created = storage.createNote({
        userId: req.user!.id,
        speciesId: body.speciesId ?? null,
        parentSpeciesId: body.parentSpeciesId ?? null,
        speciesName: body.speciesName ?? null,
        speciesCommon: body.speciesCommon ?? null,
        groupKey: body.groupKey ?? null,
        familyId: body.familyId ?? null,
        familyName: body.familyName ?? null,
        genus: body.genus ?? null,
        title: body.title ?? null,
        body: body.body,
      } as any);
      const author = authorMap([created.userId]).get(created.userId);
      res.json({ note: publicNote(created, author, req.user!.id) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Create note failed" });
    }
  });

  app.get("/api/notes", (req: Request, res: Response) => {
    const notes = storage.listAllNotes(60);
    const authors = authorMap(notes.map((n) => n.userId));
    const viewerId = req.user?.id;
    res.json({ notes: enrichNotesForList(notes, viewerId, authors) });
  });

  app.get("/api/notes/feed", requireAuth, (req: Request, res: Response) => {
    const ids = storage.listFollowing(req.user!.id);
    ids.push(req.user!.id);
    const notes = storage.listNotesByUserIds(ids, 60);
    const authors = authorMap(notes.map((n) => n.userId));
    const viewerId = req.user!.id;
    res.json({ notes: enrichNotesForList(notes, viewerId, authors) });
  });

  app.get("/api/notes/:id", (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const author = authorMap([n.userId]).get(n.userId);
    const viewerId = req.user?.id;
    res.json({
      note: publicNote(n, author, viewerId, {
        likeCount: storage.countNoteLikes(id),
        commentCount: storage.countCommentsForNotes([id]).get(id) ?? 0,
        likedByMe: viewerId ? storage.hasLikedNote(id, viewerId) : false,
      }),
    });
  });

  app.patch("/api/notes/:id", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (n.userId !== req.user!.id) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    try {
      const body = noteEditSchema.parse(req.body);
      const updated = storage.updateNote(id, body as any);
      if (!updated) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      const author = authorMap([updated.userId]).get(updated.userId);
      const viewerId = req.user!.id;
      res.json({
        note: publicNote(updated, author, viewerId, {
          likeCount: storage.countNoteLikes(id),
          commentCount: storage.countCommentsForNotes([id]).get(id) ?? 0,
          likedByMe: storage.hasLikedNote(id, viewerId),
        }),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Edit note failed" });
    }
  });

  app.delete("/api/notes/:id", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const isOwner = n.userId === req.user!.id;
    if (!isOwner) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    storage.deleteNote(id);
    res.json({ ok: true });
  });

  app.get("/api/species/:speciesId/notes", (req: Request, res: Response) => {
    const sid = parseInt(req.params.speciesId, 10);
    if (!Number.isFinite(sid)) {
      res.status(400).json({ error: "Invalid speciesId" });
      return;
    }
    const notes = storage.listNotesBySpecies(sid, 100);
    const authors = authorMap(notes.map((n) => n.userId));
    const viewerId = req.user?.id;
    res.json({ notes: enrichNotesForList(notes, viewerId, authors) });
  });

  app.get("/api/users/:username/notes", (req: Request, res: Response) => {
    const u = storage.getUserByUsername(req.params.username);
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const notes = storage.listNotesByUser(u.id, 100);
    const authors = authorMap([u.id]);
    const viewerId = req.user?.id;
    res.json({ notes: enrichNotesForList(notes, viewerId, authors) });
  });

  // ───────── Note likes ─────────
  app.post("/api/notes/:id/like", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    storage.likeNote(id, req.user!.id);
    storage.createNotification({
      recipientId: n.userId,
      actorId: req.user!.id,
      type: "note_like",
      noteId: id,
    });
    res.json({ liked: true, likeCount: storage.countNoteLikes(id) });
  });

  app.delete("/api/notes/:id/like", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    storage.unlikeNote(id, req.user!.id);
    storage.removeLikeNotification({
      recipientId: n.userId,
      actorId: req.user!.id,
      type: "note_like",
      noteId: id,
    });
    res.json({ liked: false, likeCount: storage.countNoteLikes(id) });
  });

  // ───────── Note comments ─────────
  app.get("/api/notes/:id/comments", (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const rows = storage.listNoteComments(id);
    const authors = authorMap(rows.map((c) => c.userId));
    const cIds = rows.map((c) => c.id);
    const likeCounts = storage.countLikesForNoteComments(cIds);
    const likedByMe = req.user
      ? storage.noteCommentLikesByViewer(cIds, req.user.id)
      : new Set<number>();
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        noteId: c.noteId,
        parentId: (c as any).parentId ?? null,
        body: c.body,
        createdAt: c.createdAt,
        user: authors.get(c.userId) ?? null,
        likeCount: likeCounts.get(c.id) ?? 0,
        likedByMe: likedByMe.has(c.id),
      })),
    });
  });

  app.post("/api/notes/:id/comments", requireAuth, (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const n = storage.getNote(id);
    if (!n) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    try {
      const body = noteCommentSchema.parse(req.body);
      let parentId: number | null = body.parentId ?? null;
      if (parentId != null) {
        const parent = storage.getNoteComment(parentId);
        if (!parent || parent.noteId !== id) {
          res.status(400).json({ error: "Invalid parent comment" });
          return;
        }
        if ((parent as any).parentId) parentId = (parent as any).parentId;
      }
      const created = storage.addNoteComment(id, req.user!.id, body.body, parentId);
      const author = authorMap([created.userId]).get(created.userId);
      const snippet = body.body.slice(0, 140);
      if (parentId != null) {
        const parent = storage.getNoteComment(parentId);
        if (parent && parent.userId !== req.user!.id) {
          storage.createNotification({
            recipientId: parent.userId,
            actorId: req.user!.id,
            type: "note_comment_reply",
            noteId: id,
            commentId: created.id,
            snippet,
          });
        }
        if (n.userId !== req.user!.id && (!parent || n.userId !== parent.userId)) {
          storage.createNotification({
            recipientId: n.userId,
            actorId: req.user!.id,
            type: "note_comment",
            noteId: id,
            commentId: created.id,
            snippet,
          });
        }
      } else if (n.userId !== req.user!.id) {
        storage.createNotification({
          recipientId: n.userId,
          actorId: req.user!.id,
          type: "note_comment",
          noteId: id,
          commentId: created.id,
          snippet,
        });
      }
      res.json({
        comment: {
          id: created.id,
          noteId: created.noteId,
          parentId: (created as any).parentId ?? null,
          body: created.body,
          createdAt: created.createdAt,
          user: author ?? null,
          likeCount: 0,
          likedByMe: false,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Comment failed" });
    }
  });

  app.delete(
    "/api/notes/:id/comments/:commentId",
    requireAuth,
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const cid = parseInt(req.params.commentId, 10);
      const c = storage.getNoteComment(cid);
      if (!c || c.noteId !== id) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      const n = storage.getNote(id);
      const isCommenter = c.userId === req.user!.id;
      const isOwner = n?.userId === req.user!.id;
      const canDelete = storage.hasCapability(req.user, "deleteComments");
      if (!isCommenter && !isOwner && !canDelete) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      storage.deleteNoteComment(cid);
      res.json({ ok: true });
    },
  );

  // ───────── Note comment likes ─────────
  app.post(
    "/api/note-comments/:cid/like",
    requireAuth,
    (req: Request, res: Response) => {
      const cid = parseInt(req.params.cid, 10);
      const c = storage.getNoteComment(cid);
      if (!c) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      storage.likeNoteComment(cid, req.user!.id);
      storage.createNotification({
        recipientId: c.userId,
        actorId: req.user!.id,
        type: "note_comment_like",
        noteId: c.noteId,
        commentId: cid,
      });
      res.json({
        liked: true,
        likeCount: storage.countNoteCommentLikes(cid),
      });
    },
  );

  app.delete(
    "/api/note-comments/:cid/like",
    requireAuth,
    (req: Request, res: Response) => {
      const cid = parseInt(req.params.cid, 10);
      const c = storage.getNoteComment(cid);
      if (!c) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      storage.unlikeNoteComment(cid, req.user!.id);
      storage.removeLikeNotification({
        recipientId: c.userId,
        actorId: req.user!.id,
        type: "note_comment_like",
        noteId: c.noteId,
        commentId: cid,
      });
      res.json({
        liked: false,
        likeCount: storage.countNoteCommentLikes(cid),
      });
    },
  );

  // ───────── Distribution maps ─────────
  registerDistributionRoutes(app, CATALOG, SUBCATALOG);
}

// Shared catalog entry shape used by distribution routes (mirrors the
// local interfaces above so we don't re-export them from this module).
type _CatalogLike = {
  id: number;
  scientific: string;
  common: string | null;
  group: string | null;
};
type _SubcatalogLike = _CatalogLike & {
  parentId: number;
  parentScientific: string;
  parentCommon: string | null;
};

function safeParseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function registerDistributionRoutes(
  app: Express,
  CATALOG: _CatalogLike[],
  SUBCATALOG: _SubcatalogLike[],
): void {
  function resolveScientificFromCatalog(id: number): string | null {
    const c = CATALOG.find((e) => e.id === id);
    if (c) return c.scientific;
    const s = SUBCATALOG.find((e) => e.id === id);
    if (s) return s.scientific;
    return null;
  }

  // Routes are added below in separate edits.
  registerDistributionPublicRoute(app);
  registerDistributionImportRoutes(app, resolveScientificFromCatalog);
  registerDistributionEditRoutes(app);
}

/**
 * Public: GET /api/species/:id/distribution-grid
 *   - Aggregates observed records into 0.5° cells (minus hidden)
 *   - Merges admin overrides (present=true ADDS, present=false REMOVES)
 *   - Returns polygons; optional ?points=1 includes raw points (admin view)
 */
function registerDistributionPublicRoute(app: Express): void {
  app.get(
    "/api/species/:id/distribution-grid",
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      const includePoints = req.query.points === "1";
      const observed = storage.aggregateSpeciesGrid(speciesId);
      const overrides = storage.getRangeCells(speciesId);
      const polygons = storage.getRangePolygons(speciesId);

      const cellsMap = new Map<
        string,
        {
          latIdx: number;
          lngIdx: number;
          count: number;
          source: "observed" | "admin";
        }
      >();
      for (const [k, c] of observed.entries()) {
        const [latIdx, lngIdx] = k.split(",").map(Number);
        cellsMap.set(k, { latIdx, lngIdx, count: c, source: "observed" });
      }
      for (const o of overrides) {
        const k = `${o.cellLatIdx},${o.cellLngIdx}`;
        if (o.present) {
          const ex = cellsMap.get(k);
          cellsMap.set(k, {
            latIdx: o.cellLatIdx,
            lngIdx: o.cellLngIdx,
            count: ex?.count ?? 0,
            source: "admin",
          });
        } else {
          cellsMap.delete(k);
        }
      }

      const cells = Array.from(cellsMap.values());
      const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0);

      let points:
        | Array<{
            id: number;
            lat: number;
            lng: number;
            date: string | null;
            source: string;
          }>
        | undefined;
      if (includePoints) {
        const rows = storage.getSpeciesRecords(speciesId, { limit: 10000 });
        points = rows.map((r) => ({
          id: r.id,
          lat: r.lat,
          lng: r.lng,
          date: r.date,
          source: r.source,
        }));
        // Also surface Hunt Herpetology field records on the admin map
        // so admins can see exactly which user observations are placed
        // where (and hide individual ones via the existing hide tool).
        const fieldRows = storage.getFieldRecordPoints(speciesId);
        for (const f of fieldRows) {
          points.push({
            id: f.id,
            lat: f.lat,
            lng: f.lng,
            date: f.date,
            source: "app",
          });
        }
      }

      res.json({
        speciesId,
        cellSize: 0.5,
        cells,
        maxCount,
        polygons: polygons.map((p) => ({
          id: p.id,
          polygon: safeParseJson(p.polygonJson, [] as Array<[number, number]>),
          label: p.label,
        })),
        ...(points ? { points } : {}),
      });
    },
  );
}

/**
 * Admin: bulk import + per-species re-import + progress + cancel.
 */
function registerDistributionImportRoutes(
  app: Express,
  resolveScientificFromCatalog: (id: number) => string | null,
): void {
  app.post(
    "/api/admin/distribution/import",
    requireCapability("editDistribution"),
    async (req: Request, res: Response) => {
      const sources = Array.isArray(req.body?.sources)
        ? (req.body.sources as Array<"inat" | "ala">)
        : undefined;
      const result = startBulkImport({
        triggeredBy: req.user!.id,
        sources,
      });
      const job = storage.getImportJob();
      res.json({ ...result, job });
    },
  );

  app.get(
    "/api/admin/distribution/import",
    requireCapability("editDistribution"),
    (_req: Request, res: Response) => {
      const job = storage.getImportJob();
      res.json({
        job,
        running: isJobRunning(),
        catalogSize: getCatalogSize(),
      });
    },
  );

  app.post(
    "/api/admin/distribution/import/cancel",
    requireCapability("editDistribution"),
    (_req: Request, res: Response) => {
      cancelJob();
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/admin/distribution/species/:id/import",
    requireCapability("editDistribution"),
    async (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      const scientific =
        typeof req.body?.scientific === "string" && req.body.scientific.trim()
          ? req.body.scientific.trim()
          : resolveScientificFromCatalog(speciesId);
      if (!scientific) {
        res.status(400).json({ error: "Missing scientific name" });
        return;
      }
      const sources = Array.isArray(req.body?.sources)
        ? (req.body.sources as Array<"inat" | "ala">)
        : undefined;
      if (req.body?.replace) {
        storage.deleteSpeciesRecords(speciesId);
      }
      try {
        const result = await importSpecies({
          speciesId,
          scientific,
          sources,
        });
        res.json(result);
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    },
  );

  app.get(
    "/api/admin/distribution/species/:id/stats",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      if (!Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid species id" });
        return;
      }
      res.json({
        speciesId,
        recordCount: storage.countSpeciesRecords(speciesId),
        hiddenCount: storage.getHiddenRecordIds(speciesId).size,
        cellOverrideCount: storage.getRangeCells(speciesId).length,
        polygonCount: storage.getRangePolygons(speciesId).length,
      });
    },
  );
}

/**
 * Admin: grid cell upsert/delete, polygon CRUD, hide/unhide record.
 */
function registerDistributionEditRoutes(app: Express): void {
  app.post(
    "/api/admin/distribution/species/:id/cells",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      const latIdx = Number(req.body?.latIdx);
      const lngIdx = Number(req.body?.lngIdx);
      const present = !!req.body?.present;
      if (
        !Number.isFinite(speciesId) ||
        !Number.isInteger(latIdx) ||
        !Number.isInteger(lngIdx)
      ) {
        res.status(400).json({ error: "Invalid cell parameters" });
        return;
      }
      const row = storage.upsertRangeCell({
        speciesId,
        cellLatIdx: latIdx,
        cellLngIdx: lngIdx,
        present,
        createdBy: req.user!.id,
      });
      res.json(row);
    },
  );

  app.delete(
    "/api/admin/distribution/species/:id/cells/:latIdx/:lngIdx",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      const latIdx = parseInt(req.params.latIdx, 10);
      const lngIdx = parseInt(req.params.lngIdx, 10);
      const changes = storage.deleteRangeCell(speciesId, latIdx, lngIdx);
      res.json({ changes });
    },
  );

  app.post(
    "/api/admin/distribution/species/:id/polygons",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const speciesId = parseInt(req.params.id, 10);
      const polygon = req.body?.polygon;
      const label = typeof req.body?.label === "string" ? req.body.label : null;
      if (!Array.isArray(polygon) || polygon.length < 3) {
        res
          .status(400)
          .json({ error: "Polygon must be an array of at least 3 [lng,lat] points" });
        return;
      }
      const row = storage.insertRangePolygon({
        speciesId,
        polygonJson: JSON.stringify(polygon),
        label,
        createdBy: req.user!.id,
      });
      res.json({
        id: row.id,
        polygon: safeParseJson(row.polygonJson, [] as Array<[number, number]>),
        label: row.label,
      });
    },
  );

  app.delete(
    "/api/admin/distribution/polygons/:id",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      const changes = storage.deleteRangePolygon(id);
      res.json({ changes });
    },
  );

  app.post(
    "/api/admin/distribution/hide-record",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const recordId = Number(req.body?.recordId);
      const speciesId = Number(req.body?.speciesId);
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason : null;
      if (!Number.isFinite(recordId) || !Number.isFinite(speciesId)) {
        res.status(400).json({ error: "Invalid recordId/speciesId" });
        return;
      }
      const row = storage.hideRecord({
        recordId,
        speciesId,
        hiddenBy: req.user!.id,
        reason,
      });
      res.json({ hidden: true, alreadyHidden: !row });
    },
  );

  app.delete(
    "/api/admin/distribution/hide-record/:recordId",
    requireCapability("editDistribution"),
    (req: Request, res: Response) => {
      const recordId = parseInt(req.params.recordId, 10);
      const changes = storage.unhideRecord(recordId);
      res.json({ changes });
    },
  );
}
