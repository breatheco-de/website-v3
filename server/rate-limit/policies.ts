import type {
  EffectiveRateWindow,
  RatePolicyConfig,
  RatePolicyId,
} from "./types.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

/** Production limits — multiplied in non-production (see effectiveLimits). */
export const RATE_POLICIES: Record<Exclude<RatePolicyId, "exempt">, RatePolicyConfig> = {
  expensiveAi: {
    id: "expensiveAi",
    windows: [
      { windowMs: HOUR, limit: 10, scope: "identity" },
      { windowMs: DAY, limit: 40, scope: "identity" },
      { windowMs: HOUR, limit: 60, scope: "global" },
    ],
  },
  expensiveCapture: {
    id: "expensiveCapture",
    windows: [
      { windowMs: HOUR, limit: 30, scope: "identity" },
      { windowMs: HOUR, limit: 120, scope: "global" },
    ],
  },
  staffWrite: {
    id: "staffWrite",
    windows: [{ windowMs: MINUTE, limit: 120, scope: "identity" }],
  },
  publicRead: {
    id: "publicRead",
    windows: [{ windowMs: MINUTE, limit: 300, scope: "identity" }],
  },
  auth: {
    id: "auth",
    windows: [{ windowMs: 15 * MINUTE, limit: 20, scope: "identity" }],
  },
};

export function isProductionRateLimitEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** 10× limits in non-production so local dev is not painful. */
export function devLimitMultiplier(): number {
  return isProductionRateLimitEnv() ? 1 : 10;
}

export function effectiveLimits(
  policyId: Exclude<RatePolicyId, "exempt">,
): EffectiveRateWindow[] {
  const policy = RATE_POLICIES[policyId];
  const mult = devLimitMultiplier();
  return policy.windows.map((w) => ({
    ...w,
    effectiveLimit: Math.max(1, Math.floor(w.limit * mult)),
  }));
}

export function getPolicyConfig(
  policyId: Exclude<RatePolicyId, "exempt">,
): RatePolicyConfig {
  return RATE_POLICIES[policyId];
}
