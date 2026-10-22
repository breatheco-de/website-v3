/**
 * Consent message channels stored as reserved.consent_* variables.
 * Locale copy uses the same shape as other variables: `default` + `conditions`
 * with `query.locale`.
 */

export const BUILTIN_CONSENT_KEYS = [
  "consent_general",
  "consent_marketing",
  "consent_whatsapp",
  "consent_sms",
  "consent_email",
] as const;

export type BuiltinConsentKey = (typeof BUILTIN_CONSENT_KEYS)[number];

const BUILTIN_LABELS: Record<BuiltinConsentKey, string> = {
  consent_general: "General",
  consent_marketing: "Marketing",
  consent_whatsapp: "WhatsApp",
  consent_sms: "SMS",
  consent_email: "Email",
};

export const CONSENT_KEY_RE = /^consent_[a-z][a-z0-9_]*$/;

export interface LocaleCondition {
  query: Record<string, string>;
  value: string;
}

export interface ConsentVariableShape {
  default?: string;
  conditions?: LocaleCondition[];
}

export function isBuiltinConsentKey(key: string): key is BuiltinConsentKey {
  return (BUILTIN_CONSENT_KEYS as readonly string[]).includes(key);
}

/** Hardcoded form copy when reserved.consent_* is empty. */
export const BUILTIN_CONSENT_FALLBACKS: Record<BuiltinConsentKey, Record<string, string>> = {
  consent_general: {
    en: "I agree to be contacted about this request. We'll never share your contact information, and you can easily opt out at any moment.",
    es: "Acepto que me contacten sobre esta solicitud. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento.",
  },
  consent_marketing: {
    en: "I agree to receive information through email, WhatsApp and/or other channels about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.",
    es: "Acepto recibir información a través de correo electrónico, WhatsApp y/u otros canales sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento.",
  },
  consent_sms: {
    en: "I agree to receive SMS/text messages about workshops, events, courses, and other marketing materials. Message and data rates may apply. Reply STOP to unsubscribe, HELP for help. You may receive up to 4–6 text messages per month. We will never share your contact information, and you can easily opt out at any moment.",
    es: "Acepto recibir mensajes SMS/texto sobre talleres, eventos, cursos y otros materiales de marketing. Pueden aplicarse tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda. Puedes recibir hasta 4-6 mensajes de texto por mes. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento.",
  },
  consent_email: {
    en: "I agree to receive information via email about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.",
    es: "Acepto recibir información por correo electrónico sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento.",
  },
  consent_whatsapp: {
    en: "I agree to receive information via WhatsApp about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.",
    es: "Acepto recibir información a través de WhatsApp sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento.",
  },
};

export function getBuiltinConsentFallback(key: string, locale: string): string {
  if (!isBuiltinConsentKey(key)) return "";
  const byLocale = BUILTIN_CONSENT_FALLBACKS[key];
  return byLocale[locale] || byLocale.en || "";
}

/** Strip tags for list previews. */
export function stripConsentHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlankConsentHtml(html: string | undefined | null): boolean {
  if (!html) return true;
  return stripConsentHtml(html).length === 0;
}

