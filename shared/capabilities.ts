export type CapabilityScopeKind = "content_types" | "databases" | "none";

const REGISTRY = [
  {
    name: "content_view",
    label: "View content",
    scoped: true,
    scopeKind: "content_types" as const,
    description:
      "Read content entries, type contracts, component schemas, and architecture playbooks. Does not allow writes.",
  },
  {
    name: "content_create_entry",
    label: "Create entries",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Add new entries to a content type (e.g. new blog posts or landing pages).",
  },
  {
    name: "content_delete_entry",
    label: "Delete entries",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Permanently remove existing entries from a content type.",
  },
  {
    name: "content_edit_structure",
    label: "Edit structure",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Rearrange, add, or remove sections that define the page layout.",
  },
  {
    name: "content_edit_default",
    label: "Edit default content",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Modify the shared default content that applies to all locales of an entry.",
  },
  {
    name: "content_create_variant",
    label: "Create variants",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Create new locale or A/B variants for an existing entry.",
  },
  {
    name: "content_edit_variant",
    label: "Edit variants",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Edit locale-specific or A/B variant content for an entry.",
  },
  {
    name: "content_delete_variant",
    label: "Delete variants",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Remove a locale or A/B variant from an entry.",
  },
  {
    name: "content_edit_text",
    label: "Edit text",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Update plain text fields such as headings, body copy, and labels.",
  },
  {
    name: "content_edit_media",
    label: "Edit media",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Replace or update images and videos embedded in content entries.",
  },
  {
    name: "content_allocate_traffic",
    label: "Allocate traffic to variants",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Edit traffic allocation weights between variants for A/B testing.",
  },
  {
    name: "content_promote_variant",
    label: "Promote a variant to default",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Promote a variant to become the canonical default for an entry.",
  },
  {
    name: "media_upload",
    label: "Upload media",
    scoped: false,
    scopeKind: "none" as const,
    description: "Add new images or files to the shared media library.",
  },
  {
    name: "media_delete",
    label: "Delete media",
    scoped: false,
    scopeKind: "none" as const,
    description: "Remove images or files from the shared media library.",
  },
  {
    name: "seo_edit",
    label: "Edit page SEO",
    scoped: true,
    scopeKind: "content_types" as const,
    description: "Update meta titles, descriptions, and other per-entry SEO fields.",
  },
  {
    name: "read_redirects",
    label: "Read redirects",
    scoped: false,
    scopeKind: "none" as const,
    description: "List and test URL redirects without changing them.",
  },
  {
    name: "edit_redirects",
    label: "Edit redirects",
    scoped: false,
    scopeKind: "none" as const,
    description: "Add, change, or remove URL redirects for pages and the site.",
  },
  {
    name: "overlays_edit_content",
    label: "Edit overlay copy",
    scoped: false,
    scopeKind: "none" as const,
    description: "Edit overlay / modal copy (title, body, buttons, image). Does not control who sees it or when.",
  },
  {
    name: "overlays_configure",
    label: "Configure overlays",
    scoped: false,
    scopeKind: "none" as const,
    description:
      "Create, enable/disable, and configure overlay targeting, triggers, and display settings.",
  },
  {
    name: "seo_settings",
    label: "Manage SEO settings",
    scoped: false,
    scopeKind: "none" as const,
    description:
      "Change site-wide SEO config: Schema.org, brand, Search Console, OG/preview, companion ensure, and runtime-issue cleanup.",
  },
  {
    name: "content_types_manage",
    label: "Manage content types",
    scoped: false,
    scopeKind: "none" as const,
    description: "Create, configure, or delete content type definitions.",
  },
  {
    name: "databases_manage",
    label: "Manage databases",
    scoped: false,
    scopeKind: "none" as const,
    description: "Create or patch private database definitions (config) and run vector reindex. Does not authorize editing rows — use Edit database data for that.",
  },
  {
    name: "databases_edit_data",
    label: "Edit database data",
    // scoped:false so SCOPED_CAPABILITIES stays content-type-only; scopeKind drives DB grant checks.
    scoped: false,
    scopeKind: "databases" as const,
    description: "Edit rows in selected private databases.",
  },
  {
    name: "components_manage",
    label: "Manage components",
    scoped: false,
    scopeKind: "none" as const,
    description: "Add, update, or remove section component definitions in the registry.",
  },
  {
    name: "theme_edit",
    label: "Edit theme",
    scoped: false,
    scopeKind: "none" as const,
    description: "Change site-wide colors, typography, and other visual theme settings.",
  },
  {
    name: "migrations_run",
    label: "Run migrations",
    scoped: false,
    scopeKind: "none" as const,
    description: "Execute schema or data migrations against the database.",
  },
  {
    name: "users_manage",
    label: "Manage users & roles",
    scoped: false,
    scopeKind: "none" as const,
    description: "Invite users, assign roles, and configure role permissions.",
  },
  {
    name: "metrics_view",
    label: "View metrics & performance",
    scoped: false,
    scopeKind: "none" as const,
    description:
      "Read diagnostics, runtime issues, component insights, error log, conversions, and tracking. Does not allow running jobs or changing settings.",
  },
  {
    name: "sites_manage",
    label: "Manage sites registry",
    scoped: false,
    scopeKind: "none" as const,
    description:
      "Edit sites.yml, create new site scaffolds, and rename domains in the multi-site registry.",
  },
  {
    name: "worker_manage",
    label: "Manage background worker",
    scoped: false,
    scopeKind: "none" as const,
    description:
      "Restart the Sidequest job worker and open the proxied Sidequest dashboard.",
  },
] as const;

