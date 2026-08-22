import { describe, expect, it } from "vitest";
import {
  isSkippedEmptyValue,
  isTemplateValue,
  mergeEditorHints,
  skipFieldWithoutEditor,
  validateEditorConfig,
  validateEditorFieldValue,
} from "./validateEditorFieldTypes";

const faqSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["question", "answer"],
    properties: {
      question: { type: "string" },
      answer: { type: "string" },
    },
  },
};

describe("skip helpers", () => {
  it("skips empty values", () => {
    expect(isSkippedEmptyValue(null)).toBe(true);
    expect(isSkippedEmptyValue("")).toBe(true);
    expect(isSkippedEmptyValue("  ")).toBe(true);
    expect(isSkippedEmptyValue([])).toBe(true);
    expect(isSkippedEmptyValue(0)).toBe(false);
    expect(isSkippedEmptyValue(false)).toBe(false);
  });

  it("detects templates", () => {
    expect(isTemplateValue("{{ single.title }}")).toBe(true);
    expect(isTemplateValue("plain")).toBe(false);
  });

  it("skips system specials without editor", () => {
    expect(skipFieldWithoutEditor("_slug", {})).toBe(true);
    expect(skipFieldWithoutEditor("published_at", {})).toBe(true);
    expect(skipFieldWithoutEditor("title", {})).toBe(false);
    expect(skipFieldWithoutEditor("published_at", { published_at: { type: "datetime" } })).toBe(
      false,
    );
  });

  it("merges db editor under ct editor", () => {
    const merged = mergeEditorHints(
      { title: { type: "text" } },
      { title: { type: "textarea" }, bio: { type: "markdown" } },
    );
    expect(merged.title?.type).toBe("text");
    expect(merged.bio?.type).toBe("markdown");
  });
});

describe("validateEditorConfig", () => {
  it("errors when json type has no schema", () => {
    const issues = validateEditorConfig(
      { faq: { type: "json" } },
      { faq: "faq" },
    );
    expect(issues.some((i) => i.code === "EDITOR_JSON_SCHEMA_MISSING")).toBe(true);
  });

  it("errors when relation has no source", () => {
    const issues = validateEditorConfig(
      { author: { type: "relation" } },
      { author: "author" },
    );
    expect(issues.some((i) => i.code === "EDITOR_RELATION_SOURCE_MISSING")).toBe(true);
  });

  it("warns when mapping key has no editor.type", () => {
    const issues = validateEditorConfig({}, { title: "title" });
    expect(issues.some((i) => i.code === "EDITOR_TYPE_MISSING" && i.field === "title")).toBe(
      true,
    );
  });

  it("warns on orphan editor keys", () => {
    const issues = validateEditorConfig({ extra: { type: "text" } }, { title: "title" });
    expect(issues.some((i) => i.code === "EDITOR_ORPHAN_HINT" && i.field === "extra")).toBe(
      true,
    );
  });

  it("errors on unknown editor.type", () => {
    const issues = validateEditorConfig(
      { title: { type: "richtext" } },
      { title: "title" },
    );
    expect(issues.some((i) => i.code === "EDITOR_TYPE_UNKNOWN")).toBe(true);
  });

  it("type-checks mapping default", () => {
    const issues = validateEditorConfig(
      { count: { type: "number" } },
      { count: { source: "count", default: "not-a-number" } },
    );
    expect(issues.some((i) => i.code === "FIELD_TYPE_MISMATCH")).toBe(true);
  });
});

describe("validateEditorFieldValue", () => {
  it("skips templates and empties", () => {
    expect(validateEditorFieldValue("n", "{{ single.n }}", { type: "number" })).toEqual([]);
    expect(validateEditorFieldValue("n", "", { type: "number" })).toEqual([]);
  });

  it("accepts numeric strings for number with no warning", () => {
    expect(validateEditorFieldValue("n", "42", { type: "number" })).toEqual([]);
    expect(validateEditorFieldValue("n", 1.5, { type: "number" })).toEqual([]);
    expect(validateEditorFieldValue("n", "1e3", { type: "number" })).toEqual([]);
  });

  it("warns on non-finite / non-numeric number", () => {
    const issues = validateEditorFieldValue("n", "foo", { type: "number" });
    expect(issues[0]?.code).toBe("FIELD_TYPE_MISMATCH");
    expect(validateEditorFieldValue("n", Infinity, { type: "number" })[0]?.code).toBe(
      "FIELD_TYPE_MISMATCH",
    );
  });

  it("accepts boolean true/false strings", () => {
    expect(validateEditorFieldValue("ok", true, { type: "boolean" })).toEqual([]);
    expect(validateEditorFieldValue("ok", "true", { type: "boolean" })).toEqual([]);
    expect(validateEditorFieldValue("ok", "FALSE", { type: "boolean" })).toEqual([]);
    expect(validateEditorFieldValue("ok", 1, { type: "boolean" })[0]?.code).toBe(
      "FIELD_TYPE_MISMATCH",
    );
  });

  it("accepts tags CSV only when split_comma_values", () => {
    expect(validateEditorFieldValue("t", ["a", "b"], { type: "tags" })).toEqual([]);
    expect(
      validateEditorFieldValue("t", "a, b", { type: "tags", split_comma_values: true }),
    ).toEqual([]);
    expect(validateEditorFieldValue("t", "a, b", { type: "tags" })[0]?.code).toBe(
      "FIELD_TYPE_MISMATCH",
    );
  });

  it("rejects relation objects", () => {
    const issues = validateEditorFieldValue(
      "author",
      { slug: "ada", name: "Ada" },
      { type: "relation", source: "authors" },
    );
    expect(issues[0]?.code).toBe("FIELD_RELATION_INVALID");
  });

  it("warns when select is stored as { slug } object", () => {
    const issues = validateEditorFieldValue(
      "category",
      { slug: "ai-tools" },
      { type: "select", populate_options: true, allow_custom_values: true },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("FIELD_TYPE_MISMATCH");
    expect(issues[0]?.message).toMatch(/should be a string \(select\)/);
  });

  it("accepts relation slug strings", () => {
    expect(
      validateEditorFieldValue("author", "ada", { type: "relation", source: "authors" }),
    ).toEqual([]);
  });

  it("errors when json fails schema", () => {
    const issues = validateEditorFieldValue(
      "faq",
      [{ question: "Q?" }],
      { type: "json", schema: faqSchema },
    );
    expect(issues[0]?.code).toBe("FIELD_JSON_INVALID");
  });

  it("warns when json is stored as a parseable string", () => {
    const issues = validateEditorFieldValue(
      "faq",
      JSON.stringify([{ question: "Q?", answer: "A." }]),
      { type: "json", schema: faqSchema },
    );
    expect(issues[0]?.code).toBe("FIELD_JSON_STORED_AS_STRING");
  });

  it("accepts YAML Date via parseFlexibleDate", () => {
    expect(
      validateEditorFieldValue("d", new Date("2024-01-15T00:00:00.000Z"), { type: "date" }),
    ).toEqual([]);
    expect(validateEditorFieldValue("d", "2024-01-15", { type: "date" })).toEqual([]);
  });
});
