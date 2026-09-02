import { describe, expect, it } from "vitest";
import {
  buildSignupPayloadFromFieldMap,
  DEFAULT_AUTH_SIGNUP_FIELD_MAP,
  DEFAULT_FREE_SIGNUP_PLAN_EXPR,
  isSignupFieldMapReady,
  normalizeAuthSignupFieldMapInput,
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

  it("builds payload from map and always includes conversion_info", () => {
    const body = buildSignupPayloadFromFieldMap(
      [
        { key: "email", from: "form.email" },
        { key: "course", from: "form.program" },
        { key: "country", from: "session.geo.country" },
      ],
      {
        form: { email: "a@b.com", program: "ai-eng" },
        session: { geo: { country: "" } },
      },
      { landing_url: "/x" },
    );
    expect(body).toEqual({
      email: "a@b.com",
      course: "ai-eng",
      country: "",
      conversion_info: { landing_url: "/x" },
    });
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

  it("isSignupFieldMapReady", () => {
    expect(isSignupFieldMapReady([])).toBe(false);
    expect(isSignupFieldMapReady(DEFAULT_AUTH_SIGNUP_FIELD_MAP)).toBe(true);
  });
});
