import { describe, expect, it } from "vitest";
import {
  CONVERSION_INTENT_MAX_CHARS,
  CONVERSION_INTENT_MIN_CHARS,
  isConversionIntentFieldValid,
  validateConversionEventIntent,
  validateConversionIntentField,
} from "./conversionEventIntent";

const okText = "Visitor is applying or enrolling in a program via Apply or Enroll.";

describe("conversionEventIntent", () => {
  it("rejects missing or short when_to_use", () => {
    expect(validateConversionIntentField("when_to_use", undefined)).toMatch(/required/);
    expect(validateConversionIntentField("when_to_use", "too short")).toMatch(
      new RegExp(`at least ${CONVERSION_INTENT_MIN_CHARS}`),
    );
    expect(isConversionIntentFieldValid("too short")).toBe(false);
  });

  it("rejects over-long fields", () => {
    const long = "x".repeat(CONVERSION_INTENT_MAX_CHARS + 1);
    expect(validateConversionIntentField("when_not_to_use", long)).toMatch(
      new RegExp(`at most ${CONVERSION_INTENT_MAX_CHARS}`),
    );
  });

  it("accepts valid length", () => {
    expect(validateConversionIntentField("when_to_use", okText)).toBeNull();
    expect(isConversionIntentFieldValid(okText)).toBe(true);
  });

  it("validateConversionEventIntent requires both fields", () => {
    expect(
      validateConversionEventIntent({
        name: "student_application",
        when_to_use: okText,
      }),
    ).toMatch(/when_not_to_use/);

    expect(
      validateConversionEventIntent({
        name: "student_application",
        when_to_use: okText,
        when_not_to_use: "Soft info, downloads, newsletter — use those events instead.",
      }),
    ).toBeNull();
  });
});
