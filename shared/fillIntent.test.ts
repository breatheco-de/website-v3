import { describe, it, expect } from "vitest";
import {
  FILL_INTENT_GOAL_PRESETS,
  parseFillIntent,
  isValidFillIntent,
  isPresetFillIntentGoal,
  formatFillIntentForSuggestion,
  assertRequiredFieldsHaveFillIntent,
  listNonPresetFillIntentGoals,
} from "@shared/fillIntent";
import {
  buildRequiredFieldSuggestion,
  resolveRequiredFieldGuidance,
} from "@shared/validateRequiredFields";

describe("fillIntent", () => {
  it("parses valid intent and rejects incomplete", () => {
    expect(
      parseFillIntent({
        goal: "geo_llm",
        purpose: "FAQ for LLMs",
        constraints: ["At least 5"],
      }),
    ).toEqual({
      goal: "geo_llm",
      purpose: "FAQ for LLMs",
      constraints: ["At least 5"],
    });
    expect(isValidFillIntent({ goal: "x", purpose: "" })).toBe(false);
    expect(isValidFillIntent({ goal: "", purpose: "y" })).toBe(false);
    expect(isValidFillIntent({ goal: "custom_goal", purpose: "ok" })).toBe(true);
  });

  it("treats custom goals as valid but not preset", () => {
    expect(isPresetFillIntentGoal("geo_llm")).toBe(true);
    expect(isPresetFillIntentGoal("lead_nurture")).toBe(false);
    expect(FILL_INTENT_GOAL_PRESETS).toContain("conversion");
  });

  it("assertRequiredFieldsHaveFillIntent lists gaps", () => {
    const r = assertRequiredFieldsHaveFillIntent({
      title: { required: true },
      faq: {
        required: "attached",
        fill_intent: { goal: "geo_llm", purpose: "FAQ" },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields).toEqual(["title"]);
  });

  it("lists non-preset goals for soft warnings", () => {
    expect(
      listNonPresetFillIntentGoals({
        a: { fill_intent: { goal: "lead_nurture", purpose: "x" } },
        b: { fill_intent: { goal: "seo", purpose: "y" } },
      }),
    ).toEqual([{ field: "a", goal: "lead_nurture" }]);
  });

  it("formats suggestion text", () => {
    expect(
      formatFillIntentForSuggestion({
        goal: "conversion",
        purpose: "Convert traffic",
        constraints: ["Never invent tags"],
      }),
    ).toContain("[goal: conversion]");
  });
});

describe("resolveRequiredFieldGuidance prefers fill_intent", () => {
  it("uses fill_intent over description for top-level fields", () => {
    const g = resolveRequiredFieldGuidance("faq_entries", {
      description: "UI hint only",
      fill_intent: {
        goal: "geo_llm",
        purpose: "Real LLM questions",
        constraints: ["Refresh often"],
      },
    });
    expect(g).toContain("geo_llm");
    expect(g).toContain("Real LLM questions");
    expect(g).not.toContain("UI hint only");
  });

  it("buildRequiredFieldSuggestion omits detach when fill_intent set", () => {
    const s = buildRequiredFieldSuggestion({
      fieldPath: "call_to_action",
      mode: "attached",
      hint: {
        type: "json",
        required: "attached",
        schema: { type: "object" },
        fill_intent: {
          goal: "conversion",
          purpose: "Convert for this page audience",
        },
      },
    });
    expect(s).toContain("conversion");
    expect(s).not.toContain("detach");
  });
});
