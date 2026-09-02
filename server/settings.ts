import fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
import { normalizeConsentFallbackKey } from "@shared/consent-settings";
import { validateConversionEventIntent } from "@shared/conversionEventIntent";
import {
  type AuthSignupFieldMapEntry,
  parseAuthSignupFieldMap,
  normalizeAuthSignupFieldMapInput,
  isSignupFieldMapReady,
  DEFAULT_AUTH_SIGNUP_FIELD_MAP,
  buildSignupPayloadPreviewJson,
} from "@shared/authSignupFieldMap";
import {
  appendAliasOnRename,
  DEFAULT_AUTH_CONVERSION_EVENTS,
  DEFAULT_LOGIN_EVENT_INTENT,
  DEFAULT_SIGNUP_EVENT_INTENT,
  parseAuthConversionEventConfig,
  validateAuthConversionEventConfig,
  type AuthConversionEventConfig,
} from "@shared/authConversionEvents";

export type { AuthSignupFieldMapEntry };
export {
  isSignupFieldMapReady,
  DEFAULT_AUTH_SIGNUP_FIELD_MAP,
  buildSignupPayloadPreviewJson,
};

const log = child({ module: "settings" });



const DEFAULT_CONTENT_ROOT = getDefaultContentRoot();

function resolveSettingsRoot(contentRoot?: string): string {
  return contentRoot ?? DEFAULT_CONTENT_ROOT;
}
function getSettingsPath(contentRoot?: string): string {
  return path.join(resolveSettingsRoot(contentRoot), "settings.yml");
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface I18nSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

interface HomePageSettings {
  type: string;
  slug: string;
}

export interface TagManagerSettings {
  /** Web GTM container ID (e.g. GTM-XXXX). Injected into the HTML shell; empty disables web GTM. */
  web_container_id: string;
  sgtm_enabled: boolean;
  sgtm_server_url: string;
  sgtm_proxy_path: string;
}

export interface IpnDestination {
  id: string;
  base_url: string;
}

export interface IpNormalizationSettings {
  enabled: boolean;
  destinations: IpnDestination[];
}

export interface OptimizationSettings {
  tagmanager: TagManagerSettings;
  ip_normalization: IpNormalizationSettings;
}

export interface WebhookConfig {
  url: string;
  method: "POST" | "GET";
  auth_header?: string;
}

export interface ConsentDefaults {
  marketing?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  sms_usa_only?: boolean;
  marketing_text?: string;
  sms_text?: string;
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
  [key: string]: boolean | string | undefined;
}

export interface SuccessDefaults {
  message?: string;
  url?: string;
}

export interface ConversionEventEntry {
  name: string;
  /** Short staff one-liner; agents primarily use when_to_use / when_not_to_use. */
  description?: string;
  /** Visitor proposition — when this conversion_name fits (required on save). */
  when_to_use?: string;
  /** Confusable neighbors — when not to use this name (required on save). */
  when_not_to_use?: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: WebhookConfig;
  success?: SuccessDefaults;
}

export interface TrackingWebhook {
  url: string;
  method?: string;
  auth_header?: string;
}

/** GA4 BigQuery export connection (non-secret). Credentials via GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME (same as media) or ADC. */
export interface TrackingBigQuerySettings {
  enabled: boolean;
  project_id: string;
  dataset_id: string;
  /** Query location, e.g. US or EU */
  location: string;
  /** Daily export table prefix (GA4 default events_) */
  table_prefix: string;
}

export const DEFAULT_TRACKING_BIGQUERY: TrackingBigQuerySettings = {
  enabled: false,
  project_id: "",
  dataset_id: "",
  location: "US",
  table_prefix: "events_",
};

export interface TrackingSettings {
  conversion_events: ConversionEventEntry[];
  webhook?: TrackingWebhook;
  /** Allowlist of expected conversion_names for the Leads diagnostics (empty = warning disabled). */
  leads_expected_conversion_names?: string[];
  /** Allowlist of expected ActiveCampaign tags for the Leads diagnostics (empty = warning disabled). */
  leads_expected_tags?: string[];
  bigquery: TrackingBigQuerySettings;
  /** Canonical GTM event fired on account create (account-gated forms). */
  signup_event_name: string;
  /** Canonical GTM event fired on in-form login. */
  login_event_name: string;
  /** Former signup_event_name values after rename — reserved + alias-matched. */
  signup_event_aliases: string[];
  /** Former login_event_name values after rename — reserved + alias-matched. */
  login_event_aliases: string[];
}

export function parseTrackingBigQuerySettings(
  raw: unknown,
  defaults: TrackingBigQuerySettings = DEFAULT_TRACKING_BIGQUERY,
): TrackingBigQuerySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaults };
  }
  const o = raw as Record<string, unknown>;
  const prefix =
    typeof o.table_prefix === "string" && o.table_prefix.trim()
      ? o.table_prefix.trim()
      : defaults.table_prefix;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : defaults.enabled,
    project_id: typeof o.project_id === "string" ? o.project_id.trim() : defaults.project_id,
    dataset_id: typeof o.dataset_id === "string" ? o.dataset_id.trim() : defaults.dataset_id,
    location:
      typeof o.location === "string" && o.location.trim()
        ? o.location.trim()
        : defaults.location,
    table_prefix: prefix.endsWith("_") ? prefix : `${prefix}_`,
  };
}

/** GET | POST | PUT for auth API endpoints */
export type AuthHttpMethod = "GET" | "POST" | "PUT";

export interface AuthEndpoint {
  /** Path relative to auth.host, or absolute URL */
  path?: string;
  /** HTTP method (login/signup default POST; profile default GET) */
  method?: AuthHttpMethod;
}

/**
 * Consumer auth (lead forms with is_signup, login redirect, profile prefill).
 * Nested login / signup / profile each own path + method.
 */
export interface AuthSettings {
  /** API base host, e.g. https://breathecode.herokuapp.com */
  host?: string;
  /**
   * Optional Breathecode academy id sent as the `Academy` header on profile
   * (and auth test profile) requests when set.
   */
  academy?: string;
  login?: AuthEndpoint & {
    /** Hosted login page; redirects back with ?token= */
    url?: string;
    /** Example credentials / body for login Test */
    payload?: Record<string, unknown>;
  };
  signup?: AuthEndpoint & {
    /**
     * @deprecated Legacy example JSON — no longer written on save; live signup
     * uses field_map. Kept on read for migration only.
     */
    payload?: Record<string, unknown>;
    /** Payload key → form.* / session.* map for is_signup submit */
    field_map?: AuthSignupFieldMapEntry[];
  };
  profile?: AuthEndpoint;
}

export const DEFAULT_LOGIN_PAYLOAD: Record<string, unknown> = {
  email: "bob@gmail.com",
  password: "********",
};

/** @deprecated Prefer field_map + generated preview. Kept for login-era tests. */
export const DEFAULT_SIGNUP_PAYLOAD: Record<string, unknown> = {
  first_name: "bob",
  last_name: "dylan",
  email: "bob@gmail.com",
  phone: "+574589459854",
  course: "",
  country: "Colombia",
  city: "Bogotá",
  plan: "4geeks-basic-subscription",
  language: "en",
  has_marketing_consent: true,
  conversion_info: {
    user_agent: "Mozilla/5.0 …",
    landing_url: "/login",
    conversion_url: "/interactive-exercise/python-beginner-exercises",
    internal_cta_placement: "navbar-bootcamp-options-start-practicing-with-challenges",
  },
};

/** Re-injected above `auth:` on save (yaml.dump strips comments). */
export const AUTH_YAML_COMMENT_HEADER = `# Consumer auth (lead forms with is_signup, login redirect, profile prefill).
# Paths are relative to host, or absolute URLs. method: GET | POST | PUT.
# Optional academy: Breathecode academy id sent as Academy header on profile fetch.
`;

