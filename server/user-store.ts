/**
 * UserStore — configurable role-based authorization singleton.
 *
 * Local file at repo root (.multisite-user-store.json),
 * synced to multisite-global/users-state.json in GCS on every write.
 */

import * as fs from "fs";
import * as path from "path";
import {
  platformUserStoreGcsKey,
  platformUserStoreLocalFilename,
  userStoreReadKeys,
} from "@shared/gcsKeys";
import { gcs } from "./gcs";
import {

  CAPABILITY_REGISTRY,
  SCOPED_CAPABILITIES,
  GLOBAL_CAPABILITIES,
  ALL_CAPABILITIES,
  CONTENT_MUTATE_CAPABILITIES,
  VIEW_ONLY_CAPABILITIES,
  type ScopedCapability,
  type GlobalCapability,
  type CapabilityName,
} from "../shared/capabilities";
import { child } from "./logger";
const log = child({ module: "user-store" });

export type { ScopedCapability, GlobalCapability, CapabilityName };
export { SCOPED_CAPABILITIES, GLOBAL_CAPABILITIES, ALL_CAPABILITIES, CAPABILITY_REGISTRY };

function getLocalPath(): string {
  const platformPath = path.join(process.cwd(), platformUserStoreLocalFilename());
  if (fs.existsSync(platformPath)) return platformPath;
  // Legacy fallback: default site content folder
  try {
    const { getDefaultContentRoot } = require("./site-config") as typeof import("./site-config");
    const legacyPath = path.join(getDefaultContentRoot(), ".users-state.json");
    if (fs.existsSync(legacyPath)) return legacyPath;
  } catch { /* ignore */ }
  return platformPath;
}

const GCS_KEY = platformUserStoreGcsKey();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export interface CapabilityGrant {
  name: CapabilityName;
  contentTypes?: string[] | "*";
}

export interface RoleDefinition {
  label: string;
  description?: string;
  capabilities: CapabilityGrant[];
}

export interface UserRecord {
  /** Human-readable, unique, immutable staff id (email local-part based). */
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  lastLoginAt?: string;
  roles: string[];
}

export interface PendingUserRecord {
  email: string;
  role: string;
  createdAt: string;
}

interface UsersState {
  roles: Record<string, RoleDefinition>;
  users: Record<string, UserRecord>;
  pendingUsers?: Record<string, PendingUserRecord>;
}

// ─── Built-in roles ────────────────────────────────────────────────────────────

export const BUILT_IN_ROLE_IDS = ["webmaster", "metrics_viewer", "content_viewer"] as const;
export type BuiltInRoleId = (typeof BUILT_IN_ROLE_IDS)[number];

export function isBuiltInRole(roleId: string): boolean {
  return (BUILT_IN_ROLE_IDS as readonly string[]).includes(roleId);
}

const BUILT_IN_WEBMASTER_ROLE: RoleDefinition = {
  label: "Webmaster",
  description:
    "Full CMS access: content, SEO, media, types, databases, users, and diagnostics. Use when no narrower role fits. Prefer a focused /mcp/role/… connector when one exists.",
  capabilities: [
    { name: "users_manage" },
    { name: "theme_edit" },
    { name: "media_upload" },
    { name: "media_delete" },
    { name: "seo_edit" },
    { name: "content_types_manage" },
    { name: "databases_manage" },
    { name: "components_manage" },
    { name: "migrations_run" },
    { name: "metrics_view" },
    { name: "content_view", contentTypes: "*" },
    { name: "content_create_entry", contentTypes: "*" },
    { name: "content_delete_entry", contentTypes: "*" },
    { name: "content_edit_structure", contentTypes: "*" },
    { name: "content_edit_default", contentTypes: "*" },
    { name: "content_create_variant", contentTypes: "*" },
    { name: "content_edit_variant", contentTypes: "*" },
    { name: "content_delete_variant", contentTypes: "*" },
    { name: "content_edit_text", contentTypes: "*" },
    { name: "content_edit_media", contentTypes: "*" },
    { name: "content_allocate_traffic", contentTypes: "*" },
    { name: "content_promote_variant", contentTypes: "*" },
  ],
};

