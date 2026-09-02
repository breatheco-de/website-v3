import { z } from "zod";
import { isJunkRuntimeNotFoundPath } from "./safe-href";

export const RUNTIME_ISSUE_KINDS = ["http.not_found"] as const;
export type RuntimeIssueKind = (typeof RUNTIME_ISSUE_KINDS)[number];

export const runtimeIssueKindSchema = z.enum(RUNTIME_ISSUE_KINDS);

export const RUNTIME_SOURCE_TAGS = [
  "search_crawler",
  "llm_crawler",
  "social_preview",
  "search_referrer",
  "llm_referrer",
  "internal",
  "human",
  "scraper",
] as const;
export type RuntimeSourceTag = (typeof RUNTIME_SOURCE_TAGS)[number];

export const SOURCE_LABELS: Record<RuntimeSourceTag, string> = {
  search_crawler: "Search crawler",
  llm_crawler: "LLM crawler",
  social_preview: "Social preview",
  search_referrer: "Google / Bing SERP",
  llm_referrer: "LLM click",
  internal: "Internal",
  human: "Human",
  scraper: "Scraper",
};

export const SOURCE_EXPLANATIONS: Record<RuntimeSourceTag, string> = {
  search_crawler:
    "Googlebot, Bing, Applebot, or another search crawler fetched this URL (User-Agent), not a person clicking a result.",
  llm_crawler:
    "An AI crawler (GPTBot, ClaudeBot, Perplexity, Bytespider, and similar) requested this URL.",
  social_preview:
    "A social app fetched a link preview (Facebook, X, LinkedIn, Slack, WhatsApp, Discord).",
  search_referrer:
    "A person clicked through from Google or Bing. The referrer is the search engine; the User-Agent looks like a browser.",
  llm_referrer: "A person clicked through from ChatGPT, Claude, Perplexity, or Copilot.",
  internal:
    "The referrer was a 4Geeks host (4geeks.com, *.4geeks.com, or academy). File 404s with this tag are recorded as broken internal or old assets.",
  human: "A browser User-Agent that was not classified as a crawler or scraper.",
  scraper:
    "An SEO scraper, HTTP client (curl/wget), or headless tool. Hide scrapers skips recording new hits like these.",
};

const SEO_SAMPLE_TAGS = new Set<string>([
  "search_crawler",
  "llm_crawler",
  "social_preview",
  "search_referrer",
  "llm_referrer",
]);

/** Hard-drop probe paths (exact, `prefix/…`, or `prefix.…` e.g. `/.env.production`). */
const HARD_DROP_PATH_PREFIXES = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/xmlrpc.php",
  "/phpmyadmin",
  "/.aws",
  "/vendor/phpunit",
  "/actuator",
  "/cgi-bin",
  "/.well-known",
  "/.vite",
  "/dist",
  "/build",
  "/graphql",
  "/v1/graphql",
];

const HARD_DROP_PATH_EXACT = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/graphql",
  "/v1/graphql",
]);

const SEARCH_CRAWLER_UA_RE =
  /googlebot|google-inspectiontool|adsbot-google|bingbot|bingpreview|duckduckbot|applebot|yandex(?:bot)?|baiduspider|\bslurp\b/i;

const LLM_CRAWLER_UA_RE =
  /gptbot|chatgpt-user|claudebot|perplexitybot|google-extended|bytespider|amazonbot|anthropic-ai|claude-web/i;

const SOCIAL_PREVIEW_UA_RE =
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|whatsapp|discordbot/i;

const SCRAPER_UA_RE =
  /ahrefs|semrush|mj12bot|dotbot|petalbot|scrapy|curl\/|wget\/|python-requests|go-http-client|\bjava\/|libwww|httpclient|headlesschrome/i;

const UPTIME_UA_RE = /monitor|uptime|pingdom|statuscake|synthetic/i;

const SEARCH_REFERRER_HOST_RE = /(^|\.)google(\.[a-z]{2,})+$|(^|\.)bing\.com$/i;
const LLM_REFERRER_HOST_RE =
  /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|(^|\.)perplexity\.ai$|(^|\.)copilot\.microsoft\.com$|(^|\.)claude\.ai$/i;

const ROOT_VITE_HASH_ASSET_RE = /^\/[^/]+-[A-Za-z0-9_-]{7,14}\.(?:js|mjs|cjs|css)$/i;