function parseAuthMethod(v: unknown): AuthHttpMethod | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().toUpperCase();
  return m === "GET" || m === "POST" || m === "PUT" ? m : undefined;
}

function parsePayload(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function authStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Normalize nested or legacy-flat auth YAML into AuthSettings. */
export function normalizeAuthSettings(authRaw: Record<string, unknown> | undefined | null): AuthSettings {
  if (!authRaw || typeof authRaw !== "object") return {};

  const host = authStr(authRaw.host);
  const academy =
    authStr(authRaw.academy) ||
    (typeof authRaw.academy === "number" && Number.isFinite(authRaw.academy)
      ? String(authRaw.academy)
      : undefined);

  // Nested preferred
  const loginRaw = authRaw.login && typeof authRaw.login === "object" && !Array.isArray(authRaw.login)
    ? (authRaw.login as Record<string, unknown>)
    : undefined;
  const signupRaw = authRaw.signup && typeof authRaw.signup === "object" && !Array.isArray(authRaw.signup)
    ? (authRaw.signup as Record<string, unknown>)
    : undefined;
  const profileRaw = authRaw.profile && typeof authRaw.profile === "object" && !Array.isArray(authRaw.profile)
    ? (authRaw.profile as Record<string, unknown>)
    : undefined;

  // Legacy flat keys (migrate on read)
  const legacyLoginUrl = authStr(authRaw.login_url);
  const legacyLoginPath = authStr(authRaw.login_path);
  const legacyLoginMethod = parseAuthMethod(authRaw.login_method);
  const legacySignupPath = authStr(authRaw.signup_path);
  const legacyMePath = authStr(authRaw.me_path);
  const legacySignupPayload = parsePayload(authRaw.signup_payload);

  const loginUrl = authStr(loginRaw?.url) || legacyLoginUrl;
  const loginPath = authStr(loginRaw?.path) || legacyLoginPath;
  const loginMethod = parseAuthMethod(loginRaw?.method) || legacyLoginMethod;
  const loginPayload = parsePayload(loginRaw?.payload);

  const signupPath = authStr(signupRaw?.path) || legacySignupPath;
  const signupMethod = parseAuthMethod(signupRaw?.method);
  const signupPayload = parsePayload(signupRaw?.payload) || legacySignupPayload;
  const signupFieldMap = parseAuthSignupFieldMap(signupRaw?.field_map);

  const profilePath = authStr(profileRaw?.path) || legacyMePath;
  const profileMethod = parseAuthMethod(profileRaw?.method);

  const login =
    loginUrl || loginPath || loginMethod || loginPayload
      ? {
          ...(loginUrl ? { url: loginUrl } : {}),
          ...(loginPath ? { path: loginPath } : {}),
          ...(loginMethod ? { method: loginMethod } : {}),
          ...(loginPayload ? { payload: loginPayload } : {}),
        }
      : undefined;

  const signup =
    signupPath || signupMethod || signupPayload || (signupFieldMap && signupFieldMap.length > 0)
      ? {
          ...(signupPath ? { path: signupPath } : {}),
          ...(signupMethod ? { method: signupMethod } : {}),
          // Legacy payload still readable until sites are migrated; new saves omit it.
          ...(signupPayload ? { payload: signupPayload } : {}),
          ...(signupFieldMap && signupFieldMap.length > 0 ? { field_map: signupFieldMap } : {}),
        }
      : undefined;

  const profile =
    profilePath || profileMethod
      ? {
          ...(profilePath ? { path: profilePath } : {}),
          ...(profileMethod ? { method: profileMethod } : {}),
        }
      : undefined;

  return {
    ...(host ? { host } : {}),
    ...(academy ? { academy } : {}),
    ...(login ? { login } : {}),
    ...(signup ? { signup } : {}),
    ...(profile ? { profile } : {}),
  };
}

function injectAuthYamlComments(dumped: string): string {
  // Strip a previously injected header, then insert a fresh one above `auth:`.
  const stripped = dumped.replace(
    /(?:^|\n)# Consumer auth \(lead forms with is_signup[\s\S]*?(?=\nauth:)/m,
    (m) => (m.startsWith("\n") ? "\n" : ""),
  );
  return stripped.replace(/(^|\n)(auth:)/, `$1${AUTH_YAML_COMMENT_HEADER}$2`);
}

export interface RobotsSettings {
  block_indexing: boolean;
  include_sitemap: boolean;
  disallow_paths: string[];
  ai_bots: string[];
}

export const DEFAULT_ROBOTS_SETTINGS: RobotsSettings = {
  block_indexing: false,
  include_sitemap: true,
  disallow_paths: ["/api/", "/private/", "/preview-frame", "/health"],
  ai_bots: [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "Google-Extended",
    "anthropic-ai",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Meta-ExternalAgent",
    "Applebot",
    "Applebot-Extended",
  ],
};

/** Search Console bulk export → BigQuery (non-secret). Credentials via GCS_* env (same as media). */
export interface SearchConsoleBigQuerySettings {
  enabled: boolean;
  project_id: string;
  dataset_id: string;
  /** Query location, e.g. US or EU */
  location: string;
  /** GSC bulk export table (default searchdata_url_impression) */
  url_impression_table: string;
  /** GSC export log table (default ExportLog) */
  export_log_table: string;
}

export const DEFAULT_SEARCH_CONSOLE_BIGQUERY: SearchConsoleBigQuerySettings = {
  enabled: false,
  project_id: "",
  dataset_id: "searchconsole",
  location: "US",
  url_impression_table: "searchdata_url_impression",
  export_log_table: "ExportLog",
};

/** Search Console URL Inspection property + optional BigQuery export pointer (credentials stay env-only). */
export interface SearchConsoleSettings {
  site_url: string | null;
  bigquery: SearchConsoleBigQuerySettings;
}

export const DEFAULT_SEARCH_CONSOLE_SETTINGS: SearchConsoleSettings = {
  site_url: null,
  bigquery: { ...DEFAULT_SEARCH_CONSOLE_BIGQUERY },
};

export function parseSearchConsoleBigQuerySettings(
  raw: unknown,
  defaults: SearchConsoleBigQuerySettings = DEFAULT_SEARCH_CONSOLE_BIGQUERY,
): SearchConsoleBigQuerySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaults };
  }
  const o = raw as Record<string, unknown>;
  const urlTable =
    typeof o.url_impression_table === "string" && o.url_impression_table.trim()
      ? o.url_impression_table.trim()
      : defaults.url_impression_table;
  const exportLog =
    typeof o.export_log_table === "string" && o.export_log_table.trim()
      ? o.export_log_table.trim()
      : defaults.export_log_table;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : defaults.enabled,
    project_id: typeof o.project_id === "string" ? o.project_id.trim() : defaults.project_id,
    dataset_id: typeof o.dataset_id === "string" ? o.dataset_id.trim() : defaults.dataset_id,
    location:
      typeof o.location === "string" && o.location.trim()
        ? o.location.trim()
        : defaults.location,
    url_impression_table: urlTable,
    export_log_table: exportLog,
  };
}

function isLocalGscHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  return false;
}

/**
 * Normalize a Search Console property string for settings.yml.
 * Accepts `https://example.com/` (trailing slash added) or `sc-domain:example.com`.
 */
export function normalizeSearchConsoleSiteUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Search Console property is required");
  }
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("sc-domain:")) {
    const host = trimmed.slice("sc-domain:".length).trim().toLowerCase().replace(/\.$/, "");
    if (!host) {
      throw new Error("sc-domain property needs a hostname");
    }
    if (isLocalGscHostname(host)) {
      throw new Error("Search Console property cannot be localhost");
    }
    if (host.includes("://") || host.includes("/") || /\s/.test(host)) {
      throw new Error("Invalid sc-domain hostname");
    }
    return `sc-domain:${host}`;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Search Console property must be https://example.com/ or sc-domain:example.com");
  }
  if (url.protocol !== "https:") {
    throw new Error("URL-prefix property must use https://");
  }
  if (isLocalGscHostname(url.hostname)) {
    throw new Error("Search Console property cannot be localhost");
  }
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

