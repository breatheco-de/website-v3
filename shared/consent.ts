/**
 * Tracking consent (cookie banner) rules shared by client, server, and tests.
 *
 * - "ask" countries must press Accept or Reject before marketing/analytics data is stored.
 * - Everywhere else gets a short notice; "OK" or the first scroll counts as consent.
 * - Choices are remembered in the server-set `4g_consent` cookie.
 */

export const CONSENT_COOKIE_NAME = "4g_consent";
export const AD_CONTEXT_COOKIE_NAME = "4g_ads";
export const AD_CONTEXT_MAX_AGE_DAYS = 30;

/** Below this, re-asking after a reject in ask regions may be treated as pressure by EU regulators. */
export const REJECT_RISK_THRESHOLD_DAYS = 180;

export type ConsentMode = "ask" | "notice";
export type ConsentDecision = "granted_explicit" | "granted_implied" | "denied";

export const CONSENT_DECISIONS: readonly ConsentDecision[] = [
  "granted_explicit",
  "granted_implied",
  "denied",
];

/** EU 27 + EEA (IS, LI, NO) + UK + Switzerland. */
export const DEFAULT_ASK_COUNTRIES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB",
  "CH",
];

export interface ConsentWindowSettings {
  /** "default" uses DEFAULT_ASK_COUNTRIES; otherwise an explicit ISO-3166 alpha-2 list. */
  ask_countries: "default" | string[];
  /** Mode when the visitor's country cannot be determined. */
  unknown_country_mode: ConsentMode;
  /** How long an accept is remembered. */
  accept_days: number;
  /** How long a reject is remembered before asking again. */
  reject_days: number;
}

export const DEFAULT_CONSENT_WINDOW: ConsentWindowSettings = {
  ask_countries: "default",
  unknown_country_mode: "notice",
  accept_days: 365,
  reject_days: 5,
};

function clampDays(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3650, Math.max(1, Math.round(n)));
}

export function normalizeCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function parseConsentWindowSettings(raw: unknown): ConsentWindowSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_CONSENT_WINDOW };
  const o = raw as Record<string, unknown>;
  let ask_countries: ConsentWindowSettings["ask_countries"] = "default";
  if (Array.isArray(o.ask_countries)) {
    const codes = Array.from(
      new Set(o.ask_countries.map(normalizeCountryCode).filter((c): c is string => !!c)),
    ).sort();
    ask_countries = codes;
  }
  return {
    ask_countries,
    unknown_country_mode: o.unknown_country_mode === "ask" ? "ask" : "notice",
    accept_days: clampDays(o.accept_days, DEFAULT_CONSENT_WINDOW.accept_days),
    reject_days: clampDays(o.reject_days, DEFAULT_CONSENT_WINDOW.reject_days),
  };
}

export function effectiveAskCountries(settings: ConsentWindowSettings): string[] {
  return settings.ask_countries === "default" ? [...DEFAULT_ASK_COUNTRIES] : [...settings.ask_countries];
}

export function resolveConsentMode(
  countryCode: string | null | undefined,
  settings: ConsentWindowSettings,
): ConsentMode {
  const code = normalizeCountryCode(countryCode);
  if (!code) return settings.unknown_country_mode;
  return effectiveAskCountries(settings).includes(code) ? "ask" : "notice";
}

export function isGrantedDecision(decision: ConsentDecision | null | undefined): boolean {
  return decision === "granted_explicit" || decision === "granted_implied";
}

export function consentMaxAgeDays(decision: ConsentDecision, settings: ConsentWindowSettings): number {
  return isGrantedDecision(decision) ? settings.accept_days : settings.reject_days;
}

export function isRejectDurationRisky(days: number): boolean {
  return days < REJECT_RISK_THRESHOLD_DAYS;
}

export interface ConsentCookieValue {
  decision: ConsentDecision;
  mode: ConsentMode;
  /** Epoch seconds when the choice was made. */
  at: number;
}

/** `v1.<decision>.<mode>.<epochSeconds>` — readable by page scripts, no personal data. */
export function serializeConsentCookie(value: ConsentCookieValue): string {
  return `v1.${value.decision}.${value.mode}.${Math.floor(value.at)}`;
}

export function parseConsentCookie(raw: string | null | undefined): ConsentCookieValue | null {
  if (!raw || typeof raw !== "string") return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const parts = decoded.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const decision = parts[1] as ConsentDecision;
  const mode = parts[2] as ConsentMode;
  const at = Number(parts[3]);
  if (!CONSENT_DECISIONS.includes(decision)) return null;
  if (mode !== "ask" && mode !== "notice") return null;
  if (!Number.isFinite(at)) return null;
  return { decision, mode, at };
}

/** Banner copy stored as reserved variables (`reserved.cookie_banner_*`), per locale. */
export const COOKIE_BANNER_KEYS = [
  "cookie_banner_notice",
  "cookie_banner_ask",
  "cookie_banner_ok",
  "cookie_banner_accept",
  "cookie_banner_reject",
  "cookie_banner_privacy_link",
] as const;

export type CookieBannerKey = (typeof COOKIE_BANNER_KEYS)[number];

export const DEFAULT_COOKIE_BANNER_COPY: Record<CookieBannerKey, Record<string, string>> = {
  cookie_banner_notice: {
    en: "We use cookies to improve your experience and measure how our site is used. By continuing to browse, you agree.",
    es: "Usamos cookies para mejorar tu experiencia y medir cómo se usa nuestro sitio. Al seguir navegando, aceptas su uso.",
  },
  cookie_banner_ask: {
    en: "We use cookies to improve your experience and measure how our site is used.",
    es: "Usamos cookies para mejorar tu experiencia y medir cómo se usa nuestro sitio.",
  },
  cookie_banner_ok: { en: "OK", es: "Entendido" },
  cookie_banner_accept: { en: "Accept", es: "Aceptar" },
  cookie_banner_reject: { en: "Reject", es: "Rechazar" },
  cookie_banner_privacy_link: { en: "Privacy policy", es: "Política de privacidad" },
};

export type CookieBannerCopy = Record<CookieBannerKey, string>;

export function resolveCookieBannerCopy(
  stored: Partial<Record<CookieBannerKey, Record<string, string>>> | undefined,
  locale: string,
): CookieBannerCopy {
  const out = {} as CookieBannerCopy;
  for (const key of COOKIE_BANNER_KEYS) {
    const fromStored = stored?.[key]?.[locale]?.trim();
    const fallback = DEFAULT_COOKIE_BANNER_COPY[key][locale] ?? DEFAULT_COOKIE_BANNER_COPY[key].en;
    out[key] = fromStored || fallback;
  }
  return out;
}

/** Public payload for GET /api/consent-window. */
export interface ConsentWindowPublicPayload {
  ask_countries: string[];
  unknown_country_mode: ConsentMode;
  accept_days: number;
  reject_days: number;
  copy: CookieBannerCopy;
  privacy_url: string;
}

/** Google Consent Mode v2 signal set for a decision. */
export function consentModeSignals(granted: boolean): Record<string, "granted" | "denied"> {
  const v = granted ? "granted" : "denied";
  return {
    ad_storage: v,
    analytics_storage: v,
    ad_user_data: v,
    ad_personalization: v,
  };
}
