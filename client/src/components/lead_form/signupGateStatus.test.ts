import { describe, expect, it } from "vitest";
import { isSignupFieldMapReady, type AuthSignupFieldMapEntry } from "@shared/authSignupFieldMap";
import { resolveSignupGateStatus } from "./signupGateStatus";

const fieldMap: AuthSignupFieldMapEntry[] = [
  { key: "email", from: "form.email", required: true },
  { key: "country", from: "session.geo.country" },
];

const signupForm = { is_signup: true, fields: { email: { visible: true, required: true } } };

const base = {
  isSignupRequested: true,
  allowSignup: true,
  authSettings: { signup_configured: true, signup: { field_map: fieldMap } },
  authSettingsLoading: false,
  formData: signupForm,
};

/** Same expression as LeadFormDefault `signupActive`. */
function runtimeSignupActive(input: typeof base): boolean {
  return (
    input.isSignupRequested &&
    input.allowSignup &&
    input.authSettings?.signup_configured === true &&
    isSignupFieldMapReady(input.authSettings?.signup?.field_map)
  );
}

describe("resolveSignupGateStatus", () => {
  it("is off for non-signup forms", () => {
    expect(resolveSignupGateStatus({ ...base, isSignupRequested: false })).toEqual({ kind: "off" });
  });

  it("is login_only when allow_signup is false (not an error)", () => {
    expect(resolveSignupGateStatus({ ...base, allowSignup: false })).toEqual({ kind: "login_only" });
  });

  it("stays neutral while auth settings load", () => {
    expect(
      resolveSignupGateStatus({ ...base, authSettings: undefined as never, authSettingsLoading: true }),
    ).toEqual({ kind: "loading" });
  });

  it("is active when configured, mapped and the form satisfies the map", () => {
    const status = resolveSignupGateStatus(base);
    expect(status).toEqual({ kind: "active" });
    expect(runtimeSignupActive(base)).toBe(true);
  });

  it("errors when settings could not be loaded", () => {
    expect(resolveSignupGateStatus({ ...base, authSettings: null as never })).toMatchObject({
      kind: "error",
      errors: [{ code: "settings_unavailable" }],
      runtimeActive: false,
    });
  });

  it("errors when signup is not configured and the map is empty", () => {
    const input = { ...base, authSettings: { signup_configured: false, signup: { field_map: [] } } };
    const status = resolveSignupGateStatus(input);
    expect(status).toEqual({
      kind: "error",
      errors: [{ code: "not_configured" }, { code: "field_map_empty" }],
      runtimeActive: false,
    });
    expect(runtimeSignupActive(input)).toBe(false);
  });

  it("errors on form setup but signup still runs at submit", () => {
    const input = {
      ...base,
      authSettings: {
        signup_configured: true,
        signup: { field_map: [{ key: "dob", from: "form.date_of_birth", required: true }] },
      },
    };
    const status = resolveSignupGateStatus(input);
    expect(status.kind).toBe("error");
    if (status.kind !== "error") return;
    expect(status.errors[0]?.code).toBe("form_fields");
    expect(status.errors[0]?.detail).toContain("date_of_birth");
    expect(status.runtimeActive).toBe(true);
    expect(runtimeSignupActive(input)).toBe(true);
  });
});
