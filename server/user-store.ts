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
  MCP_WRITE_OFF_CAPABILITIES,
  getCapabilityScopeKind,
  type ScopedCapability,
  type GlobalCapability,
  type CapabilityName,
  type CapabilityScopeKind,
} from "../shared/capabilities";
import {
  AGENTIC_SWARM_ROLE_IDS,
  AGENTIC_SWARM_ROLES_BY_ID,
  isAgenticSwarmRoleId,
  type AgenticSwarmRoleId,
} from "../shared/agentic-swarm-roles";
import { child } from "./logger";
const log = child({ module: "user-store" });

export type { ScopedCapability, GlobalCapability, CapabilityName, CapabilityScopeKind };
export {
  SCOPED_CAPABILITIES,
  GLOBAL_CAPABILITIES,
  ALL_CAPABILITIES,
  CAPABILITY_REGISTRY,
  getCapabilityScopeKind,
};
export {
  AGENTIC_SWARM_ROLE_IDS,
  AGENTIC_SWARM_ROLES_BY_ID,
  isAgenticSwarmRoleId,
};

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
  /** Scope for content_types caps (`*` = all current and future types). */
  contentTypes?: string[] | "*";
  /** Scope for databases caps (`*` = all current and future private DBs). */
  databases?: string[] | "*";
}

function cloneGrant(g: CapabilityGrant): CapabilityGrant {
  return {
    name: g.name,
    ...(g.contentTypes !== undefined ? { contentTypes: g.contentTypes } : {}),
    ...(g.databases !== undefined ? { databases: g.databases } : {}),
  };
}

function mergeScopeField(
  a: string[] | "*" | undefined,
  b: string[] | "*" | undefined,
): string[] | "*" | undefined {
  if (a === "*" || b === "*") return "*";
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from(new Set([...a, ...b]));
  }
  if (Array.isArray(a)) return [...a];
  if (Array.isArray(b)) return [...b];
  return undefined;
}

export interface RoleDefinition {
  label: string;
  description?: string;
  capabilities: CapabilityGrant[];
  /** True = MCP swarm agent role (hidden from Security Roles list). */
  agentic?: boolean;
}

export interface StaffProviderIdentity {
  provider: string;
  /** Immutable provider user id (GitHub numeric id as string). */
  providerUserId: string;
  /** Current handle for display (GitHub login). */
  handle?: string;
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
  identities?: StaffProviderIdentity[];
  /** Cached GitHub login for commits/display; not used for identity matching. */
  githubLogin?: string;
  /**
   * MCP-only access overlay (CMS roles unchanged).
   * Missing read ⇒ on; missing write ⇒ off (freestyle is explicit allowlist).
   * Write requires read (read off ⇒ write off).
   */
  mcpReadEnabled?: boolean;
  mcpWriteEnabled?: boolean;
  /** Soft delete: record kept for history (staff id, identities), roles cleared. */
  deletedAt?: string;
  /** Username of the admin who deleted this user. */
  deletedBy?: string;
}

/** Normalized MCP access flags (defaults: read on, write off; write implies read). */
export interface McpAccess {
  mcpReadEnabled: boolean;
  mcpWriteEnabled: boolean;
}

export interface PreviouslyDeletedInfo {
  username: string;
  staffId: string;
  deletedAt: string;
  deletedBy?: string;
}

export interface PendingUserRecord {
  email: string;
  /** Pre-assigned role. Absent on previously-deleted sign-in attempts (admin restores instead). */
  role?: string;
  createdAt: string;
  /** Set when a soft-deleted user tried to sign in again. */
  previouslyDeleted?: PreviouslyDeletedInfo;
  lastAttemptAt?: string;
}

interface UsersState {
  roles: Record<string, RoleDefinition>;
  users: Record<string, UserRecord>;
  pendingUsers?: Record<string, PendingUserRecord>;
  /** Staff ids of permanently removed duplicate records → surviving staff id. */
  staffIdAliases?: Record<string, string>;
  /** Staff-edited MCP descriptions for built-in roles (capabilities still come from code). */
  builtInDescriptionOverrides?: Record<string, string>;
  /** One-time role migrations already applied (so staff removals are not re-granted on boot). */
  appliedMigrations?: string[];
}

// ─── Built-in roles ────────────────────────────────────────────────────────────

export const BUILT_IN_ROLE_IDS = [
  "user_admin",
  "platform_steward",
  "platform_ops",
  "metrics_viewer",
  "content_viewer",
  "ads_manager",
] as const;
export type BuiltInRoleId = (typeof BUILT_IN_ROLE_IDS)[number];

/** Deprecated MCP connector id — resolves to user_admin for one release. */
export const DEPRECATED_MCP_ROLE_ALIASES: Readonly<Record<string, string>> = {
  webmaster: "user_admin",
};

export function resolveMcpRoleId(roleId: string): string {
  return DEPRECATED_MCP_ROLE_ALIASES[roleId] ?? roleId;
}

export function isBuiltInRole(roleId: string): boolean {
  return (BUILT_IN_ROLE_IDS as readonly string[]).includes(roleId);
}

/** Built-in staff roles or code-seeded agentic swarm pack — not deletable from admin. */
export function isProtectedRole(roleId: string): boolean {
  return isBuiltInRole(roleId) || isAgenticSwarmRoleId(roleId);
}

const BUILT_IN_USER_ADMIN_ROLE: RoleDefinition = {
  label: "User Admin",
  description:
    "Assign roles and manage staff access. Use /mcp/role/user_admin only for access tasks — not content, SEO, or infrastructure.",
  capabilities: [{ name: "users_manage" }],
};