const BUILT_IN_METRICS_VIEWER_ROLE: RoleDefinition = {
  label: "Metrics Viewer",
  description:
    "Read-only metrics and diagnostics (issues, insights, error log, conversions, tracking). Cannot start jobs, fix issues, or edit content or SEO.",
  capabilities: [{ name: "metrics_view" }],
};

const BUILT_IN_CONTENT_VIEWER_ROLE: RoleDefinition = {
  label: "Content Viewer",
  description:
    "Read-only content and playbooks (YAML entries, type contracts, component schemas). Cannot write entries, SEO, redirects, or run mutating diagnostics.",
  capabilities: [{ name: "content_view", contentTypes: "*" }],
};

const DEFAULT_STATE: UsersState = {
  roles: {
    webmaster: BUILT_IN_WEBMASTER_ROLE,
    metrics_viewer: BUILT_IN_METRICS_VIEWER_ROLE,
    content_viewer: BUILT_IN_CONTENT_VIEWER_ROLE,
  },
  users: {},
};

/** Overwrite built-in roles from code so local/GCS edits cannot drift. */
function syncBuiltInRoles(): void {
  if (!state.roles) state.roles = {};
  state.roles.webmaster = BUILT_IN_WEBMASTER_ROLE;
  state.roles.metrics_viewer = BUILT_IN_METRICS_VIEWER_ROLE;
  state.roles.content_viewer = BUILT_IN_CONTENT_VIEWER_ROLE;
}

function unionContentTypeScopes(
  grants: Array<{ contentTypes?: string[] | "*" }>,
): string[] | "*" {
  const types = new Set<string>();
  for (const grant of grants) {
    if (grant.contentTypes === "*" || grant.contentTypes === undefined) {
      return "*";
    }
    if (Array.isArray(grant.contentTypes)) {
      for (const t of grant.contentTypes) types.add(t);
    }
  }
  return types.size > 0 ? Array.from(types) : "*";
}

/**
 * Add content_view to custom editor roles that have mutate caps but no view grant.
 * Built-in roles are skipped (synced from code). Returns true if any role changed.
 */
export function ensureContentViewOnEditorRoles(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId)) continue;
    if (!role?.capabilities) continue;
    if (role.capabilities.some((g) => g.name === "content_view")) continue;
    const mutateGrants = role.capabilities.filter((g) =>
      (CONTENT_MUTATE_CAPABILITIES as readonly string[]).includes(g.name),
    );
    if (mutateGrants.length === 0) continue;
    role.capabilities = [
      { name: "content_view", contentTypes: unionContentTypeScopes(mutateGrants) },
      ...role.capabilities,
    ];
    changed = true;
  }
  return changed;
}

/** True when grants include a mutating cap (not only metrics_view / content_view). */
export function grantsCanMutateMetrics(caps: CapabilityGrant[]): boolean {
  return caps.some((g) => !VIEW_ONLY_CAPABILITIES.has(g.name));
}

function finishLoad(persist: "local" | "all"): void {
  syncBuiltInRoles();
  if (!state.users) state.users = {};
  backfillMissingUserIds();
  if (ensureContentViewOnEditorRoles(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added content_view from editor capabilities");
  }
  if (persist === "all") save();
  else saveLocal();
}

// ─── In-memory state ───────────────────────────────────────────────────────────

let state: UsersState = { roles: { ...DEFAULT_STATE.roles }, users: {} };
let loaded = false;

// ─── Persistence ───────────────────────────────────────────────────────────────

function saveLocal(): void {
  try {
    const dir = path.dirname(getLocalPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getLocalPath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error saving local file:");
  }
}

async function saveToBucket(): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    const content = JSON.stringify(state, null, 2);
    gcs.debouncedUpload(GCS_KEY, Buffer.from(content, "utf-8"), "application/json");
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error saving to GCS:");
  }
}

