import { describe, expect, it } from "vitest";
import {
  IDENTITY_TOOLS,
  allowedToolNames,
  grantsCanMutateMetrics,
  hasCapAnyScope,
  visibleContentTypes,
  type CatalogGrant,
} from "./tool-catalog";

const webmaster: CatalogGrant[] = [
  { name: "users_manage" },
  { name: "seo_edit" },
  { name: "metrics_view" },
  { name: "content_view", contentTypes: "*" },
  { name: "content_edit_text", contentTypes: "*" },
  { name: "content_edit_structure", contentTypes: "*" },
  { name: "content_create_entry", contentTypes: "*" },
  { name: "databases_manage" },
];

const metricsViewer: CatalogGrant[] = [{ name: "metrics_view" }];
const contentViewer: CatalogGrant[] = [{ name: "content_view", contentTypes: "*" }];
const blogEditor: CatalogGrant[] = [
  { name: "content_view", contentTypes: ["blog"] },
  { name: "content_edit_text", contentTypes: ["blog"] },
];
const seoOnly: CatalogGrant[] = [{ name: "seo_edit" }];

describe("allowedToolNames", () => {
  it("Metrics Viewer sees only identity tools", () => {
    const names = allowedToolNames(metricsViewer);
    expect(names).toEqual([...IDENTITY_TOOLS].sort());
    expect(names).not.toContain("list_entries");
    expect(names).not.toContain("run_entry_diagnostics");
    expect(names).not.toContain("update_fields");
  });

  it("Content Viewer sees YAML/component reads, not writes or diagnostics or FAQ", () => {
    const names = new Set(allowedToolNames(contentViewer));
    expect(names.has("get_current_user")).toBe(true);
    expect(names.has("list_entries")).toBe(true);
    expect(names.has("get_entry_content")).toBe(true);
    expect(names.has("get_entry_seo")).toBe(true);
    expect(names.has("explain_site")).toBe(true);
    expect(names.has("get_agent_changelog")).toBe(true);
    expect(names.has("list_components")).toBe(true);
    expect(names.has("create_component_section_demo")).toBe(true);
    expect(names.has("get_product_funnel")).toBe(true);
    expect(names.has("get_or_set_image_to_gallery")).toBe(true);
    expect(names.has("update_fields")).toBe(false);
    expect(names.has("create_entry")).toBe(false);
    expect(names.has("test_redirect")).toBe(false);
    expect(names.has("list_databases")).toBe(false);
    expect(names.has("run_entry_diagnostics")).toBe(true);
    expect(names.has("get_diagnostics_job")).toBe(false);
  });

  it("blog-only editor sees reads and text writes, not structure/create", () => {
    const names = new Set(allowedToolNames(blogEditor));
    expect(names.has("list_entries")).toBe(true);
    expect(names.has("update_fields")).toBe(true);
    expect(names.has("translate_entry")).toBe(true);
    expect(names.has("add_section")).toBe(false);
    expect(names.has("create_entry")).toBe(false);
    expect(names.has("update_redirect")).toBe(false);
  });

  it("webmaster sees writes and diagnostics", () => {
    const names = new Set(allowedToolNames(webmaster));
    expect(names.has("update_fields")).toBe(true);
    expect(names.has("create_entry")).toBe(true);
    expect(names.has("run_entry_diagnostics")).toBe(true);
    expect(names.has("reindex_database")).toBe(true);
    expect(names.has("test_redirect")).toBe(true);
    expect(names.has("update_content_type")).toBe(false);
  });

  it("content_types_manage reveals update_content_type", () => {
    const names = new Set(
      allowedToolNames([{ name: "content_types_manage" }, { name: "content_view", contentTypes: "*" }]),
    );
    expect(names.has("update_content_type")).toBe(true);
    expect(names.has("get_content_type_info")).toBe(true);
    expect(names.has("ensure_content_type_schema_org")).toBe(false);
  });

  it("seo_edit-only sees SEO inspect and SEO writes, not YAML body reads", () => {
    const names = new Set(allowedToolNames(seoOnly));
    expect(names.has("get_entry_seo")).toBe(true);
    expect(names.has("list_entry_seo")).toBe(true);
    expect(names.has("list_seo_clusters")).toBe(true);
    expect(names.has("list_seo_cluster_entries")).toBe(true);
    expect(names.has("get_seo_cluster")).toBe(true);
    expect(names.has("run_entry_diagnostics")).toBe(true);
    expect(names.has("get_diagnostics_job")).toBe(true);
    expect(names.has("update_meta_fields")).toBe(true);
    expect(names.has("test_redirect")).toBe(true);
    expect(names.has("update_fields")).toBe(true);
    expect(names.has("get_entry_content")).toBe(false);
    expect(names.has("list_entries")).toBe(false);
    expect(names.has("explain_site")).toBe(false);
  });
});

describe("visibleContentTypes", () => {
  it("filters list_entries to content_view scope", () => {
    const types = visibleContentTypes(blogEditor);
    expect(types).toEqual(new Set(["blog"]));
  });

  it("content_view * means all types", () => {
    expect(visibleContentTypes(contentViewer)).toBeNull();
  });

  it("seo_edit unlocks all types for SEO listings", () => {
    expect(visibleContentTypes(seoOnly, { seoUnlocksAll: true })).toBeNull();
    expect(visibleContentTypes(seoOnly)).toEqual(new Set());
  });
});

describe("grantsCanMutateMetrics", () => {
  it("is false for view-only roles", () => {
    expect(grantsCanMutateMetrics(metricsViewer)).toBe(false);
    expect(grantsCanMutateMetrics(contentViewer)).toBe(false);
    expect(grantsCanMutateMetrics([...metricsViewer, ...contentViewer])).toBe(false);
  });

  it("is true when any mutating cap is present", () => {
    expect(grantsCanMutateMetrics(webmaster)).toBe(true);
    expect(grantsCanMutateMetrics(blogEditor)).toBe(true);
    expect(grantsCanMutateMetrics(seoOnly)).toBe(true);
  });
});

describe("hasCapAnyScope", () => {
  it("treats a scoped grant as present without requiring *", () => {
    expect(hasCapAnyScope(blogEditor, "content_view")).toBe(true);
    expect(hasCapAnyScope(blogEditor, "seo_edit")).toBe(false);
  });
});