const ASSET_EXT_RE =
  /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|json|xml|txt|csv|zip|gz|tgz|tar|rar|7z|php|asp|aspx|jsp|cgi|env|bak|md|yml|yaml|wasm)(?:\.(?:map|gz|br))?$/i;

export function stripQueryAndHash(urlOrPath: string): string {
  const noHash = urlOrPath.split("#")[0] ?? urlOrPath;
  return noHash.split("?")[0] ?? noHash;
}

/** Pathname only: strip query/hash, ensure leading slash, collapse trailing slash (except `/`). */
export function normalizeRuntimePath(urlOrPath: string): string {
  let raw = stripQueryAndHash(urlOrPath).trim();
  if (!raw) return "/";
  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).pathname || "/";
    }
  } catch {
    // keep raw
  }
  if (!raw.startsWith("/")) raw = `/${raw}`;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep encoded
  }
  if (raw.length > 1 && raw.endsWith("/")) {
    raw = raw.slice(0, -1);
  }
  return raw || "/";
}

/** Last path segment looks like a static file (.js, images, fonts, maps, …). */
export function isAssetPath(path: string): boolean {
  const trimmed = stripQueryAndHash(path);
  const last = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return ASSET_EXT_RE.test(last);
}

export function isRootViteHashAsset(path: string): boolean {
  return ROOT_VITE_HASH_ASSET_RE.test(normalizeRuntimePath(path));
}

/** Two-letter first segment (`/es/blog` → `es`). Null when the path has no locale prefix. */
export function localePrefixFromPath(pathname: string): string | null {
  const path = normalizeRuntimePath(pathname);
  const m = path.match(/^\/([a-z]{2})(?:\/|$)/i);
  if (m?.[1]) return m[1].toLowerCase();
  return null;
}

/** Locale for storage/filter: path prefix, or `en` when the URL is not locale-prefixed. */
export function localeFromPath(pathname: string): string {
  return localePrefixFromPath(pathname) ?? "en";
}

export function stripReferrerQuery(referrer: string | undefined | null): string | undefined {
  if (!referrer || !referrer.trim()) return undefined;
  try {
    if (/^https?:\/\//i.test(referrer)) {
      const u = new URL(referrer);
      return `${u.origin}${u.pathname}`;
    }
  } catch {
    // fall through
  }
  return stripQueryAndHash(referrer.trim()) || undefined;
}

