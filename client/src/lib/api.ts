/**
 * Typed API client for the Australian Herpetology backend.
 * All requests go through apiRequest (relative paths) so they survive deploy.
 */
import { apiRequest } from "@/lib/queryClient";

export interface SpeciesPhoto {
  url: string;
  medium_url?: string;
  large_url?: string;
  license_code: string | null;
  attribution: string | null;
}

export interface SpeciesCountResult {
  count: number;
  taxon: {
    id: number;
    name: string;
    preferred_common_name?: string;
    rank: string;
    iconic_taxon_name?: string;
    default_photo?: SpeciesPhoto | null;
    /**
     * Server-resolved primary hero URL for this species (admin-forced →
     * admin-pinned record → top-liked record). When present, list views
     * should prefer this over default_photo to stay visually consistent
     * with the Species detail page. Absent when no user hero exists.
     */
    hero_photo_url?: string | null;
    wikipedia_url?: string | null;
    observations_count?: number;
    ancestor_ids?: number[];
  };
}

export interface SpeciesListResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: SpeciesCountResult[];
}

export interface TaxonDetailResult {
  id: number;
  name: string;
  rank: string;
  preferred_common_name?: string;
  wikipedia_url?: string | null;
  wikipedia_summary?: string | null;
  iconic_taxon_name?: string;
  observations_count?: number;
  conservation_status?: { status_name?: string; place?: { name?: string } } | null;
  default_photo?: SpeciesPhoto | null;
  taxon_photos?: { photo: SpeciesPhoto; taxon: { name: string } }[];
  ancestors?: { rank: string; name: string; id: number }[];
  /**
   * Taxonomic authority (author + year), e.g. "(Gray, 1841)" or "Linnaeus, 1758".
   * Server-side merged: admin override (highest priority) → ALA scientificNameAuthorship → null.
   * Client falls back to a regex extract on the wikipedia summary when this is null.
   */
  authority?: string | null;
  /**
   * National (EPBC) + per-state conservation listings, sourced from ALA's
   * BIE species endpoint. Keys: AUS (federal) + state/territory codes.
   * Empty object when ALA has no listing (i.e. Least Concern / unlisted).
   */
  conservation_statuses_au?: Partial<
    Record<
      "AUS" | "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA",
      { status: string; dr?: string }
    >
  >;
}

export interface TaxonDetailResponse {
  total_results: number;
  results: TaxonDetailResult[];
}

export interface ObservationResult {
  id: number;
  observed_on: string | null;
  place_guess: string | null;
  location: string | null;
  user?: { login: string; name?: string };
  photos: Array<{
    id: number;
    url: string;
    license_code: string | null;
    attribution: string | null;
  }>;
  // iNat’s community-supported taxon (set when 2+ identifications agree)
  community_taxon_id?: number | null;
  taxon?: { id?: number } | null;
  // Per-observation identifications. The top identifier is derived from this.
  identifications?: Array<{
    id: number;
    current: boolean;
    created_at?: string | null;
    taxon_id?: number | null;
    taxon?: { id?: number } | null;
    user?: { id?: number; login?: string; name?: string | null } | null;
  }>;
}

export interface ObservationsResponse {
  total_results: number;
  results: ObservationResult[];
}

export interface DistributionPoint {
  id: number;
  lat: number;
  lng: number;
  date: string | null;
  place: string | null;
}

export interface DistributionResponse {
  total: number;
  returned: number;
  points: DistributionPoint[];
}

export interface AreaSpecies {
  guid: string;
  count: number;
  scientificName: string;
  commonName: string | null;
  class: string | null;
  inatId: number | null;
  inatPhoto: string | null;
}

export interface AreaSpeciesResponse {
  center: { lat: number; lng: number };
  radius: number;
  totalRecords: number;
  species: AreaSpecies[];
}

export type SpeciesGroup =
  | "all"
  | "reptiles"
  | "amphibians"
  | "snakes"
  | "lizards"
  | "turtles"
  | "crocs"
  | "frogs";

export async function fetchSpecies(
  q: string,
  group: SpeciesGroup,
  page: number,
  perPage = 30,
  /** Optional explicit iNat taxon id — overrides group on the server (family/genus drill-down). */
  taxonId?: number | string,
): Promise<SpeciesListResponse> {
  const params = new URLSearchParams({
    q,
    group,
    page: String(page),
    per_page: String(perPage),
  });
  if (taxonId !== undefined && taxonId !== null && taxonId !== "") {
    params.set("taxon_id", String(taxonId));
  }
  const res = await apiRequest("GET", `/api/species?${params}`);
  return res.json();
}

export async function fetchTaxon(id: string | number): Promise<TaxonDetailResponse> {
  const res = await apiRequest("GET", `/api/taxon/${id}`);
  return res.json();
}

export async function fetchObservations(
  taxonId: string | number,
  perPage = 12,
): Promise<ObservationsResponse> {
  const res = await apiRequest(
    "GET",
    `/api/observations/${taxonId}?per_page=${perPage}`,
  );
  return res.json();
}

export async function fetchDistribution(
  taxonId: string | number,
): Promise<DistributionResponse> {
  const res = await apiRequest("GET", `/api/distribution/${taxonId}`);
  return res.json();
}

export interface AuthorityResponse {
  name: string;
  guid?: string;
  author: string | null;
  rank: string | null;
  family: string | null;
  order: string | null;
  class: string | null;
}

export async function fetchAuthority(name: string): Promise<AuthorityResponse> {
  const res = await apiRequest(
    "GET",
    `/api/authority?name=${encodeURIComponent(name)}`,
  );
  return res.json();
}

// --- Morphology --------------------------------------------------------------

export type MorphologyGroup = "snake" | "lizard" | "amphibian";

export interface MorphologyField {
  value: string;
  source: string;
}

export interface MorphologyResponse {
  name: string;
  group: MorphologyGroup;
  fields: {
    totalLength?: MorphologyField | null;
    snoutVent?: MorphologyField | null;
    dorsalScales?: MorphologyField | null;
    ventralScales?: MorphologyField | null;
    subcaudalScales?: MorphologyField | null;
    analScale?: MorphologyField | null;
    size?: MorphologyField | null;
  };
  sourceUrl: string | null;
}

