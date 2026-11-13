import { describe, expect, it } from "vitest";
import { evaluateVariableWrite, readMetadataInput } from "./variable-write-rules";
import type { VariableDefinition } from "./variable-manager";

const described: VariableDefinition = {
  description: "Full-stack tuition",
  category: "price",
  default: "$10,999",
  conditions: [{ query: { region: "europe" }, value: "6.800 €" }],
};

function run(
  action: Parameters<typeof evaluateVariableWrite>[0]["action"],
  existing: VariableDefinition | null,
  body: Record<string, unknown>,
  name = "global.price_full_fullstack",
) {
  return evaluateVariableWrite({
    name,
    action,
    existing,
    body,
    knownNames: ["global.price_full_fullstack", "global.ai_fluency_price"],
    usageCount: () => 7,
  });
}

describe("evaluateVariableWrite — required metadata", () => {
  it("refuses creating a variable without description", () => {
    const r = run("set_default", null, { value: "x", metadata: { category: "copy" } }, "global.new_var");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("description_required");
  });

  it("refuses creating a variable without category", () => {
    const r = run("set_default", null, { value: "x", metadata: { description: "A thing" } }, "global.new_var");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("category_required");
  });

  it("allows creating with both fields and returns the patch", () => {
    const r = run(
      "set_default",
      null,
      { value: "x", metadata: { description: "A thing", category: "copy" } },
      "global.new_var",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadataPatch).toMatchObject({ description: "A thing", category: "copy" });
  });

  it("refuses editing an undescribed variable without the missing field", () => {
    const r = run("add_condition", { default: "1" }, { condition: { query: { locale: "es" }, value: "2" } }, "global.x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("description_required");
  });

  it("refuses rename of an undescribed variable", () => {
    const r = run("rename", { default: "1" }, { newName: "y" }, "global.x");
    expect(r.ok).toBe(false);
  });

  it("does not require metadata to delete a condition", () => {
    expect(run("delete_condition", { default: "1" }, { index: 0 }, "global.x").ok).toBe(true);
  });

  it("skips reserved, brand and consent variables", () => {
    expect(run("set_default", { default: "a", isReserved: true }, { value: "b" }, "global.legal_terms_url").ok).toBe(true);
    expect(run("set_default", null, { value: "b" }, "brand.title").ok).toBe(true);
    expect(run("set_default", null, { value: "b" }, "reserved.consent_sms").ok).toBe(true);
  });

  it("rejects unknown category and unit", () => {
    const badCat = run("set_metadata", described, { description: "d", category: "bogus" });
    expect(!badCat.ok && badCat.code).toBe("invalid_category");
    const badUnit = run("set_metadata", described, { description: "d", category: "price", unit: "yen" });
    expect(!badUnit.ok && badUnit.code).toBe("invalid_unit");
  });

  it("rejects unknown source and non-list products", () => {
    const badSource = run("set_metadata", described, {
      description: "d",
      category: "price",
      source: "third_party",
    });
    expect(!badSource.ok && badSource.code).toBe("invalid_source");
    const badProducts = run("set_metadata", described, {
      description: "d",
      category: "price",
      products: "ai-flex",
    });
    expect(!badProducts.ok && badProducts.code).toBe("invalid_products");
  });

  it("accepts source and products list on set_metadata", () => {
    const r = run("set_metadata", described, {
      description: "d",
      category: "price",
      source: "internal",
      products: ["ai-flex", "full-stack", "ai-flex"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.metadataPatch).toMatchObject({
        source: "internal",
        products: ["ai-flex", "full-stack"],
      });
    }
  });

  it("rejects replaced_by pointing at a missing variable", () => {
    const r = run("set_metadata", described, { deprecated: true, replaced_by: "global.nope" });
    expect(!r.ok && r.code).toBe("replaced_by_unknown");
  });
});

describe("evaluateVariableWrite — figure confirmation", () => {
  it("returns 409 with usage count for a figure default change", () => {
    const r = run("set_default", described, { value: "$11,999" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe("confirm_figure_change");
      expect(r.details).toMatchObject({ usage_count: 7, old_value: "$10,999", new_value: "$11,999" });
    }
  });

  it("succeeds with confirm_figure_change", () => {
    expect(run("set_default", described, { value: "$11,999", confirm_figure_change: true }).ok).toBe(true);
  });

  it("does not ask when the value is unchanged", () => {
    expect(run("set_default", described, { value: "$10,999" }).ok).toBe(true);
  });

  it("asks for condition edits on figures", () => {
    const r = run("update_condition", described, { index: 0, condition: { query: { region: "europe" }, value: "7.000 €" } });
    expect(!r.ok && r.code).toBe("confirm_figure_change");
  });

  it("does not ask for non-figure categories or metadata-only writes", () => {
    const copy: VariableDefinition = { description: "Button", category: "copy", default: "Apply" };
    expect(run("set_default", copy, { value: "Apply now" }, "global.cta").ok).toBe(true);
    expect(run("set_metadata", described, { description: "New wording", category: "price" }).ok).toBe(true);
  });

  it("does not ask when creating a new figure variable", () => {
    expect(
      run("set_default", null, { value: "$1", metadata: { description: "d", category: "price" } }, "global.new_price").ok,
    ).toBe(true);
  });
});

describe("readMetadataInput", () => {
  it("reads set_metadata fields from the body", () => {
    expect(
      readMetadataInput("set_metadata", {
        description: "d",
        category: "price",
        unit: "usd",
        source: "external",
        products: ["ai-flex"],
      }),
    ).toEqual({
      ok: true,
      patch: {
        description: "d",
        category: "price",
        unit: "usd",
        source: "external",
        products: ["ai-flex"],
      },
    });
  });

  it("rejects non-array products at parse time", () => {
    const r = readMetadataInput("set_metadata", {
      description: "d",
      category: "price",
      products: "ai-flex",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_products");
  });

  it("ignores body fields for value actions unless nested in metadata", () => {
    expect(readMetadataInput("set_default", { value: "x", description: "d" })).toEqual({
      ok: true,
      patch: null,
    });
  });
});
