/**
 * DataForSEO Labs keyword metrics — login/password from DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD only.
 * Off the live server, calls go to the free sandbox (sample data) unless DATAFORSEO_USE_LIVE=true.
 */

import { child } from "./logger";
import { getDataForSeoSettings } from "./settings";
import { isLiveServer } from "./live-server";
import type { KeywordDifficultySource } from "./openrush-keyword-difficulty";

const log = child({ module: "dataforseo-client" });

const LIVE_BASE_URL = "https://api.dataforseo.com/v3";
const SANDBOX_BASE_URL = "https://sandbox.dataforseo.com/v3";
const KEYWORD_OVERVIEW_PATH = "/dataforseo_labs/google/keyword_overview/live";
const USER_DATA_PATH = "/appendix/user_data";

/** keyword_overview/live accepts up to 700 keywords per task. */
export const DATAFORSEO_KEYWORD_OVERVIEW_MAX = 700;

/** Labs live pricing estimate: per task + per returned keyword (USD). Actual cost comes back in the response. */
export const DATAFORSEO_TASK_USD = 0.01;
export const DATAFORSEO_KEYWORD_USD = 0.0001;

export function estimateKeywordOverviewUsd(keywordCount: number): number {
  const n = Math.max(0, Math.floor(keywordCount));
  if (n === 0) return 0;
  const tasks = Math.ceil(n / DATAFORSEO_KEYWORD_OVERVIEW_MAX);
  return roundUsd(tasks * DATAFORSEO_TASK_USD + n * DATAFORSEO_KEYWORD_USD);
}