function save(): void {
  saveLocal();
  saveToBucket().catch((err) => {
    log.error({ err: err }, "[UserStore] Background GCS save failed:");
  });
}

function loadLocal(): UsersState {
  try {
    if (fs.existsSync(getLocalPath())) {
      const raw = fs.readFileSync(getLocalPath(), "utf-8");
      return JSON.parse(raw) as UsersState;
    }
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error loading local file:");
  }
  return { roles: { ...DEFAULT_STATE.roles }, users: {} };
}

/**
 * Load users state from GCS on startup (production only).
 * Falls back to local file if GCS is unavailable.
 */
export async function loadUsersStateFromBucket(): Promise<void> {
  if (!IS_PRODUCTION) {
    log.info("[UserStore] Development mode — using local file only");
    state = loadLocal();
    finishLoad("local");
    loaded = true;
    return;
  }

  if (!gcs.available) {
    log.info("[UserStore] GCS unavailable — loading from local file");
    state = loadLocal();
    finishLoad("local");
    loaded = true;
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(userStoreReadKeys());
    if (!result) {
      log.info("[UserStore] No users state in GCS — using local file");
      state = loadLocal();
    } else {
      state = JSON.parse(result.data.toString("utf-8")) as UsersState;
      log.info("[UserStore] Loaded users state from GCS");
      saveLocal();
    }
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error loading from GCS:");
    state = loadLocal();
  }

  finishLoad("all");

  loaded = true;
}

export interface ReuploadUsersStateResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

/** Force-upload local/in-memory user store to GCS immediately (admin Cloud Sync). */
export async function reuploadUsersStateToBucket(): Promise<ReuploadUsersStateResult> {
  const gcsKey = GCS_KEY;

  if (!IS_PRODUCTION) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS sync only runs in production (NODE_ENV=production).",
    };
  }

  if (!gcs.available) {
    gcs.initBootstrapFromEnv();
  }
  if (!gcs.available) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }

  ensureLoaded();
  const localPath = getLocalPath();
  if (!fs.existsSync(localPath) && Object.keys(state.users).length === 0) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "No local user store found to upload.",
    };
  }

  saveLocal();
  await gcs.upload(gcsKey, Buffer.from(JSON.stringify(state, null, 2), "utf-8"), "application/json");
  log.info("[UserStore] Re-uploaded users state to GCS via admin action");
  return { success: true, uploaded: true, gcsKey };
}

/** Local path for admin View / inventory (platform file). */
export function getUsersStateLocalPath(): string {
  return getLocalPath();
}

function ensureLoaded(): void {
  if (!loaded) {
    state = loadLocal();
    syncBuiltInRoles();
    if (!state.users) state.users = {};
    if (!state.pendingUsers) state.pendingUsers = {};
    backfillMissingUserIds();
    loaded = true;
  }
}

function normalizeStaffIdBase(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "") || "user";
}

function collectExistingIds(exceptUsername?: string): Set<string> {
  const ids = new Set<string>();
  for (const [uname, user] of Object.entries(state.users)) {
    if (exceptUsername && uname === exceptUsername) continue;
    if (user.id) ids.add(user.id);
  }
  return ids;
}

