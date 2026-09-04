import { describe, expect, it } from "vitest";
import { applyRawValueAtPath, applyRawValuesAtPaths } from "./applyRawValueAtPath";

describe("applyRawValueAtPath", () => {
  it("sets and deletes nested booleans", () => {
    const parsed: Record<string, unknown> = {
      form: { is_signup: true, conversion_name: "access_free_course_or_tutorial" },
    };
    applyRawValueAtPath(parsed, "form.is_signup", undefined);
    expect(parsed).toEqual({
      form: { conversion_name: "access_free_course_or_tutorial" },
    });
  });

  it("persists null for conversion_name identity opt-out", () => {
    const parsed: Record<string, unknown> = {
      form: { conversion_name: "lead" },
    };
    applyRawValueAtPath(parsed, "form.conversion_name", null);
    expect(parsed).toEqual({ form: { conversion_name: null } });
  });
});

describe("applyRawValuesAtPaths", () => {
  it("clears is_signup and allow_signup in one pass (Require account off)", () => {
    const parsed: Record<string, unknown> = {
      form: {
        is_signup: true,
        allow_signup: true,
        conversion_name: "access_free_course_or_tutorial",
      },
    };
    applyRawValuesAtPaths(parsed, {
      "form.is_signup": undefined,
      "form.allow_signup": undefined,
    });
    expect(parsed).toEqual({
      form: { conversion_name: "access_free_course_or_tutorial" },
    });
  });

  it("does not resurrect is_signup when clearing allow_signup after it", () => {
    // Regression: consecutive single updates used stale YAML and put is_signup back.
    const parsed: Record<string, unknown> = {
      form: { is_signup: true, allow_signup: false, conversion_name: "lead" },
    };
    applyRawValuesAtPaths(parsed, {
      "form.is_signup": undefined,
      "form.allow_signup": undefined,
    });
    expect((parsed.form as Record<string, unknown>).is_signup).toBeUndefined();
    expect((parsed.form as Record<string, unknown>).allow_signup).toBeUndefined();
  });
});
