import { describe, expect, it } from "vitest";
import {
  grantFreeSubscription,
  isIdempotentGrantError,
  normalizeCountryCode,
  type GrantFetch,
} from "./grantFreeSubscription";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizeCountryCode", () => {
  it("defaults to US", () => {
    expect(normalizeCountryCode(undefined)).toBe("US");
    expect(normalizeCountryCode("")).toBe("US");
    expect(normalizeCountryCode("xxx")).toBe("US");
  });

  it("uppercases valid codes", () => {
    expect(normalizeCountryCode("co")).toBe("CO");
    expect(normalizeCountryCode("US")).toBe("US");
  });
});

describe("isIdempotentGrantError", () => {
  it("matches known trial/already patterns", () => {
    expect(isIdempotentGrantError({ detail: "your-free-trial-was-already-took" })).toBe(
      true,
    );
    expect(isIdempotentGrantError({ slug: "already-subscribed" })).toBe(true);
    expect(isIdempotentGrantError({ detail: "not-found-or-without-checking" })).toBe(
      false,
    );
  });
});

describe("grantFreeSubscription", () => {
  it("requires plan, token, and host", async () => {
    expect(await grantFreeSubscription({ host: "", token: "t", plan: "p" })).toMatchObject({
      ok: false,
      code: "missing_host",
    });
    expect(await grantFreeSubscription({ host: "https://x", token: "", plan: "p" })).toMatchObject({
      ok: false,
      code: "missing_token",
    });
    expect(await grantFreeSubscription({ host: "https://x", token: "t", plan: "  " })).toMatchObject({
      ok: false,
      code: "missing_plan",
    });
  });

  it("happy path: checking → pay → subscription poll", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchFn: GrantFetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.includes("/v2/payments/checking")) {
        return jsonResponse({ token: "bag-123", status: "CHECKING" });
      }
      if (url.includes("/v2/payments/pay")) {
        return jsonResponse({ status: "FULFILLED" }, 201);
      }
      if (url.includes("/v2/payments/me/subscription")) {
        return jsonResponse([{ id: 1, plan: { slug: "4geeks-basic-subscription" } }]);
      }
      throw new Error(`unexpected ${url}`);
    };

    const result = await grantFreeSubscription({
      host: "https://bc.example",
      token: "user-tok",
      plan: "4geeks-basic-subscription",
      countryCode: "us",
      fetchFn,
      pollAttempts: 1,
      pollIntervalMs: 0,
    });

    expect(result).toEqual({
      ok: true,
      status: "FULFILLED",
      subscription_ready: true,
    });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("country_code=US");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("/pay");
  });

  it("treats idempotent pay errors as success", async () => {
    const fetchFn: GrantFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/v2/payments/checking")) {
        return jsonResponse({ token: "bag-1" });
      }
      if (url.includes("/v2/payments/pay")) {
        return jsonResponse({ detail: "your-free-trial-was-already-took" }, 400);
      }
      throw new Error(`unexpected ${url} ${init?.method}`);
    };

    const result = await grantFreeSubscription({
      host: "https://bc.example",
      token: "t",
      plan: "4geeks-basic-subscription",
      fetchFn,
      pollAttempts: 0,
    });

    expect(result).toEqual({
      ok: true,
      status: "FULFILLED",
      subscription_ready: true,
      idempotent: true,
    });
  });

  it("returns blocking error when checking fails", async () => {
    const fetchFn: GrantFetch = async () =>
      jsonResponse({ detail: "Academy not found or not configured properly" }, 400);

    const result = await grantFreeSubscription({
      host: "https://bc.example",
      token: "t",
      plan: "4geeks-basic-subscription",
      fetchFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("checking_failed");
      expect(result.error).toMatch(/Academy not found/i);
    }
  });

  it("succeeds when pay is OK even if subscription poll is empty", async () => {
    const fetchFn: GrantFetch = async (input) => {
      const url = String(input);
      if (url.includes("/v2/payments/checking")) return jsonResponse({ token: "bag" });
      if (url.includes("/v2/payments/pay")) return jsonResponse({ status: "FULFILLED" }, 201);
      if (url.includes("/v2/payments/me/subscription")) return jsonResponse([]);
      throw new Error(url);
    };

    const result = await grantFreeSubscription({
      host: "https://bc.example",
      token: "t",
      plan: "plan-x",
      fetchFn,
      pollAttempts: 2,
      pollIntervalMs: 0,
    });

    expect(result).toEqual({
      ok: true,
      status: "FULFILLED",
      subscription_ready: false,
    });
  });

  it("sends plan and conversion_info in request bodies", async () => {
    const bodies: unknown[] = [];
    const fetchFn: GrantFetch = async (input, init) => {
      const url = String(input);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (url.includes("/v2/payments/checking")) return jsonResponse({ token: "bag" });
      if (url.includes("/v2/payments/pay")) return jsonResponse({ status: "FULFILLED" }, 201);
      return jsonResponse([]);
    };

    await grantFreeSubscription({
      host: "https://bc.example",
      token: "t",
      plan: "my-plan",
      countryCode: "CO",
      conversionInfo: { landing_url: "/ex" },
      fetchFn,
      pollAttempts: 1,
      pollIntervalMs: 0,
    });

    expect(bodies[0]).toEqual({
      type: "PREVIEW",
      plans: ["my-plan"],
      country_code: "CO",
    });
    expect(bodies[1]).toEqual({
      token: "bag",
      conversion_info: { landing_url: "/ex" },
    });
  });
});
