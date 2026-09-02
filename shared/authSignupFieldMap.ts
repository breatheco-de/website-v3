/**
 * Consumer auth signup field_map — maps payload keys to form.* or session.* sources.
 * Used by Auth settings, LeadFormDefault signup submit, and is_signup validation.
 */

export type AuthSignupFieldMapEntry = {
  /** Payload property name sent to the signup endpoint */
  key: string;
  /** Source path: "form.email" | "session.geo.country" | … */
  from: string;
  /** Only valid when from starts with "form." */
  required?: boolean;
};

/** Standard lead-form field names offered in the Auth source picker. */
export const AUTH_SIGNUP_FORM_FIELD_PRESETS = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "program",
  "plan",
  "region",
  "location",
  "coupon",
  "referral_key",
  "client_comments",
  "current_download",
  "consent_email",
  "consent_sms",
  "consent_whatsapp",
  "consent_general",
] as const;

/** Common session paths offered in the Auth source picker. */
export const AUTH_SIGNUP_SESSION_FIELD_PRESETS = [
  "language",
  "browserLang",
  "landing_page",
  "conversion_page",
  "userId",
  "geo.city",
  "geo.country",
  "geo.country_code",
  "geo.region",
  "geo.latitude",
  "geo.longitude",
  "location.slug",
  "location.city",
  "location.country",
  "location.region",
  "utm.utm_source",
  "utm.utm_medium",
  "utm.utm_campaign",
  "utm.utm_content",
  "utm.utm_term",
  "utm.utm_url",
  "utm.utm_placement",
  "utm.utm_plan",
  "utm.coupon",
  "utm.referral_key",
] as const;

/** Seed matching historical liveSignup intent (explicit course ← form.program). */
export const DEFAULT_AUTH_SIGNUP_FIELD_MAP: AuthSignupFieldMapEntry[] = [
  { key: "first_name", from: "form.first_name" },
  { key: "last_name", from: "form.last_name" },
  { key: "email", from: "form.email", required: true },
  { key: "phone", from: "form.phone" },
  { key: "course", from: "form.program" },
  { key: "plan", from: "form.plan", required: true },
  { key: "country", from: "session.geo.country" },
  { key: "city", from: "session.geo.city" },
  { key: "language", from: "session.language" },
  { key: "has_marketing_consent", from: "form.consent_email" },
];

export const DEFAULT_FREE_SIGNUP_PLAN_FALLBACK = "4geeks-basic-subscription";
export const DEFAULT_FREE_SIGNUP_PLAN_EXPR =
  `{{ global.default_free_signup_plan | ${DEFAULT_FREE_SIGNUP_PLAN_FALLBACK} }}`;

const CONSENT_FORM_FIELDS = new Set([
  "consent_email",
  "consent_sms",
  "consent_whatsapp",
  "consent_general",
]);

const BUILTIN_FORM_FIELDS = new Set<string>(AUTH_SIGNUP_FORM_FIELD_PRESETS);

export function isFormSource(from: string): boolean {
  return from.trim().startsWith("form.");
}

export function isSessionSource(from: string): boolean {
  return from.trim().startsWith("session.");
}

export function formFieldNameFromSource(from: string): string | null {
  const t = from.trim();
  if (!t.startsWith("form.")) return null;
  const name = t.slice("form.".length).trim();
  return name || null;
}

export function sessionPathFromSource(from: string): string | null {
  const t = from.trim();
  if (!t.startsWith("session.")) return null;
  const path = t.slice("session.".length).trim();
  return path || null;
}

export function parseAuthSignupFieldMap(raw: unknown): AuthSignupFieldMapEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AuthSignupFieldMapEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!key || !from) continue;
    const entry: AuthSignupFieldMapEntry = { key, from };
    if (row.required === true && isFormSource(from)) {
      entry.required = true;
    }
    out.push(entry);
  }
  return out;
}