export function parseSearchConsoleSettings(raw: unknown): SearchConsoleSettings {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const siteUrl = typeof obj.site_url === "string" && obj.site_url.trim() ? obj.site_url.trim() : null;
  return {
    site_url: siteUrl,
    bigquery: parseSearchConsoleBigQuerySettings(obj.bigquery),
  };
}

function serializeSearchConsoleBigQuery(
  bq: SearchConsoleBigQuerySettings,
): Record<string, unknown> {
  return {
    enabled: bq.enabled,
    project_id: bq.project_id,
    dataset_id: bq.dataset_id,
    location: bq.location,
    url_impression_table: bq.url_impression_table,
    export_log_table: bq.export_log_table,
  };
}

function writeSearchConsoleBlock(
  existing: Record<string, unknown>,
  sc: SearchConsoleSettings,
): void {
  const block: Record<string, unknown> = {
    bigquery: serializeSearchConsoleBigQuery(sc.bigquery),
  };
  if (sc.site_url) {
    block.site_url = sc.site_url;
  }
  existing.search_console = block;
}

/**
 * Non-secret Browser Run pacing for OG / entry-preview captures.
 * Credentials stay env-only; these rate fields live in settings.yml → entry_preview.
 */
export interface EntryPreviewSettings {
  /** Min ms between Cloudflare /screenshot starts (process-wide). Free ≈ 6/min → 10000. */
  min_interval_ms: number;
  /** Max in-flight capture jobs per content root (1–8). */
  max_concurrency: number;
  /** Retries on HTTP 429 before failing the job (1–20). */
  max_retries: number;
}

export const DEFAULT_ENTRY_PREVIEW_SETTINGS: EntryPreviewSettings = {
  min_interval_ms: 10_000,
  max_concurrency: 1,
  max_retries: 5,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseEntryPreviewSettings(raw: unknown): EntryPreviewSettings {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    min_interval_ms: clampInt(
      obj.min_interval_ms,
      0,
      120_000,
      DEFAULT_ENTRY_PREVIEW_SETTINGS.min_interval_ms,
    ),
    max_concurrency: clampInt(
      obj.max_concurrency,
      1,
      8,
      DEFAULT_ENTRY_PREVIEW_SETTINGS.max_concurrency,
    ),
    max_retries: clampInt(
      obj.max_retries,
      1,
      20,
      DEFAULT_ENTRY_PREVIEW_SETTINGS.max_retries,
    ),
  };
}

/** Lead-form consent pointer in settings.yml (`consent.fallback`). */
export interface SiteConsentSettings {
  fallback: string | null;
}

interface SiteSettings {
  i18n: I18nSettings;
  home_page: HomePageSettings;
  optimization: OptimizationSettings;
  tracking: TrackingSettings;
  robots: RobotsSettings;
  search_console: SearchConsoleSettings;
  auth: AuthSettings;
  entry_preview: EntryPreviewSettings;
  consent: SiteConsentSettings;
}

function parseSiteConsentSettings(raw: unknown): SiteConsentSettings {
  if (!raw || typeof raw !== "object") return { fallback: null };
  const rec = raw as Record<string, unknown>;
  return { fallback: normalizeConsentFallbackKey(rec.fallback) };
}

/** Build robots.txt body from settings. `baseUrl` is used for the Sitemap line when included. */
export function buildRobotsTxtContent(robots: RobotsSettings, baseUrl: string): string {
  if (robots.block_indexing) {
    return `# Site indexing blocked
User-agent: *
Disallow: /
`;
  }

  const lines: string[] = [
    "# Allow all crawlers",
    "User-agent: *",
    "Allow: /",
  ];
  for (const p of robots.disallow_paths) {
    const path = p.trim();
    if (path) lines.push(`Disallow: ${path}`);
  }
  lines.push("");

  if (robots.ai_bots.length > 0) {
    lines.push("# Allow AI/LLM crawlers explicitly");
    for (const bot of robots.ai_bots) {
      const name = bot.trim();
      if (!name) continue;
      lines.push(`User-agent: ${name}`);
      lines.push("Allow: /");
      lines.push("");
    }
  }

  if (robots.include_sitemap && baseUrl) {
    lines.push("# Sitemap location");
    lines.push(`Sitemap: ${baseUrl.replace(/\/$/, "")}/sitemap.xml`);
    lines.push("");
  }

  return lines.join("\n");
}

const settingsCache = new Map<string, SiteSettings>();