export async function fetchMorphology(
  name: string,
  group: MorphologyGroup,
): Promise<MorphologyResponse> {
  const res = await apiRequest(
    "GET",
    `/api/morphology?name=${encodeURIComponent(name)}&group=${group}`,
  );
  return res.json();
}

/**
 * Classify an iNat/ALA taxon into snake | lizard | amphibian, returning null
 * when we can't determine the group (in which case the morphology section is
 * hidden).
 *
 * Heuristics:
 *   - class Amphibia                          → amphibian
 *   - class Reptilia + order Squamata + family/suborder containing "snake"
 *     keywords (Elapidae, Pythonidae, Boidae, Colubridae, Typhlopidae,
 *     Hydrophiinae, Acrochordidae) → snake
 *   - class Reptilia + order Squamata otherwise → lizard
 *   - class Reptilia + order Testudines or Crocodylia → null (no morphology yet)
 */
export function classifyHerp(
  className: string | null | undefined,
  order: string | null | undefined,
  family: string | null | undefined,
): MorphologyGroup | null {
  const c = (className || "").toLowerCase();
  const o = (order || "").toLowerCase();
  const f = (family || "").toLowerCase();
  if (c === "amphibia") return "amphibian";
  if (c !== "reptilia") return null;
  if (o !== "squamata") return null; // turtles, crocs not handled
  const SNAKE_FAMILIES = [
    "elapidae",
    "pythonidae",
    "boidae",
    "colubridae",
    "typhlopidae",
    "hydrophiinae",
    "hydrophiidae",
    "acrochordidae",
    "laticaudidae",
    "homalopsidae",
  ];
  if (SNAKE_FAMILIES.includes(f)) return "snake";
  return "lizard";
}

export async function fetchAreaSpecies(
  lat: number,
  lng: number,
  radiusKm: number,
  group: SpeciesGroup = "all",
): Promise<AreaSpeciesResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(radiusKm),
    group,
    limit: "60",
  });
  const res = await apiRequest("GET", `/api/area-species?${params}`);
  return res.json();
}

// --- helpers -----------------------------------------------------------------