const BUILT_IN_PLATFORM_STEWARD_ROLE: RoleDefinition = {
  label: "Platform Steward",
  description:
    "Site health: diagnostics, runtime issues, redirects, SEO and Ads settings, cookie consent window, A/B testing setup and checks (staff UI), content-type schema, private database definitions, row edits in the press_mentions database (company news and announcements), and full proposal create/review (bulk proposal delete and live-ad edits are staff UI only, never via MCP). Use /mcp/role/platform_steward for update_content_type, create_or_update_database, reindex_database, and add/update/delete_database_item on press_mentions as well as SEO and redirect writes — not for row CRUD in any other database (needs Edit database data for that bank), user admin, or infrastructure. For paid-ads-only work prefer /mcp/role/ads_manager.",
  capabilities: [
    { name: "metrics_view" },
    { name: "content_view", contentTypes: "*" },
    { name: "seo_edit", contentTypes: "*" },
    { name: "read_redirects" },
    { name: "edit_redirects" },
    { name: "overlays_configure" },
    { name: "seo_settings" },
    { name: "ads_settings" },
    { name: "ads_edit" },
    { name: "consent_settings" },
    { name: "ab_testing_settings" },
    { name: "components_manage" },
    { name: "content_types_manage" },
    { name: "databases_manage" },
    { name: "databases_view" },
    { name: "databases_edit_data", databases: ["press_mentions"] },
    { name: "proposals_create" },
    { name: "proposals_review" },
    { name: "proposals_delete" },
  ],
};

const BUILT_IN_PLATFORM_OPS_ROLE: RoleDefinition = {
  label: "Platform Ops",
  description:
    "Infrastructure: sites.yml, new sites, Sidequest restart/dashboard. Use /mcp/role/platform_ops — not for content edits or user management.",
  capabilities: [
    { name: "sites_manage" },
    { name: "worker_manage" },
    { name: "migrations_run" },
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
    "Read-only content and playbooks (YAML entries, type contracts, component schemas) plus private databases and their rows. Cannot write entries, database rows, SEO, redirects, or run mutating diagnostics.",
  capabilities: [
    { name: "content_view", contentTypes: "*" },
    { name: "databases_view" },
  ],
};

const BUILT_IN_ADS_MANAGER_ROLE: RoleDefinition = {
  label: "Ads Manager",
  description:
    "Paid ads: read ads diagnostics, paid traffic, conversions and content, manage Meta ad account settings and syncs, and file proposals for landing pages. Use /mcp/role/ads_manager for paid-traffic analysis and proposals — not for editing live ads (staff UI only), cookie consent, content or SEO writes. Unlike metrics_viewer it can change Ads settings; unlike platform_steward it has no SEO, redirect, schema or consent access.",
  capabilities: [
    { name: "metrics_view" },
    { name: "content_view", contentTypes: "*" },
    { name: "ads_settings" },
    { name: "ads_edit" },
    { name: "proposals_create" },
  ],
};

const BUILT_IN_ROLES_BY_ID: Record<BuiltInRoleId, RoleDefinition> = {
  user_admin: BUILT_IN_USER_ADMIN_ROLE,
  platform_steward: BUILT_IN_PLATFORM_STEWARD_ROLE,
  platform_ops: BUILT_IN_PLATFORM_OPS_ROLE,
  metrics_viewer: BUILT_IN_METRICS_VIEWER_ROLE,
  content_viewer: BUILT_IN_CONTENT_VIEWER_ROLE,
  ads_manager: BUILT_IN_ADS_MANAGER_ROLE,
};

function cloneRoleDefinition(def: RoleDefinition): RoleDefinition {
  return {
    label: def.label,
    description: def.description,
    capabilities: def.capabilities.map(cloneGrant),
    ...(def.agentic ? { agentic: true } : {}),
  };
}

function agenticSwarmRoleFromCode(roleId: AgenticSwarmRoleId): RoleDefinition {
  const def = AGENTIC_SWARM_ROLES_BY_ID[roleId];
  return cloneRoleDefinition({
    label: def.label,
    description: def.description,
    capabilities: def.capabilities.map(cloneGrant),
    agentic: true,
  });
}

/**
 * Seed / refresh agentic swarm roles from code.
 * Missing → create. Present with agentic → refresh label/caps/description.
 * Never marks a non-agentic custom role as agentic.
 * @returns true when at least one role was newly created (caller should persist).
 */
export function ensureAgenticSwarmRoles(roles: Record<string, RoleDefinition>): boolean {
  let created = false;
  for (const roleId of AGENTIC_SWARM_ROLE_IDS) {
    const codeDef = agenticSwarmRoleFromCode(roleId);
    const existing = roles[roleId];
    if (!existing) {
      roles[roleId] = codeDef;
      created = true;
      continue;
    }
    if (!existing.agentic) {
      // Do not overwrite a staff custom role that reused the id.
      continue;
    }
    roles[roleId] = codeDef;
  }
  return created;
}

/** Code-shipped definition for a built-in role (before staff description override). */
export function getBuiltInRoleCodeDefinition(roleId: string): RoleDefinition | null {
  if (!isBuiltInRole(roleId)) return null;
  return cloneRoleDefinition(BUILT_IN_ROLES_BY_ID[roleId as BuiltInRoleId]);
}

const DEFAULT_STATE: UsersState = {
  roles: {
    user_admin: BUILT_IN_USER_ADMIN_ROLE,
    platform_steward: BUILT_IN_PLATFORM_STEWARD_ROLE,
    platform_ops: BUILT_IN_PLATFORM_OPS_ROLE,
    metrics_viewer: BUILT_IN_METRICS_VIEWER_ROLE,
    content_viewer: BUILT_IN_CONTENT_VIEWER_ROLE,
    ads_manager: BUILT_IN_ADS_MANAGER_ROLE,
  },
  users: {},
};

/** Overwrite built-in role label/caps from code; merge staff MCP description overrides. */
function syncBuiltInRoles(): void {
  if (!state.roles) state.roles = {};
  const overrides = state.builtInDescriptionOverrides ?? {};
  for (const roleId of BUILT_IN_ROLE_IDS) {
    const codeDef = cloneRoleDefinition(BUILT_IN_ROLES_BY_ID[roleId]);
    const override = overrides[roleId]?.trim();
    state.roles[roleId] = override ? { ...codeDef, description: override } : codeDef;
  }
}

export function getBuiltInDescriptionOverrides(): Record<string, string> {
  ensureLoaded();
  return { ...(state.builtInDescriptionOverrides ?? {}) };
}

export function hasBuiltInDescriptionOverride(roleId: string): boolean {
  ensureLoaded();
  return Boolean(state.builtInDescriptionOverrides?.[roleId]?.trim());
}

export function setBuiltInRoleDescription(
  roleId: string,
  description: string,
): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!isBuiltInRole(roleId)) {
    return { ok: false, error: `Role "${roleId}" is not a built-in role` };
  }
  const trimmed = description.trim();
  if (!trimmed) {
    return { ok: false, error: "Description for AI agents is required" };
  }
  if (!state.builtInDescriptionOverrides) state.builtInDescriptionOverrides = {};
  state.builtInDescriptionOverrides[roleId] = trimmed;
  syncBuiltInRoles();
  save();
  return { ok: true };
}