function loadSettings(contentRoot?: string): SiteSettings {
  const key = resolveSettingsRoot(contentRoot);
  if (settingsCache.has(key)) return settingsCache.get(key)!;

  const settingsPath = getSettingsPath(key);

  const defaults: SiteSettings = {
    i18n: {
      default_locale: "en",
      supported_locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Spanish" },
      ],
    },
    home_page: {
      type: "page",
      slug: "home",
    },
    optimization: {
      tagmanager: {
        web_container_id: "GTM-PGGRR6",
        sgtm_enabled: false,
        sgtm_server_url: "",
        sgtm_proxy_path: "/sgtm/",
      },
      ip_normalization: {
        enabled: false,
        destinations: [],
      },
    },
    tracking: {
      conversion_events: [],
      bigquery: { ...DEFAULT_TRACKING_BIGQUERY },
      ...DEFAULT_AUTH_CONVERSION_EVENTS,
      signup_event_aliases: [],
      login_event_aliases: [],
    },
    robots: { ...DEFAULT_ROBOTS_SETTINGS },
    search_console: { ...DEFAULT_SEARCH_CONSOLE_SETTINGS },
    auth: {},
    entry_preview: { ...DEFAULT_ENTRY_PREVIEW_SETTINGS },
    consent: { fallback: null },
  };

  if (!fs.existsSync(settingsPath)) {
    log.warn("[Settings] settings.yml not found, using defaults");
    settingsCache.set(key, defaults);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) {
      settingsCache.set(key, defaults);
      return defaults;
    }

    const i18nRaw = parsed.i18n as Record<string, unknown> | undefined;
    const i18n: I18nSettings = {
      default_locale: (i18nRaw?.default_locale as string) || defaults.i18n.default_locale,
      supported_locales: Array.isArray(i18nRaw?.supported_locales)
        ? (i18nRaw.supported_locales as LocaleEntry[]).filter(
            (e) => typeof e.code === "string" && typeof e.label === "string"
          )
        : defaults.i18n.supported_locales,
    };

    const homePageRaw = parsed.home_page as Record<string, unknown> | undefined;
    const home_page: HomePageSettings = {
      type: (homePageRaw?.type as string) || defaults.home_page.type,
      slug: (homePageRaw?.slug as string) || defaults.home_page.slug,
    };

    const optRaw = parsed.optimization as Record<string, unknown> | undefined;
    const tmRaw = optRaw?.tagmanager as Record<string, unknown> | undefined;
    const ipnRaw = optRaw?.ip_normalization as Record<string, unknown> | undefined;
    const defTm = defaults.optimization.tagmanager;
    const defIpn = defaults.optimization.ip_normalization;
    const optimization: OptimizationSettings = {
      tagmanager: {
        web_container_id:
          typeof tmRaw?.web_container_id === "string"
            ? tmRaw.web_container_id
            : defTm.web_container_id,
        sgtm_enabled: typeof tmRaw?.sgtm_enabled === "boolean" ? tmRaw.sgtm_enabled : defTm.sgtm_enabled,
        sgtm_server_url: (tmRaw?.sgtm_server_url as string) || defTm.sgtm_server_url,
        sgtm_proxy_path: (tmRaw?.sgtm_proxy_path as string) || defTm.sgtm_proxy_path,
      },
      ip_normalization: parseIpNormalizationSettings(ipnRaw, defIpn),
    };

    const trackingRaw = parsed.tracking as Record<string, unknown> | undefined;
    const conversionEventsRaw = trackingRaw?.conversion_events;

    const parseWebhookConfig = (raw: unknown): WebhookConfig | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const w = raw as Record<string, unknown>;
      if (typeof w.url !== "string" || !w.url.trim()) return undefined;
      const method = w.method === "GET" ? "GET" : "POST";
      return {
        url: w.url.trim(),
        method,
        ...(typeof w.auth_header === "string" && w.auth_header ? { auth_header: w.auth_header } : {}),
      };
    };
    const parseWebhook = (raw: unknown): TrackingWebhook | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const w = raw as Record<string, unknown>;
      if (typeof w.url !== "string" || !w.url.trim()) return undefined;
      const method = typeof w.method === "string" ? w.method : "POST";
      return {
        url: w.url.trim(),
        method,
        ...(typeof w.auth_header === "string" && w.auth_header ? { auth_header: w.auth_header } : {}),
      };
    };
    const parseConsent = (raw: Record<string, unknown>): ConsentDefaults => {
      const result: ConsentDefaults = {};
      const textKeys = new Set(["marketing_text", "sms_text", "terms_url", "privacy_url"]);
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "boolean") {
          result[key] = value;
        } else if (typeof value === "string" && value && textKeys.has(key)) {
          result[key] = value;
        }
      }
      return result;
    };
    const authConv = parseAuthConversionEventConfig(trackingRaw, DEFAULT_AUTH_CONVERSION_EVENTS);
    const tracking: TrackingSettings = {
      conversion_events: Array.isArray(conversionEventsRaw)
        ? (conversionEventsRaw as Array<Record<string, unknown>>)
            .filter((e) => e && typeof e.name === "string")
            .map((e) => {
              const successRaw = e.success && typeof e.success === "object"
                ? (e.success as Record<string, unknown>)
                : null;
              const success: SuccessDefaults | undefined = successRaw
                ? {
                    ...(typeof successRaw.message === "string" && successRaw.message
                      ? { message: successRaw.message }
                      : {}),
                    ...(typeof successRaw.url === "string" && successRaw.url
                      ? { url: successRaw.url }
                      : {}),
                  }
                : undefined;
              const entry: ConversionEventEntry = {
                name: e.name as string,
                ...(typeof e.description === "string" ? { description: e.description } : {}),
                ...(typeof e.when_to_use === "string" && e.when_to_use.trim()
                  ? { when_to_use: e.when_to_use.trim() }
                  : {}),
                ...(typeof e.when_not_to_use === "string" && e.when_not_to_use.trim()
                  ? { when_not_to_use: e.when_not_to_use.trim() }
                  : {}),
                ...(typeof e.automations === "string" && e.automations ? { automations: e.automations } : {}),
                ...(Array.isArray(e.tags) && e.tags.length > 0
                  ? { tags: e.tags.filter((t) => typeof t === "string") as string[] }
                  : {}),
                ...(e.consent && typeof e.consent === "object"
                  ? { consent: parseConsent(e.consent as Record<string, unknown>) }
                  : {}),
                ...(parseWebhookConfig(e.webhook) ? { webhook: parseWebhookConfig(e.webhook) } : {}),
                ...(success && (success.message || success.url) ? { success } : {}),
              };
              return entry;
            })
        : defaults.tracking.conversion_events,
      webhook: parseWebhook(trackingRaw?.webhook),
      ...(Array.isArray(trackingRaw?.leads_expected_conversion_names)
        ? {
            leads_expected_conversion_names: (trackingRaw.leads_expected_conversion_names as unknown[])
              .filter((t): t is string => typeof t === "string" && !!t.trim())
              .map((t) => t.trim()),
          }
        : {}),
      ...(Array.isArray(trackingRaw?.leads_expected_tags)
        ? {
            leads_expected_tags: (trackingRaw.leads_expected_tags as unknown[])
              .filter((t): t is string => typeof t === "string" && !!t.trim())
              .map((t) => t.trim()),
          }
        : {}),
      bigquery: parseTrackingBigQuerySettings(
        trackingRaw?.bigquery,
        defaults.tracking.bigquery,
      ),
      signup_event_name: authConv.signup_event_name,
      login_event_name: authConv.login_event_name,
      signup_event_aliases: authConv.signup_event_aliases,
      login_event_aliases: authConv.login_event_aliases,
    };

    const robotsRaw = parsed.robots as Record<string, unknown> | undefined;
    const defRobots = defaults.robots;
    const robots: RobotsSettings = {
      block_indexing:
        typeof robotsRaw?.block_indexing === "boolean"
          ? robotsRaw.block_indexing
          : defRobots.block_indexing,
      include_sitemap:
        typeof robotsRaw?.include_sitemap === "boolean"
          ? robotsRaw.include_sitemap
          : defRobots.include_sitemap,
      disallow_paths: Array.isArray(robotsRaw?.disallow_paths)
        ? (robotsRaw.disallow_paths as unknown[]).filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [...defRobots.disallow_paths],
      ai_bots: Array.isArray(robotsRaw?.ai_bots)
        ? (robotsRaw.ai_bots as unknown[]).filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        : [...defRobots.ai_bots],
    };

    const authRaw = parsed.auth as Record<string, unknown> | undefined;
    const auth = normalizeAuthSettings(authRaw);

    // entry_preview: rate fields are loaded; legacy secrets (account/token/capture)
    // are ignored (env-only) and scrubbed on the next entry_preview write.

    const result: SiteSettings = {
      ...defaults,
      i18n,
      home_page,
      optimization,
      tracking,
      robots,
      search_console: parseSearchConsoleSettings(parsed.search_console),
      auth,
      entry_preview: parseEntryPreviewSettings(parsed.entry_preview),
      consent: parseSiteConsentSettings(parsed.consent),
    };
    settingsCache.set(key, result);
    log.info(
      `[Settings] Loaded: ${i18n.supported_locales.length} locale(s), default="${i18n.default_locale}", home_page="${home_page.slug}", conversion_events=${tracking.conversion_events.length}, block_indexing=${robots.block_indexing}`
    );
    return result;
  } catch (err) {
    log.error({ err: err }, "[Settings] Failed to parse settings.yml, using defaults:");
    settingsCache.set(key, defaults);
    return defaults;
  }
}

export function getSettings(contentRoot?: string): SiteSettings {
  return loadSettings(contentRoot);
}

export function getSupportedLocales(contentRoot?: string): string[] {
  return loadSettings(contentRoot).i18n.supported_locales.map((l) => l.code);
}

export function getDefaultLocale(contentRoot?: string): string {
  return loadSettings(contentRoot).i18n.default_locale;
}

export function getLocaleLabel(code: string, contentRoot?: string): string | undefined {
  const entry = loadSettings(contentRoot).i18n.supported_locales.find((l) => l.code === code);
  return entry?.label;
}

export function getLocaleEntries(contentRoot?: string): LocaleEntry[] {
  return loadSettings(contentRoot).i18n.supported_locales;
}

export function getHomePage(contentRoot?: string): HomePageSettings {
  return loadSettings(contentRoot).home_page;
}

export function getConsentFallback(contentRoot?: string): string | null {
  return loadSettings(contentRoot).consent.fallback;
}

/**
 * Persist `consent.fallback` by patching settings.yml (preserves unrelated keys).
 * Pass null / empty to clear — forms then show no extra checkbox when channels are off.
 */