const LICENSE_MAP: Record<string, { label: string; url: string }> = {
  cc0: { label: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  "cc-by": { label: "CC BY", url: "https://creativecommons.org/licenses/by/4.0/" },
  "cc-by-nc": { label: "CC BY-NC", url: "https://creativecommons.org/licenses/by-nc/4.0/" },
  "cc-by-sa": { label: "CC BY-SA", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  "cc-by-nd": { label: "CC BY-ND", url: "https://creativecommons.org/licenses/by-nd/4.0/" },
  "cc-by-nc-sa": { label: "CC BY-NC-SA", url: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  "cc-by-nc-nd": { label: "CC BY-NC-ND", url: "https://creativecommons.org/licenses/by-nc-nd/4.0/" },
};

export function licenseInfo(code: string | null | undefined) {
  if (!code) return { label: "All rights reserved", url: null };
  return LICENSE_MAP[code] || { label: code.toUpperCase(), url: null };
}

/** Replace iNat 'square' photo URL with a higher-res one. */
export function biggerPhoto(url: string | undefined | null, size: "medium" | "large" = "medium") {
  if (!url) return null;
  return url.replace(/\/square\./, `/${size}.`).replace(/\/small\./, `/${size}.`);
}

/** Strip iNat HTML tags from wikipedia summary text. */
export function cleanSummary(html: string | null | undefined) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// =============================================================================
// User accounts, records, suggestions, follows
// =============================================================================

export type UserRole =
  | "none"
  | "moderator"
  | "editor"
  | "admin"
  | "super-admin";

export const ROLE_RANK: Record<UserRole, number> = {
  none: 0,
  moderator: 1,
  editor: 2,
  admin: 3,
  "super-admin": 4,
};

export function hasRoleAtLeast(
  user: { role?: UserRole | null } | null | undefined,
  min: UserRole,
): boolean {
  const r = (user?.role ?? "none") as UserRole;
  return ROLE_RANK[r] >= ROLE_RANK[min];
}

// ───── Admin capabilities (overlay on roles) ─────

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

export const CAPABILITY_LABELS: Record<AdminCapability, string> = {
  deleteComments: "Delete any user's comments",
  editRecords: "Edit any user's records",
  deleteRecords: "Delete any record",
  editSpecies: "Edit species profiles",
  hidePhotos: "Hide photos from species pages",
  editDistribution: "Edit distribution maps (import, grid, polygons, hide points)",
  manageRoles: "Manage roles & permissions",
};

export const ROLE_DEFAULT_CAPABILITIES: Record<UserRole, CapabilityMap> = {
  none: {},
  moderator: { deleteComments: true },
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

export interface AppUser {
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
  role?: UserRole;
  createdAt: number;
  capabilities?: Record<AdminCapability, boolean>;
  followerCount?: number;
  followingCount?: number;
  recordCount?: number;
  isFollowing?: boolean;
}

export type LicenseCode =
  | "none"
  | "all-rights-reserved"
  | "cc-by"
  | "cc-by-nc"
  | "cc-by-sa";

export type ConditionTag =
  | "wild"
  | "captive"
  | "relocated"
  | "roadkill"
  | "rescue";

export const LICENSE_OPTIONS: { value: LicenseCode; label: string; short: string }[] = [
  { value: "all-rights-reserved", label: "All rights reserved (©)", short: "© All rights reserved" },
  { value: "cc-by", label: "Creative Commons — Attribution (CC BY)", short: "CC BY" },
  { value: "cc-by-nc", label: "Creative Commons — Attribution, Non-Commercial (CC BY-NC)", short: "CC BY-NC" },
  { value: "cc-by-sa", label: "Creative Commons — Attribution, Share-Alike (CC BY-SA)", short: "CC BY-SA" },
  { value: "none", label: "No license specified", short: "No license" },
];

export const CONDITION_OPTIONS: { value: ConditionTag; label: string; icon: string }[] = [
  { value: "wild", label: "In the wild", icon: "🌿" },
  { value: "captive", label: "Captive", icon: "🏠" },
  { value: "relocated", label: "Relocated", icon: "🚚" },
  { value: "roadkill", label: "Roadkill", icon: "💀" },
  { value: "rescue", label: "Rescue / Rehab", icon: "⚕️" },
];

export const BEHAVIOUR_OPTIONS: { value: string; label: string }[] = [
  { value: "basking", label: "Basking" },
  { value: "foraging", label: "Foraging" },
  { value: "hunting", label: "Hunting" },
  { value: "sheltering", label: "Sheltering" },
  { value: "mating", label: "Mating" },
  { value: "gravid", label: "Gravid" },
  { value: "shedding", label: "Shedding" },
  { value: "defensive", label: "Defensive" },
  { value: "moving", label: "Moving / active" },
  { value: "dead", label: "Dead" },
];

export interface AppRecord {
  id: number;
  userId: number;
  speciesId: number | null;
  speciesName: string | null;
  speciesCommon: string | null;
  notes: string | null;
  photoDataUrl: string;
  photos: string[];
  lat: string | null;
  lng: string | null;
  placeGuess: string | null;
  observedOn: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  fNumber: string | null;
  shutter: string | null;
  focalLength: string | null;
  groupKey: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
  obscureLocation: boolean;
  obscured: boolean;
  licenseCode: LicenseCode | null;
  conditionTag: ConditionTag | null;
  behaviors: string[];
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  createdAt: number;
  author: AppUser | null;
}

export interface AppComment {
  id: number;
  recordId: number;
  parentId: number | null;
  body: string;
  createdAt: number;
  user: AppUser | null;
  likeCount: number;
  likedByMe: boolean;
}

export interface SpeciesOverride {
  speciesId: number;
  commonNameOverride: string | null;
  notesOverride: string | null;
  heroRecordId: number | null;
  hiddenPhotos: string[];
  scientificNameOverride: string | null;
  authorityOverride: string | null;
  classOverride: string | null;
  orderOverride: string | null;
  familyOverride: string | null;
  descriptionOverride: string | null;
  habitatOverride: string | null;
  dietOverride: string | null;
  sizeOverride: string | null;
  conservationOverride: string | null;
  totalLengthOverride: string | null;
  snoutVentOverride: string | null;
  bodyLengthOverride: string | null;
  dorsalScalesOverride: string | null;
  ventralScalesOverride: string | null;
  subcaudalScalesOverride: string | null;
  analScaleOverride: string | null;
  lifecycleOverride: string | null;
  behaviourOverride: string | null;
  venomOverride: string | null;
  rangeOverride: string | null;
  identificationOverride: string | null;
  similarSpeciesOverride: string | null;
  forcedHeroPhotoUrl: string | null;
  updatedAt: number | null;
}

export interface SpeciesOverridePatch {
  commonNameOverride?: string | null;
  notesOverride?: string | null;
  heroRecordId?: number | null;
  scientificNameOverride?: string | null;
  authorityOverride?: string | null;
  classOverride?: string | null;
  orderOverride?: string | null;
  familyOverride?: string | null;
  descriptionOverride?: string | null;
  habitatOverride?: string | null;
  dietOverride?: string | null;
  sizeOverride?: string | null;
  conservationOverride?: string | null;
  totalLengthOverride?: string | null;
  snoutVentOverride?: string | null;
  bodyLengthOverride?: string | null;
  dorsalScalesOverride?: string | null;
  ventralScalesOverride?: string | null;
  subcaudalScalesOverride?: string | null;
  analScaleOverride?: string | null;
  lifecycleOverride?: string | null;
  behaviourOverride?: string | null;
  venomOverride?: string | null;
  rangeOverride?: string | null;
  identificationOverride?: string | null;
  similarSpeciesOverride?: string | null;
}

export interface SpeciesTopPhoto {
  photoDataUrl: string | null;
  recordId?: number;
  likeCount?: number;
  author?: AppUser | null;
  pinned?: boolean;
}

export interface AppSuggestion {
  id: number;
  recordId: number;
  speciesId: number | null;
  speciesName: string;
  speciesCommon: string | null;
  comment: string | null;
  createdAt: number;
  user: AppUser | null;
}

export async function apiSignup(input: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ token: string; user: AppUser }> {
  const res = await apiRequest("POST", "/api/auth/signup", input);
  return res.json();
}

export async function apiLogin(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: AppUser }> {
  const res = await apiRequest("POST", "/api/auth/login", input);
  return res.json();
}

export async function apiLogout(): Promise<void> {
  await apiRequest("POST", "/api/auth/logout");
}

export async function apiMe(): Promise<{ user: AppUser | null }> {
  const res = await apiRequest("GET", "/api/auth/me");
  return res.json();
}

export async function apiUpdateMe(
  patch: Partial<
    Pick<
      AppUser,
      | "displayName"
      | "bio"
      | "avatarDataUrl"
      | "coverDataUrl"
      | "avatarPos"
      | "coverPos"
      | "website"
      | "location"
      | "instagram"
      | "twitter"
      | "facebook"
    >
  >,
): Promise<{ user: AppUser }> {
  const res = await apiRequest("PATCH", "/api/me", patch);
  return res.json();
}

export async function apiGetUser(username: string): Promise<{ user: AppUser }> {
  const res = await apiRequest("GET", `/api/users/${encodeURIComponent(username)}`);
  return res.json();
}

export async function apiGetUserRecords(
  username: string,
): Promise<{ records: AppRecord[] }> {
  const res = await apiRequest(
    "GET",
    `/api/users/${encodeURIComponent(username)}/records`,
  );
  return res.json();
}

export interface RankingEntry {
  rank: number;
  totalEntrants: number;
  speciesCount: number;
  recordCount: number;
}
export interface UserRankings {
  username: string;
  total: RankingEntry | null;
  groups: Array<RankingEntry & { key: string; label: string }>;
  families: Array<RankingEntry & { familyId: number; familyName: string }>;
}

export async function apiGetUserRankings(username: string): Promise<UserRankings> {
  const res = await apiRequest(
    "GET",
    `/api/users/${encodeURIComponent(username)}/rankings`,
  );
  return res.json();
}

export async function apiSearchUsers(q: string): Promise<{ users: AppUser[] }> {
  const res = await apiRequest("GET", `/api/users/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function apiFollow(username: string): Promise<{ user: AppUser }> {
  const res = await apiRequest(
    "POST",
    `/api/users/${encodeURIComponent(username)}/follow`,
  );
  return res.json();
}

export async function apiUnfollow(username: string): Promise<{ user: AppUser }> {
  const res = await apiRequest(
    "DELETE",
    `/api/users/${encodeURIComponent(username)}/follow`,
  );
  return res.json();
}

export async function apiGetFollowers(
  username: string,
): Promise<{ users: AppUser[] }> {
  const res = await apiRequest(
    "GET",
    `/api/users/${encodeURIComponent(username)}/followers`,
  );
  return res.json();
}

export async function apiGetFollowing(
  username: string,
): Promise<{ users: AppUser[] }> {
  const res = await apiRequest(
    "GET",
    `/api/users/${encodeURIComponent(username)}/following`,
  );
  return res.json();
}

export async function apiCreateRecord(input: {
  speciesId?: number | null;
  parentSpeciesId?: number | null;
  speciesName?: string | null;
  speciesCommon?: string | null;
  notes?: string | null;
  photoDataUrl: string;
  photos?: string[];
  lat?: string | null;
  lng?: string | null;
  placeGuess?: string | null;
  observedOn?: string | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  iso?: number | null;
  fNumber?: string | null;
  shutter?: string | null;
  focalLength?: string | null;
  exifJson?: string | null;
  groupKey?: string | null;
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
  obscureLocation?: boolean;
  licenseCode?: LicenseCode | null;
  conditionTag?: ConditionTag | null;
  behaviors?: string[];
}): Promise<{ record: AppRecord }> {
  const res = await apiRequest("POST", "/api/records", input);
  return res.json();
}

export async function apiGetRecord(
  id: number,
): Promise<{ record: AppRecord; suggestions: AppSuggestion[]; comments: AppComment[] }> {
  const res = await apiRequest("GET", `/api/records/${id}`);
  return res.json();
}

export async function apiUpdateRecordSpecies(
  id: number,
  patch: {
    speciesId?: number | null;
    speciesName?: string | null;
    speciesCommon?: string | null;
    groupKey?: string | null;
    familyId?: number | null;
    familyName?: string | null;
    genus?: string | null;
  },
): Promise<{ record: AppRecord }> {
  const res = await apiRequest("PATCH", `/api/records/${id}`, patch);
  return res.json();
}

export async function apiDeleteRecord(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/records/${id}`);
}

export async function apiSuggestId(
  recordId: number,
  input: {
    speciesId?: number | null;
    speciesName: string;
    speciesCommon?: string | null;
    comment?: string | null;
    groupKey?: string | null;
    familyId?: number | null;
    familyName?: string | null;
    genus?: string | null;
  },
): Promise<{ suggestion: AppSuggestion }> {
  const res = await apiRequest("POST", `/api/records/${recordId}/suggestions`, input);
  return res.json();
}

export async function apiAcceptSuggestion(
  recordId: number,
  suggestionId: number,
): Promise<{ record: AppRecord }> {
  const res = await apiRequest(
    "POST",
    `/api/records/${recordId}/suggestions/${suggestionId}/accept`,
  );
  return res.json();
}

export async function apiDeleteSuggestion(
  recordId: number,
  suggestionId: number,
): Promise<void> {
  await apiRequest("DELETE", `/api/records/${recordId}/suggestions/${suggestionId}`);
}

export async function apiFeed(): Promise<{ records: AppRecord[] }> {
  const res = await apiRequest("GET", "/api/feed");
  return res.json();
}

export async function apiAllRecords(): Promise<{ records: AppRecord[] }> {
  const res = await apiRequest("GET", "/api/records");
  return res.json();
}

/** Records of a single species — used by the species page Records list. */
export async function apiRecordsForSpecies(
  speciesId: number,
  limit = 200,
): Promise<{ records: AppRecord[] }> {
  const res = await apiRequest(
    "GET",
    `/api/records?speciesId=${speciesId}&limit=${limit}`,
  );
  return res.json();
}

// --- Species tally / leaderboards --------------------------------------------

export interface UserSpeciesCount {
  speciesId: number;
  speciesName: string | null;
  speciesCommon: string | null;
  groupKey: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
  count: number;
}

export interface UserSpeciesResponse {
  userId: number;
  speciesIds: number[];
  counts: UserSpeciesCount[];
}

export async function apiGetUserSpecies(
  username: string,
): Promise<UserSpeciesResponse> {
  const res = await apiRequest(
    "GET",
    `/api/users/${encodeURIComponent(username)}/species`,
  );
  return res.json();
}

// Catalog: curated AU herp species reference list.
export interface CatalogSpecies {
  id: number;
  scientific: string;
  common: string | null;
  group: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
  /**
   * Server-resolved hero URL when a user-record hero exists for this
   * species (admin-forced, admin-pinned, or top-liked). Null when none
   * — the client should fall back to the iNat default_photo via the
   * parallel iNat species list.
   */
  heroPhotoUrl?: string | null;
}

export interface CatalogResponse {
  species: CatalogSpecies[];
  total: number;
}

export async function apiGetCatalog(opts: {
  group?: string;
  familyId?: number;
  genus?: string;
  q?: string;
} = {}): Promise<CatalogResponse> {
  const params = new URLSearchParams();
  if (opts.group) params.set("group", opts.group);
  if (opts.familyId) params.set("familyId", String(opts.familyId));
  if (opts.genus) params.set("genus", opts.genus);
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await apiRequest("GET", `/api/species/catalog${qs ? `?${qs}` : ""}`);
  return res.json();
}

// Backfill record taxonomy from the catalog — admin/super-admin only.
export async function apiBackfillRecordTaxonomy(): Promise<{ updated: number; skipped: number; totalCatalog: number }> {
  const res = await apiRequest("POST", "/api/admin/backfill-record-taxonomy");
  return res.json();
}

// Subspecies catalog
export interface CatalogSubspecies extends CatalogSpecies {
  parentId: number;
  parentScientific: string;
  parentCommon: string | null;
}

export interface SubspeciesCatalogResponse {
  subspecies: CatalogSubspecies[];
  total: number;
}

export async function apiGetSubspeciesCatalog(opts: {
  parentId?: number;
  group?: string;
  familyId?: number;
  genus?: string;
  q?: string;
} = {}): Promise<SubspeciesCatalogResponse> {
  const params = new URLSearchParams();
  if (opts.parentId) params.set("parentId", String(opts.parentId));
  if (opts.group) params.set("group", opts.group);
  if (opts.familyId) params.set("familyId", String(opts.familyId));
  if (opts.genus) params.set("genus", opts.genus);
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await apiRequest("GET", `/api/subspecies/catalog${qs ? `?${qs}` : ""}`);
  return res.json();
}

export async function apiGetMySpecies(): Promise<UserSpeciesResponse> {
  const res = await apiRequest("GET", "/api/me/species");
  return res.json();
}

export interface SpeciesStatsResponse {
  speciesId: number;
  myCount: number;
  topRecorders: Array<{ user: AppUser | null; recordCount: number }>;
  topIdentifiers?: Array<{
    user: AppUser | null;
    idCount: number;
    acceptedCount: number;
  }>;
}

export async function apiGetSpeciesStats(
  speciesId: number,
): Promise<SpeciesStatsResponse> {
  const res = await apiRequest("GET", `/api/species/${speciesId}/stats`);
  return res.json();
}

export type LeaderboardScope =
  | "all"
  | "reptiles"
  | "amphibians"
  | "snakes"
  | "lizards"
  | "turtles"
  | "crocs"
  | "frogs";

export interface LeaderboardEntry {
  user: AppUser | null;
  speciesCount: number;
  recordCount: number;
}

export interface LeaderboardResponse {
  scope: string;
  familyId: number | null;
  genus: string | null;
  entries: LeaderboardEntry[];
}

export async function apiGetLeaderboard(opts: {
  scope?: LeaderboardScope;
  familyId?: number | null;
  genus?: string | null;
  limit?: number;
}): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.familyId) params.set("familyId", String(opts.familyId));
  if (opts.genus) params.set("genus", opts.genus);
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await apiRequest("GET", `/api/leaderboard?${params}`);
  return res.json();
}

export interface IdLeaderboardEntry {
  user: AppUser | null;
  idCount: number;
  acceptedCount: number;
}

export interface IdLeaderboardResponse {
  scope: string;
  familyId: number | null;
  genus: string | null;
  entries: IdLeaderboardEntry[];
}

export async function apiGetIdLeaderboard(opts: {
  scope?: LeaderboardScope;
  familyId?: number | null;
  genus?: string | null;
  limit?: number;
}): Promise<IdLeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.familyId) params.set("familyId", String(opts.familyId));
  if (opts.genus) params.set("genus", opts.genus);
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await apiRequest("GET", `/api/leaderboard-ids?${params}`);
  return res.json();
}

