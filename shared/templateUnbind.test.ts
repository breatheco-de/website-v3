import { describe, expect, it } from "vitest";
import {
  applyUnbindToFieldValue,
  formatUnbindLiteralForInsert,
  getSuggestedUnbindDefault,
  parseTemplateExpression,
} from "./templateUnbind";

describe("parseTemplateExpression", () => {
  it("parses name and pipe fallback", () => {
    expect(parseTemplateExpression('{{ single.category | category }}')).toEqual({
      name: "single.category",
      inlineFallback: "category",
      raw: "{{ single.category | category }}",
    });
  });

  it("parses without fallback", () => {
    expect(parseTemplateExpression("{{ single.description }}")).toEqual({
      name: "single.description",
      inlineFallback: undefined,
      raw: "{{ single.description }}",
    });
  });
});

describe("getSuggestedUnbindDefault", () => {
  it("uses pipe fallback", () => {
    expect(getSuggestedUnbindDefault('{{ single.category | category }}')).toBe("category");
  });

  it("parses JSON pipe fallback", () => {
    expect(getSuggestedUnbindDefault("{{ single.items | [] }}")).toEqual([]);
  });

  it("returns empty for single without pipe", () => {
    expect(getSuggestedUnbindDefault("{{ single.description }}")).toBe("");
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
    const field = "{{ single.title | Blog }} - Hub";
    const from = field.indexOf("{{");
    const to = field.indexOf("}}") + 2;
    expect(applyUnbindToFieldValue(field, from, to, "Guides")).toBe("Guides - Hub");
  });
});