export function updateConsentFallback(fallback: string | null, contentRoot?: string): string | null {
  const normalized = fallback === null || fallback === "" ? null : normalizeConsentFallbackKey(fallback);
  if (fallback && fallback.trim() && !normalized) {
    throw new Error(`Invalid consent.fallback "${fallback}" — use a consent_* key`);
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const prev =
    existing.consent && typeof existing.consent === "object"
      ? { ...(existing.consent as Record<string, unknown>) }
      : {};
  if (normalized) {
    existing.consent = { ...prev, fallback: normalized };
  } else {
    delete prev.fallback;
    if (Object.keys(prev).length > 0) existing.consent = prev;
    else delete existing.consent;
  }

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(`[Settings] Updated consent.fallback=${normalized ?? "(none)"}`);
  return normalized;
}

export function normalizeLocale(locale: string | undefined | null, contentRoot?: string): string {
  const defaultLocale = getDefaultLocale(contentRoot);
  if (!locale) return defaultLocale;

  const lower = locale.toLowerCase().replace("_", "-");
  const supported = getSupportedLocales(contentRoot).map(c => c.toLowerCase());

  // Exact match first (handles both "es" and "es-mx" if explicitly in supported_locales)
  if (supported.includes(lower)) return lower;

  // If it's a regional locale (xx-xx), check if the base language is supported.
  // When the base is supported, preserve the full regional code so content loaders
  // can find es-mx.yml instead of falling back to es.yml.
  const dashIdx = lower.indexOf("-");
  if (dashIdx > 0) {
    const base = lower.slice(0, dashIdx);
    if (supported.includes(base)) return lower;
  }

  // Fall back to the base language alone
  const base = lower.split("-")[0];
  if (supported.includes(base)) return base;

  return defaultLocale;
}

export function updateLocaleSettings(input: {
  default_locale: string;
  supported_locales: LocaleEntry[];
}, contentRoot?: string): void {
  const { default_locale, supported_locales } = input;

  if (!Array.isArray(supported_locales) || supported_locales.length === 0) {
    throw new Error("At least one supported locale is required");
  }

  for (const entry of supported_locales) {
    if (typeof entry.code !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(entry.code)) {
      throw new Error(`Invalid locale code: "${entry.code}" — must be 2-3 lowercase letters, optionally followed by a region tag (e.g. es-MX)`);
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`Locale "${entry.code}" must have a non-empty label`);
    }
  }

  if (!supported_locales.some((l) => l.code === default_locale)) {
    throw new Error(`Default locale "${default_locale}" must be in the supported locales list`);
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  existing.i18n = {
    default_locale,
    supported_locales: supported_locales.map((l) => ({
      code: l.code,
      label: l.label.trim(),
    })),
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated: ${supported_locales.length} locale(s), default="${default_locale}"`
  );
}

export function resetSettings(contentRoot?: string): void {
  if (contentRoot) {
    settingsCache.delete(contentRoot);
  } else {
    settingsCache.clear();
  }
}

const IPN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Reject loopback / private / link-local hosts for egress destinations (SSRF guard). */
export function isBlockedIpnHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host === "0.0.0.0") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  // IPv6 unique-local / link-local (coarse)
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  return false;
}

/**
 * Normalize a destination base_url: https only, no query/hash, optional path prefix, no trailing slash.
 */
export function normalizeIpnBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid destination base_url: "${raw}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Destination base_url must use https://");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Destination base_url must not include query or hash");
  }
  if (isBlockedIpnHostname(parsed.hostname)) {
    throw new Error(`Destination host "${parsed.hostname}" is not allowed`);
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path === "/" ? "" : path}`;
}

export function validateIpnDestination(dest: { id: string; base_url: string }): IpnDestination {
  const id = typeof dest.id === "string" ? dest.id.trim() : "";
  if (!IPN_ID_RE.test(id)) {
    throw new Error(
      `Invalid destination id "${dest.id}" — use lowercase letters, digits, _ or - (max 64)`,
    );
  }
  const base_url = normalizeIpnBaseUrl(dest.base_url);
  return { id, base_url };
}

function parseIpNormalizationSettings(
  raw: Record<string, unknown> | undefined,
  defaults: IpNormalizationSettings,
): IpNormalizationSettings {
  const destinationsRaw = Array.isArray(raw?.destinations) ? raw!.destinations : defaults.destinations;
  const destinations: IpnDestination[] = [];
  const seen = new Set<string>();
  for (const entry of destinationsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.base_url !== "string") continue;
    try {
      const dest = validateIpnDestination({ id: e.id, base_url: e.base_url });
      if (seen.has(dest.id)) continue;
      seen.add(dest.id);
      destinations.push(dest);
    } catch {
      // Skip invalid entries on load; save path validates strictly
    }
  }
  // Legacy `secret` in settings.yml is ignored (env-only: IPN_SECRET).
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : defaults.enabled,
    destinations,
  };
}

export function getOptimizationSettings(contentRoot?: string): OptimizationSettings {
  return loadSettings(contentRoot).optimization;
}

export function getTrackingSettings(contentRoot?: string): TrackingSettings {
  return loadSettings(contentRoot).tracking;
}

export function getAuthConversionEventConfig(contentRoot?: string): AuthConversionEventConfig {
  const t = getTrackingSettings(contentRoot);
  return {
    signup_event_name: t.signup_event_name,
    login_event_name: t.login_event_name,
    signup_event_aliases: t.signup_event_aliases,
    login_event_aliases: t.login_event_aliases,
  };
}

export function getRobotsSettings(contentRoot?: string): RobotsSettings {
  return loadSettings(contentRoot).robots;
}

export function getSearchConsoleSettings(contentRoot?: string): SearchConsoleSettings {
  return loadSettings(contentRoot).search_console;
}

export function getEntryPreviewSettings(contentRoot?: string): EntryPreviewSettings {
  return loadSettings(contentRoot).entry_preview;
}

export function getAuthSettings(contentRoot?: string): AuthSettings {
  return loadSettings(contentRoot).auth;
}

/**
 * Persist Browser Run pacing to settings.yml → entry_preview (non-secret fields only).
 * Scrubs legacy credential keys if present on disk.
 */