// --- Denominator helpers (total AU species) ----------------------------------

/**
 * Total AU species for a given scope. Uses the merged catalog endpoint so the
 * count includes admin-added species (e.g. recently described taxa not yet on
 * iNat) and excludes admin-hidden species. The catalog rows already carry
 * group/familyId/genus, so scope filtering happens server-side via query params.
 *
 * Note: `taxonId` is interpreted as a family taxon id (the only way the tally
 * uses it) and is mapped to `familyId` on the catalog endpoint.
 */
export async function fetchSpeciesTotal(opts: {
  group?: SpeciesGroup;
  taxonId?: number;
}): Promise<number> {
  const params = new URLSearchParams();
  if (opts.taxonId) {
    params.set("familyId", String(opts.taxonId));
  } else if (opts.group && opts.group !== "all") {
    // Map iNat super-groups (reptiles/amphibians) by summing constituent groups
    // client-side via separate calls. For specific groups, filter directly.
    if (opts.group === "reptiles" || opts.group === "amphibians") {
      const sub = opts.group === "reptiles"
        ? ["snakes", "lizards", "turtles", "crocs"]
        : ["frogs"];
      const totals = await Promise.all(
        sub.map(async (g) => {
          const r = await apiRequest("GET", `/api/species/catalog?group=${g}`);
          const j = (await r.json()) as { total: number };
          return j.total || 0;
        }),
      );
      return totals.reduce((a, b) => a + b, 0);
    }
    params.set("group", opts.group);
  }
  const qs = params.toString();
  const res = await apiRequest("GET", `/api/species/catalog${qs ? `?${qs}` : ""}`);
  const data = (await res.json()) as { total: number };
  return data.total || 0;
}

