import { VIEW_ONLY_CAPABILITIES, type CapabilityName } from "./capabilities.js";

export interface CatalogGrant {
  name: string;
  contentTypes?: string[] | "*";
}

export const IDENTITY_TOOLS = [
  "get_current_user",
  "check_capability",
  "list_sites",
] as const;

export type ToolGate =
  | { kind: "auth" }
  | { kind: "anyCap"; caps: readonly string[] }
  | { kind: "canMutateMetrics" };

/**
 * Which grants reveal a tool in tools/list.
 * "anyCap" = grant exists at any content-type scope (do not use checkCap without a type).
 */
export const TOOL_GATES: Record<string, ToolGate> = {
  get_current_user: { kind: "auth" },
  check_capability: { kind: "auth" },
  list_sites: { kind: "auth" },

  list_entries: { kind: "anyCap", caps: ["content_view"] },
  get_entry_content: { kind: "anyCap", caps: ["content_view"] },
  get_entry_fields: { kind: "anyCap", caps: ["content_view"] },
  get_content_type_info: { kind: "anyCap", caps: ["content_view"] },
  get_section_bindings: { kind: "anyCap", caps: ["content_view"] },
  list_variants: { kind: "anyCap", caps: ["content_view"] },
  get_product_funnel: { kind: "anyCap", caps: ["content_view"] },
  get_product_funnel_analytics: { kind: "anyCap", caps: ["content_view"] },
  list_components: { kind: "anyCap", caps: ["content_view"] },
  get_component_schema: { kind: "anyCap", caps: ["content_view"] },
  get_component_variant: { kind: "anyCap", caps: ["content_view"] },
  get_component_usage: { kind: "anyCap", caps: ["content_view"] },
  create_component_section_demo: { kind: "anyCap", caps: ["content_view"] },
  explain_site: { kind: "anyCap", caps: ["content_view"] },
  bootstrap_agent: { kind: "anyCap", caps: ["content_view"] },
  agent_session: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },

  get_entry_seo: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_entry_seo: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_seo_clusters: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_seo_cluster_entries: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  get_seo_cluster: { kind: "anyCap", caps: ["content_view", "seo_edit"] },

  update_fields: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },
  update_entry_field: { kind: "anyCap", caps: ["content_edit_text"] },
  update_meta_fields: { kind: "anyCap", caps: ["seo_edit"] },
  ensure_content_type_schema_org: { kind: "anyCap", caps: ["seo_settings"] },
  update_content_type: { kind: "anyCap", caps: ["content_types_manage"] },
  test_redirect: { kind: "anyCap", caps: ["read_redirects"] },
  update_redirect: { kind: "anyCap", caps: ["edit_redirects"] },

  add_section: { kind: "anyCap", caps: ["content_edit_structure"] },
  remove_section: { kind: "anyCap", caps: ["content_edit_structure"] },
  reorder_sections: { kind: "anyCap", caps: ["content_edit_structure"] },
  replace_entry_sections: { kind: "anyCap", caps: ["content_edit_structure"] },
  set_entry_attachment: { kind: "anyCap", caps: ["content_edit_structure"] },

  create_entry: { kind: "anyCap", caps: ["content_create_entry"] },
  delete_entries: { kind: "anyCap", caps: ["content_delete_entry"] },
  translate_entry: { kind: "anyCap", caps: ["content_edit_text"] },
  regenerate_entry_previews: { kind: "anyCap", caps: ["content_edit_media"] },
  get_or_set_image_to_gallery: {
    kind: "anyCap",
    caps: ["media_upload", "content_view"],
  },

  create_variant: { kind: "anyCap", caps: ["content_create_variant"] },
  delete_variant: { kind: "anyCap", caps: ["content_delete_variant"] },
  publish_draft: { kind: "anyCap", caps: ["content_promote_variant"] },
  promote_variant: { kind: "anyCap", caps: ["content_promote_variant"] },
  convert_to_draft: { kind: "anyCap", caps: ["content_promote_variant"] },

  list_databases: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  list_database_items: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  get_database_item: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  add_database_item: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  add_database_items: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  update_database_item: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  update_database_items: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  delete_database_item: { kind: "anyCap", caps: ["databases_manage", "content_edit_text"] },
  reindex_database: { kind: "anyCap", caps: ["databases_manage"] },

  run_entry_diagnostics: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  get_diagnostics_job: { kind: "canMutateMetrics" },
  get_validation_issues: { kind: "anyCap", caps: ["metrics_view"] },
  update_issue: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },
  propose_change: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_proposals: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  update_proposal: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },
};

export function hasCapAnyScope(grants: CatalogGrant[], cap: string): boolean {
  return grants.some((g) => g.name === cap);
}

export function grantsCanMutateMetrics(grants: CatalogGrant[]): boolean {
  return grants.some((g) => !VIEW_ONLY_CAPABILITIES.has(g.name as CapabilityName));
}

function grantMatches(grants: CatalogGrant[], caps: readonly string[]): boolean {
  return caps.some((cap) => hasCapAnyScope(grants, cap));
}

function gateAllows(gate: ToolGate, grants: CatalogGrant[]): boolean {
  if (gate.kind === "auth") return true;
  if (gate.kind === "canMutateMetrics") return grantsCanMutateMetrics(grants);
  return grantMatches(grants, gate.caps);
}

export function allowedToolNames(grants: CatalogGrant[]): string[] {
  return Object.entries(TOOL_GATES)
    .filter(([, gate]) => gateAllows(gate, grants))
    .map(([name]) => name)
    .sort();
}

function scopeFromGrant(grant: CatalogGrant | undefined): Set<string> | null | "none" {
  if (!grant) return "none";
  if (grant.contentTypes === "*" || grant.contentTypes === undefined) return null;
  if (Array.isArray(grant.contentTypes)) return new Set(grant.contentTypes);
  return "none";
}

/**
 * Content types the caller may see in list_entries / list_entry_seo.
 * null = all types.
 * When opts.unionSeoEdit is true, union content_view and seo_edit scopes
 * (either * unlocks all; otherwise merge type lists).
 */
export function visibleContentTypes(
  grants: CatalogGrant[],
  opts?: { unionSeoEdit?: boolean; /** @deprecated use unionSeoEdit */ seoUnlocksAll?: boolean },
): Set<string> | null {
  const unionSeo = opts?.unionSeoEdit ?? opts?.seoUnlocksAll ?? false;
  const viewScope = scopeFromGrant(grants.find((g) => g.name === "content_view"));
  if (!unionSeo) {
    if (viewScope === "none") return new Set();
    return viewScope;
  }

  const seoScope = scopeFromGrant(grants.find((g) => g.name === "seo_edit"));
  if (viewScope === null || seoScope === null) return null;
  if (viewScope === "none" && seoScope === "none") return new Set();
  if (viewScope === "none") return seoScope;
  if (seoScope === "none") return viewScope;
  return new Set([...viewScope, ...seoScope]);
}