export function consentLabelFromKey(key: string): string {
  if (isBuiltinConsentKey(key)) return BUILTIN_LABELS[key];
  const slug = key.replace(/^consent_/, "").replace(/_/g, " ").trim();
  if (!slug) return key;
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "WhatsApp" / "whatsapp" / "consent_whatsapp" → consent_whatsapp */
export function slugifyConsentKey(name: string): string {
  let slug = name.trim().toLowerCase();
  if (slug.startsWith("consent_")) slug = slug.slice("consent_".length);
  slug = slug.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug ? `consent_${slug}` : "";
}

export function isValidConsentKey(key: string): boolean {
  return CONSENT_KEY_RE.test(key);
}

/** YAML `consent.*` toggles that ConsentCard always shows. */
export const CONSENT_CARD_BUILTIN_YAML = ["marketing", "sms", "whatsapp"] as const;

const NON_CHANNEL_CONSENT_KEYS = new Set([
  "sms_usa_only",
  "marketing_text",
  "sms_text",
  "show_terms",
  "terms_url",
  "privacy_url",
  // ConsentCard UI keys — never treat these as YAML channels
  "smsUsaOnly",
  "showTerms",
  "termsUrl",
  "privacyUrl",
]);

/** Dedicated form checkboxes — not listed as ConsentCard "extras". */
const FORM_EXPLICIT_YAML = new Set(["marketing", "sms", "whatsapp", "email"]);

/** Builtin YAML fields ConsentCard shows from Settings (not custom extras). */
const CARD_BUILTIN_YAML = new Set(["marketing", "sms", "whatsapp", "email", "general"]);

const CARD_CHANNEL_ORDER = ["marketing", "sms", "whatsapp", "email", "general"] as const;

const CONSENT_CARD_UI_META = new Set([
  "smsUsaOnly",
  "showTerms",
  "termsUrl",
  "privacyUrl",
]);

/** First-class channel toggles + UI meta. Extra YAML fields live as top-level keys (`test`, not `extras.test`). */
export type ConsentCardValues = {
  marketing: boolean;
  sms: boolean;
  whatsapp: boolean;
  smsUsaOnly: boolean;
  showTerms: boolean;
  termsUrl: string;
  privacyUrl: string;
  [yamlField: string]: boolean | string | undefined;
};

export function eventConsentToCardValues(
  consent: Record<string, unknown> | null | undefined,
): ConsentCardValues {
  const extras = extraConsentYamlFieldsFromObject(consent);
  return {
    marketing: !!consent?.marketing,
    sms: !!consent?.sms,
    whatsapp: !!consent?.whatsapp,
    ...(consent?.email ? { email: true } : {}),
    smsUsaOnly: !!consent?.sms_usa_only,
    showTerms: !!consent?.show_terms,
    termsUrl: typeof consent?.terms_url === "string" ? consent.terms_url : "",
    privacyUrl: typeof consent?.privacy_url === "string" ? consent.privacy_url : "",
    ...Object.fromEntries(extras.map((f) => [f, !!consent?.[f]])),
  };
}

export function cardValuesToEventConsent(
  values: ConsentCardValues,
  preserve?: { marketing_text?: string; sms_text?: string },
): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {
    marketing: !!values.marketing,
    sms: !!values.sms,
    whatsapp: !!values.whatsapp,
    sms_usa_only: !!values.smsUsaOnly,
    show_terms: !!values.showTerms,
  };
  const termsUrl = typeof values.termsUrl === "string" ? values.termsUrl.trim() : "";
  const privacyUrl = typeof values.privacyUrl === "string" ? values.privacyUrl.trim() : "";
  if (termsUrl) out.terms_url = termsUrl;
  if (privacyUrl) out.privacy_url = privacyUrl;
  if (preserve?.marketing_text) out.marketing_text = preserve.marketing_text;
  if (preserve?.sms_text) out.sms_text = preserve.sms_text;
  if (values.email) out.email = true;
  for (const [k, v] of Object.entries(values)) {
    if (k === "marketing" || k === "sms" || k === "whatsapp" || k === "email") continue;
    if (CONSENT_CARD_UI_META.has(k)) continue;
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** reserved.consent_marketing → marketing; consent_general → general. */
export function yamlFieldFromConsentKey(key: string): string | null {
  if (!isValidConsentKey(key)) return null;
  return key.slice("consent_".length);
}

export function consentKeyFromYamlField(field: string): string {
  if (field === "marketing") return "consent_marketing";
  return `consent_${field}`;
}

/** Extra YAML channel fields from Settings keys (not Marketing/SMS/WhatsApp/Email/General). */
export function extraConsentYamlFields(settingsKeys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of settingsKeys) {
    const field = yamlFieldFromConsentKey(key);
    if (!field || CARD_BUILTIN_YAML.has(field) || NON_CHANNEL_CONSENT_KEYS.has(field)) continue;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push(field);
  }
  return out;
}

/** Extra boolean keys already stored on a form/event `consent` object. */
export function extraConsentYamlFieldsFromObject(
  consent: Record<string, unknown> | Partial<ConsentCardValues> | null | undefined,
): string[] {
  if (!consent) return [];
  const record = consent as Record<string, unknown>;
  return Object.keys(record).filter(
    (k) =>
      !FORM_EXPLICIT_YAML.has(k) &&
      !NON_CHANNEL_CONSENT_KEYS.has(k) &&
      typeof record[k] === "boolean",
  );
}

/** Union of extra YAML fields from Settings keys and stored consent objects. */
export function collectExtraConsentYamlFields(
  settingsKeys: string[] | undefined,
  ...objects: Array<Record<string, unknown> | Partial<ConsentCardValues> | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (field: string) => {
    if (seen.has(field)) return;
    seen.add(field);
    out.push(field);
  };
  for (const field of extraConsentYamlFields(settingsKeys ?? [])) add(field);
  for (const obj of objects) {
    for (const field of extraConsentYamlFieldsFromObject(obj)) add(field);
  }
  return out;
}

export function consentObjectHasVisibleChannel(
  consent: Record<string, unknown> | null | undefined,
): boolean {
  if (!consent) return false;
  if (consent.email || consent.sms || consent.whatsapp || consent.marketing) return true;
  return extraConsentYamlFieldsFromObject(consent).some((field) => consent[field] === true);
}

/** `settings.yml` → `consent.fallback`. Empty / invalid → no fallback checkbox. */
export function normalizeConsentFallbackKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !isValidConsentKey(trimmed)) return null;
  return trimmed;
}