// ───────── iNaturalist connection ─────────

export interface InatStatus {
  inatUsername: string | null;
  inatLastImportAt: number | null;
}

export interface InatSyncSummary {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  inatLogin: string;
}

export interface InatConnectResult extends InatStatus {
  summary: InatSyncSummary;
}

export async function apiGetInatStatus(): Promise<InatStatus> {
  const res = await apiRequest("GET", "/api/me/inat");
  return res.json();
}

export async function apiConnectInat(username: string): Promise<InatConnectResult> {
  const res = await apiRequest("POST", "/api/me/inat/connect", { username });
  return res.json();
}

export async function apiSyncInat(): Promise<InatConnectResult> {
  const res = await apiRequest("POST", "/api/me/inat/sync");
  return res.json();
}

export async function apiDisconnectInat(): Promise<{ ok: true }> {
  const res = await apiRequest("DELETE", "/api/me/inat");
  return res.json();
}

// =============================================================================
// Likes / Comments / Record edit / Species top photo + overrides / Admin
// =============================================================================

export async function apiLikeRecord(
  id: number,
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await apiRequest("POST", `/api/records/${id}/like`);
  return res.json();
}

export async function apiUnlikeRecord(
  id: number,
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await apiRequest("DELETE", `/api/records/${id}/like`);
  return res.json();
}

export async function apiListComments(
  recordId: number,
): Promise<{ comments: AppComment[] }> {
  const res = await apiRequest("GET", `/api/records/${recordId}/comments`);
  return res.json();
}

export async function apiAddComment(
  recordId: number,
  body: string,
  parentId: number | null = null,
): Promise<{ comment: AppComment }> {
  const res = await apiRequest("POST", `/api/records/${recordId}/comments`, {
    body,
    parentId,
  });
  return res.json();
}

export async function apiDeleteComment(
  recordId: number,
  commentId: number,
): Promise<void> {
  await apiRequest("DELETE", `/api/records/${recordId}/comments/${commentId}`);
}