type RegistryEntry = (typeof REGISTRY)[number];

export type ScopedCapability = Extract<RegistryEntry, { scopeKind: "content_types" }>["name"];
export type GlobalCapability = Extract<RegistryEntry, { scopeKind: "none" }>["name"];
export type CapabilityName = RegistryEntry["name"];
export type DatabaseScopedCapability = Extract<RegistryEntry, { scopeKind: "databases" }>["name"];

export interface CapabilityDefinition {
  readonly name: CapabilityName;
  readonly label: string;
  readonly scoped: boolean;
  readonly scopeKind: CapabilityScopeKind;
  readonly description: string;
}

export const CAPABILITY_REGISTRY: ReadonlyArray<CapabilityDefinition> = REGISTRY;

/** Content-type-scoped caps only (`scopeKind: "content_types"`). */
export const SCOPED_CAPABILITIES: ScopedCapability[] = (
  REGISTRY.filter(
    (c): c is Extract<RegistryEntry, { scopeKind: "content_types" }> =>
      c.scopeKind === "content_types"
  ) as Array<Extract<RegistryEntry, { scopeKind: "content_types" }>>
).map((c) => c.name);

/** Unscoped caps (`scopeKind: "none"`). Does not include database-scoped caps. */
export const GLOBAL_CAPABILITIES: GlobalCapability[] = (
  REGISTRY.filter(
    (c): c is Extract<RegistryEntry, { scopeKind: "none" }> => c.scopeKind === "none"
  ) as Array<Extract<RegistryEntry, { scopeKind: "none" }>>
).map((c) => c.name);

export const ALL_CAPABILITIES: CapabilityName[] = REGISTRY.map((c) => c.name);

export const DATABASE_SCOPED_CAPABILITIES: DatabaseScopedCapability[] = (
  REGISTRY.filter(
    (c): c is Extract<RegistryEntry, { scopeKind: "databases" }> => c.scopeKind === "databases"
  ) as Array<Extract<RegistryEntry, { scopeKind: "databases" }>>
).map((c) => c.name);

const SCOPE_KIND_BY_NAME = new Map<CapabilityName, CapabilityScopeKind>(
  REGISTRY.map((c) => [c.name, c.scopeKind]),
);

/** Scope kind for a capability name (content_types | databases | none). */
export function getCapabilityScopeKind(name: string): CapabilityScopeKind {
  return SCOPE_KIND_BY_NAME.get(name as CapabilityName) ?? "none";
}

/**
 * Scoped content caps that mutate entries (everything content-type-scoped except content_view).
 * Database-scoped caps are intentionally excluded so they do not auto-enable content_view.
 */
export const CONTENT_MUTATE_CAPABILITIES: ScopedCapability[] = SCOPED_CAPABILITIES.filter(
  (name) => name !== "content_view",
);

/** Caps that never authorize metrics jobs or other mutating staff surfaces. */
export const VIEW_ONLY_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  "metrics_view",
  "content_view",
  "read_redirects",
]);