/**
 * Which consent checkboxes visitors must tick on one form.
 *
 * - General and Marketing are mandatory whenever shown (both when both are shown).
 * - A custom consent is mandatory only when neither is shown (the first one, in
 *   Settings order when `messages` is given).
 * - SMS, Email and WhatsApp are never mandatory.
 * - The site Default (`consent.fallback`) appears only when none of the above is
 *   shown, and is then the mandatory one.
 *
 * `required` holds YAML fields (`general`, `marketing`, custom field, or the
 * Default's field). Pass `messages` (Settings consent copy) to drop custom
 * consents with blank text in `locale`; without it, custom consents count as shown.
 */
export type ConsentRequirement = {
  required: string[];
  showFallback: boolean;
  fallbackKey: string | null;
  twoRequired: boolean;
};

export function resolveConsentRequirement(
  consent: Record<string, unknown> | null | undefined,
  fallbackKey: string | null | undefined,
  opts?: {
    locale?: string;
    messages?: Record<string, Record<string, string> | string | undefined>;
  },
): ConsentRequirement {
  const c = consent ?? {};
  const locale = opts?.locale ?? "en";
  const messages = opts?.messages;
  const hasCopy = (settingsKey: string): boolean => {
    if (!messages) return true;
    return !isBlankConsentHtml(resolveConsentCopy(settingsKey, messages[settingsKey], locale));
  };

  const shownExtras = extraConsentYamlFieldsFromObject(c).filter(
    (field) => c[field] === true && hasCopy(consentKeyFromYamlField(field)),
  );
  const general = shownExtras.includes("general");
  const marketing = !!c.marketing;

  const required: string[] = [];
  if (general) required.push("general");
  if (marketing) required.push("marketing");
  if (required.length === 0) {
    const customs = shownExtras.filter((f) => f !== "general");
    if (messages && customs.length > 1) {
      const order = Object.keys(messages);
      customs.sort((a, b) => {
        const ia = order.indexOf(consentKeyFromYamlField(a));
        const ib = order.indexOf(consentKeyFromYamlField(b));
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      });
    }
    if (customs.length > 0) required.push(customs[0]!);
  }

  const normalizedFallback = normalizeConsentFallbackKey(fallbackKey);
  let showFallback = false;
  if (required.length === 0 && normalizedFallback && hasCopy(normalizedFallback)) {
    showFallback = true;
    required.push(yamlFieldFromConsentKey(normalizedFallback)!);
  }

  return {
    required,
    showFallback,
    fallbackKey: showFallback ? normalizedFallback : null,
    twoRequired: general && marketing,
  };
}

/** Form field name for a required YAML field (Marketing is stored as `consent_email`). */
export function consentFormFieldName(yamlField: string): string {
  return yamlField === "marketing" ? "consent_email" : `consent_${yamlField}`;
}

/** True when the form should show the Settings Default checkbox (no mandatory checkbox otherwise). */
export function shouldShowFallbackConsent(
  consent: Record<string, unknown> | null | undefined,
  fallbackKey: string | null | undefined,
  opts?: Parameters<typeof resolveConsentRequirement>[2],
): boolean {
  return resolveConsentRequirement(consent, fallbackKey, opts).showFallback;
}

