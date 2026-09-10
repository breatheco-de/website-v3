import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dev-production-fetch", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.PRODUCTION_STAFF_TOKEN;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.PRODUCTION_STAFF_TOKEN;
    const mod = await import("./dev-production-fetch");
    mod.resetProductionStaffTokenForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.PRODUCTION_STAFF_TOKEN;
    else process.env.PRODUCTION_STAFF_TOKEN = originalEnv;
    vi.restoreAllMocks();
  });

  it("prefers in-memory token over env", async () => {
    process.env.PRODUCTION_STAFF_TOKEN = "env-token";
    const {
      setProductionStaffToken,
      getProductionStaffToken,
      resetProductionStaffTokenForTests,
    } = await import("./dev-production-fetch");
    resetProductionStaffTokenForTests();
    expect(getProductionStaffToken()).toBe("env-token");
    setProductionStaffToken("memory-token");
    expect(getProductionStaffToken()).toBe("memory-token");
  });

  it("returns token_required when no token is configured", async () => {
    const { fetchProductionAdmin } = await import("./dev-production-fetch");
    const result = await fetchProductionAdmin(
      "https://prod.example/api/admin/events",
      undefined,
      "https://prod.example",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_required");
    if (result.kind !== "token_required") return;
    expect(result.payload.code).toBe("production_staff_token_required");
    expect(result.payload.envVar).toBe("PRODUCTION_STAFF_TOKEN");
    expect(result.payload.productionOrigin).toBe("https://prod.example");
  });

  it("attaches Authorization and clears memory on production 401", async () => {
    const {
      setProductionStaffToken,
      getProductionStaffToken,
      fetchProductionAdmin,
    } = await import("./dev-production-fetch");
    setProductionStaffToken("memory-token");

    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Token memory-token");
      return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
    }) as typeof fetch;

    const result = await fetchProductionAdmin(
      "https://prod.example/api/admin/events",
      { method: "GET" },
      "https://prod.example",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_required");
    expect(getProductionStaffToken()).toBeNull();
  });

  it("returns ok response on 200", async () => {
    process.env.PRODUCTION_STAFF_TOKEN = "env-token";
    const { fetchProductionAdmin, resetProductionStaffTokenForTests } = await import(
      "./dev-production-fetch"
    );
    resetProductionStaffTokenForTests();

    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }) as typeof fetch;

    const result = await fetchProductionAdmin(
      "https://prod.example/api/admin/events",
      undefined,
      "https://prod.example",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.status).toBe(200);
  });
});
