/**
 * Site-configured signup/login GTM conversion event names + rename aliases.
 * Canonical names are what trackConversion fires; aliases remain valid for
 * form conversion_name matching after a rename.
 */

export const DEFAULT_SIGNUP_EVENT_NAME = "sign_up";
export const DEFAULT_LOGIN_EVENT_NAME = "login";

export type AuthConversionKind = "signup" | "login";

export interface AuthConversionEventConfig {
  signup_event_name: string;
  login_event_name: string;
  signup_event_aliases: string[];
  login_event_aliases: string[];
}

export const DEFAULT_AUTH_CONVERSION_EVENTS: AuthConversionEventConfig = {
  signup_event_name: DEFAULT_SIGNUP_EVENT_NAME,
  login_event_name: DEFAULT_LOGIN_EVENT_NAME,
  signup_event_aliases: [],
  login_event_aliases: [],
};

const EVENT_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function isValidConversionEventSlug(name: string): boolean {
  return EVENT_NAME_RE.test(name.trim());
}

function normalizeAliasList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || !EVENT_NAME_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Parse auth conversion keys from a tracking YAML / API object. */
export function parseAuthConversionEventConfig(
  raw: Record<string, unknown> | null | undefined,
  defaults: AuthConversionEventConfig = DEFAULT_AUTH_CONVERSION_EVENTS,
): AuthConversionEventConfig {
  if (!raw || typeof raw !== "object") {
    return { ...defaults, signup_event_aliases: [...defaults.signup_event_aliases], login_event_aliases: [...defaults.login_event_aliases] };
  }
  const signup =
    typeof raw.signup_event_name === "string" && raw.signup_event_name.trim()
      ? raw.signup_event_name.trim()
      : defaults.signup_event_name;
  const login =
    typeof raw.login_event_name === "string" && raw.login_event_name.trim()
      ? raw.login_event_name.trim()
      : defaults.login_event_name;
  return {
    signup_event_name: signup,
    login_event_name: login,
    signup_event_aliases: normalizeAliasList(raw.signup_event_aliases),
    login_event_aliases: normalizeAliasList(raw.login_event_aliases),
  };
}

export function signupNames(cfg: AuthConversionEventConfig): string[] {
  return [cfg.signup_event_name, ...cfg.signup_event_aliases];
}

export function loginNames(cfg: AuthConversionEventConfig): string[] {
  return [cfg.login_event_name, ...cfg.login_event_aliases];
}

export function allReservedAuthEventNames(cfg: AuthConversionEventConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...signupNames(cfg), ...loginNames(cfg)]) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function isSignupConversionName(
  name: string | null | undefined,
  cfg: AuthConversionEventConfig,
): boolean {
  if (typeof name !== "string" || !name.trim()) return false;
  const n = name.trim();
  return signupNames(cfg).includes(n);
}

export function isLoginConversionName(
  name: string | null | undefined,
  cfg: AuthConversionEventConfig,
): boolean {
  if (typeof name !== "string" || !name.trim()) return false;
  const n = name.trim();
  return loginNames(cfg).includes(n);
}

export function resolveAuthConversionKind(
  name: string | null | undefined,
  cfg: AuthConversionEventConfig,
): AuthConversionKind | null {
  if (isSignupConversionName(name, cfg)) return "signup";
  if (isLoginConversionName(name, cfg)) return "login";
  return null;
}

export function isAuthConversionName(
  name: string | null | undefined,
  cfg: AuthConversionEventConfig,
): boolean {
  return resolveAuthConversionKind(name, cfg) !== null;
}

/**
 * When renaming a canonical auth event, append the previous canonical to aliases
 * (deduped, never equal to the new canonical).
 */
export function appendAliasOnRename(
  previousCanonical: string,
  nextCanonical: string,
  existingAliases: string[],
): string[] {
  const prev = previousCanonical.trim();
  const next = nextCanonical.trim();
  if (!prev || prev === next) return normalizeAliasList(existingAliases);
  const aliases = normalizeAliasList(existingAliases).filter((a) => a !== next);
  if (!aliases.includes(prev) && prev !== next) {
    aliases.push(prev);
  }
  return aliases;
}

/**
 * Validate a proposed auth conversion config (cross-collision + slug format).
 * Returns error message or null.
 */
export function validateAuthConversionEventConfig(
  cfg: AuthConversionEventConfig,
): string | null {
  if (!isValidConversionEventSlug(cfg.signup_event_name)) {
    return `Invalid signup_event_name: "${cfg.signup_event_name}" — use lowercase letters, digits, and underscores only`;
  }
  if (!isValidConversionEventSlug(cfg.login_event_name)) {
    return `Invalid login_event_name: "${cfg.login_event_name}" — use lowercase letters, digits, and underscores only`;
  }
  if (cfg.signup_event_name === cfg.login_event_name) {
    return "signup_event_name and login_event_name must be different";
  }
  for (const a of cfg.signup_event_aliases) {
    if (a === cfg.signup_event_name) {
      return `signup_event_aliases must not include the current signup_event_name "${a}"`;
    }
    if (a === cfg.login_event_name || cfg.login_event_aliases.includes(a)) {
      return `signup alias "${a}" collides with login event name or aliases`;
    }
  }
  for (const a of cfg.login_event_aliases) {
    if (a === cfg.login_event_name) {
      return `login_event_aliases must not include the current login_event_name "${a}"`;
    }
    if (a === cfg.signup_event_name || cfg.signup_event_aliases.includes(a)) {
      return `login alias "${a}" collides with signup event name or aliases`;
    }
  }
  if (cfg.signup_event_aliases.includes(cfg.login_event_name)) {
    return `signup_event_aliases must not include login_event_name "${cfg.login_event_name}"`;
  }
  if (cfg.login_event_aliases.includes(cfg.signup_event_name)) {
    return `login_event_aliases must not include signup_event_name "${cfg.signup_event_name}"`;
  }
  return null;
}

/** True if `name` is reserved as an auth canonical or alias (cannot be a different catalog event). */
export function isReservedAuthEventName(
  name: string,
  cfg: AuthConversionEventConfig,
): boolean {
  return allReservedAuthEventNames(cfg).includes(name.trim());
}

export const DEFAULT_SIGNUP_EVENT_INTENT = {
  description: "Account signup",
  when_to_use:
    "Visitor creates a 4Geeks account via a form with the account gate (Require Signup / is_signup) and allow_signup. GA4 recommended event name — prefer this over inventing website_signup / signup.",
  when_not_to_use:
    "Newsletter list join (newsletter_signup), program apply (student_application), soft info leads, or login of an existing account (use the site login_event_name).",
} as const;

export const DEFAULT_LOGIN_EVENT_INTENT = {
  description: "Account login",
  when_to_use:
    "Visitor signs in to an existing account on an account-gated form (GA4 recommended). Fired from in-form Login when the account gate is on.",
  when_not_to_use:
    "Account creation (signup_event_name), newsletter, apply/enroll, or contact forms.",
} as const;