/** Normalize + validate entries for Auth save. Throws on invalid rows. */
export function normalizeAuthSignupFieldMapInput(
  raw: unknown,
  fieldLabel = "auth.signup.field_map",
): AuthSignupFieldMapEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${fieldLabel} must be an array`);
  }
  const out: AuthSignupFieldMapEntry[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldLabel}[${i}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!key) throw new Error(`${fieldLabel}[${i}].key is required`);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(
        `${fieldLabel}[${i}].key "${key}" must be a simple identifier (letters, digits, underscore)`,
      );
    }
    if (!from) throw new Error(`${fieldLabel}[${i}].from is required`);
    if (!isFormSource(from) && !isSessionSource(from)) {
      throw new Error(
        `${fieldLabel}[${i}].from "${from}" must start with "form." or "session."`,
      );
    }
    if (isFormSource(from) && !formFieldNameFromSource(from)) {
      throw new Error(`${fieldLabel}[${i}].from must include a form field name`);
    }
    if (isSessionSource(from) && !sessionPathFromSource(from)) {
      throw new Error(`${fieldLabel}[${i}].from must include a session path`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`${fieldLabel}: duplicate key "${key}"`);
    }
    seenKeys.add(key);
    const required = row.required === true;
    if (required && !isFormSource(from)) {
      throw new Error(
        `${fieldLabel}[${i}]: required is only allowed when from starts with "form."`,
      );
    }
    out.push(required ? { key, from, required: true } : { key, from });
  }
  return out;
}

export function isSignupFieldMapReady(fieldMap: AuthSignupFieldMapEntry[] | undefined | null): boolean {
  return Array.isArray(fieldMap) && fieldMap.length > 0;
}

function getByPath(root: unknown, dotted: string): unknown {
  if (!dotted) return undefined;
  const parts = dotted.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export type SignupFieldMapResolveContext = {
  form: Record<string, unknown>;
  session: Record<string, unknown>;
};

/** Resolve one source; missing values become "". */
export function resolveSignupSourceValue(
  from: string,
  ctx: SignupFieldMapResolveContext,
): string | boolean | number {
  if (isFormSource(from)) {
    const name = formFieldNameFromSource(from)!;
    const v = ctx.form[name];
    if (typeof v === "boolean" || typeof v === "number") return v;
    if (v == null) return "";
    return String(v);
  }
  if (isSessionSource(from)) {
    const path = sessionPathFromSource(from)!;
    const v = getByPath(ctx.session, path);
    if (typeof v === "boolean" || typeof v === "number") return v;
    if (v == null) return "";
    return String(v);
  }
  return "";
}

export function buildSignupPayloadFromFieldMap(
  fieldMap: AuthSignupFieldMapEntry[],
  ctx: SignupFieldMapResolveContext,
  conversionInfo: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const entry of fieldMap) {
    body[entry.key] = resolveSignupSourceValue(entry.from, ctx);
  }
  body.conversion_info = conversionInfo;
  return body;
}

/** Sample conversion_info for Auth preview (always appended at runtime). */
export const SIGNUP_CONVERSION_INFO_PREVIEW = {
  user_agent: "Mozilla/5.0 …",
  landing_url: "/login",
  conversion_url: "/interactive-exercise/example",
  internal_cta_placement: "example-cta",
};

/** Auto-generated example JSON with {{ form.* }} / {{ session.* }} variables. */
export function buildSignupPayloadPreviewJson(
  fieldMap: AuthSignupFieldMapEntry[],
): string {
  const obj: Record<string, unknown> = {};
  for (const entry of fieldMap) {
    obj[entry.key] = `{{ ${entry.from} }}`;
  }
  obj.conversion_info = SIGNUP_CONVERSION_INFO_PREVIEW;
  return JSON.stringify(obj, null, 2);
}

/** Placeholder values for Auth Test when building from the map. */
export function buildSignupTestPayloadFromFieldMap(
  fieldMap: AuthSignupFieldMapEntry[],
): Record<string, unknown> {
  const formSamples: Record<string, unknown> = {
    email: `auth-test-${Date.now()}@example.com`,
    first_name: "Test",
    last_name: "User",
    phone: "",
    program: "",
    plan: DEFAULT_FREE_SIGNUP_PLAN_FALLBACK,
    consent_email: false,
    consent_sms: false,
    consent_whatsapp: false,
    consent_general: false,
  };
  const sessionSamples: Record<string, unknown> = {
    language: "en",
    browserLang: "en",
    landing_page: "/private/security/auth",
    geo: { country: "", city: "" },
    location: {},
    utm: {},
  };
  return buildSignupPayloadFromFieldMap(
    fieldMap,
    { form: formSamples, session: sessionSamples },
    {
      user_agent: "website-v3-auth-test",
      landing_url: "/private/security/auth",
      conversion_url: "/private/security/auth",
    },
  );
}

type FormFieldCfg = {
  visible?: boolean;
  required?: boolean;
  default?: unknown;
};

function readFields(form: Record<string, unknown>): Record<string, FormFieldCfg> {
  const fields = form.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const out: Record<string, FormFieldCfg> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = v as FormFieldCfg;
    }
  }
  return out;
}

/** Defaults aligned with LeadFormDefault getFieldConfig when YAML omits the field. */
function builtinFieldDefaults(name: string): FormFieldCfg | null {
  if (name === "email") return { visible: true, required: true };
  if (
    name === "first_name" ||
    name === "last_name" ||
    name === "phone" ||
    name === "program" ||
    name === "plan" ||
    name === "region" ||
    name === "location" ||
    name === "coupon" ||
    name === "referral_key" ||
    name === "client_comments" ||
    name === "current_download"
  ) {
    return { visible: false, required: false };
  }
  return null;
}

function consentSatisfied(
  form: Record<string, unknown>,
  fieldName: string,
  needRequired: boolean,
): { ok: boolean; message?: string } {
  const consent = form.consent;
  const c =
    consent && typeof consent === "object" && !Array.isArray(consent)
      ? (consent as Record<string, unknown>)
      : {};

  if (fieldName === "consent_email") {
    const on = c.email === true || c.marketing === true;
    if (!on && needRequired) {
      return {
        ok: false,
        message:
          "form.consent_email is required by auth.signup.field_map — enable consent.email or consent.marketing on this form (or add fields.consent_email with required: true)",
      };
    }
    // Presence: marketing/email consent toggle OR explicit fields entry is enough when not required
    if (!on && !needRequired) {
      // Optional mapping — still "present" as a form value (checkbox may be off)
      return { ok: true };
    }
    return { ok: true };
  }
  if (fieldName === "consent_sms") {
    if (needRequired && c.sms !== true) {
      return {
        ok: false,
        message:
          "form.consent_sms is required by auth.signup.field_map — enable consent.sms on this form",
      };
    }
    return { ok: true };
  }
  if (fieldName === "consent_whatsapp") {
    if (needRequired && c.whatsapp !== true) {
      return {
        ok: false,
        message:
          "form.consent_whatsapp is required by auth.signup.field_map — enable consent.whatsapp on this form",
      };
    }
    return { ok: true };
  }
  if (fieldName === "consent_general") {
    // Fallback checkbox always available when no other consent — treat as present
    return { ok: true };
  }
  return { ok: true };
}

/**
 * When form.is_signup is true, ensure site field_map is non-empty and each form.*
 * source is satisfied on this form. Returns error message or null.
 */
export function validateSignupFormFields(
  form: Record<string, unknown> | null | undefined,
  fieldMap: AuthSignupFieldMapEntry[] | undefined | null,
  formLabel = "form",
): string | null {
  if (!form || typeof form !== "object") return null;
  if (form.is_signup !== true) return null;

  if (!isSignupFieldMapReady(fieldMap)) {
    return (
      `${formLabel}.is_signup is true but auth.signup.field_map is empty — ` +
      `add signup field mappings under Consumer Auth (/private/security/auth) before enabling Require Signup. ` +
      `Hidden plan default: fields.plan.default: "${DEFAULT_FREE_SIGNUP_PLAN_EXPR}"`
    );
  }

  const fields = readFields(form);
  const map = fieldMap!;

  for (const entry of map) {
    if (!isFormSource(entry.from)) continue;
    const name = formFieldNameFromSource(entry.from)!;
    const needRequired = entry.required === true;

    if (CONSENT_FORM_FIELDS.has(name)) {
      const explicit = fields[name];
      if (explicit) {
        if (needRequired && explicit.required !== true) {
          return (
            `${formLabel}.fields.${name}.required must be true ` +
            `(auth.signup.field_map key "${entry.key}" is required)`
          );
        }
        continue;
      }
      const c = consentSatisfied(form, name, needRequired);
      if (!c.ok) return c.message ?? null;
      continue;
    }

    const explicit = fields[name];
    const builtin = BUILTIN_FORM_FIELDS.has(name) ? builtinFieldDefaults(name) : null;

    if (!explicit && !builtin) {
      return (
        `${formLabel}.fields.${name} is required when is_signup is true ` +
        `(auth.signup.field_map maps payload "${entry.key}" from form.${name}). ` +
        `Add the field on this form, or remove that mapping in Consumer Auth.`
      );
    }

    const effectiveRequired =
      explicit?.required === true || (!explicit && builtin?.required === true);

    if (needRequired && !effectiveRequired) {
      return (
        `${formLabel}.fields.${name}.required must be true ` +
        `(auth.signup.field_map key "${entry.key}" is required). ` +
        (name === "plan"
          ? `Example: visible: false, required: true, default: "${DEFAULT_FREE_SIGNUP_PLAN_EXPR}"`
          : "")
      );
    }
  }

  return null;
}
