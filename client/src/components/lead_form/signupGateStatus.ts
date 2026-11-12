/**
 * Signup / login gate status for an `is_signup` LeadForm (edit-mode Signup Gated badge).
 * Mirrors the runtime `signupActive` gate and the save-time form validation.
 */
import {
  isSignupFieldMapReady,
  validateSignupFormFields,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";

export type SignupGateErrorCode =
  /** /api/settings/auth failed or returned nothing. */
  | "settings_unavailable"
  /** Consumer Auth signup is not configured for the site. */
  | "not_configured"
  /** Consumer Auth field map has no entries. */
  | "field_map_empty"
  /** The form does not provide a field the field map needs. */
  | "form_fields";

export type SignupGateStatus =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "active" }
  | { kind: "login_only" }
  | {
      kind: "error";
      errors: Array<{ code: SignupGateErrorCode; detail?: string }>;
      /** Signup still runs at submit (only the form setup check failed). */
      runtimeActive: boolean;
    };

export interface SignupGateAuthSettings {
  signup_configured?: boolean;
  signup?: { field_map?: AuthSignupFieldMapEntry[] };
}

export function resolveSignupGateStatus(input: {
  isSignupRequested: boolean;
  allowSignup: boolean;
  authSettings: SignupGateAuthSettings | undefined | null;
  authSettingsLoading: boolean;
  /** Form section data (is_signup, allow_signup, fields, consent). */
  formData: Record<string, unknown>;
}): SignupGateStatus {
  const { isSignupRequested, allowSignup, authSettings, authSettingsLoading, formData } = input;
  if (!isSignupRequested) return { kind: "off" };
  if (!allowSignup) return { kind: "login_only" };
  if (authSettingsLoading) return { kind: "loading" };
  if (!authSettings) {
    return { kind: "error", errors: [{ code: "settings_unavailable" }], runtimeActive: false };
  }

  const fieldMap = authSettings.signup?.field_map;
  const errors: Array<{ code: SignupGateErrorCode; detail?: string }> = [];
  if (authSettings.signup_configured !== true) errors.push({ code: "not_configured" });
  if (!isSignupFieldMapReady(fieldMap)) errors.push({ code: "field_map_empty" });
  if (errors.length > 0) return { kind: "error", errors, runtimeActive: false };

  const formError = validateSignupFormFields(formData, fieldMap);
  if (formError) {
    return {
      kind: "error",
      errors: [{ code: "form_fields", detail: formError }],
      runtimeActive: true,
    };
  }
  return { kind: "active" };
}
