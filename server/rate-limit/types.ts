/**
 * Rate-limit policy types and pluggable store interface.
 * Default store is in-memory (per process); Redis can implement RateLimitStore later.
 */

export type RatePolicyId =
  | "expensiveAi"
  | "expensiveCapture"
  | "staffWrite"
  | "publicRead"
  | "auth"
  | "exempt";

export type RateWindowScope = "identity" | "global";

export type RateWindowConfig = {
  windowMs: number;
  limit: number;
  scope: RateWindowScope;
};

export type RatePolicyConfig = {
  id: Exclude<RatePolicyId, "exempt">;
  windows: RateWindowConfig[];
};

export type RateLimitStore = {
  /** Current count for a fixed-window bucket key. */
  getCount(key: string): number;
  /** Increment and return new count. Sets expiry on first write. */
  increment(key: string, windowMs: number): number;
  /** Test helper — clear all buckets. */
  reset(): void;
};

export type EffectiveRateWindow = RateWindowConfig & {
  effectiveLimit: number;
};

export type RateLimitCheckResult =
  | { ok: true }
  | {
      ok: false;
      policy: Exclude<RatePolicyId, "exempt">;
      scope: RateWindowScope;
      retryAfterSec: number;
      limit: number;
      windowMs: number;
    };

/** Set on res.locals by streaming handlers when a billable success occurred. */
export const RATE_LIMIT_COUNT_SUCCESS = "rateLimitCountSuccess";