export function clearBuiltInRoleDescription(roleId: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!isBuiltInRole(roleId)) {
    return { ok: false, error: `Role "${roleId}" is not a built-in role` };
  }
  if (state.builtInDescriptionOverrides?.[roleId]) {
    delete state.builtInDescriptionOverrides[roleId];
    if (Object.keys(state.builtInDescriptionOverrides).length === 0) {
      delete state.builtInDescriptionOverrides;
    }
  }
  syncBuiltInRoles();
  save();
  return { ok: true };
}

/**
 * Migrate legacy webmaster role assignments to user_admin and remove the old role definition.
 * Idempotent — safe on every load.
 */
export function migrateWebmasterToUserAdmin(
  users: Record<string, UserRecord>,
  roles: Record<string, RoleDefinition>,
  pendingUsers?: Record<string, PendingUserRecord>,
): boolean {
  let changed = false;

  for (const user of Object.values(users)) {
    if (!user.roles.includes("webmaster")) continue;
    const withoutWebmaster = user.roles.filter((r) => r !== "webmaster");
    user.roles = withoutWebmaster.includes("user_admin")
      ? withoutWebmaster
      : [...withoutWebmaster, "user_admin"];
    changed = true;
  }

  if (pendingUsers) {
    for (const pending of Object.values(pendingUsers)) {
      if (pending.role === "webmaster") {
        pending.role = "user_admin";
        changed = true;
      }
    }
  }

  if (roles.webmaster) {
    delete roles.webmaster;
    changed = true;
  }

  return changed;
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
 * Add content_delete_variant to custom roles that can create variants but cannot delete them.
 * Mirrors content_create_variant scope. Built-in roles are skipped.
 */
export function ensureDeleteVariantOnCreateVariantRoles(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    const createGrant = role.capabilities.find((g) => g.name === "content_create_variant");
    if (!createGrant) continue;
    if (role.capabilities.some((g) => g.name === "content_delete_variant")) continue;
    role.capabilities = [
      ...role.capabilities,
      {
        name: "content_delete_variant",
        ...(createGrant.contentTypes !== undefined
          ? { contentTypes: createGrant.contentTypes }
          : {}),
      },
    ];
    changed = true;
  }
  return changed;
}

/**
 * Add content_view to custom editor roles that have mutate caps but no view grant.
 * Built-in roles are skipped (synced from code). Returns true if any role changed.
 *
 * Triggers on CONTENT_MUTATE_CAPABILITIES (incl. scoped seo_edit) or edit_redirects.
 * edit_redirects alone → content_view with "*".
 */
export function ensureContentViewOnEditorRoles(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (role.capabilities.some((g) => g.name === "content_view")) continue;

    const mutateGrants = role.capabilities.filter((g) =>
      (CONTENT_MUTATE_CAPABILITIES as readonly string[]).includes(g.name),
    );
    const hasEditRedirects = role.capabilities.some((g) => g.name === "edit_redirects");
    if (mutateGrants.length === 0 && !hasEditRedirects) continue;

    const contentTypes =
      mutateGrants.length > 0 ? unionContentTypeScopes(mutateGrants) : ("*" as const);

    role.capabilities = [
      { name: "content_view", contentTypes },
      ...role.capabilities,
    ];
    changed = true;
  }
  return changed;
}

/**
 * Expand legacy global seo_edit on custom roles to the split caps.
 * Preserves existing seo_edit grant; fills missing contentTypes with "*".
 * Returns true if changed.
 */
export function migrateSeoEditSplit(roles: Record<string, RoleDefinition>): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    const seoGrant = role.capabilities.find((g) => g.name === "seo_edit");
    if (!seoGrant) continue;

    if (seoGrant.contentTypes === undefined) {
      seoGrant.contentTypes = "*";
      changed = true;
    }

    const names = new Set(role.capabilities.map((g) => g.name));
    const toAdd: CapabilityGrant[] = [];
    if (!names.has("read_redirects")) toAdd.push({ name: "read_redirects" });
    if (!names.has("edit_redirects")) toAdd.push({ name: "edit_redirects" });
    if (!names.has("seo_settings")) toAdd.push({ name: "seo_settings" });
    if (toAdd.length === 0) continue;

    role.capabilities = [...role.capabilities, ...toAdd];
    changed = true;
  }
  return changed;
}

/**
 * Soft-migrate custom roles that have Edit text on all content types:
 * add databases_edit_data with databases: "*".
 * Built-ins (incl. platform_steward) are skipped — steward keeps databases_manage only.
 * Blog-only (or any non-"*") content_edit_text does not auto-grant.
 */
