import type { NextFunction, Request, Response } from "express";
import { getDefaultRateLimitStore } from "./memory-store.js";
import { bucketKey, rateLimitIdentityKey, windowRetryAfterSec } from "./keys.js";
import { effectiveLimits } from "./policies.js";
import type {
  RateLimitCheckResult,
  RateLimitStore,
  RatePolicyId,
} from "./types.js";
import { RATE_LIMIT_COUNT_SUCCESS } from "./types.js";

export function markRateLimitSuccess(res: Response): void {
  res.locals[RATE_LIMIT_COUNT_SUCCESS] = true;
}

export function markRateLimitNoCharge(res: Response): void {
  res.locals[RATE_LIMIT_COUNT_SUCCESS] = false;
}

function shouldCountSuccess(res: Response): boolean {
  const status = res.statusCode;
  if (status < 200 || status >= 300) return false;
  if (res.locals[RATE_LIMIT_COUNT_SUCCESS] === false) return false;
  if (res.locals[RATE_LIMIT_COUNT_SUCCESS] === true) return true;
  return true;
}

export function checkRateLimit(
  policyId: Exclude<RatePolicyId, "exempt">,
  req: Request,
  store: RateLimitStore = getDefaultRateLimitStore(),
  nowMs = Date.now(),
): RateLimitCheckResult {
  const identityKey = rateLimitIdentityKey(req);
  const windows = effectiveLimits(policyId);

  for (const w of windows) {
    const subject = w.scope === "global" ? "global" : identityKey;
    const key = bucketKey(policyId, w.scope, subject, w.windowMs, nowMs);
    const count = store.getCount(key);
    if (count >= w.effectiveLimit) {
      return {
        ok: false,
        policy: policyId,
        scope: w.scope,
        retryAfterSec: windowRetryAfterSec(w.windowMs, nowMs),
        limit: w.effectiveLimit,
        windowMs: w.windowMs,
      };
    }
  }

  return { ok: true };
}

export function recordRateLimitSuccess(
  policyId: Exclude<RatePolicyId, "exempt">,
  req: Request,
  store: RateLimitStore = getDefaultRateLimitStore(),
  nowMs = Date.now(),
): void {
  const identityKey = rateLimitIdentityKey(req);
  const windows = effectiveLimits(policyId);

  for (const w of windows) {
    const subject = w.scope === "global" ? "global" : identityKey;
    const key = bucketKey(policyId, w.scope, subject, w.windowMs, nowMs);
    store.increment(key, w.windowMs);
  }
}

export function sendRateLimitResponse(
  res: Response,
  result: Extract<RateLimitCheckResult, { ok: false }>,
): void {
  const message =
    result.scope === "global"
      ? `Rate limit exceeded for ${result.policy} (site-wide). Try again in ${result.retryAfterSec}s.`
      : `Rate limit exceeded for ${result.policy}. Try again in ${result.retryAfterSec}s.`;

  res.setHeader("Retry-After", String(result.retryAfterSec));
  res.setHeader("RateLimit-Policy", result.policy);
  res.status(429).json({
    error: message,
    code: "rate_limited",
    policy: result.policy,
    scope: result.scope,
    retry_after_sec: result.retryAfterSec,
    limit: result.limit,
    window_ms: result.windowMs,
  });
}

export function createRateLimitMiddleware(
  policyId: Exclude<RatePolicyId, "exempt">,
  store: RateLimitStore = getDefaultRateLimitStore(),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const check = checkRateLimit(policyId, req, store);
    if (!check.ok) {
      sendRateLimitResponse(res, check);
      return;
    }

    res.on("finish", () => {
      if (!shouldCountSuccess(res)) return;
      recordRateLimitSuccess(policyId, req, store);
    });

    next();
  };
}
