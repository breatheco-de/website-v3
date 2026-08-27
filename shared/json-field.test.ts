import { describe, expect, it } from "vitest";
import {
  coerceJsonFieldInput,
  compileJsonSchema,
  formatJsonFieldDraft,
  parseJsonFieldText,
  parsePipeFallback,
  resolveSingleTemplateValue,
  validateJsonAgainstSchema,
} from "./json-field";

const faqArraySchema = {
  type: "array",
  items: {
    type: "object",
    required: ["question", "answer"],
    properties: {
      question: { type: "string" },
      answer: { type: "string" },
    },
    additionalProperties: true,
  },
};

describe("parseJsonFieldText", () => {
  it("maps empty/whitespace to null", () => {
    expect(parseJsonFieldText("")).toEqual({ ok: true, value: null });
    expect(parseJsonFieldText("  \n")).toEqual({ ok: true, value: null });
  });

  it("parses arrays and objects", () => {
    expect(parseJsonFieldText("[1,2]")).toEqual({ ok: true, value: [1, 2] });
    expect(parseJsonFieldText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects invalid JSON", () => {
    const r = parseJsonFieldText("{");
    expect(r.ok).toBe(false);
  });
});

describe("compileJsonSchema / validateJsonAgainstSchema", () => {
  it("compiles a valid schema", () => {
    expect(compileJsonSchema(faqArraySchema).ok).toBe(true);
  });

  it("rejects non-object schemas", () => {
    expect(compileJsonSchema([]).ok).toBe(false);
    expect(compileJsonSchema("x").ok).toBe(false);
  });

  it("accepts valid FAQ-shaped arrays", () => {
    const r = validateJsonAgainstSchema(
      [{ question: "Q?", answer: "A." }],
      faqArraySchema,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects invalid shapes and returns schema", () => {
    const r = validateJsonAgainstSchema([{ question: "Q?" }], faqArraySchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.schema).toEqual(faqArraySchema);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("coerceJsonFieldInput", () => {
  it("parses string payloads once then validates", () => {
    const r = coerceJsonFieldInput(
      JSON.stringify([{ question: "Q?", answer: "A." }]),
      faqArraySchema,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([{ question: "Q?", answer: "A." }]);
    }
  });

  it("allows null without schema checks", () => {
    expect(coerceJsonFieldInput(null, faqArraySchema)).toEqual({
      ok: true,
      value: null,
    });
    expect(coerceJsonFieldInput("")).toEqual({ ok: true, value: null });
  });

  it("requires schema for non-null values", () => {
    const r = coerceJsonFieldInput([{ question: "Q?", answer: "A." }], null);
    expect(r.ok).toBe(false);
  });
});

describe("parsePipeFallback", () => {
  it("parses JSON literals", () => {
    expect(parsePipeFallback("[]")).toEqual([]);
    expect(parsePipeFallback('{"enabled":false}')).toEqual({ enabled: false });
    expect(parsePipeFallback("null")).toBe(null);
    expect(parsePipeFallback("true")).toBe(true);
    expect(parsePipeFallback("42")).toBe(42);
  });

  it("returns prose/path fallbacks as strings", () => {
    expect(parsePipeFallback("/fallback.webp")).toBe("/fallback.webp");
    expect(parsePipeFallback("default.jpg")).toBe("default.jpg");
  });
});

describe("resolveSingleTemplateValue", () => {
  it("returns FAQ arrays from exact single binds", () => {
    const faqs = [{ question: "Q?", answer: "A." }];
    expect(
      resolveSingleTemplateValue("{{ entry.faq_entries | [] }}", {
        faq_entries: faqs,
      }),
    ).toEqual(faqs);
  });

  it("parses JSON pipe fallbacks when the bag misses the field", () => {
    expect(resolveSingleTemplateValue("{{ entry.faq_entries | [] }}", {})).toEqual(
      [],
    );
    expect(
      resolveSingleTemplateValue(
        '{{ entry.title | ¿Qué significa ser Full Stack? }}',
        {},
      ),
    ).toBe("¿Qué significa ser Full Stack?");
  });

  it("resolves exact string fields for search phrases", () => {
    expect(
      resolveSingleTemplateValue("{{ entry.title | fallback }}", {
        title: "Real title",
      }),
    ).toBe("Real title");
  });

  it("leaves non-bind arrays and objects alone", () => {
    const items = [{ question: "Q?", answer: "A." }];
    expect(resolveSingleTemplateValue(items, {})).toEqual(items);
  });
});

describe("formatJsonFieldDraft", () => {
  it("pretty-prints and empties null", () => {
    expect(formatJsonFieldDraft(null)).toBe("");
    expect(formatJsonFieldDraft({ a: 1 })).toContain('"a"');
  });
});