export function referrerHostname(referrer: string | undefined | null): string | undefined {
  if (!referrer || !referrer.trim()) return undefined;
  try {
    if (/^https?:\/\//i.test(referrer)) {
      return new URL(referrer).hostname.toLowerCase();
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function is4geeksReferrerHost(referrer: string | undefined | null): boolean {
  const host = referrerHostname(referrer);
  if (!host) return false;
  return (
    host === "4geeks.com" ||
    host.endsWith(".4geeks.com") ||
    host === "4geeksacademy.com" ||
    host.endsWith(".4geeksacademy.com")
  );
}

function isSearchReferrerHost(host: string): boolean {
  const h = host.replace(/^www\./, "");
  return SEARCH_REFERRER_HOST_RE.test(h);
}

function isLlmReferrerHost(host: string): boolean {
  const h = host.replace(/^www\./, "");
  return LLM_REFERRER_HOST_RE.test(h);
}

export type UaBucket =
  | "search_crawler"
  | "llm_crawler"
  | "social_preview"
  | "scraper"
  | "likely_bot"
  | "mobile"
  | "desktop"
  | "unknown"
  | "bot";

export type HourCounts = Record<string, number>;
export type ByHour = Record<string, HourCounts>;

export interface ClassifyRuntimeHitResult {
  tags: RuntimeSourceTag[];
  uaBucket: UaBucket;
  likelyBot: boolean;
}

export function classifyRuntimeHit(
  path: string,
  ua: string | undefined | null,
  referrer: string | undefined | null,
): ClassifyRuntimeHitResult {
  const tags = new Set<RuntimeSourceTag>();
  const agent = ua?.trim() ?? "";
  let uaBucket: UaBucket = "unknown";
  let likelyBot = false;

  if (agent) {
    if (SEARCH_CRAWLER_UA_RE.test(agent)) {
      tags.add("search_crawler");
      uaBucket = "search_crawler";
    } else if (LLM_CRAWLER_UA_RE.test(agent)) {
      tags.add("llm_crawler");
      uaBucket = "llm_crawler";
    } else if (SOCIAL_PREVIEW_UA_RE.test(agent)) {
      tags.add("social_preview");
      uaBucket = "social_preview";
    } else if (SCRAPER_UA_RE.test(agent)) {
      tags.add("scraper");
      uaBucket = "scraper";
      likelyBot = true;
    } else if (UPTIME_UA_RE.test(agent)) {
      tags.add("scraper");
      uaBucket = "likely_bot";
      likelyBot = true;
    } else if (/mobile|android|iphone|ipad/i.test(agent)) {
      tags.add("human");
      uaBucket = "mobile";
    } else if (/mozilla|chrome|safari|firefox|edg\//i.test(agent)) {
      tags.add("human");
      uaBucket = "desktop";
    }
  }

  const host = referrerHostname(referrer);
  if (host) {
    if (is4geeksReferrerHost(referrer)) tags.add("internal");
    if (uaBucket === "mobile" || uaBucket === "desktop" || uaBucket === "unknown") {
      if (isSearchReferrerHost(host)) tags.add("search_referrer");
      if (isLlmReferrerHost(host)) tags.add("llm_referrer");
    }
  }

  return { tags: Array.from(tags), uaBucket, likelyBot };
}

export function bucketUserAgent(ua: string | undefined | null): UaBucket {
  return classifyRuntimeHit("/", ua, undefined).uaBucket;
}

export function isLikelyBotUa(ua: string | undefined | null): boolean {
  if (!ua) return false;
  return classifyRuntimeHit("/", ua, undefined).likelyBot;
}

export function hitHasSeoSignal(tags: readonly string[]): boolean {
  return tags.some((t) => SEO_SAMPLE_TAGS.has(t));
}

export function shouldHardDropNotFound(
  path: string,
  ua: string | undefined | null,
  referrer?: string | null,
  dropScrapers = true,
): boolean {
  const p = normalizeRuntimePath(path).toLowerCase();
  if (HARD_DROP_PATH_EXACT.has(p)) return true;
  if (isJunkRuntimeNotFoundPath(p)) return true;
  for (const prefix of HARD_DROP_PATH_PREFIXES) {
    // `/.env` must also match `/.env.production` (dot suffix), not only `/.env/…`
    if (p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix + ".")) return true;
  }
  if (isRootViteHashAsset(p)) return true;

  const classified = classifyRuntimeHit(p, ua, referrer);
  if (
    dropScrapers &&
    (classified.uaBucket === "scraper" || classified.uaBucket === "likely_bot" || classified.likelyBot)
  ) {
    return true;
  }

  if (isAssetPath(p) && !is4geeksReferrerHost(referrer)) return true;
  return false;
}

export function fingerprintNotFound(site: string, locale: string, path: string): string {
  const normalized = normalizeRuntimePath(path);
  const loc = (locale || localeFromPath(normalized)).toLowerCase();
  return `http.not_found|${site}|${loc}|${normalized}`;
}

export function utcHourKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
}

export function utcHourKeyToMs(key: string): number {
  const m = key.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})$/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}:00:00.000Z`);
}

export function incrementByHour(
  byHour: ByHour | undefined,
  ts: number,
  tags: readonly string[],
): ByHour {
  const key = utcHourKey(ts);
  const next: ByHour = { ...(byHour ?? {}) };
  const prev = next[key] ?? { total: 0 };
  const bucket: HourCounts = { ...prev };
  bucket.total = (bucket.total ?? 0) + 1;
  for (const tag of tags) {
    if (!tag || tag === "total") continue;
    bucket[tag] = (bucket[tag] ?? 0) + 1;
  }
  next[key] = bucket;
  return next;
}

export function sumByHourTotals(byHour: ByHour | undefined): number {
  if (!byHour) return 0;
  let sum = 0;
  for (const bucket of Object.values(byHour)) {
    sum += bucket.total ?? 0;
  }
  return sum;
}

export function localYmd(ts: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function addCivilDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + delta));
  return dt.toISOString().slice(0, 10);
}

export function localDateKeysInWindow(now: number, timeZone: string, windowDays: number): Set<string> {
  const today = localYmd(now, timeZone);
  const keys = new Set<string>();
  const days = Math.max(1, windowDays);
  for (let i = 0; i < days; i++) {
    keys.add(addCivilDays(today, -i));
  }
  return keys;
}

export function windowHitCount(
  issue: { byHour?: ByHour; count: number; lastSeen: number },
  windowDays: number,
  timeZone: string,
  now = Date.now(),
  tag?: string,
): number {
  const days = localDateKeysInWindow(now, timeZone, windowDays);
  const byHour = issue.byHour;
  if (!byHour || Object.keys(byHour).length === 0) {
    if (tag && tag !== "total") return 0;
    return days.has(localYmd(issue.lastSeen, timeZone)) ? issue.count : 0;
  }
  let sum = 0;
  for (const [hourKey, bucket] of Object.entries(byHour)) {
    const ts = utcHourKeyToMs(hourKey);
    if (Number.isNaN(ts)) continue;
    if (!days.has(localYmd(ts, timeZone))) continue;
    if (!tag || tag === "total") sum += bucket.total ?? 0;
    else sum += bucket[tag] ?? 0;
  }
  return sum;
}

export type DailyHitCount = { day: string; count: number };

function sourceTagForAggregation(source?: string): string | undefined {
  if (!source || source === "total" || source === "__all__") return undefined;
  return source;
}

/** One point per civil day in the window, oldest → newest. Matches windowHitCount semantics. */
export function aggregateHitsByDay(
  issues: Array<{ byHour?: ByHour; count: number; lastSeen: number }>,
  opts: { windowDays: number; tz: string; now?: number; source?: string },
): DailyHitCount[] {
  const now = opts.now ?? Date.now();
  const tz = opts.tz || "UTC";
  const windowDays = opts.windowDays || 30;
  const tag = sourceTagForAggregation(opts.source);
  const dayKeys = [...localDateKeysInWindow(now, tz, windowDays)].sort();
  const counts = new Map(dayKeys.map((d) => [d, 0]));

  for (const issue of issues) {
    const byHour = issue.byHour;
    if (!byHour || Object.keys(byHour).length === 0) {
      if (tag) continue;
      const day = localYmd(issue.lastSeen, tz);
      if (!counts.has(day)) continue;
      counts.set(day, (counts.get(day) ?? 0) + issue.count);
      continue;
    }
    for (const [hourKey, bucket] of Object.entries(byHour)) {
      const ts = utcHourKeyToMs(hourKey);
      if (Number.isNaN(ts)) continue;
      const day = localYmd(ts, tz);
      if (!counts.has(day)) continue;
      const n = !tag ? (bucket.total ?? 0) : (bucket[tag] ?? 0);
      counts.set(day, (counts.get(day) ?? 0) + n);
    }
  }

  return dayKeys.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

export function pruneIssueHours(
  issue: RuntimeIssueRecord,
  now = Date.now(),
): RuntimeIssueRecord {
  if (!issue.byHour) return issue;
  const cutoff = now - ISSUE_TTL_MS;
  const next: ByHour = {};
  for (const [key, bucket] of Object.entries(issue.byHour)) {
    const ts = utcHourKeyToMs(key);
    if (!Number.isNaN(ts) && ts >= cutoff) next[key] = bucket;
  }
  return {
    ...issue,
    byHour: next,
    count: sumByHourTotals(next) || issue.count,
  };
}

export function unionSources(existing: string[] | undefined, tags: readonly string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...tags]));
}

export type RuntimeQueryAttribution = {
  source?: string[];
  medium?: string[];
  campaign?: string[];
  other?: Record<string, string[]>;
};

export const STAFF_QUERY_KEYS = new Set([
  "force_variant",
  "variant",
  "edit",
  "edit_mode",
  "debug",
  "__site",
]);

const SENSITIVE_QUERY_KEY_PARTS = [
  "token",
  "password",
  "secret",
  "email",
  "auth",
  "code",
  "apikey",
  "api_key",
  "session",
  "credential",
] as const;

export const QUERY_ATTRIBUTION_MAX_VALUES_PER_KEY = 8;
export const QUERY_ATTRIBUTION_MAX_VALUE_LEN = 120;

function decodeQueryValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

function truncateQueryValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= QUERY_ATTRIBUTION_MAX_VALUE_LEN) return trimmed;
  return `${trimmed.slice(0, QUERY_ATTRIBUTION_MAX_VALUE_LEN)}…`;
}

export function isSensitiveQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_QUERY_KEY_PARTS.some((part) => lower.includes(part));
}

export function hasStaffQueryParams(search: string | undefined | null): boolean {
  if (!search?.trim()) return false;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw.trim()) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return false;
  }
  for (const [key, value] of params.entries()) {
    const k = key.toLowerCase();
    if (STAFF_QUERY_KEYS.has(k)) return true;
    if (k === "cache" && value.toLowerCase() === "false") return true;
  }
  return false;
}

function unionStringArrays(
  a: string[] | undefined,
  b: string[] | undefined,
  maxPerKey: number,
): string[] | undefined {
  const merged = Array.from(new Set([...(a ?? []), ...(b ?? [])])).filter(Boolean);
  if (merged.length === 0) return undefined;
  return merged.slice(0, maxPerKey);
}

function unionOtherMaps(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
  maxPerKey: number,
): Record<string, string[]> | undefined {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  if (keys.size === 0) return undefined;
  const next: Record<string, string[]> = {};
  for (const key of keys) {
    const merged = unionStringArrays(a?.[key], b?.[key], maxPerKey);
    if (merged?.length) next[key] = merged;
  }
  return Object.keys(next).length ? next : undefined;
}

export function parseRuntimeQueryAttribution(
  search: string | undefined | null,
): RuntimeQueryAttribution | undefined {
  if (!search?.trim()) return undefined;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw.trim()) return undefined;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return undefined;
  }

  const source: string[] = [];
  const medium: string[] = [];
  const campaign: string[] = [];
  const other: Record<string, string[]> = {};

  for (const [key, rawValue] of params.entries()) {
    const k = key.toLowerCase();
    if (STAFF_QUERY_KEYS.has(k)) continue;
    if (k === "cache" && rawValue.toLowerCase() === "false") continue;
    if (isSensitiveQueryKey(k)) continue;
    const value = truncateQueryValue(decodeQueryValue(rawValue));
    if (!value) continue;

    if (k === "utm_source") {
      if (!source.includes(value)) source.push(value);
      continue;
    }
    if (k === "utm_medium") {
      if (!medium.includes(value)) medium.push(value);
      continue;
    }
    if (k === "utm_campaign") {
      if (!campaign.includes(value)) campaign.push(value);
      continue;
    }

    const list = other[k] ?? [];
    if (!list.includes(value)) list.push(value);
    other[k] = list;
  }

  const out: RuntimeQueryAttribution = {};
  if (source.length) out.source = source;
  if (medium.length) out.medium = medium;
  if (campaign.length) out.campaign = campaign;
  if (Object.keys(other).length) out.other = other;
  return Object.keys(out).length ? out : undefined;
}

export function mergeQueryAttribution(
  a: RuntimeQueryAttribution | undefined,
  b: RuntimeQueryAttribution | undefined,
  maxPerKey = QUERY_ATTRIBUTION_MAX_VALUES_PER_KEY,
): RuntimeQueryAttribution | undefined {
  if (!a && !b) return undefined;
  const out: RuntimeQueryAttribution = {};
  const source = unionStringArrays(a?.source, b?.source, maxPerKey);
  const medium = unionStringArrays(a?.medium, b?.medium, maxPerKey);
  const campaign = unionStringArrays(a?.campaign, b?.campaign, maxPerKey);
  const other = unionOtherMaps(a?.other, b?.other, maxPerKey);
  if (source) out.source = source;
  if (medium) out.medium = medium;
  if (campaign) out.campaign = campaign;
  if (other) out.other = other;
  return Object.keys(out).length ? out : undefined;
}

export function hasQueryAttribution(q: RuntimeQueryAttribution | undefined | null): boolean {
  if (!q) return false;
  if (q.source?.length || q.medium?.length || q.campaign?.length) return true;
  return Object.keys(q.other ?? {}).length > 0;
}

/** utm_* keys first, then alphabetical (for param popover / CSV). */
export function sortParamKeysForDisplay(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aUtm = a.startsWith("utm_");
    const bUtm = b.startsWith("utm_");
    if (aUtm && !bUtm) return -1;
    if (!aUtm && bUtm) return 1;
    return a.localeCompare(b);
  });
}

export const runtimeQueryAttributionSchema = z.object({
  source: z.array(z.string()).optional(),
  medium: z.array(z.string()).optional(),
  campaign: z.array(z.string()).optional(),
  other: z.record(z.string(), z.array(z.string())).optional(),
});

export const hourCountsSchema = z.record(z.string(), z.number());

export const RUNTIME_ISSUE_PROBE_STATUSES = [
  "page",
  "redirect",
  "not_found",
  "broken_redirect",
  "mismatch",
  "loop",
] as const;
export type RuntimeIssueProbeStatus = (typeof RUNTIME_ISSUE_PROBE_STATUSES)[number];

export const runtimeIssueProbeStatusSchema = z.enum(RUNTIME_ISSUE_PROBE_STATUSES);

export const runtimeIssueProbeSchema = z.object({
  at: z.number(),
  status: runtimeIssueProbeStatusSchema,
  destination: z.string().optional(),
  chained: z.boolean().optional(),
  hops: z.array(z.string()).optional(),
  httpStatus: z.number().optional(),
  matchType: z.enum(["exact", "regex", "canonical"]).optional(),
  entry: z
    .object({
      contentType: z.string(),
      slug: z.string(),
    })
    .optional(),
});

export type RuntimeIssueProbe = z.infer<typeof runtimeIssueProbeSchema>;

/** Green check: Test found a live page or redirect. */
export function isRuntimeIssueProbeSuccess(status: RuntimeIssueProbeStatus | undefined): boolean {
  return status === "page" || status === "redirect";
}

export const runtimeIssueRecordSchema = z.object({
  fingerprint: z.string(),
  kind: runtimeIssueKindSchema,
  path: z.string(),
  locale: z.string(),
  count: z.number().int().nonnegative(),
  firstSeen: z.number(),
  lastSeen: z.number(),
  sampleReferrer: z.string().optional(),
  uaBucket: z.string().optional(),
  hostname: z.string().optional(),
  likelyBot: z.boolean().optional(),
  sources: z.array(z.string()).optional(),
  byHour: z.record(z.string(), hourCountsSchema).optional(),
  lastProbe: runtimeIssueProbeSchema.optional(),
  queryAttribution: runtimeQueryAttributionSchema.optional(),
});

export type RuntimeIssueRecord = z.infer<typeof runtimeIssueRecordSchema>;

export const runtimeIssuesStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  issues: z.record(z.string(), runtimeIssueRecordSchema),
  recent: z
    .array(
      z.object({
        fingerprint: z.string(),
        ts: z.number(),
        referrer: z.string().optional(),
      }),
    )
    .optional(),
  dropScrapers: z.boolean().optional(),
});

export type RuntimeIssuesState = z.infer<typeof runtimeIssuesStateSchema>;

export const MAX_ISSUES_PER_SITE = 2000;
export const ISSUE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_RECENT = 100;

export function emptyRuntimeIssuesState(): RuntimeIssuesState {
  return {
    version: 1,
    updatedAt: Date.now(),
    issues: {},
    recent: [],
    dropScrapers: true,
  };
}

export function resolvedDropScrapers(state: { dropScrapers?: boolean } | undefined | null): boolean {
  return state?.dropScrapers !== false;
}

export function pruneRuntimeIssuesState(
  state: RuntimeIssuesState,
  now = Date.now(),
): RuntimeIssuesState {
  const cutoff = now - ISSUE_TTL_MS;
  const dropScrapers = resolvedDropScrapers(state);
  const entries = Object.values(state.issues)
    .map((issue) => pruneIssueHours(issue, now))
    .filter((i) => i.lastSeen >= cutoff)
    .filter((i) => !shouldHardDropNotFound(i.path, undefined, i.sampleReferrer, dropScrapers));
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });
  const kept = entries.slice(0, MAX_ISSUES_PER_SITE);
  const issues: Record<string, RuntimeIssueRecord> = {};
  for (const e of kept) issues[e.fingerprint] = e;
  const recent = (state.recent ?? []).filter((r) => r.ts >= cutoff).slice(-MAX_RECENT);
  return {
    version: 1,
    updatedAt: now,
    issues,
    recent,
    dropScrapers,
  };
}
