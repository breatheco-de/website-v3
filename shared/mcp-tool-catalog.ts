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
  list_components: { kind: "anyCap", caps: ["content_view"] },
  get_component_schema: { kind: "anyCap", caps: ["content_view"] },
  get_component_variant: { kind: "anyCap", caps: ["content_view"] },
  get_component_usage: { kind: "anyCap", caps: ["content_view"] },
  create_component_section_demo: { kind: "anyCap", caps: ["content_view"] },
  explain_site: { kind: "anyCap", caps: ["content_view"] },
  get_agent_changelog: { kind: "anyCap", caps: ["content_view"] },
  agent_session: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },

  get_entry_seo: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_entry_seo: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_seo_clusters: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  list_seo_cluster_entries: { kind: "anyCap", caps: ["content_view", "seo_edit"] },
  get_seo_cluster: { kind: "anyCap", caps: ["content_view", "seo_edit"] },

  update_fields: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },
  update_entry_field: { kind: "anyCap", caps: ["seo_edit"] },
  reset_entry_field: { kind: "anyCap", caps: ["seo_edit"] },
  update_meta_fields: { kind: "anyCap", caps: ["seo_edit"] },
  ensure_content_type_schema_org: { kind: "anyCap", caps: ["seo_edit"] },
  update_content_type: { kind: "anyCap", caps: ["content_types_manage"] },
  test_redirect: { kind: "anyCap", caps: ["seo_edit"] },
  update_redirect: { kind: "anyCap", caps: ["seo_edit"] },

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
  update_issue: { kind: "anyCap", caps: ["content_edit_text", "seo_edit"] },
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

/**
 * Content types the caller may see in list_entries / list_entry_seo.
 * null = all types. seo_edit (global) unlocks all types for SEO listings.
 */
export function visibleContentTypes(
  grants: CatalogGrant[],
  opts?: { seoUnlocksAll?: boolean },
): Set<string> | null {
  if (opts?.seoUnlocksAll && hasCapAnyScope(grants, "seo_edit")) return null;
  const view = grants.find((g) => g.name === "content_view");
  if (!view) return new Set();
  if (view.contentTypes === "*" || view.contentTypes === undefined) return null;
  if (Array.isArray(view.contentTypes)) return new Set(view.contentTypes);
  return new Set();
}