export async function apiLikeComment(
  commentId: number,
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await apiRequest("POST", `/api/comments/${commentId}/like`);
  return res.json();
}

export async function apiUnlikeComment(
  commentId: number,
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await apiRequest("DELETE", `/api/comments/${commentId}/like`);
  return res.json();
}

export interface RecordEditPatch {
  speciesId?: number | null;
  speciesName?: string | null;
  speciesCommon?: string | null;
  groupKey?: string | null;
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
  notes?: string | null;
  placeGuess?: string | null;
  observedOn?: string | null;
  lat?: string | null;
  lng?: string | null;
  obscureLocation?: boolean;
  licenseCode?: LicenseCode | null;
  conditionTag?: ConditionTag | null;
  behaviors?: string[];
}

export async function apiUpdateRecord(
  id: number,
  patch: RecordEditPatch,
): Promise<{ record: AppRecord }> {
  const res = await apiRequest("PATCH", `/api/records/${id}`, patch);
  return res.json();
}

export async function apiGetSpeciesTopPhoto(
  speciesId: number,
): Promise<SpeciesTopPhoto> {
  const res = await apiRequest("GET", `/api/species/${speciesId}/top-photo`);
  return res.json();
}

export async function apiGetSpeciesOverrides(
  speciesId: number,
): Promise<{ override: SpeciesOverride }> {
  const res = await apiRequest("GET", `/api/species/${speciesId}/overrides`);
  return res.json();
}

// ───── Admin ─────

export interface AdminUserRow {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarDataUrl: string | null;
  role: UserRole;
  createdAt: number;
  /** Explicit per-user permission overrides (null = no overrides) */
  permissions: CapabilityMap | null;
  /** Resolved effective capabilities (role default merged with overrides) */
  capabilities: Record<AdminCapability, boolean>;
}

export async function apiListAdminUsers(): Promise<{ users: AdminUserRow[] }> {
  const res = await apiRequest("GET", "/api/admin/users");
  return res.json();
}

export async function apiSetUserRole(
  username: string,
  role: UserRole,
): Promise<{ user: { id: number; username: string; role: UserRole } }> {
  const res = await apiRequest("POST", `/api/admin/users/${username}/role`, { role });
  return res.json();
}

export async function apiSetUserPermissions(
  username: string,
  permissions: CapabilityMap | null,
): Promise<{
  user: {
    id: number;
    username: string;
    role: UserRole;
    permissions: CapabilityMap | null;
    capabilities: Record<AdminCapability, boolean>;
  };
}> {
  const res = await apiRequest(
    "PATCH",
    `/api/admin/users/${username}/permissions`,
    { permissions },
  );
  return res.json();
}

export interface AuditEntry {
  id: number;
  actor: AppUser | null;
  action: string;
  targetType: string;
  targetId: number;
  detail: string | null;
  createdAt: number;
}

export async function apiGetAuditLog(): Promise<{ entries: AuditEntry[] }> {
  const res = await apiRequest("GET", "/api/admin/audit");
  return res.json();
}

// ─── iNat observer blocklist (admin) ──────────────────────────────────

export interface InatBlockRow {
  id: number;
  login: string;
  userId: number | null;
  label: string | null;
  note: string | null;
  blockedBy: AppUser | null;
  createdAt: number;
}

export async function apiListInatBlocks(): Promise<{ blocks: InatBlockRow[] }> {
  const res = await apiRequest("GET", "/api/admin/inat-blocks");
  return res.json();
}

export async function apiAddInatBlock(
  login: string,
  note?: string | null,
): Promise<{
  block: Omit<InatBlockRow, "blockedBy">;
  resolved: boolean;
}> {
  const res = await apiRequest("POST", "/api/admin/inat-blocks", {
    login,
    note: note?.trim() || null,
  });
  return res.json();
}

export async function apiDeleteInatBlock(id: number): Promise<{ ok: true }> {
  const res = await apiRequest("DELETE", `/api/admin/inat-blocks/${id}`);
  return res.json();
}

// ─── Admin: species management ───────────────────────────

export interface AdminSpeciesRow {
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
}

export interface InatTaxonLookupResult {
  id: number;
  scientific: string;
  common: string | null;
  rank: string;
  group: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
  observationsCount: number;
}

export async function apiListAdminSpecies(opts?: {
  q?: string;
  group?: string;
}): Promise<{ species: AdminSpeciesRow[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.group) params.set("group", opts.group);
  const qs = params.toString();
  const res = await apiRequest(
    "GET",
    `/api/admin/species${qs ? `?${qs}` : ""}`,
  );
  return res.json();
}

export async function apiInatTaxonLookup(
  q: string,
): Promise<{ results: InatTaxonLookupResult[] }> {
  const res = await apiRequest(
    "GET",
    `/api/admin/inat-taxon-lookup?q=${encodeURIComponent(q)}`,
  );
  return res.json();
}

export interface AdminSpeciesUpsertInput {
  id?: number;
  source: "inat" | "manual";
  scientific: string;
  common?: string | null;
  group: "snakes" | "lizards" | "turtles" | "crocs" | "frogs";
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
  authority?: string | null;
  description?: string | null;
}

export async function apiCreateAdminSpecies(
  input: AdminSpeciesUpsertInput,
): Promise<{ species: any }> {
  const res = await apiRequest("POST", "/api/admin/species", input);
  return res.json();
}

export async function apiUpdateAdminSpecies(
  id: number,
  patch: Partial<
    Pick<
      AdminSpeciesUpsertInput,
      | "scientific"
      | "common"
      | "group"
      | "familyName"
      | "genus"
      | "authority"
      | "description"
    >
  > & { hidden?: boolean },
): Promise<{ species: any }> {
  const res = await apiRequest("PATCH", `/api/admin/species/${id}`, patch);
  return res.json();
}

export async function apiHideAdminSpecies(
  id: number,
  hidden: boolean,
): Promise<{ ok: true; hidden: boolean }> {
  const res = await apiRequest("POST", `/api/admin/species/${id}/hide`, {
    hidden,
  });
  return res.json();
}

export async function apiDeleteAdminSpecies(
  id: number,
): Promise<{ ok: true }> {
  const res = await apiRequest("DELETE", `/api/admin/species/${id}`);
  return res.json();
}

// ─── Species articles ─────────────────────────────────────────────────