export function ensureDatabasesEditDataOnAllContentEditors(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (role.capabilities.some((g) => g.name === "databases_edit_data")) continue;

    const textGrant = role.capabilities.find((g) => g.name === "content_edit_text");
    if (!textGrant || textGrant.contentTypes !== "*") continue;

    role.capabilities = [
      ...role.capabilities,
      { name: "databases_edit_data", databases: "*" },
    ];
    changed = true;
  }
  return changed;
}

/**
 * Soft-migrate custom roles: text or SEO editors get proposals_create so they can still file proposals.
 * Does not grant proposals_review — assign Proposal Reviewer or Publisher (or platform_steward) for decide.
 */
export function ensureProposalsCreateOnContentEditors(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (role.capabilities.some((g) => g.name === "proposals_create")) continue;

    const hasTextOrSeo = role.capabilities.some(
      (g) => g.name === "content_edit_text" || g.name === "seo_edit",
    );
    if (!hasTextOrSeo) continue;

    role.capabilities = [...role.capabilities, { name: "proposals_create" }];
    changed = true;
  }
  return changed;
}

/**
 * Soft-migrate custom roles: site-wide SEO settings managers also get ads_settings
 * (Meta Ads connection + cookie consent window) so the new surfaces are not orphaned.
 */
export function ensureAdsSettingsOnSeoSettingsRoles(
  roles: Record<string, RoleDefinition>,
): boolean {
  let changed = false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (role.capabilities.some((g) => g.name === "ads_settings")) continue;
    if (!role.capabilities.some((g) => g.name === "seo_settings")) continue;
    role.capabilities = [...role.capabilities, { name: "ads_settings" }];
    changed = true;
  }
  return changed;
}

export const CONSENT_SETTINGS_SPLIT_MIGRATION = "consent_settings_split";

/**
 * One-time: custom roles that could edit the consent window via ads_settings keep that
 * access through consent_settings. Recorded in `applied` so a later staff removal sticks.
 * @returns true when roles or `applied` changed (caller should persist).
 */
export function ensureConsentSettingsOnAdsSettingsRoles(
  roles: Record<string, RoleDefinition>,
  applied: string[],
): boolean {
  if (applied.includes(CONSENT_SETTINGS_SPLIT_MIGRATION)) return false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (!role.capabilities.some((g) => g.name === "ads_settings")) continue;
    if (role.capabilities.some((g) => g.name === "consent_settings")) continue;
    role.capabilities = [...role.capabilities, { name: "consent_settings" }];
  }
  applied.push(CONSENT_SETTINGS_SPLIT_MIGRATION);
  return true;
}

export const DATABASES_VIEW_CONTENT_EDITORS_MIGRATION = "databases_view_content_editors";

/**
 * One-time: custom roles that can edit text (any scope) get View databases so editors can
 * see what the private databases hold. Skips roles that already browse databases via
 * databases_view, databases_edit_data, or databases_manage. Recorded in `applied` so a
 * later staff removal sticks.
 * @returns true when roles or `applied` changed (caller should persist).
 */
export function ensureDatabasesViewOnContentEditors(
  roles: Record<string, RoleDefinition>,
  applied: string[],
): boolean {
  if (applied.includes(DATABASES_VIEW_CONTENT_EDITORS_MIGRATION)) return false;
  for (const [roleId, role] of Object.entries(roles)) {
    if (isBuiltInRole(roleId) || role?.agentic || isAgenticSwarmRoleId(roleId)) continue;
    if (!role?.capabilities) continue;
    if (!role.capabilities.some((g) => g.name === "content_edit_text")) continue;
    const hasBrowse = role.capabilities.some(
      (g) =>
        g.name === "databases_view" ||
        g.name === "databases_edit_data" ||
        g.name === "databases_manage",
    );
    if (hasBrowse) continue;
    role.capabilities = [...role.capabilities, { name: "databases_view" }];
  }
  applied.push(DATABASES_VIEW_CONTENT_EDITORS_MIGRATION);
  return true;
}

/** True when grants include a mutating cap (not only metrics_view / content_view). */
export function grantsCanMutateMetrics(caps: CapabilityGrant[]): boolean {
  return caps.some((g) => !VIEW_ONLY_CAPABILITIES.has(g.name));
}

