import { describe, expect, it } from "vitest";
import {
  isSignupFieldMapError,
  signupFieldMapActionRequired,
} from "./signup-field-map-hints.js";

describe("isSignupFieldMapError", () => {
  it("matches field_map identity errors", () => {
    expect(
      isSignupFieldMapError(
        "form.is_signup is true but auth.signup.field_map is empty — add signup field mappings",
      ),
    ).toBe(true);
    expect(
      isSignupFieldMapError(
        'form.fields.plan.required must be true (auth.signup.field_map key "plan" is required)',
      ),
    ).toBe(true);
    expect(isSignupFieldMapError("ecommerce scope missing")).toBe(false);
  });
});

describe("signupFieldMapActionRequired", () => {
  it("returns fix_signup_field_map envelope", () => {
    const result = signupFieldMapActionRequired(
      "sections[2].form.is_signup is true but auth.signup.field_map is empty",
      { slug: "home", locale: "en", contentType: "page" },
    );
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    expect(text).toMatch(/fix_signup_field_map/);
    expect(text).toMatch(/lead-forms/);
    expect(text).toMatch(/sections\[2\]\.form/);
  });
});