export interface SpeciesArticleRow {
  id: number;
  speciesId: number;
  title: string;
  description: string | null;
  citation: string;
  credit: string;
  fileName: string | null;
  hasFile: boolean;
  externalUrl: string | null;
  createdAt: number;
  uploader: AppUser | null;
}

export async function apiListSpeciesArticles(
  speciesId: number,
): Promise<{ articles: SpeciesArticleRow[] }> {
  const res = await apiRequest("GET", `/api/species/${speciesId}/articles`);
  return res.json();
}

export async function apiCreateSpeciesArticle(
  speciesId: number,
  input: {
    title: string;
    description?: string | null;
    citation: string;
    credit: string;
    fileDataUrl?: string | null;
    fileName?: string | null;
    externalUrl?: string | null;
  },
): Promise<{ article: SpeciesArticleRow }> {
  const res = await apiRequest(
    "POST",
    `/api/species/${speciesId}/articles`,
    input,
  );
  return res.json();
}

export async function apiDeleteSpeciesArticle(
  id: number,
): Promise<{ ok: true }> {
  const res = await apiRequest("DELETE", `/api/articles/${id}`);
  return res.json();
}

export async function apiPatchSpeciesOverride(
  speciesId: number,
  patch: SpeciesOverridePatch,
): Promise<{ override: any }> {
  const res = await apiRequest("PATCH", `/api/admin/species/${speciesId}`, patch);
  return res.json();
}

export async function apiHideSpeciesPhoto(
  speciesId: number,
  photoUrl: string,
): Promise<{ override: any }> {
  const res = await apiRequest("POST", `/api/admin/species/${speciesId}/hide-photo`, {
    photoUrl,
  });
  return res.json();
}

export async function apiUnhideSpeciesPhoto(
  speciesId: number,
  photoUrl: string,
): Promise<{ override: any }> {
  const res = await apiRequest("POST", `/api/admin/species/${speciesId}/unhide-photo`, {
    photoUrl,
  });
  return res.json();
}

/**
 * Admin: pin a specific iNat taxon photo as the species hero, or clear the
 * pin (photoUrl=null). Pin overrides default precedence.
 */
export async function apiForceHeroPhoto(
  speciesId: number,
  photoUrl: string | null,
): Promise<{ override: any }> {
  const res = await apiRequest(
    "POST",
    `/api/admin/species/${speciesId}/force-hero-photo`,
    { photoUrl },
  );
  return res.json();
}

// ───── Notifications ─────

export type NotificationType =
  | "record_like"
  | "record_comment"
  | "comment_reply"
  | "comment_like"
  | "note_like"
  | "note_comment"
  | "note_comment_reply"
  | "note_comment_like";

export interface AppNotification {
  id: number;
  type: NotificationType;
  recordId: number | null;
  commentId: number | null;
  noteId: number | null;
  snippet: string | null;
  readAt: number | null;
  createdAt: number;
  actor: AppUser | null;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

export async function apiListNotifications(
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.unreadOnly) params.set("unread", "1");
  const qs = params.toString();
  const res = await apiRequest(
    "GET",
    `/api/notifications${qs ? `?${qs}` : ""}`,
  );
  return res.json();
}

export async function apiUnreadNotificationCount(): Promise<{
  unreadCount: number;
}> {
  const res = await apiRequest("GET", "/api/notifications/unread-count");
  return res.json();
}

export async function apiMarkNotificationRead(
  id: number,
): Promise<{ ok: true; unreadCount: number }> {
  const res = await apiRequest("POST", `/api/notifications/${id}/read`);
  return res.json();
}

export async function apiMarkNotificationUnread(
  id: number,
): Promise<{ ok: true; unreadCount: number }> {
  const res = await apiRequest("POST", `/api/notifications/${id}/unread`);
  return res.json();
}

export async function apiMarkAllNotificationsRead(): Promise<{
  ok: true;
  unreadCount: number;
}> {
  const res = await apiRequest("POST", "/api/notifications/read-all");
  return res.json();
}

export async function apiDeleteNotification(
  id: number,
): Promise<{ ok: true; unreadCount: number }> {
  const res = await apiRequest("DELETE", `/api/notifications/${id}`);
  return res.json();
}

// ───── Observation notes ─────

export interface AppNote {
  id: number;
  userId: number;
  speciesId: number | null;
  parentSpeciesId: number | null;
  speciesName: string | null;
  speciesCommon: string | null;
  groupKey: string | null;
  familyId: number | null;
  familyName: string | null;
  genus: string | null;
  title: string | null;
  body: string;
  createdAt: number;
  author: AppUser | null;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
}

export interface AppNoteComment {
  id: number;
  noteId: number;
  parentId: number | null;
  body: string;
  createdAt: number;
  user: AppUser | null;
  likeCount: number;
  likedByMe: boolean;
}

export async function apiCreateNote(input: {
  speciesId: number | null;
  parentSpeciesId?: number | null;
  speciesName?: string | null;
  speciesCommon?: string | null;
  groupKey?: string | null;
  familyId?: number | null;
  familyName?: string | null;
  genus?: string | null;
  title?: string | null;
  body: string;
}): Promise<{ note: AppNote }> {
  const res = await apiRequest("POST", "/api/notes", input);
  return res.json();
}

export async function apiListNotes(): Promise<{ notes: AppNote[] }> {
  const res = await apiRequest("GET", "/api/notes");
  return res.json();
}

export async function apiNotesFeed(): Promise<{ notes: AppNote[] }> {
  const res = await apiRequest("GET", "/api/notes/feed");
  return res.json();
}

export async function apiGetNote(id: number): Promise<{ note: AppNote }> {
  const res = await apiRequest("GET", `/api/notes/${id}`);
  return res.json();
}

export async function apiUpdateNote(
  id: number,
  patch: { title?: string | null; body?: string },
): Promise<{ note: AppNote }> {
  const res = await apiRequest("PATCH", `/api/notes/${id}`, patch);
  return res.json();
}

export async function apiDeleteNote(id: number): Promise<{ ok: true }> {
  const res = await apiRequest("DELETE", `/api/notes/${id}`);
  return res.json();
}

