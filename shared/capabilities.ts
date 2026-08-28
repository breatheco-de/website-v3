const REGISTRY = [
  {
    name: "content_view",
    label: "View content",
    scoped: true,
    description:
      "Read content entries, type contracts, component schemas, and architecture playbooks. Does not allow writes.",
  },
  {
    name: "content_create_entry",
    label: "Create entries",
    scoped: true,
    description: "Add new entries to a content type (e.g. new blog posts or landing pages).",
  },
  {
    name: "content_delete_entry",
    label: "Delete entries",
    scoped: true,
    description: "Permanently remove existing entries from a content type.",
  },
  {
    name: "content_edit_structure",
    label: "Edit structure",
    scoped: true,
    description: "Rearrange, add, or remove sections that define the page layout.",
  },
  {
    name: "content_edit_default",
    label: "Edit default content",
    scoped: true,
    description: "Modify the shared default content that applies to all locales of an entry.",
  },
  {
    name: "content_create_variant",
    label: "Create variants",
    scoped: true,
    description: "Create new locale or A/B variants for an existing entry.",
  },
  {
    name: "content_edit_variant",
    label: "Edit variants",
    scoped: true,
    description: "Edit locale-specific or A/B variant content for an entry.",
  },
  {
    name: "content_delete_variant",
    label: "Delete variants",
    scoped: true,
    description: "Remove a locale or A/B variant from an entry.",
  },
  {
    name: "content_edit_text",
    label: "Edit text",
    scoped: true,
    description: "Update plain text fields such as headings, body copy, and labels.",
  },
  {
    name: "content_edit_media",
    label: "Edit media",
    scoped: true,
    description: "Replace or update images and videos embedded in content entries.",
  },
  {
    name: "content_allocate_traffic",
    label: "Allocate traffic to variants",
    scoped: true,
    description: "Edit traffic allocation weights between variants for A/B testing.",
  },
  {
    name: "content_promote_variant",
    label: "Promote a variant to default",
    scoped: true,
    description: "Promote a variant to become the canonical default for an entry.",
  },
  {
    name: "media_upload",
    label: "Upload media",
    scoped: false,
    description: "Add new images or files to the shared media library.",
  },
  {
    name: "media_delete",
    label: "Delete media",
    scoped: false,
    description: "Remove images or files from the shared media library.",
  },
  {
    name: "seo_edit",
    label: "Edit SEO",
    scoped: false,
    description:
      "Update meta titles, descriptions, redirects, and other SEO settings; list and manage SEO topic clusters.",
  },
  {
    name: "content_types_manage",
    label: "Manage content types",
    scoped: false,
    description: "Create, configure, or delete content type definitions.",
  },
  {
    name: "databases_manage",
    label: "Manage databases",
    scoped: false,
    description: "Configure database-backed content types and their connections.",
  },
  {
    name: "components_manage",
    label: "Manage components",
    scoped: false,
    description: "Add, update, or remove section component definitions in the registry.",
  },
  {
    name: "theme_edit",
    label: "Edit theme",
    scoped: false,
    description: "Change site-wide colors, typography, and other visual theme settings.",
  },
  {
    name: "migrations_run",
    label: "Run migrations",
    scoped: false,
    description: "Execute schema or data migrations against the database.",
  },
  {
    name: "users_manage",
    label: "Manage users & roles",
    scoped: false,
    description: "Invite users, assign roles, and configure role permissions.",
  },
  {
    name: "metrics_view",
    label: "View metrics & performance",
    scoped: false,
    description:
      "Read diagnostics, runtime issues, component insights, error log, conversions, and tracking. Does not allow running jobs or changing settings.",
  },
] as const;

type RegistryEntry = (typeof REGISTRY)[number];

export type ScopedCapability = Extract<RegistryEntry, { scoped: true }>["name"];
export type GlobalCapability = Extract<RegistryEntry, { scoped: false }>["name"];
export type CapabilityName = RegistryEntry["name"];

export interface CapabilityDefinition {
  readonly name: CapabilityName;
  readonly label: string;
  readonly scoped: boolean;
  readonly description: string;
}

export const CAPABILITY_REGISTRY: ReadonlyArray<CapabilityDefinition> = REGISTRY;

export const SCOPED_CAPABILITIES: ScopedCapability[] = (
  REGISTRY.filter(
    (c): c is Extract<RegistryEntry, { scoped: true }> => c.scoped
  ) as Array<Extract<RegistryEntry, { scoped: true }>>
).map((c) => c.name);

export const GLOBAL_CAPABILITIES: GlobalCapability[] = (
  REGISTRY.filter(
    (c): c is Extract<RegistryEntry, { scoped: false }> => !c.scoped
  ) as Array<Extract<RegistryEntry, { scoped: false }>>
).map((c) => c.name);

export const ALL_CAPABILITIES: CapabilityName[] = REGISTRY.map((c) => c.name);

/** Scoped content caps that mutate entries (everything scoped except content_view). */
export const CONTENT_MUTATE_CAPABILITIES: ScopedCapability[] = SCOPED_CAPABILITIES.filter(
  (name) => name !== "content_view",
);

/** Caps that never authorize metrics jobs or other mutating staff surfaces. */
export const VIEW_ONLY_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  "metrics_view",
  "content_view",
]);
