import { describe, expect, it, vi } from "vitest";
import { classifyUrl, isRootPath, type FetchLike } from "./classify";

function respond(status: number, opts: { url?: string; redirected?: boolean } = {}): Response {
  const res = new Response("body", { status: status > 599 ? 200 : status });
  Object.defineProperty(res, "status", { value: status });
  Object.defineProperty(res, "url", { value: opts.url ?? "" });
  Object.defineProperty(res, "redirected", { value: opts.redirected ?? false });
  return res;
}

function fetchReturning(res: Response | (() => never)): FetchLike {
  return vi.fn(async () => (typeof res === "function" ? res() : res)) as unknown as FetchLike;
}

const deep = "https://www.coursereport.com/research/coding-bootcamp-market-sizing-2025";

describe("classifyUrl", () => {
  it("404 and 410 are gone (not_found)", async () => {
    expect(await classifyUrl(deep, { fetchImpl: fetchReturning(respond(404)) })).toMatchObject({
      status: "gone",
      reason: "not_found",
      http_status: 404,
    });
    expect((await classifyUrl(deep, { fetchImpl: fetchReturning(respond(410)) })).status).toBe("gone");
  });

  it("bot walls, rate limits, LinkedIn 999 and 5xx are unknown", async () => {
    for (const status of [403, 429, 999, 500, 503]) {
      expect((await classifyUrl(deep, { fetchImpl: fetchReturning(respond(status)) })).status).toBe("unknown");
    }
  });

  it("2xx is ok and uses GET only", async () => {
    const fetchImpl = fetchReturning(respond(200));
    expect((await classifyUrl(deep, { fetchImpl })).status).toBe("ok");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("deep link redirected to the root or a locale root is gone (redirected_to_home)", async () => {
    for (const landed of ["https://www.coursereport.com/", "https://www.coursereport.com/en", "https://x.com/es-mx/"]) {
      const out = await classifyUrl(deep, { fetchImpl: fetchReturning(respond(200, { url: landed, redirected: true })) });
      expect(out).toMatchObject({ status: "gone", reason: "redirected_to_home", final_url: landed });
    }
  });

  it("root link redirected to a root stays ok; ordinary redirects stay ok", async () => {
    const root = await classifyUrl("http://example.com/", {
      fetchImpl: fetchReturning(respond(200, { url: "https://example.com/en", redirected: true })),
    });
    expect(root.status).toBe("ok");
    const moved = await classifyUrl(deep, {
      fetchImpl: fetchReturning(respond(200, { url: "https://www.coursereport.com/reports/2025", redirected: true })),
    });
    expect(moved).toMatchObject({ status: "ok", final_url: "https://www.coursereport.com/reports/2025" });
  });

  it("DNS and certificate failures are unreachable; timeouts and refused connections are unknown", async () => {
    const throwing = (cause: Record<string, string>) =>
      fetchReturning(() => {
        throw Object.assign(new TypeError("fetch failed"), { cause });
      });
    expect(await classifyUrl(deep, { fetchImpl: throwing({ code: "ENOTFOUND" }) })).toMatchObject({
      status: "unreachable",
      reason: "unreachable",
    });
    expect((await classifyUrl(deep, { fetchImpl: throwing({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }) })).status).toBe(
      "unreachable",
    );
    expect((await classifyUrl(deep, { fetchImpl: throwing({ code: "EAI_AGAIN" }) })).status).toBe("unknown");
    expect((await classifyUrl(deep, { fetchImpl: throwing({ code: "ECONNREFUSED" }) })).status).toBe("unknown");
    const timeout = fetchReturning(() => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect((await classifyUrl(deep, { fetchImpl: timeout })).status).toBe("unknown");
  });
});

describe("isRootPath", () => {
  it("matches site and locale roots only", () => {
    for (const p of ["", "/", "/en", "/es/", "/en-us", "/pt_BR"]) expect(isRootPath(p)).toBe(true);
    for (const p of ["/blog", "/en/blog", "/research/x"]) expect(isRootPath(p)).toBe(false);
  });
});
