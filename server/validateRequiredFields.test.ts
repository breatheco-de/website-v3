import { describe, it, expect } from "vitest";
import {
  validateRequiredFields,
  listRequiredEditorFields,
  isEmptyRequiredValue,
  satisfyRequiredEditorField,
  effectiveRequiredMode,
  buildRequiredFieldSuggestion,
  resolveRequiredFieldGuidance,
} from "@shared/validateRequiredFields";

const ctaSchema = {
  type: "object",
  required: ["title", "subtitle", "conversion_name"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    conversion_name: { type: "string" },
  },
  additionalProperties: true,
};

describe("validateRequiredFields", () => {
  it("lists required editor keys including attached when shared and not detached", () => {
    expect(
      listRequiredEditorFields(
        {
          title: { required: true },
          call_to_action: { required: "attached" },
          category: { type: "select" },
        },
        { isSharedLayout: true, isDetached: false },
      ),
    ).toEqual(["title", "call_to_action"]);
  });

  it("skips attached-required when detached", () => {
    expect(
      listRequiredEditorFields(
        {
          title: { required: true },
          call_to_action: { required: "attached" },
        },
        { isSharedLayout: true, isDetached: true },
      ),
    ).toEqual(["title"]);
  });

  it("treats attached as always required when not shared-layout", () => {
    expect(
      listRequiredEditorFields(
        { call_to_action: { required: "attached" } },
        { isSharedLayout: false, isDetached: false },
      ),
    ).toEqual(["call_to_action"]);
  });

  it("treats empty string and templates as empty", () => {
    expect(isEmptyRequiredValue("")).toBe(true);
    expect(isEmptyRequiredValue("  ")).toBe(true);
    expect(isEmptyRequiredValue("{{ single.title }}")).toBe(true);
    expect(isEmptyRequiredValue("Real title")).toBe(false);
    expect(isEmptyRequiredValue({})).toBe(true);
  });

  it("fails when a required field is empty with mode-aware message", () => {
    const result = validateRequiredFields(
      { title: { required: true }, description: { required: true } },
      { title: "Hello", description: "" },
      "publish",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe("description");
      expect(result.errors[0].message).toContain("editor.required: true");
    }
  });

  it("passes when all required fields are set", () => {
    expect(
      validateRequiredFields(
        { title: { required: true }, description: { required: true } },
        { title: "Hello", description: "World" },
        "live_update",
      ),
    ).toEqual({ ok: true });
  });

  it("fails empty call_to_action object for attached mode", () => {
    const result = validateRequiredFields(
      {
        call_to_action: {
          type: "json",
          required: "attached",
          schema: ctaSchema,
        },
      },
      { call_to_action: {} },
      "publish",
      { isSharedLayout: true, isDetached: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("editor.required: attached");
    }
  });

  it("fails partial call_to_action missing conversion_name via schema", () => {
    const errors = satisfyRequiredEditorField(
      "call_to_action",
      { title: "T", subtitle: "S" },
      { type: "json", required: "attached", schema: ctaSchema },
      "attached",
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field.includes("conversion_name"))).toBe(true);
  });

  it("passes valid call_to_action with known conversion_name", () => {
    const errors = satisfyRequiredEditorField(
      "call_to_action",
      {
        title: "T",
        subtitle: "S",
        conversion_name: "student_application",
      },
      { type: "json", required: "attached", schema: ctaSchema },
      "attached",
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(errors).toEqual([]);
  });

  it("effectiveRequiredMode is null when detached and attached-required", () => {
    expect(
      effectiveRequiredMode(
        { required: "attached" },
        { isSharedLayout: true, isDetached: true },
      ),
    ).toBeNull();
  });
});

describe("buildRequiredFieldSuggestion", () => {
  const ctaHint = {
    type: "json" as const,
    required: "attached" as const,
    description:
      "Per-post CTA banner copy and lead settings for the shared blog cta_banner.",
    schema: {
      type: "object",
      properties: {
        conversion_name: {
          type: "string",
          description: "Must match a tracking.conversion_events name.",
        },
        tags: { type: "string" },
      },
    },
  };

  const faqHint = {
    type: "json" as const,
    required: "attached" as const,
    description:
      "At least 5 items, this is really important for SEO/GEO purposes because it creates schema org for FAQ.",
    schema: {
      type: "array",
      minItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
  };

  it("surfaces FAQ description (SEO/GEO) and omits detach when description set", () => {
    const s = buildRequiredFieldSuggestion({
      fieldPath: "faq_entries",
      mode: "attached",
      hint: faqHint,
    });
    expect(s).toContain("SEO/GEO");
    expect(s).toContain("editor.faq_entries.schema");
    expect(s).not.toContain("detach");
  });

  it("prefers fill_intent over description when both set", () => {
    const s = buildRequiredFieldSuggestion({
      fieldPath: "faq_entries",
      mode: "attached",
      hint: {
        ...faqHint,
        fill_intent: {
          goal: "geo_llm",
          purpose: "Intent-driven FAQ brief for LLMs",
        },
      },
    });
    expect(s).toContain("Intent-driven FAQ brief");
    expect(s).not.toContain("SEO/GEO purposes");
  });

  it("surfaces CTA description (lead/conversion) on top-level empty", () => {
    const s = buildRequiredFieldSuggestion({
      fieldPath: "call_to_action",
      mode: "attached",
      hint: ctaHint,
    });
    expect(s).toContain("CTA banner");
    expect(s).not.toContain("detach");
  });

  it("prefers nested JSON Schema property description over top-level", () => {
    expect(
      resolveRequiredFieldGuidance("call_to_action.conversion_name", ctaHint),
    ).toBe("Must match a tracking.conversion_events name.");
    const s = buildRequiredFieldSuggestion({
      fieldPath: "call_to_action.conversion_name",
      mode: "attached",
      hint: ctaHint,
    });
    expect(s).toContain("tracking.conversion_events");
    expect(s).not.toContain("CTA banner");
  });

  it("falls back to structural + detach when description missing", () => {
    const s = buildRequiredFieldSuggestion({
      fieldPath: "title",
      mode: "attached",
      hint: { required: "attached" },
    });
    expect(s).toContain("non-empty");
    expect(s).toContain("detach");
    expect(s).not.toContain("Must satisfy editor.");
  });

  it("fails faq_entries with fewer than minItems via schema", () => {
    const errors = satisfyRequiredEditorField(
      "faq_entries",
      [
        { question: "Q1?", answer: "A1" },
        { question: "Q2?", answer: "A2" },
      ],
      faqHint,
      "attached",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /fewer than 5/i.test(e.message))).toBe(true);
  });
});