function finishLoad(persist: "local" | "all"): void {
  syncBuiltInRoles();
  if (!state.users) state.users = {};
  backfillMissingUserIds();
  if (migrateWebmasterToUserAdmin(state.users, state.roles, state.pendingUsers)) {
    log.info("[UserStore] Migrated webmaster role assignments to user_admin");
  }
  if (migrateSeoEditSplit(state.roles)) {
    log.info("[UserStore] Migrated custom roles: expanded seo_edit to redirect + settings caps");
  }
  if (ensureContentViewOnEditorRoles(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added content_view from editor capabilities");
  }
  if (ensureDeleteVariantOnCreateVariantRoles(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added content_delete_variant from content_create_variant");
  }
  if (ensureDatabasesEditDataOnAllContentEditors(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added databases_edit_data from content_edit_text:*");
  }
  if (ensureProposalsCreateOnContentEditors(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added proposals_create from content_edit_text|seo_edit");
  }
  if (ensureAdsSettingsOnSeoSettingsRoles(state.roles)) {
    log.info("[UserStore] Migrated custom roles: added ads_settings from seo_settings");
  }
  if (!state.appliedMigrations) state.appliedMigrations = [];
  if (ensureConsentSettingsOnAdsSettingsRoles(state.roles, state.appliedMigrations)) {
    log.info("[UserStore] Migrated custom roles: added consent_settings from ads_settings (one-time)");
  }
  if (ensureDatabasesViewOnContentEditors(state.roles, state.appliedMigrations)) {
    log.info("[UserStore] Migrated custom roles: added databases_view from content_edit_text (one-time)");
  }
  if (ensureAgenticSwarmRoles(state.roles)) {
    log.info("[UserStore] Seeded agentic swarm roles");
  }
  if (persist === "all") save();
  else saveLocal();
}

// ─── In-memory state ───────────────────────────────────────────────────────────

let state: UsersState = { roles: { ...DEFAULT_STATE.roles }, users: {} };
let loaded = false;
let persistenceDisabledForTests = false;

/** Tests only: replace in-memory users/pending/aliases and stop writing to disk or GCS. */
export function _setUsersStateForTests(next: {
  users?: Record<string, UserRecord>;
  pendingUsers?: Record<string, PendingUserRecord>;
  staffIdAliases?: Record<string, string>;
}): void {
  persistenceDisabledForTests = true;
  state = {
    roles: { ...DEFAULT_STATE.roles },
    users: next.users ?? {},
    pendingUsers: next.pendingUsers ?? {},
    staffIdAliases: next.staffIdAliases ?? {},
  };
  syncBuiltInRoles();
  loaded = true;
}

// ─── Persistence ───────────────────────────────────────────────────────────────

function saveLocal(): void {
  if (persistenceDisabledForTests) return;
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
  if (persistenceDisabledForTests || !IS_PRODUCTION || !gcs.available) return;
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
    const seeded = ensureAgenticSwarmRoles(state.roles);
    loaded = true;
    if (seeded) {
      log.info("[UserStore] Seeded agentic swarm roles");
      save();
    }
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
  for (const aliasId of Object.keys(state.staffIdAliases ?? {})) ids.add(aliasId);
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
  const taken = new Set<string>(Object.keys(state.staffIdAliases ?? {}));
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
 * Returns true when no user holds user_admin — first login should bootstrap access management.
 */
export function needsBootstrapAdmin(): boolean {
  ensureLoaded();
  return !Object.values(state.users).some((u) => u.roles.includes("user_admin"));
}

/** @deprecated Use needsBootstrapAdmin */
export function isFirstUser(): boolean {
  return needsBootstrapAdmin();
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
    identities: existing?.identities ? [...existing.identities] : undefined,
    githubLogin: existing?.githubLogin,
    mcpReadEnabled: existing?.mcpReadEnabled,
    mcpWriteEnabled: existing?.mcpWriteEnabled,
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

/** Normalize raw/missing MCP flags. Missing read ⇒ on; missing write ⇒ off; write requires read. */
export function normalizeMcpAccess(
  user?: Pick<UserRecord, "mcpReadEnabled" | "mcpWriteEnabled"> | null,
): McpAccess {
  const mcpReadEnabled = user?.mcpReadEnabled !== false;
  const mcpWriteEnabled = mcpReadEnabled && user?.mcpWriteEnabled === true;
  return { mcpReadEnabled, mcpWriteEnabled };
}

/** MCP access for a staff identity (defaults when user missing: read on, write off). */
export function getMcpAccess(username: string, email?: string): McpAccess {
  ensureLoaded();
  const found = findUserEntry(username, email);
  return normalizeMcpAccess(found?.user ?? null);
}

/**
 * Persist MCP read/write flags. Write is forced off when read is off.
 */
export function setMcpAccess(
  username: string,
  flags: { mcpReadEnabled?: boolean; mcpWriteEnabled?: boolean },
  email?: string,
): { ok: boolean; error?: string; access?: McpAccess } {
  ensureLoaded();
  const found = findUserEntry(username, email);
  if (!found) return { ok: false, error: "User not found" };

  const current = normalizeMcpAccess(found.user);
  const mcpReadEnabled =
    flags.mcpReadEnabled !== undefined ? flags.mcpReadEnabled : current.mcpReadEnabled;
  let mcpWriteEnabled =
    flags.mcpWriteEnabled !== undefined ? flags.mcpWriteEnabled : current.mcpWriteEnabled;
  if (!mcpReadEnabled) mcpWriteEnabled = false;

  state.users[found.key].mcpReadEnabled = mcpReadEnabled;
  state.users[found.key].mcpWriteEnabled = mcpWriteEnabled;
  save();
  return { ok: true, access: { mcpReadEnabled, mcpWriteEnabled } };
}

/** Apply MCP access overlay (propose-only intersect when write off). */
export function applyMcpAccessToGrants(
  grants: CapabilityGrant[],
  access: McpAccess,
): CapabilityGrant[] {
  if (!access.mcpReadEnabled) return [];
  if (!access.mcpWriteEnabled) {
    return grants.filter((g) => MCP_WRITE_OFF_CAPABILITIES.has(g.name));
  }
  return grants;
}

/**
 * True when MCP may use this capability under the user's MCP access overlay.
 * Read off ⇒ false. Write off ⇒ only MCP_WRITE_OFF_CAPABILITIES.
 */
export function mcpAccessAllowsCapability(access: McpAccess, capName: string): boolean {
  if (!access.mcpReadEnabled) return false;
  if (!access.mcpWriteEnabled) {
    return MCP_WRITE_OFF_CAPABILITIES.has(capName as CapabilityName);
  }
  return true;
}

/**
 * Role-union capabilities after MCP read/write overlay.
 * Used by MCP user-info / catalog — not by CMS validate-token.
 */
export function getMcpEffectiveCapabilities(username: string, email?: string): CapabilityGrant[] {
  return applyMcpAccessToGrants(
    getEffectiveCapabilities(username, email),
    getMcpAccess(username, email),
  );
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
        grantMap.set(grant.name, cloneGrant(grant));
      } else {
        const merged: CapabilityGrant = { name: grant.name };
        const contentTypes = mergeScopeField(existing.contentTypes, grant.contentTypes);
        const databases = mergeScopeField(existing.databases, grant.databases);
        if (contentTypes !== undefined) merged.contentTypes = contentTypes;
        if (databases !== undefined) merged.databases = databases;
        grantMap.set(grant.name, merged);
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

/**
 * Whether a single grant authorizes `capName`.
 * For content_types / databases scopeKind, `scope` is the content-type id or DB slug.
 * Omit scope → fail-closed unless the grant is `"*"`.
 */
export function grantAllowsCap(
  grant: CapabilityGrant | undefined,
  capName: CapabilityName,
  scope?: string,
): boolean {
  if (!grant) return false;

  const kind = getCapabilityScopeKind(capName);
  if (kind === "content_types") {
    if (!scope) {
      // No content type provided — only allow if the grant covers all content types.
      // Fail-closed for any scoped grant to prevent bypass via missing scope.
      return grant.contentTypes === "*";
    }
    if (grant.contentTypes === "*") return true;
    if (Array.isArray(grant.contentTypes)) {
      return grant.contentTypes.includes(scope);
    }
    return false;
  }

  if (kind === "databases") {
    if (!scope) {
      return grant.databases === "*";
    }
    if (grant.databases === "*") return true;
    if (Array.isArray(grant.databases)) {
      return grant.databases.includes(scope);
    }
    return false;
  }

  return true;
}

/**
 * Check if a user has a specific capability.
 * Optional `scope` is a content-type id or database slug depending on the cap's scopeKind.
 */
export function hasCapability(
  username: string,
  capName: CapabilityName,
  scope?: string
): boolean {
  const caps = getEffectiveCapabilities(username);
  return grantAllowsCap(
    caps.find((g) => g.name === capName),
    capName,
    scope,
  );
}

/**
 * True when a databases_edit_data grant authorizes browse (any bank list/get).
 * Requires `*` or a non-empty slug list — omit/empty fails closed.
 * Used by grantsAllowDatabasesBrowse (OR databases_manage / databases_view).
 */
export function grantAllowsAnyDatabasesEditDataAccess(
  grant: CapabilityGrant | undefined,
): boolean {
  if (!grant || grant.name !== "databases_edit_data") return false;
  if (grant.databases === "*") return true;
  return Array.isArray(grant.databases) && grant.databases.length > 0;
}

/**
 * True when the user may browse any private database (list/get items/config).
 * Requires databases_edit_data with `*` or a non-empty slug list — omit/empty fails closed.
 * Callers that also accept Manage databases should OR hasCapability(..., "databases_manage").
 */
export function hasAnyDatabasesEditDataAccess(username: string): boolean {
  const grant = getEffectiveCapabilities(username).find((g) => g.name === "databases_edit_data");
  return grantAllowsAnyDatabasesEditDataAccess(grant);
}

/**
 * True when grants allow browsing private databases (list/get items/config):
 * databases_manage, databases_view, or databases_edit_data with `*` / a non-empty slug list.
 */
export function grantsAllowDatabasesBrowse(caps: CapabilityGrant[]): boolean {
  if (caps.some((g) => g.name === "databases_manage" || g.name === "databases_view")) return true;
  return grantAllowsAnyDatabasesEditDataAccess(caps.find((g) => g.name === "databases_edit_data"));
}

export function hasDatabasesBrowseAccess(username: string): boolean {
  return grantsAllowDatabasesBrowse(getEffectiveCapabilities(username));
}

/** Whether the user is assigned the given role id. */
export function userHasRole(username: string, roleId: string, email?: string): boolean {
  return getUserRoles(username, email).includes(roleId);
}

/**
 * Capability check against a single role's grants only (no union across roles).
 * Returns false if the user is not assigned the role or the role does not exist.
 */
export function hasCapabilityInRole(
  username: string,
  roleId: string,
  capName: CapabilityName,
  scope?: string,
  email?: string,
): boolean {
  if (!userHasRole(username, roleId, email)) return false;
  ensureLoaded();
  const role = state.roles[roleId];
  if (!role) return false;
  return grantAllowsCap(
    role.capabilities.find((g) => g.name === capName),
    capName,
    scope,
  );
}

/** All records, including soft-deleted ones. */
export function getAllUsers(): UserRecord[] {
  ensureLoaded();
  return Object.values(state.users);
}

export function isUserDeleted(user: UserRecord | null | undefined): boolean {
  return Boolean(user?.deletedAt);
}

export function getActiveUsers(): UserRecord[] {
  ensureLoaded();
  return Object.values(state.users).filter((u) => !u.deletedAt);
}

export function getDeletedUsers(): UserRecord[] {
  ensureLoaded();
  return Object.values(state.users).filter((u) => Boolean(u.deletedAt));
}

export function getUser(username: string): UserRecord | null {
  ensureLoaded();
  return state.users[username] ?? null;
}

const STAFF_ID_ALIAS_MAX_HOPS = 5;

/**
 * Look up a staff user by immutable staff id (used in `_label.requester` / `owner`).
 * Follows `staffIdAliases` so history from removed duplicate records resolves to the survivor.
 */
export function getUserByStaffId(staffId: string): UserRecord | null {
  ensureLoaded();
  if (!staffId) return null;
  let current = staffId;
  for (let hop = 0; hop <= STAFF_ID_ALIAS_MAX_HOPS; hop++) {
    for (const user of Object.values(state.users)) {
      if (user.id === current) return user;
    }
    const next = state.staffIdAliases?.[current];
    if (!next || next === current) return null;
    current = next;
  }
  return null;
}

function normalizeEmail(email?: string): string | undefined {
  const n = email?.toLowerCase().trim();
  return n || undefined;
}

function recordEmails(key: string, user: UserRecord): Set<string> {
  const emails = new Set<string>();
  const fromField = normalizeEmail(user.email);
  if (fromField) emails.add(fromField);
  const keyNorm = key.toLowerCase().trim();
  if (keyNorm.includes("@")) emails.add(keyNorm);
  return emails;
}

function identityKeys(user: UserRecord): Set<string> {
  return new Set(
    (user.identities ?? []).map((id) => `${id.provider}:${id.providerUserId}`),
  );
}

/**
 * Other active (not soft-deleted) records that belong to the same person:
 * same normalized email (field or email-shaped key) or same provider identity.
 * Sorted by most recent sign-in first (records without lastLoginAt last).
 */
export function findActiveDuplicates(username: string): Array<{ key: string; user: UserRecord }> {
  ensureLoaded();
  const target = state.users[username];
  if (!target) return [];
  const emails = recordEmails(username, target);
  const identities = identityKeys(target);
  const matches: Array<{ key: string; user: UserRecord }> = [];
  for (const [key, user] of Object.entries(state.users)) {
    if (key === username || user.deletedAt) continue;
    const sameEmail = Array.from(recordEmails(key, user)).some((e) => emails.has(e));
    const sameIdentity = Array.from(identityKeys(user)).some((i) => identities.has(i));
    if (sameEmail || sameIdentity) matches.push({ key, user });
  }
  return matches.sort((a, b) => {
    const at = a.user.lastLoginAt ? Date.parse(a.user.lastLoginAt) : -Infinity;
    const bt = b.user.lastLoginAt ? Date.parse(b.user.lastLoginAt) : -Infinity;
    return bt - at;
  });
}

/** Find any record (active or soft-deleted) by normalized email (field or email-shaped key). */
export function findUserByEmailIncludingDeleted(
  email: string,
): { key: string; user: UserRecord; deleted: boolean } | null {
  ensureLoaded();
  const wanted = normalizeEmail(email);
  if (!wanted) return null;
  let deletedMatch: { key: string; user: UserRecord; deleted: boolean } | null = null;
  for (const [key, user] of Object.entries(state.users)) {
    if (!recordEmails(key, user).has(wanted)) continue;
    if (!user.deletedAt) return { key, user, deleted: false };
    deletedMatch ??= { key, user, deleted: true };
  }
  return deletedMatch;
}

/** Number of active records whose roles grant `capName`, optionally excluding one key. */
export function countActiveUsersWithCapability(
  capName: CapabilityName,
  excludingUsername?: string,
): number {
  ensureLoaded();
  let n = 0;
  for (const [key, user] of Object.entries(state.users)) {
    if (key === excludingUsername || user.deletedAt) continue;
    if (getEffectiveCapabilities(key).some((g) => g.name === capName)) n += 1;
  }
  return n;
}

/** Roles on `username` that `survivorKey` does not have. */
export function rolesMissingOnSurvivor(username: string, survivorKey: string): string[] {
  ensureLoaded();
  const target = state.users[username];
  const survivor = state.users[survivorKey];
  if (!target || !survivor) return [];
  return target.roles.filter((r) => !survivor.roles.includes(r));
}

/** Soft delete: keep identity for history, clear roles, stamp who/when. */
export function softDeleteUser(
  username: string,
  deletedBy?: string,
): { ok: true; user: UserRecord } | { ok: false; error: string } {
  ensureLoaded();
  const user = state.users[username];
  if (!user) return { ok: false, error: "User not found" };
  if (user.deletedAt) return { ok: false, error: "User is already deleted" };
  ensureUserHasId(username);
  user.roles = [];
  user.deletedAt = new Date().toISOString();
  if (deletedBy) user.deletedBy = deletedBy;
  else delete user.deletedBy;
  save();
  return { ok: true, user };
}

/**
 * Permanently remove one duplicate record. Its staff id is aliased to the survivor
 * so history keeps resolving to a real person; aliases pointing at it are re-pointed.
 */
export function hardDeleteDuplicate(
  username: string,
  survivorKey: string,
): { ok: true; survivor: UserRecord; rolesLost: string[] } | { ok: false; error: string } {
  ensureLoaded();
  const target = state.users[username];
  const survivor = state.users[survivorKey];
  if (!target) return { ok: false, error: "User not found" };
  if (!survivor || survivor.deletedAt || survivorKey === username) {
    return { ok: false, error: "Surviving duplicate not found" };
  }
  const rolesLost = rolesMissingOnSurvivor(username, survivorKey);
  const removedId = target.id || ensureUserHasId(username);
  const survivorId = survivor.id || ensureUserHasId(survivorKey);
  if (!state.staffIdAliases) state.staffIdAliases = {};
  for (const [from, to] of Object.entries(state.staffIdAliases)) {
    if (to === removedId) state.staffIdAliases[from] = survivorId;
  }
  if (removedId !== survivorId) state.staffIdAliases[removedId] = survivorId;
  delete state.users[username];
  save();
  return { ok: true, survivor, rolesLost };
}

/** Restore a soft-deleted user with the given roles (same staff id and identities). */
export function restoreUser(
  username: string,
  roles: string[],
): { ok: true; user: UserRecord } | { ok: false; error: string } {
  ensureLoaded();
  const user = state.users[username];
  if (!user) return { ok: false, error: "User not found" };
  if (!user.deletedAt) return { ok: false, error: "User is not deleted" };
  const unknown = roles.filter((r) => !state.roles[r]);
  if (unknown.length > 0) return { ok: false, error: `Unknown role(s): ${unknown.join(", ")}` };
  if (roles.length === 0) return { ok: false, error: "Pick at least one role" };
  user.roles = Array.from(new Set(roles));
  delete user.deletedAt;
  delete user.deletedBy;
  if (state.pendingUsers) {
    for (const [email, pending] of Object.entries(state.pendingUsers)) {
      if (pending.previouslyDeleted?.username === username) delete state.pendingUsers[email];
    }
  }
  save();
  return { ok: true, user };
}

/**
 * A soft-deleted user tried to sign in: keep a single Pending entry (no role)
 * flagged as previously deleted, refreshing `lastAttemptAt` on repeat attempts.
 */
export function recordDeletedUserSignInAttempt(
  username: string,
  attemptEmail?: string,
): PendingUserRecord | null {
  ensureLoaded();
  const user = state.users[username];
  if (!user?.deletedAt) return null;
  const email =
    normalizeEmail(user.email) ??
    (username.includes("@") ? normalizeEmail(username) : undefined) ??
    normalizeEmail(attemptEmail);
  if (!email) return null;
  if (!state.pendingUsers) state.pendingUsers = {};
  const now = new Date().toISOString();
  const existing = state.pendingUsers[email];
  const entry: PendingUserRecord = {
    email,
    createdAt: existing?.createdAt ?? now,
    lastAttemptAt: now,
    previouslyDeleted: {
      username,
      staffId: user.id || ensureUserHasId(username),
      deletedAt: user.deletedAt,
      ...(user.deletedBy ? { deletedBy: user.deletedBy } : {}),
    },
  };
  state.pendingUsers[email] = entry;
  save();
  return entry;
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
    .filter((u) => !u.deletedAt)
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

export function findUserByIdentity(
  provider: string,
  providerUserId: string,
): { key: string; user: UserRecord } | null {
  ensureLoaded();
  if (!provider || !providerUserId) return null;
  for (const [key, user] of Object.entries(state.users)) {
    if (
      user.identities?.some(
        (id) => id.provider === provider && id.providerUserId === providerUserId,
      )
    ) {
      return { key, user };
    }
  }
  return null;
}

export function findUsersByEmails(
  emails: string[],
): Array<{ key: string; user: UserRecord }> {
  ensureLoaded();
  const wanted = new Set(
    emails.map((e) => e.toLowerCase().trim()).filter(Boolean),
  );
  if (wanted.size === 0) return [];
  const found: Array<{ key: string; user: UserRecord }> = [];
  const seen = new Set<string>();
  for (const [key, user] of Object.entries(state.users)) {
    const emailNorm = user.email?.toLowerCase().trim();
    const keyNorm = key.toLowerCase().trim();
    if (
      (emailNorm && wanted.has(emailNorm)) ||
      (keyNorm.includes("@") && wanted.has(keyNorm))
    ) {
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ key, user });
      }
    }
  }
  return found;
}

export function peekPendingUsersForEmails(emails: string[]): PendingUserRecord[] {
  ensureLoaded();
  if (!state.pendingUsers) return [];
  const wanted = new Set(
    emails.map((e) => e.toLowerCase().trim()).filter(Boolean),
  );
  return Object.values(state.pendingUsers).filter((p) => wanted.has(p.email));
}

export function attachIdentity(
  username: string,
  identity: StaffProviderIdentity,
  profile?: { email?: string; firstName?: string; lastName?: string; githubLogin?: string },
): UserRecord | null {
  ensureLoaded();
  const found = findUserEntry(username, profile?.email);
  if (!found) return null;
  const user = state.users[found.key];
  const identities = [...(user.identities ?? [])];
  const idx = identities.findIndex(
    (id) =>
      id.provider === identity.provider &&
      id.providerUserId === identity.providerUserId,
  );
  if (idx >= 0) identities[idx] = { ...identities[idx], ...identity };
  else identities.push(identity);
  user.identities = identities;
  if (profile?.email) user.email = profile.email;
  if (profile?.firstName) user.firstName = profile.firstName;
  if (profile?.lastName) user.lastName = profile.lastName;
  if (profile?.githubLogin) user.githubLogin = profile.githubLogin;
  user.lastLoginAt = new Date().toISOString();
  save();
  return user;
}

export function createAdmittedUser(input: {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  githubLogin?: string;
  identity: StaffProviderIdentity;
  roles: string[];
}): UserRecord {
  ensureLoaded();
  const record: UserRecord = {
    id: generateUniqueStaffId({ username: input.username, email: input.email }),
    username: input.username,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    githubLogin: input.githubLogin,
    lastLoginAt: new Date().toISOString(),
    roles: [...input.roles],
    identities: [input.identity],
  };
  state.users[input.username] = record;
  save();
  return record;
}

export function hasAnyRole(username: string, email?: string): boolean {
  return getUserRoles(username, email).length > 0;
}

export function renameUser(oldUsername: string, newUsername: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.users[oldUsername]) {
    return { ok: false, error: "User not found" };
  }
  if (state.users[oldUsername].deletedAt) {
    return { ok: false, error: "Deleted users cannot be renamed. Restore them first." };
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

export type AddPendingUserResult =
  | { ok: true }
  | { ok: false; error: string; code?: undefined }
  | { ok: false; error: string; code: "user_exists" | "user_previously_deleted"; user: UserRecord };

export function addPendingUser(email: string, role: string): AddPendingUserResult {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return { ok: false, error: "Email is required" };
  if (!state.roles[role]) return { ok: false, error: `Role "${role}" does not exist` };
  const existing = findUserByEmailIncludingDeleted(normalizedEmail);
  if (existing && !existing.deleted) {
    return {
      ok: false,
      code: "user_exists",
      error: `${normalizedEmail} is already a staff user (${formatStaffDisplayName(existing.user)}). Edit their roles instead.`,
      user: existing.user,
    };
  }
  if (existing?.deleted) {
    return {
      ok: false,
      code: "user_previously_deleted",
      error: `${normalizedEmail} belongs to a deleted user. Restore them instead.`,
      user: existing.user,
    };
  }
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
  if (!pending?.role) return null;
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
  if (!pending.role) {
    return { ok: false, error: "This entry is a previously deleted user. Restore them instead." };
  }
  if (!state.users[username]) return { ok: false, error: "User not found" };
  if (state.users[username].deletedAt) {
    return { ok: false, error: "That user is deleted. Restore them first." };
  }
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
  return grantsCanMutateMetrics(getEffectiveCapabilities(username));
}

export function deleteRole(roleId: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (isBuiltInRole(roleId)) {
    return { ok: false, error: `The built-in ${roleId} role cannot be deleted` };
  }
  if (isAgenticSwarmRoleId(roleId)) {
    return { ok: false, error: `The agentic swarm role ${roleId} cannot be deleted` };
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
