import { describe, expect, it, vi } from "vitest";
import {
  buildAvailableFieldsCatalog,
  filterFieldsByRequest,
  findUnknownFields,
  needsSelectFieldsGate,
  selectFieldsGatePayload,
  stripRedundantBaseline,
  type AvailableFieldRow,
} from "./get-entry-fields-catalog.js";

vi.mock("../../server/ecommerce/ecommerce-manager.js", () => ({
  PURCHASABLE_FIELD: "purchasable",
  ecommerceManager: {
    contentTypeHasEcommerce: () => false,
  },
}));

vi.mock("../../server/seo-monitoring.js", () => ({
  isSeoMonitoringEnabled: () => true,
}));

vi.mock("../../server/content-types.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/content-types.js")>();
  return {
    ...actual,
    getFieldMapping: () => ({
      title: "title",
      content: "content",
      authors: "authors",
    }),
    getFullFieldMapping: () => ({
      title: "title",
      content: "content",
      authors: "authors",
      _slug: "slug",
    }),
  };
});

describe("needsSelectFieldsGate", () => {
  it("treats missing and empty the same", () => {
    expect(needsSelectFieldsGate(undefined)).toBe(true);
    expect(needsSelectFieldsGate(null)).toBe(true);
    expect(needsSelectFieldsGate([])).toBe(true);
    expect(needsSelectFieldsGate(["title"])).toBe(false);
  });
});

describe("buildAvailableFieldsCatalog", () => {
  it("lists mapped keys, seo.*, and clustering without values", () => {
    const catalog = buildAvailableFieldsCatalog({
      contentType: "blog",
      config: {
        directory: "blog",
        editor: {
          title: { type: "text" },
          content: { type: "markdown" },
          authors: { type: "relation", source: "authors" },
        },
      } as Parameters<typeof buildAvailableFieldsCatalog>[0]["config"],
    });
    const names = catalog.map((r) => r.field);
    expect(names).toContain("title");
    expect(names).toContain("content");
    expect(names).toContain("seo.refresh_tier");
    expect(names).toContain("seo.include_in_clustering");
    expect(catalog.find((r) => r.field === "content")?.pick_hint).toMatch(/Large body/);
    expect(catalog.every((r) => !("effective" in r))).toBe(true);
  });

  it("keeps deprecated fields listed with replaced_by and a pick_hint", () => {
    const catalog = buildAvailableFieldsCatalog({
      contentType: "blog",
      config: {
        directory: "blog",
        editor: {
          title: { type: "text" },
          content: { type: "markdown", deprecated: { replaced_by: "title" } },
          authors: { type: "relation", source: "authors", deprecated: true },
        },
      } as Parameters<typeof buildAvailableFieldsCatalog>[0]["config"],
    });
    const content = catalog.find((r) => r.field === "content");
    expect(content).toMatchObject({ deprecated: true, replaced_by: "title", pick_hint: "Deprecated; use title" });
    const authors = catalog.find((r) => r.field === "authors");
    expect(authors).toMatchObject({ deprecated: true, replaced_by: null, pick_hint: "Deprecated; no replacement" });
    expect(catalog.find((r) => r.field === "title")?.deprecated).toBeUndefined();
  });
});

describe("findUnknownFields / selectFieldsGatePayload", () => {
  const catalog: AvailableFieldRow[] = [
    { field: "title", type: "text" },
    { field: "content", type: "markdown", pick_hint: "Large body; returns full value if selected" },
    { field: "seo.refresh_tier", group: "seo", writable: true },
    { field: "seo.include_in_clustering", group: "seo", type: "boolean", writable: true },
  ];

  it("lists unknown names without partial success", () => {
    expect(findUnknownFields(["title", "titile"], catalog)).toEqual(["titile"]);
    const payload = selectFieldsGatePayload({
      contentType: "blog",
      slug: "post",
      locale: "en",
      catalog,
      unknown_fields: ["titile"],
    });
    expect(payload.action_required).toBe("select_fields");
    expect(payload.code).toBe("unknown_fields");
    expect(payload.unknown_fields).toEqual(["titile"]);
    expect(payload.available_fields.every((r) => !("effective" in r))).toBe(true);
  });

  it("fields_required when no unknown list", () => {
    const payload = selectFieldsGatePayload({
      contentType: "blog",
      slug: "post",
      locale: "en",
      catalog,
    });
    expect(payload.code).toBe("fields_required");
    expect(payload.unknown_fields).toBeUndefined();
  });
});

describe("filterFieldsByRequest / stripRedundantBaseline", () => {
  it("preserves request order and drops equal baseline", () => {
    const rows = [
      { field: "content", effective: "# Hi", baseline: "# Hi", source: "entry_default" },
      { field: "title", effective: "Hello", baseline: "Other", source: "ct_override" },
      { field: "seo.refresh_tier", effective: "fast", source: "entry_default" },
      {
        field: "seo.include_in_clustering",
        effective: true,
        source: "system",
      },
    ];
    const filtered = filterFieldsByRequest(rows, ["title", "seo.refresh_tier"]);
    expect(filtered.map((r) => r.field)).toEqual(["title", "seo.refresh_tier"]);
    expect(filtered.some((r) => r.field === "seo.include_in_clustering")).toBe(false);

    const contentOnly = filterFieldsByRequest(rows, ["content"]);
    expect(contentOnly).toHaveLength(1);
    expect(contentOnly[0]).not.toHaveProperty("baseline");
    expect(contentOnly[0]!.effective).toBe("# Hi");
  });

  it("keeps stored_in / also_in / publishes_to on selected rows", () => {
    const rows = [
      {
        field: "authors",
        effective: ["4geeks-academy"],
        baseline: ["4geeks-academy"],
        source: "entry_default",
        stored_in: "locale_file",
        stored_in_path: "site_x/blog/post/en.yml",
        also_in: [{ stored_in: "page_common", path: "site_x/blog/post/_common.yml" }],
      },
      { field: "published_at", effective: "2026-08-22", source: "entry_default", stored_in: "draft_file", publishes_to: "page_common" },
    ];
    const [authors, publishedAt] = filterFieldsByRequest(rows, ["authors", "published_at"]);
    expect(authors).toMatchObject({
      stored_in: "locale_file",
      also_in: [{ stored_in: "page_common", path: "site_x/blog/post/_common.yml" }],
    });
    expect(authors).not.toHaveProperty("baseline");
    expect(publishedAt).toMatchObject({ stored_in: "draft_file", publishes_to: "page_common" });
  });

  it("keeps baseline when it differs", () => {
    const row = stripRedundantBaseline({
      field: "title",
      effective: "New",
      baseline: "Old",
    });
    expect(row.baseline).toBe("Old");
  });
});
