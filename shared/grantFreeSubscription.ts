/**
 * Silent free-plan grant after consumer signup.
 * Materializes a Breathecode Subscription via checking + pay (subscribe alone
 * only attaches the plan to UserInvite metadata).
 */

export type GrantFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type GrantFreeSubscriptionOpts = {
  host: string;
  token: string;
  plan: string;
  countryCode?: string;
  conversionInfo?: Record<string, unknown>;
  acceptLanguage?: string;
  fetchFn?: GrantFetch;
  /** Sleep between subscription polls (ms). Default 1000. */
  pollIntervalMs?: number;
  /** Max subscription poll attempts after pay. Default 3. */
  pollAttempts?: number;
};

export type GrantFreeSubscriptionResult =
  | {
      ok: true;
      status: "FULFILLED";
      subscription_ready: boolean;
      idempotent?: boolean;
    }
  | {
      ok: false;
      error: string;
      code?: string;
      status?: number;
      details?: unknown;
    };

/** Upstream detail/slug patterns treated as already-granted (safe to continue). */
const IDEMPOTENT_PATTERNS = [
  /your-free-trial-was-already-took/i,
  /already.?took/i,
  /already.?subscribed/i,
  /already.?has.?subscription/i,
  /subscription.?already/i,
  /plan.?already/i,
];

export function normalizeCountryCode(raw: unknown): string {
  if (typeof raw !== "string") return "US";
  const cc = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return cc;
  return "US";
}

export function isIdempotentGrantError(details: unknown): boolean {
  const text = extractErrorText(details);
  if (!text) return false;
  return IDEMPOTENT_PATTERNS.some((re) => re.test(text));
}

function extractErrorText(details: unknown): string {
  if (details == null) return "";
  if (typeof details === "string") return details;
  if (typeof details === "object") {
    const o = details as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["detail", "error", "code", "message", "slug"]) {
      const v = o[key];
      if (typeof v === "string") parts.push(v);
      if (Array.isArray(v)) parts.push(v.map(String).join(" "));
    }
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  }
  return String(details);
}

function joinHostPath(host: string, path: string): string {
  const base = host.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function authHeaders(token: string, acceptLanguage: string): HeadersInit {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    "Accept-Language": acceptLanguage,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bagTokenFromChecking(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.token === "string" && o.token.trim()) return o.token.trim();
  return null;
}

function payLooksFulfilled(json: unknown, httpStatus: number): boolean {
  if (httpStatus === 201 || httpStatus === 200) {
    if (!json || typeof json !== "object") return true;
    const o = json as Record<string, unknown>;
    const status = o.status;
    if (typeof status === "string") {
      return status.toUpperCase() === "FULFILLED" || status.toUpperCase() === "PAID";
    }
    return true;
  }
  return false;
}

function subscriptionListHasItems(json: unknown): boolean {
  if (Array.isArray(json)) return json.length > 0;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.results)) return o.results.length > 0;
    if (Array.isArray(o.subscriptions)) return o.subscriptions.length > 0;
  }
  return false;
}

/**
 * Completes free checkout: checking → pay → optional subscription poll.
 */
export async function grantFreeSubscription(
  opts: GrantFreeSubscriptionOpts,
): Promise<GrantFreeSubscriptionResult> {
  const plan = typeof opts.plan === "string" ? opts.plan.trim() : "";
  if (!plan) {
    return { ok: false, error: "plan is required", code: "missing_plan" };
  }
  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (!token) {
    return { ok: false, error: "token is required", code: "missing_token" };
  }
  const host = typeof opts.host === "string" ? opts.host.trim().replace(/\/$/, "") : "";
  if (!host) {
    return { ok: false, error: "auth host is not configured", code: "missing_host" };
  }

  const countryCode = normalizeCountryCode(opts.countryCode);
  const acceptLanguage = (() => {
    const raw = typeof opts.acceptLanguage === "string" ? opts.acceptLanguage.trim() : "";
    const short = raw.slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(short) ? short : "en";
  })();
  const fetchFn = opts.fetchFn ?? fetch;
  const pollAttempts = opts.pollAttempts ?? 3;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const conversionInfo =
    opts.conversionInfo && typeof opts.conversionInfo === "object"
      ? opts.conversionInfo
      : {};

  const headers = authHeaders(token, acceptLanguage);

  // 1) Checking
  const checkingUrl = joinHostPath(
    host,
    `/v2/payments/checking?country_code=${encodeURIComponent(countryCode)}`,
  );
  let checkingRes: Response;
  try {
    checkingRes = await fetchFn(checkingUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        type: "PREVIEW",
        plans: [plan],
        country_code: countryCode,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: "Failed to reach payments checking service",
      code: "checking_network",
      details: err instanceof Error ? err.message : String(err),
    };
  }

  const checkingJson = await parseJsonSafe(checkingRes);
  if (!checkingRes.ok) {
    if (isIdempotentGrantError(checkingJson)) {
      return {
        ok: true,
        status: "FULFILLED",
        subscription_ready: true,
        idempotent: true,
      };
    }
    return {
      ok: false,
      error: extractErrorText(checkingJson) || "Payments checking failed",
      code: "checking_failed",
      status: checkingRes.status,
      details: checkingJson,
    };
  }

  const bagToken = bagTokenFromChecking(checkingJson);
  if (!bagToken) {
    return {
      ok: false,
      error: "Checking succeeded but no bag token was returned",
      code: "missing_bag_token",
      details: checkingJson,
    };
  }

  // 2) Pay
  const payUrl = joinHostPath(
    host,
    `/v2/payments/pay?country_code=${encodeURIComponent(countryCode)}`,
  );
  let payRes: Response;
  try {
    payRes = await fetchFn(payUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        token: bagToken,
        conversion_info: conversionInfo,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: "Failed to reach payments pay service",
      code: "pay_network",
      details: err instanceof Error ? err.message : String(err),
    };
  }

  const payJson = await parseJsonSafe(payRes);
  if (!payRes.ok) {
    if (isIdempotentGrantError(payJson)) {
      return {
        ok: true,
        status: "FULFILLED",
        subscription_ready: true,
        idempotent: true,
      };
    }
    return {
      ok: false,
      error: extractErrorText(payJson) || "Payments pay failed",
      code: "pay_failed",
      status: payRes.status,
      details: payJson,
    };
  }

  if (!payLooksFulfilled(payJson, payRes.status)) {
    return {
      ok: false,
      error: extractErrorText(payJson) || "Pay did not return FULFILLED",
      code: "pay_not_fulfilled",
      status: payRes.status,
      details: payJson,
    };
  }

  // 3) Optional poll — pay OK is enough; poll is best-effort for subscription_ready
  let subscriptionReady = false;
  const meUrl = joinHostPath(host, "/v2/payments/me/subscription");
  for (let i = 0; i < pollAttempts; i++) {
    if (i > 0) await sleep(pollIntervalMs);
    try {
      const subRes = await fetchFn(meUrl, { method: "GET", headers });
      if (!subRes.ok) continue;
      const subJson = await parseJsonSafe(subRes);
      if (subscriptionListHasItems(subJson)) {
        subscriptionReady = true;
        break;
      }
    } catch {
      // ignore poll errors — pay already succeeded
    }
  }

  return {
    ok: true,
    status: "FULFILLED",
    subscription_ready: subscriptionReady,
  };
}