export type ConsentSettingsApiResponse = {
  fallback: string | null;
  messages: Record<string, Record<string, string>>;
};

/** GET /api/settings/consent — wrapped `{ fallback, messages }` or legacy messages-only. */
export function parseConsentSettingsResponse(data: unknown): ConsentSettingsApiResponse {
  if (!data || typeof data !== "object") {
    return { fallback: null, messages: {} };
  }
  const rec = data as Record<string, unknown>;
  const wrapped = rec.messages;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return {
      fallback: normalizeConsentFallbackKey(rec.fallback),
      messages: wrapped as Record<string, Record<string, string>>,
    };
  }
  const messages: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "fallback" || k === "success" || k === "error") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      messages[k] = v as Record<string, string>;
    }
  }
  return {
    fallback: normalizeConsentFallbackKey(rec.fallback),
    messages,
  };
}

export type ConsentChannelDef = {
  yamlField: string;
  settingsKey: string;
  label: string;
};

/**
 * Channel switches for ConsentCard: every Settings consent, including Default
 * (`consent.fallback`). Builtins always appear; custom keys come from `settingsKeys`.
 * `fallbackKey` is unused here — the form still shows that checkbox when no
 * mandatory checkbox is shown (`resolveConsentRequirement`).
 */
export function consentCardChannels(
  settingsKeys: string[],
  _fallbackKey?: string | null,
): ConsentChannelDef[] {
  const seen = new Set<string>();
  const defs: ConsentChannelDef[] = [];
  const add = (settingsKey: string) => {
    const yamlField = yamlFieldFromConsentKey(settingsKey);
    if (!yamlField || NON_CHANNEL_CONSENT_KEYS.has(yamlField) || seen.has(yamlField)) return;
    seen.add(yamlField);
    defs.push({
      yamlField,
      settingsKey,
      label: consentLabelFromKey(settingsKey),
    });
  };
  for (const key of BUILTIN_CONSENT_KEYS) add(key);
  for (const key of settingsKeys) add(key);
  defs.sort((a, b) => {
    const ia = (CARD_CHANNEL_ORDER as readonly string[]).indexOf(a.yamlField);
    const ib = (CARD_CHANNEL_ORDER as readonly string[]).indexOf(b.yamlField);
    if (ia === -1 && ib === -1) return a.label.localeCompare(b.label);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return defs;
}

export function localesToConsentDefinition(
  locales: Record<string, string>,
  defaultLocale: string,
): ConsentVariableShape {
  const defaultRaw = locales[defaultLocale] ?? "";
  const defaultVal = isBlankConsentHtml(defaultRaw) ? "" : defaultRaw.trim();
  const conditions: LocaleCondition[] = [];
  for (const [loc, raw] of Object.entries(locales)) {
    if (loc === defaultLocale) continue;
    if (isBlankConsentHtml(raw)) continue;
    conditions.push({ query: { locale: loc }, value: raw.trim() });
  }
  const def: ConsentVariableShape = { default: defaultVal };
  if (conditions.length > 0) def.conditions = conditions;
  return def;
}

export function consentDefinitionToLocales(
  def: ConsentVariableShape | undefined,
  defaultLocale: string,
): Record<string, string> {
  const locales: Record<string, string> = {
    [defaultLocale]: def?.default ?? "",
  };
  for (const condition of def?.conditions ?? []) {
    const loc = condition.query.locale;
    if (!loc) continue;
    if (Object.keys(condition.query).length !== 1) continue;
    if (loc === defaultLocale) continue;
    locales[loc] = condition.value ?? "";
  }
  return locales;
}

export function resolveConsentLocaleText(
  locales: Record<string, string> | string | undefined,
  locale: string,
  fallback: string,
): string {
  if (!locales) return fallback;
  if (typeof locales === "string") return isBlankConsentHtml(locales) ? fallback : locales.trim();
  const localized = locales[locale];
  if (localized && !isBlankConsentHtml(localized)) return localized.trim();
  return fallback;
}

export function resolveConsentCopy(
  key: string,
  locales: Record<string, string> | string | undefined,
  locale: string,
): string {
  return resolveConsentLocaleText(locales, locale, getBuiltinConsentFallback(key, locale));
}
