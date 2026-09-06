import { describe, expect, it } from "vitest";
import {
  jsonFieldFailureHttpBody,
  validateAndCoerceJsonFields,
  validateEditorHintsHaveJsonSchemas,
  validateTouchedJsonFieldsInDocument,
} from "./json-field-validate";

const schema = {
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

describe("validateEditorHintsHaveJsonSchemas", () => {
  it("requires schema for json type", () => {
    const r = validateEditorHintsHaveJsonSchemas({
      faq_entries: { type: "json" },
    });
    expect(r.ok).toBe(false);
  });

  it("accepts compilable schema", () => {
    expect(
      validateEditorHintsHaveJsonSchemas({
        faq_entries: { type: "json", schema },
      }).ok,
    ).toBe(true);
  });
});

describe("validateAndCoerceJsonFields", () => {
  it("coerces string JSON and validates", () => {
    const r = validateAndCoerceJsonFields(
      {
        title: "x",
        faq_entries: JSON.stringify([{ question: "Q?", answer: "A." }]),
      },
      { faq_entries: { type: "json", schema } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.faq_entries).toEqual([{ question: "Q?", answer: "A." }]);
      expect(r.fields.title).toBe("x");
    }
  });

  it("returns schema on failure for MCP", () => {
    const r = validateAndCoerceJsonFields(
      { faq_entries: [{ question: "Q?" }] },
      { faq_entries: { type: "json", schema } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const body = jsonFieldFailureHttpBody(r.failures);
      expect(body.schema).toBeTruthy();
      expect(body.details[0].field).toBe("faq_entries");
    }
  });
});

const ctaSchema = {
  type: "object",
  required: ["title", "subtitle", "conversion_name"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    conversion_name: { type: "string" },
    tags: { type: "string" },
    program: { type: "string" },
  },
  additionalProperties: false,
};

describe("validateTouchedJsonFieldsInDocument", () => {
  const editor = {
    call_to_action: { type: "json" as const, schema: ctaSchema },
    title: { type: "text" as const },
  };

  it("rejects ecommerce_product_field on touched call_to_action", () => {
    const r = validateTouchedJsonFieldsInDocument(
      {
        call_to_action: {
          title: "Become an AI Engineer",
          subtitle: "Learn with us",
          conversion_name: "student_application",
          ecommerce_product_field: "program",
        },
      },
      ["call_to_action"],
      editor,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures[0]?.field).toBe("call_to_action");
      expect(r.failures[0]?.error).toMatch(/additional properties|ecommerce_product_field/i);
    }
  });

  it("accepts schema-valid call_to_action", () => {
    const r = validateTouchedJsonFieldsInDocument(
      {
        call_to_action: {
          title: "Become an AI Engineer",
          subtitle: "Learn with us",
          conversion_name: "student_application",
        },
      },
      ["call_to_action"],
      editor,
    );
    expect(r.ok).toBe(true);
  });

  it("skips schema when field was cleared", () => {
    const r = validateTouchedJsonFieldsInDocument(
      {},
      ["call_to_action"],
      editor,
    );
    expect(r.ok).toBe(true);
  });

  it("does not validate untouched json fields", () => {
    const r = validateTouchedJsonFieldsInDocument(
      {
        title: "Hello",
        call_to_action: {
          title: "x",
          ecommerce_product_field: "program",
        },
      },
      ["title"],
      editor,
    );
    expect(r.ok).toBe(true);
  });
});