/** Generate a unique human-readable staff id from email/username. */
export function generateUniqueStaffId(
  profile: { username: string; email?: string },
  existingIds?: Set<string>,
): string {
  const taken = existingIds ?? collectExistingIds(profile.username);
  const email = profile.email || profile.username;
  let base = normalizeStaffIdBase(email.includes("@") ? email : profile.username);
  if (!base) base = "user";
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

function ensureUserHasId(username: string): string {
  const user = state.users[username];
  if (!user) return generateUniqueStaffId({ username });
  if (user.id) return user.id;
  const id = generateUniqueStaffId({ username, email: user.email });
  user.id = id;
  return id;
}

/** Backfill missing ids for all users; persists when any were assigned. */
function backfillMissingUserIds(): void {
  if (!state.users) state.users = {};
  let changed = false;
  const taken = new Set<string>();
  for (const user of Object.values(state.users)) {
    if (user.id) taken.add(user.id);
  }
  for (const user of Object.values(state.users)) {
    if (user.id) continue;
    const id = generateUniqueStaffId({ username: user.username, email: user.email }, taken);
    user.id = id;
    taken.add(id);
    changed = true;
  }
  if (changed) {
    save();
    log.info("[UserStore] Backfilled missing staff user ids");
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if no user currently holds the webmaster role.
 * This ensures the bootstrap grant fires even when stale user records
 * exist from prior deployments that never completed first-login.
 */
export function isFirstUser(): boolean {
  ensureLoaded();
  return !Object.values(state.users).some((u) => u.roles.includes("webmaster"));
}

/** True when the user holds the built-in webmaster role (full platform access). */
export function hasWebmasterRole(username: string, email?: string): boolean {
  ensureLoaded();
  const found = findUserEntry(username, email);
  return found?.user.roles.includes("webmaster") ?? false;
}

/**
 * Find a staff user by username key, or by email (key or email field).
 * Store keys are often emails historically; Breathecode username may differ.
 */
function findUserEntry(
  username: string,
  email?: string,
): { key: string; user: UserRecord } | null {
  if (state.users[username]) {
    return { key: username, user: state.users[username] };
  }
  const emailNorm = email?.toLowerCase().trim();
  if (!emailNorm) return null;
  if (state.users[emailNorm]) {
    return { key: emailNorm, user: state.users[emailNorm] };
  }
  for (const [key, user] of Object.entries(state.users)) {
    if (user.email?.toLowerCase().trim() === emailNorm) {
      return { key, user };
    }
  }
  return null;
}

/**
 * Upsert a user record (from Breathecode profile). Updates lastLoginAt.
 * Resolves existing rows by username or email so role assignments are not lost
 * when Breathecode username differs from an email-keyed store entry.
 * Migrates the store key to `profile.username` when a legacy email key is found.
 */
export function upsertUser(profile: {
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): UserRecord {
  ensureLoaded();
  const found = findUserEntry(profile.username, profile.email);
  const existing = found?.user;
  const id =
    existing?.id ??
    generateUniqueStaffId({ username: profile.username, email: profile.email ?? existing?.email });
  const record: UserRecord = {
    id,
    username: profile.username,
    firstName: profile.firstName ?? existing?.firstName,
    lastName: profile.lastName ?? existing?.lastName,
    email: profile.email ?? existing?.email,
    lastLoginAt: new Date().toISOString(),
    roles: existing?.roles ? [...existing.roles] : [],
  };
  state.users[profile.username] = record;
  if (found && found.key !== profile.username) {
    delete state.users[found.key];
  }
  save();
  return record;
}

/**
 * Assign roles to a user, replacing all existing assignments.
 * Optional email helps resolve legacy email-keyed store rows.
 */
export function assignRoles(username: string, roleIds: string[], email?: string): void {
  ensureLoaded();
  const found = findUserEntry(username, email);
  const key = found?.key ?? username;
  if (!state.users[key]) {
    state.users[key] = {
      id: generateUniqueStaffId({ username, email }),
      username,
      email,
      roles: [],
    };
  } else if (!state.users[key].id) {
    ensureUserHasId(key);
  }
  state.users[key].roles = roleIds;
  if (key !== username && !state.users[username]) {
    // Keep canonical username key in sync after assign
    state.users[username] = { ...state.users[key], username };
    delete state.users[key];
  }
  save();
}

/** Resolve immutable staff id for labels; assigns one if missing. */
export function getOrCreateStaffUserId(username: string, email?: string): string | null {
  ensureLoaded();
  const found = findUserEntry(username, email);
  if (!found) return null;
  if (found.user.id) return found.user.id;
  const id = generateUniqueStaffId({
    username,
    email: found.user.email ?? email,
  });
  state.users[found.key].id = id;
  save();
  return id;
}

/**
 * Get all effective capability grants for a user (union across all their roles).
 * Resolves by username key or email so lookups match upsertUser identity rules.
 */
export function getEffectiveCapabilities(username: string, email?: string): CapabilityGrant[] {
  ensureLoaded();
  const found = findUserEntry(username, email);
  const user = found?.user;
  if (!user) return [];

  const grantMap = new Map<string, CapabilityGrant>();

  for (const roleId of user.roles) {
    const role = state.roles[roleId];
    if (!role) continue;
    for (const grant of role.capabilities) {
      const existing = grantMap.get(grant.name);
      if (!existing) {
        grantMap.set(grant.name, { ...grant });
      } else {
        // Merge: "*" wins over a specific list
        if (existing.contentTypes === "*" || grant.contentTypes === "*") {
          grantMap.set(grant.name, { name: grant.name, contentTypes: "*" });
        } else if (existing.contentTypes && grant.contentTypes) {
          const merged = Array.from(
            new Set([
              ...(existing.contentTypes as string[]),
              ...(grant.contentTypes as string[]),
            ])
          );
          grantMap.set(grant.name, { name: grant.name, contentTypes: merged });
        }
      }
    }
  }

  return Array.from(grantMap.values());
}

/** Roles for a staff identity (username and/or email). */
export function getUserRoles(username: string, email?: string): string[] {
  ensureLoaded();
  return findUserEntry(username, email)?.user.roles ?? [];
}

function grantAllowsCap(
  grant: CapabilityGrant | undefined,
  capName: CapabilityName,
  contentType?: string,
): boolean {
  if (!grant) return false;

  if (SCOPED_CAPABILITIES.includes(capName as ScopedCapability)) {
    if (!contentType) {
      // No content type provided — only allow if the grant covers all content types.
      // Fail-closed for any scoped grant to prevent bypass via missing scope.
      return grant.contentTypes === "*";
    }
    if (grant.contentTypes === "*") return true;
    if (Array.isArray(grant.contentTypes)) {
      return grant.contentTypes.includes(contentType);
    }
    return false;
  }

  return true;
}

/**
 * Check if a user has a specific capability, optionally scoped to a content type.
 */
export function hasCapability(
  username: string,
  capName: CapabilityName,
  contentType?: string
): boolean {
  if (hasWebmasterRole(username)) return true;

  const caps = getEffectiveCapabilities(username);
  return grantAllowsCap(
    caps.find((g) => g.name === capName),
    capName,
    contentType,
  );
}

/** Whether the user is assigned the given role id. */
export function userHasRole(username: string, roleId: string, email?: string): boolean {
  return getUserRoles(username, email).includes(roleId);
}

/**
 * Capability check against a single role's grants only (no webmaster bypass).
 * Returns false if the user is not assigned the role or the role does not exist.
 */
export function hasCapabilityInRole(
  username: string,
  roleId: string,
  capName: CapabilityName,
  contentType?: string,
  email?: string,
): boolean {
  if (!userHasRole(username, roleId, email)) return false;
  ensureLoaded();
  const role = state.roles[roleId];
  if (!role) return false;
  return grantAllowsCap(
    role.capabilities.find((g) => g.name === capName),
    capName,
    contentType,
  );
}

export function getAllUsers(): UserRecord[] {
  ensureLoaded();
  return Object.values(state.users);
}

export function getUser(username: string): UserRecord | null {
  ensureLoaded();
  return state.users[username] ?? null;
}

/** Look up a staff user by immutable staff id (used in `_label.requester` / `owner`). */
export function getUserByStaffId(staffId: string): UserRecord | null {
  ensureLoaded();
  if (!staffId) return null;
  for (const user of Object.values(state.users)) {
    if (user.id === staffId) return user;
  }
  return null;
}

/** Display name for UI: "First Last", else username, else staff id. */
export function formatStaffDisplayName(user: UserRecord): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.username) return user.username;
  return user.id;
}

/** Lightweight roster for label assignee pickers (id + display name). */
export function getStaffDirectory(): Array<{
  id: string;
  username: string;
  displayName: string;
}> {
  ensureLoaded();
  return Object.values(state.users)
    .map((u) => ({
      id: u.id || ensureUserHasId(u.username),
      username: u.username,
      displayName: formatStaffDisplayName(u),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getAllRoles(): Record<string, RoleDefinition> {
  ensureLoaded();
  return { ...state.roles };
}

export function getRole(roleId: string): RoleDefinition | null {
  ensureLoaded();
  return state.roles[roleId] ?? null;
}

export function setRole(roleId: string, definition: RoleDefinition): void {
  ensureLoaded();
  state.roles[roleId] = definition;
  save();
}

export function deleteUser(username: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.users[username]) {
    return { ok: false, error: "User not found" };
  }
  delete state.users[username];
  save();
  return { ok: true };
}

export function renameUser(oldUsername: string, newUsername: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.users[oldUsername]) {
    return { ok: false, error: "User not found" };
  }
  if (state.users[newUsername]) {
    return { ok: false, error: `Username "${newUsername}" is already taken` };
  }
  state.users[newUsername] = { ...state.users[oldUsername], username: newUsername };
  delete state.users[oldUsername];
  save();
  return { ok: true };
}

// ─── Pending Users API ─────────────────────────────────────────────────────────

export function addPendingUser(email: string, role: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return { ok: false, error: "Email is required" };
  if (!state.roles[role]) return { ok: false, error: `Role "${role}" does not exist` };
  state.pendingUsers[normalizedEmail] = {
    email: normalizedEmail,
    role,
    createdAt: new Date().toISOString(),
  };
  save();
  return { ok: true };
}

export function removePendingUser(email: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  if (!state.pendingUsers[normalizedEmail]) {
    return { ok: false, error: "Pending user not found" };
  }
  delete state.pendingUsers[normalizedEmail];
  save();
  return { ok: true };
}

export function getPendingUsers(): PendingUserRecord[] {
  ensureLoaded();
  if (!state.pendingUsers) return [];
  return Object.values(state.pendingUsers);
}

/**
 * If the given email has a pending pre-registration, returns the pre-assigned
 * role and removes the pending entry (one-time claim). Returns null if no match.
 */
export function claimPendingUser(email: string): string | null {
  ensureLoaded();
  if (!state.pendingUsers) return null;
  const normalizedEmail = email.toLowerCase().trim();
  const pending = state.pendingUsers[normalizedEmail];
  if (!pending) return null;
  delete state.pendingUsers[normalizedEmail];
  save();
  return pending.role;
}

/**
 * Manually assign a pending pre-registration to a specific existing user,
 * bypassing email-matching. Grants the role and removes the pending entry.
 */
export function assignPendingToUser(email: string, username: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  const pending = state.pendingUsers[normalizedEmail];
  if (!pending) return { ok: false, error: "Pending user not found" };
  if (!state.users[username]) return { ok: false, error: "User not found" };
  const currentRoles = state.users[username].roles ?? [];
  if (!currentRoles.includes(pending.role)) {
    state.users[username].roles = [...currentRoles, pending.role];
  }
  delete state.pendingUsers[normalizedEmail];
  save();
  return { ok: true };
}

/**
 * True when the user can mutate metrics surfaces (run diagnostics, rebuild insights,
 * change tracking/conversions). View-only roles (metrics_view and/or content_view only) cannot.
 */
export function canMutateMetrics(username: string): boolean {
  ensureLoaded();
  if (hasWebmasterRole(username)) return true;
  return grantsCanMutateMetrics(getEffectiveCapabilities(username));
}

export function deleteRole(roleId: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (isBuiltInRole(roleId)) {
    return { ok: false, error: `The built-in ${roleId} role cannot be deleted` };
  }
  if (!state.roles[roleId]) {
    return { ok: false, error: "Role not found" };
  }
  const usersWithRole = Object.values(state.users).filter((u) =>
    u.roles.includes(roleId)
  );
  if (usersWithRole.length > 0) {
    return {
      ok: false,
      error: `Role is assigned to ${usersWithRole.length} user(s). Remove the role from those users first.`,
    };
  }
  delete state.roles[roleId];
  save();
  return { ok: true };
}
