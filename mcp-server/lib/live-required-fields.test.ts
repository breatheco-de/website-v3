import { describe, it, expect } from "vitest";
import {
  LIVE_REQUIRED_FIELDS_CODE,
  circularRequiredFieldsHint,
  isCircularDescriptionTrap,
  parseLiveRequiredMissingFields,
} from "@shared/liveSeoGate";
import {
  isLiveRequiredFieldsError,
  liveRequiredFieldsActionRequired,
  editApiErrorResult,
} from "./live-required-fields";

describe("liveSeoGate helpers", () => {
  it("parses meta + editor.required fields from gate messages", () => {
    const msg =
      "meta.page_title is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates). " +
      "meta.description is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates). " +
      'Field "title" is required for publish and cannot be empty on a live entry. ' +
      'Field "description" is required for publish and cannot be empty on a live entry.';
    expect(parseLiveRequiredMissingFields(msg)).toEqual([
      "meta.page_title",
      "meta.description",
      "title",
      "description",
    ]);
  });

  it("detects circular description trap", () => {
    expect(
      isCircularDescriptionTrap(["meta.description", "description"]),
    ).toBe(true);
    expect(isCircularDescriptionTrap(["meta.description"])).toBe(false);
    expect(isCircularDescriptionTrap(["title", "description"])).toBe(false);
  });

  it("emits circular hint when meta and body required fields are both missing", () => {
    const hint = circularRequiredFieldsHint([
      "meta.description",
      "description",
    ]);
    expect(hint).toContain("CIRCULAR_REQUIRED_FIELDS");
    expect(hint).toContain("update_fields");
  });
});

describe("MCP live required fields guidance", () => {
  it("recognizes structured and string gate errors", () => {
    expect(
      isLiveRequiredFieldsError("x", LIVE_REQUIRED_FIELDS_CODE),
    ).toBe(true);
    expect(
      isLiveRequiredFieldsError(
        "meta.description is required before saving a live page",
      ),
    ).toBe(true);
    expect(isLiveRequiredFieldsError("unrelated boom")).toBe(false);
  });

  it("returns action_required with update_fields next_action", () => {
    const result = liveRequiredFieldsActionRequired({
      errMsg:
        "meta.description is required before saving a live page. " +
        'Field "description" is required for publish and cannot be empty on a live entry.',
      code: LIVE_REQUIRED_FIELDS_CODE,
      missingFields: ["meta.description", "description"],
      slug: "how-to-pay-for-a-coding-bootcamp",
      locale: "en",
      contentType: "blog",
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as {
      action_required: string;
      code: string;
      missing_fields: string[];
      next_actions: Array<{ tool: string; args_hint?: { updates?: unknown[] } }>;
    };
    expect(payload.action_required).toBe("fix_live_required_fields");
    expect(payload.code).toBe(LIVE_REQUIRED_FIELDS_CODE);
    expect(payload.missing_fields).toEqual([
      "meta.description",
      "description",
    ]);
    expect(payload.next_actions[0]?.tool).toBe("update_fields");
    expect(payload.next_actions[0]?.args_hint?.updates).toHaveLength(2);
  });

  it("surfaces seo_keyword_taken with code and warnings", () => {
    const result = editApiErrorResult(
      'Main keyword "learn javascript" is already used by /en/blog/post-a.',
      { code: "seo_keyword_taken" },
      { slug: "post-b", locale: "en", contentType: "blog" },
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as {
      success: boolean;
      code: string;
      warnings: Array<{ code: string }>;
    };
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("seo_keyword_taken");
    expect(payload.warnings.some((w) => w.code === "seo_keyword_taken")).toBe(true);
  });
});