export function updateEntryPreviewSettings(
  input: Partial<EntryPreviewSettings>,
  contentRoot?: string,
): EntryPreviewSettings {
  if (input.min_interval_ms !== undefined) {
    if (typeof input.min_interval_ms !== "number" || !Number.isFinite(input.min_interval_ms)) {
      throw new Error("min_interval_ms must be a number");
    }
    if (input.min_interval_ms < 0 || input.min_interval_ms > 120_000) {
      throw new Error("min_interval_ms must be between 0 and 120000");
    }
  }
  if (input.max_concurrency !== undefined) {
    if (typeof input.max_concurrency !== "number" || !Number.isFinite(input.max_concurrency)) {
      throw new Error("max_concurrency must be a number");
    }
    if (input.max_concurrency < 1 || input.max_concurrency > 8) {
      throw new Error("max_concurrency must be between 1 and 8");
    }
  }
  if (input.max_retries !== undefined) {
    if (typeof input.max_retries !== "number" || !Number.isFinite(input.max_retries)) {
      throw new Error("max_retries must be a number");
    }
    if (input.max_retries < 1 || input.max_retries > 20) {
      throw new Error("max_retries must be between 1 and 20");
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {
      /* ignore */
    }
  }

  const current = loadSettings(contentRoot).entry_preview;
  const updated: EntryPreviewSettings = {
    min_interval_ms:
      input.min_interval_ms !== undefined
        ? Math.floor(input.min_interval_ms)
        : current.min_interval_ms,
    max_concurrency:
      input.max_concurrency !== undefined
        ? Math.floor(input.max_concurrency)
        : current.max_concurrency,
    max_retries:
      input.max_retries !== undefined ? Math.floor(input.max_retries) : current.max_retries,
  };

  // Keep only rate fields; drop legacy secrets so they are not re-committed.
  existing.entry_preview = {
    min_interval_ms: updated.min_interval_ms,
    max_concurrency: updated.max_concurrency,
    max_retries: updated.max_retries,
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated entry_preview: min_interval_ms=${updated.min_interval_ms}, max_concurrency=${updated.max_concurrency}, max_retries=${updated.max_retries}`,
  );
  return updated;
}

/** Signup is available only when both a host (explicit or env fallback) and a signup path are configured. */
export function isSignupConfigured(contentRoot?: string): boolean {
  const auth = getAuthSettings(contentRoot);
  const host = auth.host || process.env.VITE_BREATHECODE_HOST;
  return !!(host && auth.signup?.path);
}

export function updateAuthSettings(
  input: Partial<AuthSettings> | null,
  contentRoot?: string,
): AuthSettings {
  const validateUrl = (value: string, field: string) => {
    try {
      new URL(value);
    } catch {
      throw new Error(`${field} must be a valid absolute URL`);
    }
  };
  const validatePathOrUrl = (value: string, field: string) => {
    if (value.startsWith("/")) return;
    validateUrl(value, field);
  };
  const validateMethod = (value: unknown, field: string) => {
    if (value === undefined || value === null || value === "") return;
    const m = parseAuthMethod(value);
    if (!m) throw new Error(`${field} must be "GET", "POST", or "PUT"`);
  };
  const validatePayload = (value: unknown, field: string) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${field} must be a plain object`);
    }
  };

  if (input) {
    if (input.host !== undefined && input.host !== "" && typeof input.host === "string") {
      validateUrl(input.host.trim(), "auth.host");
    }
    if (input.academy !== undefined && input.academy !== "" && typeof input.academy === "string") {
      const academy = input.academy.trim();
      if (!/^\d+$/.test(academy) && !/^[a-z0-9_-]+$/i.test(academy)) {
        throw new Error('auth.academy must be a numeric id or slug (e.g. "4")');
      }
    }
    if (input.login) {
      if (input.login.url !== undefined && input.login.url !== "") {
        validateUrl(String(input.login.url).trim(), "auth.login.url");
      }
      if (input.login.path !== undefined && input.login.path !== "") {
        validatePathOrUrl(String(input.login.path).trim(), "auth.login.path");
      }
      validateMethod(input.login.method, "auth.login.method");
      validatePayload(input.login.payload, "auth.login.payload");
    }
    if (input.signup) {
      if (input.signup.path !== undefined && input.signup.path !== "") {
        validatePathOrUrl(String(input.signup.path).trim(), "auth.signup.path");
      }
      validateMethod(input.signup.method, "auth.signup.method");
      // Legacy payload may still arrive; ignore for persistence (field_map is source of truth).
      if (input.signup.field_map !== undefined) {
        normalizeAuthSignupFieldMapInput(input.signup.field_map);
      }
    }
    if (input.profile) {
      if (input.profile.path !== undefined && input.profile.path !== "") {
        validatePathOrUrl(String(input.profile.path).trim(), "auth.profile.path");
      }
      validateMethod(input.profile.method, "auth.profile.method");
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  if (input === null) {
    delete existing.auth;
  } else {
    // Full replace with normalized nested shape from the request (merged with current for undefined sections).
    const current = loadSettings(contentRoot).auth;
    const mergeEndpoint = <T extends AuthEndpoint & { url?: string; payload?: Record<string, unknown> }>(
      incoming: T | undefined,
      prev: T | undefined,
      opts: { includeUrl?: boolean; includePayload?: boolean },
    ): T | undefined => {
      if (incoming === undefined) return prev;
      if (incoming === null) return undefined;

      const nextPath =
        incoming.path !== undefined
          ? (String(incoming.path ?? "").trim() || undefined)
          : prev?.path;
      const nextMethod =
        incoming.method !== undefined
          ? parseAuthMethod(incoming.method) ?? undefined
          : prev?.method;
      const nextUrl = opts.includeUrl
        ? incoming.url !== undefined
          ? (String(incoming.url ?? "").trim() || undefined)
          : prev?.url
        : undefined;
      const nextPayload = opts.includePayload
        ? incoming.payload !== undefined
          ? (incoming.payload ?? undefined)
          : prev?.payload
        : undefined;

      const next = {
        ...(nextPath ? { path: nextPath } : {}),
        ...(nextMethod ? { method: nextMethod } : {}),
        ...(opts.includeUrl && nextUrl ? { url: nextUrl } : {}),
        ...(opts.includePayload && nextPayload ? { payload: nextPayload } : {}),
      } as T;
      return Object.keys(next).length > 0 ? next : undefined;
    };

    const nextHost =
      input.host !== undefined
        ? (String(input.host ?? "").trim() || undefined)
        : current.host;

    const nextAcademy =
      input.academy !== undefined
        ? (String(input.academy ?? "").trim() || undefined)
        : current.academy;

    const nextLogin = mergeEndpoint(input.login, current.login, { includeUrl: true, includePayload: true });
    // Signup: persist field_map; do not write legacy payload.
    let nextSignup: AuthSettings["signup"] | undefined;
    if (input.signup === undefined) {
      nextSignup = current.signup
        ? {
            ...(current.signup.path ? { path: current.signup.path } : {}),
            ...(current.signup.method ? { method: current.signup.method } : {}),
            ...(current.signup.field_map?.length
              ? { field_map: current.signup.field_map }
              : {}),
          }
        : undefined;
    } else {
      const nextPath =
        input.signup.path !== undefined
          ? (String(input.signup.path ?? "").trim() || undefined)
          : current.signup?.path;
      const nextMethod =
        input.signup.method !== undefined
          ? parseAuthMethod(input.signup.method) ?? undefined
          : current.signup?.method;
      const nextFieldMap =
        input.signup.field_map !== undefined
          ? normalizeAuthSignupFieldMapInput(input.signup.field_map)
          : current.signup?.field_map ?? [];
      nextSignup =
        nextPath || nextMethod || nextFieldMap.length > 0
          ? {
              ...(nextPath ? { path: nextPath } : {}),
              ...(nextMethod ? { method: nextMethod } : {}),
              ...(nextFieldMap.length > 0 ? { field_map: nextFieldMap } : {}),
            }
          : undefined;
    }
    const nextProfile = mergeEndpoint(input.profile, current.profile, {});

    const next: AuthSettings = {
      ...(nextHost ? { host: nextHost } : {}),
      ...(nextAcademy ? { academy: nextAcademy } : {}),
      ...(nextLogin ? { login: nextLogin } : {}),
      ...(nextSignup ? { signup: nextSignup } : {}),
      ...(nextProfile ? { profile: nextProfile } : {}),
    };

    if (Object.keys(next).length === 0) {
      delete existing.auth;
    } else {
      existing.auth = next;
    }
  }

  const dumped = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  const output = injectAuthYamlComments(dumped);
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  const updated = loadSettings(contentRoot).auth;
  log.info(
    `[Settings] Updated auth: host="${updated.host ?? ""}", academy="${updated.academy ?? ""}", login.path="${updated.login?.path ?? ""}", signup.path="${updated.signup?.path ?? ""}", profile.path="${updated.profile?.path ?? ""}"`,
  );
  return updated;
}

export function isIndexingBlocked(contentRoot?: string): boolean {
  return loadSettings(contentRoot).robots.block_indexing;
}

/** When sitewide indexing is blocked, always return noindex; otherwise use pageRobots or default. */
export function resolveEffectiveRobots(
  pageRobots: string | undefined | null,
  contentRoot?: string,
): string {
  if (isIndexingBlocked(contentRoot)) return "noindex, nofollow";
  return typeof pageRobots === "string" && pageRobots.trim()
    ? pageRobots
    : "index, follow";
}

export function updateRobotsSettings(input: Partial<RobotsSettings>, contentRoot?: string): RobotsSettings {
  if (input.block_indexing !== undefined && typeof input.block_indexing !== "boolean") {
    throw new Error("block_indexing must be a boolean");
  }
  if (input.include_sitemap !== undefined && typeof input.include_sitemap !== "boolean") {
    throw new Error("include_sitemap must be a boolean");
  }
  if (input.disallow_paths !== undefined) {
    if (!Array.isArray(input.disallow_paths)) {
      throw new Error("disallow_paths must be an array of strings");
    }
    for (const p of input.disallow_paths) {
      if (typeof p !== "string" || !p.trim()) {
        throw new Error("Each disallow path must be a non-empty string");
      }
      if (!p.trim().startsWith("/")) {
        throw new Error(`Disallow path must start with /: "${p}"`);
      }
    }
  }
  if (input.ai_bots !== undefined) {
    if (!Array.isArray(input.ai_bots)) {
      throw new Error("ai_bots must be an array of strings");
    }
    for (const b of input.ai_bots) {
      if (typeof b !== "string" || !b.trim()) {
        throw new Error("Each AI bot name must be a non-empty string");
      }
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const current = loadSettings(contentRoot).robots;
  const updated: RobotsSettings = {
    block_indexing: typeof input.block_indexing === "boolean" ? input.block_indexing : current.block_indexing,
    include_sitemap: typeof input.include_sitemap === "boolean" ? input.include_sitemap : current.include_sitemap,
    disallow_paths: Array.isArray(input.disallow_paths)
      ? input.disallow_paths.map((p) => p.trim()).filter(Boolean)
      : [...current.disallow_paths],
    ai_bots: Array.isArray(input.ai_bots)
      ? input.ai_bots.map((b) => b.trim()).filter(Boolean)
      : [...current.ai_bots],
  };

  existing.robots = {
    block_indexing: updated.block_indexing,
    include_sitemap: updated.include_sitemap,
    disallow_paths: updated.disallow_paths,
    ai_bots: updated.ai_bots,
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated robots: block_indexing=${updated.block_indexing}, include_sitemap=${updated.include_sitemap}, disallow_paths=${updated.disallow_paths.length}, ai_bots=${updated.ai_bots.length}`
  );
  return updated;
}

export function updateSearchConsoleSettings(
  input: { site_url: string },
  contentRoot?: string,
): SearchConsoleSettings {
  const siteUrl = normalizeSearchConsoleSiteUrl(input.site_url);
  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const current = parseSearchConsoleSettings(existing.search_console);
  const updated: SearchConsoleSettings = { ...current, site_url: siteUrl };
  writeSearchConsoleBlock(existing, updated);

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(`[Settings] Updated search_console.site_url=${siteUrl}`);
  return updated;
}

export function updateSearchConsoleBigQuerySettings(
  input: Partial<SearchConsoleBigQuerySettings>,
  contentRoot?: string,
): SearchConsoleSettings {
  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const current = parseSearchConsoleSettings(existing.search_console);
  const merged = parseSearchConsoleBigQuerySettings(
    { ...current.bigquery, ...input },
    DEFAULT_SEARCH_CONSOLE_BIGQUERY,
  );
  if (merged.enabled && (!merged.project_id || !merged.dataset_id)) {
    throw new Error(
      "search_console.bigquery.project_id and dataset_id are required when enabled",
    );
  }
  if (merged.url_impression_table && /[^a-zA-Z0-9_]/.test(merged.url_impression_table)) {
    throw new Error("url_impression_table must be alphanumeric/underscore");
  }
  if (merged.export_log_table && /[^a-zA-Z0-9_]/.test(merged.export_log_table)) {
    throw new Error("export_log_table must be alphanumeric/underscore");
  }

  const updated: SearchConsoleSettings = { ...current, bigquery: merged };
  writeSearchConsoleBlock(existing, updated);

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated search_console.bigquery enabled=${merged.enabled} project=${merged.project_id || "(empty)"}`,
  );
  return updated;
}

export function updateTrackingSettings(input: {
  conversion_events?: ConversionEventEntry[];
  webhook?: { url: string; method?: string; auth_header?: string } | null;
  leads_expected_conversion_names?: string[];
  leads_expected_tags?: string[];
  bigquery?: Partial<TrackingBigQuerySettings>;
  signup_event_name?: string;
  login_event_name?: string;
  signup_event_aliases?: string[];
  login_event_aliases?: string[];
}, contentRoot?: string): void {
  if (input.conversion_events !== undefined && !Array.isArray(input.conversion_events)) {
    throw new Error("conversion_events must be an array");
  }

  if (input.conversion_events !== undefined) {
    for (const entry of input.conversion_events) {
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        throw new Error("Each conversion event must have a non-empty name");
      }
      if (!/^[a-z][a-z0-9_]*$/.test(entry.name.trim())) {
        throw new Error(`Invalid conversion event name: "${entry.name}" — use lowercase letters, digits, and underscores only`);
      }
      const intentErr = validateConversionEventIntent(entry);
      if (intentErr) throw new Error(intentErr);
    }
  }

  if (input.webhook !== undefined && input.webhook !== null) {
    if (typeof input.webhook.url !== "string" || !input.webhook.url.trim()) {
      throw new Error("webhook.url must be a non-empty string");
    }
    if (input.webhook.method !== undefined && !["POST", "GET"].includes(input.webhook.method)) {
      throw new Error('webhook.method must be "POST" or "GET"');
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const currentTracking = (existing.tracking as Record<string, unknown>) || {};

  const nextTracking: Record<string, unknown> = { ...currentTracking };

  if (input.conversion_events !== undefined) {
    nextTracking.conversion_events = input.conversion_events.map((e) => {
      const serialized: Record<string, unknown> = { name: e.name.trim() };
      if (e.description?.trim()) serialized.description = e.description.trim();
      serialized.when_to_use = e.when_to_use!.trim();
      serialized.when_not_to_use = e.when_not_to_use!.trim();
      if (e.automations?.trim()) serialized.automations = e.automations.trim();
      if (e.tags && e.tags.length > 0) serialized.tags = e.tags;
      if (e.consent && Object.keys(e.consent).length > 0) serialized.consent = e.consent;
      if (e.webhook?.url?.trim()) {
        serialized.webhook = {
          url: e.webhook.url.trim(),
          method: e.webhook.method ?? "POST",
          ...(e.webhook.auth_header?.trim() ? { auth_header: e.webhook.auth_header.trim() } : {}),
        };
      }
      if (e.success?.message?.trim() || e.success?.url?.trim()) {
        serialized.success = {
          ...(e.success.message?.trim() ? { message: e.success.message.trim() } : {}),
          ...(e.success.url?.trim() ? { url: e.success.url.trim() } : {}),
        };
      }
      return serialized;
    });
  }

  if (input.webhook !== undefined) {
    if (input.webhook === null) {
      delete nextTracking.webhook;
    } else {
      nextTracking.webhook = {
        url: input.webhook.url.trim(),
        method: input.webhook.method ?? "POST",
        ...(input.webhook.auth_header ? { auth_header: input.webhook.auth_header.trim() } : {}),
      };
    }
  }

  if (input.leads_expected_conversion_names !== undefined) {
    const cleaned = input.leads_expected_conversion_names
      .filter((t) => typeof t === "string" && !!t.trim())
      .map((t) => t.trim());
    if (cleaned.length > 0) nextTracking.leads_expected_conversion_names = cleaned;
    else delete nextTracking.leads_expected_conversion_names;
  }

  if (input.leads_expected_tags !== undefined) {
    const cleaned = input.leads_expected_tags
      .filter((t) => typeof t === "string" && !!t.trim())
      .map((t) => t.trim());
    if (cleaned.length > 0) nextTracking.leads_expected_tags = cleaned;
    else delete nextTracking.leads_expected_tags;
  }

  if (input.bigquery !== undefined) {
    const currentBq = parseTrackingBigQuerySettings(
      currentTracking.bigquery,
      DEFAULT_TRACKING_BIGQUERY,
    );
    const merged = parseTrackingBigQuerySettings(
      { ...currentBq, ...input.bigquery },
      DEFAULT_TRACKING_BIGQUERY,
    );
    if (merged.enabled && (!merged.project_id || !merged.dataset_id)) {
      throw new Error("bigquery.project_id and bigquery.dataset_id are required when enabled");
    }
    if (merged.table_prefix && /[^a-zA-Z0-9_]/.test(merged.table_prefix.replace(/_$/, ""))) {
      throw new Error("bigquery.table_prefix must be alphanumeric/underscore (e.g. events_)");
    }
    nextTracking.bigquery = {
      enabled: merged.enabled,
      project_id: merged.project_id,
      dataset_id: merged.dataset_id,
      location: merged.location,
      table_prefix: merged.table_prefix,
    };
  }

  // Auth signup/login GTM event names (+ rename aliases)
  const currentAuth = parseAuthConversionEventConfig(currentTracking, DEFAULT_AUTH_CONVERSION_EVENTS);
  let nextAuth: AuthConversionEventConfig = { ...currentAuth };
  const authNameTouched =
    input.signup_event_name !== undefined ||
    input.login_event_name !== undefined ||
    input.signup_event_aliases !== undefined ||
    input.login_event_aliases !== undefined;

  if (authNameTouched) {
    let signupName = currentAuth.signup_event_name;
    let loginName = currentAuth.login_event_name;
    let signupAliases = [...currentAuth.signup_event_aliases];
    let loginAliases = [...currentAuth.login_event_aliases];

    if (typeof input.signup_event_name === "string" && input.signup_event_name.trim()) {
      const next = input.signup_event_name.trim();
      signupAliases = appendAliasOnRename(signupName, next, signupAliases);
      signupName = next;
    }
    if (typeof input.login_event_name === "string" && input.login_event_name.trim()) {
      const next = input.login_event_name.trim();
      loginAliases = appendAliasOnRename(loginName, next, loginAliases);
      loginName = next;
    }
    if (input.signup_event_aliases !== undefined) {
      signupAliases = Array.isArray(input.signup_event_aliases)
        ? input.signup_event_aliases
            .filter((t): t is string => typeof t === "string" && !!t.trim())
            .map((t) => t.trim())
        : signupAliases;
    }
    if (input.login_event_aliases !== undefined) {
      loginAliases = Array.isArray(input.login_event_aliases)
        ? input.login_event_aliases
            .filter((t): t is string => typeof t === "string" && !!t.trim())
            .map((t) => t.trim())
        : loginAliases;
    }

    nextAuth = {
      signup_event_name: signupName,
      login_event_name: loginName,
      signup_event_aliases: signupAliases,
      login_event_aliases: loginAliases,
    };
    const authErr = validateAuthConversionEventConfig(nextAuth);
    if (authErr) throw new Error(authErr);
  }

  nextTracking.signup_event_name = nextAuth.signup_event_name;
  nextTracking.login_event_name = nextAuth.login_event_name;
  nextTracking.signup_event_aliases = nextAuth.signup_event_aliases;
  nextTracking.login_event_aliases = nextAuth.login_event_aliases;

  // Ensure catalog rows for canonical auth event names
  {
    const eventsRaw = nextTracking.conversion_events;
    let events: ConversionEventEntry[] = Array.isArray(eventsRaw)
      ? (eventsRaw as ConversionEventEntry[]).filter(
          (e) => e && typeof e === "object" && typeof (e as ConversionEventEntry).name === "string",
        )
      : [];

    const ensureCanonical = (
      name: string,
      intent: { description: string; when_to_use: string; when_not_to_use: string },
    ) => {
      if (events.some((e) => e.name === name)) return;
      events = [
        ...events,
        {
          name,
          description: intent.description,
          when_to_use: intent.when_to_use,
          when_not_to_use: intent.when_not_to_use,
        },
      ];
    };
    ensureCanonical(nextAuth.signup_event_name, DEFAULT_SIGNUP_EVENT_INTENT);
    ensureCanonical(nextAuth.login_event_name, DEFAULT_LOGIN_EVENT_INTENT);
    nextTracking.conversion_events = events;
  }

  existing.tracking = nextTracking;

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  if (input.conversion_events !== undefined) {
    log.info(`[Settings] Updated tracking.conversion_events: ${input.conversion_events.length} event(s)`);
  }
  if (input.webhook !== undefined) {
    log.info(`[Settings] Updated tracking.webhook: ${input.webhook ? input.webhook.url : "(cleared)"}`);
  }
  if (authNameTouched) {
    log.info(
      `[Settings] Updated auth conversion events: signup=${nextAuth.signup_event_name} login=${nextAuth.login_event_name}`,
    );
  }
}

export function updateOptimizationSettings(
  input: {
    tagmanager?: Partial<TagManagerSettings>;
    ip_normalization?: Partial<IpNormalizationSettings>;
  },
  contentRoot?: string,
): void {
  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const currentOpt = loadSettings(contentRoot).optimization;
  const current = currentOpt.tagmanager;
  const tm = input.tagmanager ?? {};
  const updated: TagManagerSettings = {
    web_container_id:
      typeof tm.web_container_id === "string" ? tm.web_container_id.trim() : current.web_container_id,
    sgtm_enabled: typeof tm.sgtm_enabled === "boolean" ? tm.sgtm_enabled : current.sgtm_enabled,
    sgtm_server_url: typeof tm.sgtm_server_url === "string" ? tm.sgtm_server_url : current.sgtm_server_url,
    sgtm_proxy_path: typeof tm.sgtm_proxy_path === "string" ? tm.sgtm_proxy_path : current.sgtm_proxy_path,
  };

  if (updated.web_container_id && !/^GTM-[A-Z0-9]+$/.test(updated.web_container_id)) {
    throw new Error("Web container ID must match GTM-XXXXX (uppercase letters and digits)");
  }

  // Validate proxy path — must start with /, be more than just /, and contain a meaningful segment
  const pPath = updated.sgtm_proxy_path;
  if (!pPath.startsWith("/")) {
    throw new Error("Proxy path must start with /");
  }
  // Reject bare root path which would claim all routes
  const normalizedForValidation = pPath.replace(/\/$/, "") || "/";
  if (normalizedForValidation === "/" || normalizedForValidation === "") {
    throw new Error("Proxy path must not be / — use a specific path like /sgtm/");
  }
  // Ensure no path traversal or unsafe characters
  if (/[?#\s]/.test(pPath)) {
    throw new Error("Proxy path must not contain ?, #, or whitespace");
  }

  const currentIpn = currentOpt.ip_normalization;
  const ipnIn = input.ip_normalization;
  let updatedIpn: IpNormalizationSettings = { ...currentIpn, destinations: [...currentIpn.destinations] };
  if (ipnIn) {
    if (typeof ipnIn.enabled === "boolean") {
      updatedIpn.enabled = ipnIn.enabled;
    }
    if (Array.isArray(ipnIn.destinations)) {
      const seen = new Set<string>();
      const destinations: IpnDestination[] = [];
      for (const d of ipnIn.destinations) {
        const dest = validateIpnDestination(d);
        if (seen.has(dest.id)) {
          throw new Error(`Duplicate destination id "${dest.id}"`);
        }
        seen.add(dest.id);
        destinations.push(dest);
      }
      updatedIpn.destinations = destinations;
    }
  }

  // Omit secret so legacy settings.yml secrets are scrubbed on next optimization write.
  existing.optimization = {
    tagmanager: {
      web_container_id: updated.web_container_id,
      sgtm_enabled: updated.sgtm_enabled,
      sgtm_server_url: updated.sgtm_server_url,
      sgtm_proxy_path: updated.sgtm_proxy_path,
    },
    ip_normalization: {
      enabled: updatedIpn.enabled,
      destinations: updatedIpn.destinations,
    },
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated optimization: web="${updated.web_container_id}", sgtm=${updated.sgtm_enabled}, ipn=${updatedIpn.enabled}, destinations=${updatedIpn.destinations.length}`,
  );
}