export function roundUsd(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export type DataForSeoMode = "live" | "sandbox";
export type DataForSeoErrorKind = "auth" | "funds" | "unavailable" | "request";

/** Location + language strings DataForSEO accepts as location_name / language_name. */
export type DataForSeoMarket = { location: string; language: string };

export function getDataForSeoCredentials(): { login: string; password: string } {
  return {
    login: (process.env.DATAFORSEO_LOGIN || "").trim(),
    password: (process.env.DATAFORSEO_PASSWORD || "").trim(),
  };
}

export function dataForSeoCredentialsConfigured(): boolean {
  const { login, password } = getDataForSeoCredentials();
  return Boolean(login && password);
}

export function dataForSeoMode(): DataForSeoMode {
  if ((process.env.DATAFORSEO_USE_LIVE || "").trim().toLowerCase() === "true") return "live";
  return isLiveServer() ? "live" : "sandbox";
}

function baseUrl(): string {
  return dataForSeoMode() === "live" ? LIVE_BASE_URL : SANDBOX_BASE_URL;
}

export function isDataForSeoConfigured(contentRoot?: string): boolean {
  return Boolean(getDataForSeoSettings(contentRoot).enabled && dataForSeoCredentialsConfigured());
}

const AUTH_CODES = new Set([40100, 40104, 40201, 40207]);
const FUNDS_CODES = new Set([40200, 40203, 40210]);
const UNAVAILABLE_CODES = new Set([40202, 40209, 50000, 50001, 50301, 50303, 50304, 50401]);
/** Task finished with nothing to return — not an error for metrics lookups. */
const EMPTY_RESULT_CODES = new Set([40102]);

export function classifyDataForSeoStatus(code: number): DataForSeoErrorKind {
  if (AUTH_CODES.has(code)) return "auth";
  if (FUNDS_CODES.has(code)) return "funds";
  if (UNAVAILABLE_CODES.has(code) || code >= 50000) return "unavailable";
  return "request";
}

const STAFF_MESSAGES: Record<DataForSeoErrorKind, string> = {
  auth: "DataForSEO rejected the login. Check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD and that the account is verified.",
  funds: "DataForSEO is out of funds or hit its account cost limit. Top up the DataForSEO account.",
  unavailable: "DataForSEO is not responding. Try again later.",
  request: "DataForSEO rejected the request.",
};

export type DataForSeoFailure = {
  ok: false;
  error: string;
  error_kind: DataForSeoErrorKind;
  /** Auth / funds / outage — callers stop (bulk aborts; agents do not retry). */
  fatal: boolean;
  status_code: number | null;
};

export type DataForSeoEnvelopeOk = {
  ok: true;
  /** `tasks[0].result` (empty when the provider had no data). */
  result: unknown[];
  cost_usd: number;
};

function failure(kind: DataForSeoErrorKind, statusCode: number | null, detail?: string): DataForSeoFailure {
  const base = STAFF_MESSAGES[kind];
  return {
    ok: false,
    error: detail ? `${base} (${detail})` : base,
    error_kind: kind,
    fatal: kind !== "request",
    status_code: statusCode,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * DataForSEO reports errors inside HTTP 200 bodies: check the top-level and first-task status codes.
 */
export function parseDataForSeoEnvelope(
  body: unknown,
  httpStatus: number,
): DataForSeoEnvelopeOk | DataForSeoFailure {
  const rec = asRecord(body);
  if (!rec) {
    if (httpStatus === 401 || httpStatus === 403) return failure("auth", httpStatus);
    if (httpStatus === 402) return failure("funds", httpStatus);
    if (httpStatus >= 500 || httpStatus === 429) return failure("unavailable", httpStatus);
    return failure("unavailable", httpStatus, `HTTP ${httpStatus}, unreadable body`);
  }
  const topCode = finiteNumber(rec.status_code);
  const topMessage = typeof rec.status_message === "string" ? rec.status_message : undefined;
  if (topCode != null && topCode !== 20000) {
    return failure(classifyDataForSeoStatus(topCode), topCode, topMessage);
  }
  if (topCode == null && httpStatus >= 400) {
    if (httpStatus === 401 || httpStatus === 403) return failure("auth", httpStatus);
    if (httpStatus === 402) return failure("funds", httpStatus);
    return failure(httpStatus >= 500 ? "unavailable" : "request", httpStatus, `HTTP ${httpStatus}`);
  }
  const tasks = Array.isArray(rec.tasks) ? rec.tasks : [];
  const task = asRecord(tasks[0]);
  if (!task) return failure("unavailable", topCode, "response had no task");
  const taskCode = finiteNumber(task.status_code);
  const taskMessage = typeof task.status_message === "string" ? task.status_message : undefined;
  const cost_usd = roundUsd(finiteNumber(task.cost) ?? finiteNumber(rec.cost) ?? 0);
  if (taskCode != null && taskCode !== 20000) {
    if (EMPTY_RESULT_CODES.has(taskCode)) return { ok: true, result: [], cost_usd };
    return failure(classifyDataForSeoStatus(taskCode), taskCode, taskMessage);
  }
  return { ok: true, result: Array.isArray(task.result) ? task.result : [], cost_usd };
}

function authHeader(): string {
  const { login, password } = getDataForSeoCredentials();
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function dataForSeoRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<DataForSeoEnvelopeOk | DataForSeoFailure> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    return parseDataForSeoEnvelope(json, res.status);
  } catch (err) {
    log.warn({ err, path }, "[dataforseo] request failed");
    return failure("unavailable", null, err instanceof Error ? err.message : String(err));
  }
}

function preflight(contentRoot?: string): DataForSeoFailure | null {
  if (!dataForSeoCredentialsConfigured()) {
    return {
      ok: false,
      error: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set",
      error_kind: "auth",
      fatal: true,
      status_code: null,
    };
  }
  if (!getDataForSeoSettings(contentRoot).enabled) {
    return {
      ok: false,
      error: "DataForSEO is disabled in settings",
      error_kind: "auth",
      fatal: true,
      status_code: null,
    };
  }
  return null;
}

export type DataForSeoKeywordMetrics = {
  keyword: string;
  monthly_volume: number | null;
  kw_difficulty: number | null;
  kw_difficulty_source: KeywordDifficultySource | null;
  competition_level: string | number | null;
  intent: string | null;
  payload: Record<string, unknown>;
};

/** One keyword_overview item → metrics. Difficulty is a real ranking score (`reported`) or null. */
export function parseKeywordOverviewItem(item: unknown): DataForSeoKeywordMetrics | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const keyword = typeof rec.keyword === "string" ? rec.keyword.trim() : "";
  if (!keyword) return null;
  const info = asRecord(rec.keyword_info) ?? {};
  const props = asRecord(rec.keyword_properties) ?? {};
  const intentInfo = asRecord(rec.search_intent_info) ?? {};
  const volumeRaw = finiteNumber(info.search_volume);
  const kdRaw = finiteNumber(props.keyword_difficulty);
  const kd = kdRaw == null ? null : Math.round(Math.min(100, Math.max(0, kdRaw)));
  const comp = info.competition_level;
  const intent = intentInfo.main_intent;
  return {
    keyword,
    monthly_volume: volumeRaw == null || volumeRaw < 0 ? null : Math.round(volumeRaw),
    kw_difficulty: kd,
    kw_difficulty_source: kd == null ? null : "reported",
    competition_level: typeof comp === "string" || typeof comp === "number" ? comp : null,
    intent: typeof intent === "string" && intent.trim() ? intent.trim() : null,
    payload: rec,
  };
}

export function parseKeywordOverviewResult(result: unknown[]): DataForSeoKeywordMetrics[] {
  const out: DataForSeoKeywordMetrics[] = [];
  for (const block of result) {
    const items = asRecord(block)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const parsed = parseKeywordOverviewItem(item);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export type KeywordOverviewResult =
  | {
      ok: true;
      /** Keyed by lowercased keyword (DataForSEO lowercases input). Omitted = provider has no data. */
      metrics: Map<string, DataForSeoKeywordMetrics>;
      cost_usd: number;
      mode: DataForSeoMode;
    }
  | DataForSeoFailure;

/** keyword_overview/live for 1–700 keywords in one market. */
export async function keywordOverviewQuery(opts: {
  keywords: string[];
  market: DataForSeoMarket;
  contentRoot?: string;
}): Promise<KeywordOverviewResult> {
  const keywords = [...new Set(opts.keywords.map((k) => k.trim()).filter(Boolean))];
  if (keywords.length === 0) {
    return { ok: false, error: "keywords is required", error_kind: "request", fatal: false, status_code: null };
  }
  if (keywords.length > DATAFORSEO_KEYWORD_OVERVIEW_MAX) {
    return {
      ok: false,
      error: `keyword_overview accepts at most ${DATAFORSEO_KEYWORD_OVERVIEW_MAX} keywords per call`,
      error_kind: "request",
      fatal: false,
      status_code: null,
    };
  }
  const blocked = preflight(opts.contentRoot);
  if (blocked) return blocked;

  const res = await dataForSeoRequest("POST", KEYWORD_OVERVIEW_PATH, [
    {
      keywords,
      location_name: opts.market.location,
      language_name: opts.market.language,
    },
  ]);
  if (!res.ok) return res;
  const metrics = new Map<string, DataForSeoKeywordMetrics>();
  for (const m of parseKeywordOverviewResult(res.result)) {
    metrics.set(m.keyword.toLowerCase(), m);
  }
  return { ok: true, metrics, cost_usd: res.cost_usd, mode: dataForSeoMode() };
}

export type DataForSeoBalanceResult =
  | { ok: true; balance_usd: number; mode: DataForSeoMode }
  | DataForSeoFailure;

/** GET appendix/user_data → money.balance (USD). */
export async function fetchDataForSeoBalance(): Promise<DataForSeoBalanceResult> {
  if (!dataForSeoCredentialsConfigured()) {
    return {
      ok: false,
      error: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set",
      error_kind: "auth",
      fatal: true,
      status_code: null,
    };
  }
  const res = await dataForSeoRequest("GET", USER_DATA_PATH);
  if (!res.ok) return res;
  const money = asRecord(asRecord(res.result[0])?.money);
  const balance = finiteNumber(money?.balance);
  if (balance == null) {
    return failure("unavailable", null, "user_data response missing money.balance");
  }
  return { ok: true, balance_usd: roundUsd(balance), mode: dataForSeoMode() };
}

export async function testDataForSeoConnection(contentRoot?: string): Promise<{
  ok: boolean;
  error?: string;
  error_kind?: DataForSeoErrorKind;
  elapsed_ms: number;
  credentials_configured: boolean;
  mode: DataForSeoMode;
  balance_usd: number | null;
}> {
  const started = Date.now();
  const credentials_configured = dataForSeoCredentialsConfigured();
  const mode = dataForSeoMode();
  const blocked = preflight(contentRoot);
  if (blocked) {
    return {
      ok: false,
      error: blocked.error,
      error_kind: blocked.error_kind,
      elapsed_ms: Date.now() - started,
      credentials_configured,
      mode,
      balance_usd: null,
    };
  }
  const res = await fetchDataForSeoBalance();
  return {
    ok: res.ok,
    error: res.ok ? undefined : res.error,
    error_kind: res.ok ? undefined : res.error_kind,
    elapsed_ms: Date.now() - started,
    credentials_configured,
    mode,
    balance_usd: res.ok ? res.balance_usd : null,
  };
}