export async function apiNotesForSpecies(
  speciesId: number,
): Promise<{ notes: AppNote[] }> {
  const res = await apiRequest("GET", `/api/species/${speciesId}/notes`);
  return res.json();
}

export async function apiNotesForUser(
  username: string,
): Promise<{ notes: AppNote[] }> {
  const res = await apiRequest("GET", `/api/users/${encodeURIComponent(username)}/notes`);
  return res.json();
}

export async function apiLikeNote(
  id: number,
): Promise<{ liked: true; likeCount: number }> {
  const res = await apiRequest("POST", `/api/notes/${id}/like`);
  return res.json();
}

export async function apiUnlikeNote(
  id: number,
): Promise<{ liked: false; likeCount: number }> {
  const res = await apiRequest("DELETE", `/api/notes/${id}/like`);
  return res.json();
}

export async function apiListNoteComments(
  id: number,
): Promise<{ comments: AppNoteComment[] }> {
  const res = await apiRequest("GET", `/api/notes/${id}/comments`);
  return res.json();
}

export async function apiAddNoteComment(
  id: number,
  body: string,
  parentId?: number | null,
): Promise<{ comment: AppNoteComment }> {
  const res = await apiRequest("POST", `/api/notes/${id}/comments`, {
    body,
    parentId: parentId ?? null,
  });
  return res.json();
}

export async function apiDeleteNoteComment(
  noteId: number,
  commentId: number,
): Promise<{ ok: true }> {
  const res = await apiRequest(
    "DELETE",
    `/api/notes/${noteId}/comments/${commentId}`,
  );
  return res.json();
}

export async function apiLikeNoteComment(
  cid: number,
): Promise<{ liked: true; likeCount: number }> {
  const res = await apiRequest("POST", `/api/note-comments/${cid}/like`);
  return res.json();
}

export async function apiUnlikeNoteComment(
  cid: number,
): Promise<{ liked: false; likeCount: number }> {
  const res = await apiRequest("DELETE", `/api/note-comments/${cid}/like`);
  return res.json();
}

// ─── Distribution maps (grid + admin) ────────────────────────────────

export interface DistributionGridCell {
  latIdx: number;
  lngIdx: number;
  count: number;
  source: "observed" | "admin";
}

export interface DistributionGridPolygon {
  id: number;
  polygon: Array<[number, number]>; // [lng, lat] pairs
  label: string | null;
}

export interface DistributionGridPoint {
  id: number;
  lat: number;
  lng: number;
  date: string | null;
  source: string;
}

export interface DistributionGridResponse {
  speciesId: number;
  cellSize: number; // 0.5
  cells: DistributionGridCell[];
  maxCount: number;
  polygons: DistributionGridPolygon[];
  points?: DistributionGridPoint[];
}

export async function fetchDistributionGrid(
  speciesId: number,
  opts: { points?: boolean } = {},
): Promise<DistributionGridResponse> {
  const qs = opts.points ? "?points=1" : "";
  const res = await apiRequest(
    "GET",
    `/api/species/${speciesId}/distribution-grid${qs}`,
  );
  return res.json();
}

export interface DistributionImportJob {
  id: number;
  status: "idle" | "running" | "done" | "error";
  totalSpecies: number;
  processedSpecies: number;
  currentSpeciesId: number | null;
  currentSpeciesName: string | null;
  totalRecords: number;
  lastError: string | null;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
}

export interface DistributionImportStatus {
  job: DistributionImportJob | null;
  running: boolean;
  catalogSize: number;
}

export async function apiGetDistributionImportStatus(): Promise<DistributionImportStatus> {
  const res = await apiRequest("GET", "/api/admin/distribution/import");
  return res.json();
}

export async function apiStartDistributionImport(
  sources?: Array<"inat" | "ala">,
): Promise<{ started: boolean; reason?: string; job: DistributionImportJob | null }> {
  const res = await apiRequest("POST", "/api/admin/distribution/import", {
    sources,
  });
  return res.json();
}

export async function apiCancelDistributionImport(): Promise<{ ok: true }> {
  const res = await apiRequest(
    "POST",
    "/api/admin/distribution/import/cancel",
  );
  return res.json();
}

export interface SpeciesImportResult {
  speciesId: number;
  scientific: string;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export async function apiReimportSpecies(
  speciesId: number,
  opts: { scientific?: string; sources?: Array<"inat" | "ala">; replace?: boolean } = {},
): Promise<SpeciesImportResult> {
  const res = await apiRequest(
    "POST",
    `/api/admin/distribution/species/${speciesId}/import`,
    opts,
  );
  return res.json();
}

export async function apiUpsertRangeCell(
  speciesId: number,
  latIdx: number,
  lngIdx: number,
  present: boolean,
): Promise<unknown> {
  const res = await apiRequest(
    "POST",
    `/api/admin/distribution/species/${speciesId}/cells`,
    { latIdx, lngIdx, present },
  );
  return res.json();
}

export async function apiDeleteRangeCell(
  speciesId: number,
  latIdx: number,
  lngIdx: number,
): Promise<{ changes: number }> {
  const res = await apiRequest(
    "DELETE",
    `/api/admin/distribution/species/${speciesId}/cells/${latIdx}/${lngIdx}`,
  );
  return res.json();
}

export async function apiAddRangePolygon(
  speciesId: number,
  polygon: Array<[number, number]>,
  label?: string,
): Promise<DistributionGridPolygon> {
  const res = await apiRequest(
    "POST",
    `/api/admin/distribution/species/${speciesId}/polygons`,
    { polygon, label },
  );
  return res.json();
}

export async function apiDeleteRangePolygon(
  id: number,
): Promise<{ changes: number }> {
  const res = await apiRequest(
    "DELETE",
    `/api/admin/distribution/polygons/${id}`,
  );
  return res.json();
}

export async function apiHideRecord(
  recordId: number,
  speciesId: number,
  reason?: string,
): Promise<{ hidden: true; alreadyHidden: boolean }> {
  const res = await apiRequest(
    "POST",
    "/api/admin/distribution/hide-record",
    { recordId, speciesId, reason },
  );
  return res.json();
}

export async function apiUnhideRecord(
  recordId: number,
): Promise<{ changes: number }> {
  const res = await apiRequest(
    "DELETE",
    `/api/admin/distribution/hide-record/${recordId}`,
  );
  return res.json();
}
