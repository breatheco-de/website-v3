import { describe, expect, it } from "vitest";
import {
  buildSignupPayloadFromFieldMap,
  buildSignupPayloadPreviewJson,
  DEFAULT_AUTH_SIGNUP_FIELD_MAP,
  DEFAULT_FREE_SIGNUP_PLAN_EXPR,
  isSignupFieldMapReady,
  normalizeAuthSignupFieldMapInput,
  parseAuthSignupFieldMap,
  validateSignupFormFields,
} from "./authSignupFieldMap";

describe("authSignupFieldMap", () => {
  it("normalizes field map and rejects required on session sources", () => {
    expect(() =>
      normalizeAuthSignupFieldMapInput([
        { key: "country", from: "session.geo.country", required: true },
      ]),
    ).toThrow(/required is only allowed/);

    const ok = normalizeAuthSignupFieldMapInput([
      { key: "plan", from: "form.plan", required: true },
      { key: "country", from: "session.geo.country" },
    ]);
    expect(ok).toEqual([
      { key: "plan", from: "form.plan", required: true },
      { key: "country", from: "session.geo.country" },
    ]);
  });

  it("normalizes constant and global entries", () => {
    const ok = normalizeAuthSignupFieldMapInput([
      { key: "source", constant: "website" },
      { key: "plan", global: "global.default_free_signup_plan" },
    ]);
    expect(ok).toEqual([
      { key: "source", constant: "website" },
      { key: "plan", global: "global.default_free_signup_plan" },
    ]);
  });

  it("rejects empty constant and mixed sources", () => {
    expect(() =>
      normalizeAuthSignupFieldMapInput([{ key: "x", constant: "  " }]),
    ).toThrow(/constant must be a non-empty/);
    expect(() =>
      normalizeAuthSignupFieldMapInput([
        { key: "x", from: "form.email", constant: "a" },
      ]),
    ).toThrow(/exactly one/);
    expect(() =>
      normalizeAuthSignupFieldMapInput([{ key: "x", global: "brand.logo" }]),
    ).toThrow(/must match global\./);
  });

  it("builds payload from map including constant and global", () => {
    const body = buildSignupPayloadFromFieldMap(
      [
        { key: "email", from: "form.email" },
        { key: "course", from: "form.program" },
        { key: "country", from: "session.geo.country" },
        { key: "source", constant: "website" },
        { key: "plan", global: "global.default_free_signup_plan" },
      ],
      {
        form: { email: "a@b.com", program: "ai-eng" },
        session: { geo: { country: "" } },
        globals: { "global.default_free_signup_plan": "4geeks-basic-subscription" },
      },
      { landing_url: "/x" },
    );
    expect(body).toEqual({
      email: "a@b.com",
      course: "ai-eng",
      country: "",
      source: "website",
      plan: "4geeks-basic-subscription",
      conversion_info: { landing_url: "/x" },
    });
  });

  it("missing global resolves to empty string", () => {
    const body = buildSignupPayloadFromFieldMap(
      [{ key: "plan", global: "global.missing" }],
      { form: {}, session: {}, globals: {} },
      {},
    );
    expect(body.plan).toBe("");
  });

  it("preview json shows literals and template vars", () => {
    const json = buildSignupPayloadPreviewJson([
      { key: "email", from: "form.email" },
      { key: "source", constant: "website" },
      { key: "plan", global: "global.default_free_signup_plan" },
    ]);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(obj.email).toBe("{{ form.email }}");
    expect(obj.source).toBe("website");
    expect(obj.plan).toBe("{{ global.default_free_signup_plan }}");
  });

  it("parseAuthSignupFieldMap accepts discriminated rows", () => {
    const parsed = parseAuthSignupFieldMap([
      { key: "a", from: "form.email" },
      { key: "b", constant: "x" },
      { key: "c", global: "global.foo" },
      { key: "skip", constant: "" },
    ]);
    expect(parsed).toEqual([
      { key: "a", from: "form.email" },
      { key: "b", constant: "x" },
      { key: "c", global: "global.foo" },
    ]);
  });

  it("validateSignupFormFields fails on empty map", () => {
    const err = validateSignupFormFields({ is_signup: true, fields: {} }, []);
    expect(err).toMatch(/field_map is empty/);
    expect(err).toContain(DEFAULT_FREE_SIGNUP_PLAN_EXPR);
  });

  it("validateSignupFormFields requires plan.required when mapped required", () => {
    const err = validateSignupFormFields(
      {
        is_signup: true,
        fields: {
          email: { visible: true, required: true },
          plan: { visible: false, required: false, default: "x" },
        },
      },
      DEFAULT_AUTH_SIGNUP_FIELD_MAP,
    );
    expect(err).toMatch(/fields\.plan\.required must be true/);
  });

  it("validateSignupFormFields passes with hidden required plan", () => {
    const err = validateSignupFormFields(
      {
        is_signup: true,
        fields: {
          email: { visible: true, required: true },
          plan: {
            visible: false,
            required: true,
            default: DEFAULT_FREE_SIGNUP_PLAN_EXPR,
          },
        },
      },
      DEFAULT_AUTH_SIGNUP_FIELD_MAP,
    );
    expect(err).toBeNull();
  });

  it("validateSignupFormFields skips when allow_signup is false", () => {
    const err = validateSignupFormFields(
      { is_signup: true, allow_signup: false, fields: {} },
      [],
    );
    expect(err).toBeNull();
  });

  it("validateSignupFormFields ignores constant/global for form field checks", () => {
    const err = validateSignupFormFields(
      {
        is_signup: true,
        fields: {
          email: { visible: true, required: true },
          plan: {
            visible: false,
            required: true,
            default: DEFAULT_FREE_SIGNUP_PLAN_EXPR,
          },
        },
      },
      [
        { key: "email", from: "form.email", required: true },
        { key: "plan", from: "form.plan", required: true },
        { key: "source", constant: "website" },
        { key: "sku", global: "global.default_free_signup_plan" },
      ],
    );
    expect(err).toBeNull();
  });

  it("isSignupFieldMapReady", () => {
    expect(isSignupFieldMapReady([])).toBe(false);
    expect(isSignupFieldMapReady(DEFAULT_AUTH_SIGNUP_FIELD_MAP)).toBe(true);
  });
});
