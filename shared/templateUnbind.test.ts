import { describe, expect, it } from "vitest";
import {
  applyUnbindToFieldValue,
  formatUnbindLiteralForInsert,
  getSuggestedUnbindDefault,
  parseTemplateExpression,
} from "./templateUnbind";

describe("parseTemplateExpression", () => {
  it("parses name and pipe fallback", () => {
    expect(parseTemplateExpression('{{ entry.category | category }}')).toEqual({
      name: "entry.category",
      inlineFallback: "category",
      raw: "{{ entry.category | category }}",
    });
  });

  it("parses without fallback", () => {
    expect(parseTemplateExpression("{{ entry.description }}")).toEqual({
      name: "entry.description",
      inlineFallback: undefined,
      raw: "{{ entry.description }}",
    });
  });
});

describe("getSuggestedUnbindDefault", () => {
  it("uses pipe fallback", () => {
    expect(getSuggestedUnbindDefault('{{ entry.category | category }}')).toBe("category");
  });

  it("parses JSON pipe fallback", () => {
    expect(getSuggestedUnbindDefault("{{ entry.items | [] }}")).toEqual([]);
  });

  it("returns empty for single without pipe", () => {
    expect(getSuggestedUnbindDefault("{{ entry.description }}")).toBe("");
  });

  it("uses global definition default", () => {
    expect(
      getSuggestedUnbindDefault("{{ hero_title }}", {
        definitions: { hero_title: { default: "Welcome" } },
      }),
    ).toBe("Welcome");
  });
});

describe("formatUnbindLiteralForInsert", () => {
  it("stringifies arrays for YAML string fields", () => {
    expect(formatUnbindLiteralForInsert([])).toBe("[]");
  });

  it("passes through strings", () => {
    expect(formatUnbindLiteralForInsert("hello")).toBe("hello");
  });
});

describe("applyUnbindToFieldValue", () => {
  it("replaces only the template span in mixed strings", () => {
    const field = "{{ entry.title | Blog }} - Hub";
    const from = field.indexOf("{{");
    const to = field.indexOf("}}") + 2;
    expect(applyUnbindToFieldValue(field, from, to, "Guides")).toBe("Guides - Hub");
  });
});
