import { describe, expect, it, vi } from "vitest";
import { archiveUrl, checkOriginal, getArchiveOrgKeys, type FetchLike } from "./archive-org-client";

const keys = { access: "AK", secret: "SK" };
const target = "https://www.forbes.com/advisor/a";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fetchFrom(handler: (url: string, init?: RequestInit) => Response): FetchLike {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as unknown as FetchLike;
}

const noSnapshot = () => json({ archived_snapshots: {} });
const sleep = async () => {};

describe("archiveUrl", () => {
  it("uses an existing snapshot without saving", async () => {
    const fetchImpl = fetchFrom((url) => {
      expect(url).toContain("archive.org/wayback/available");
      return json({
        archived_snapshots: {
          closest: { available: true, status: "200", timestamp: "20240529143404", url: `http://web.archive.org/web/20240529143404/${target}` },
        },
      });
    });
    const out = await archiveUrl(target, { keys, fetchImpl, sleep });
    expect(out).toEqual({
      status: "archived",
      url: `https://web.archive.org/web/20240529143404/${target}`,
      captured_at: "2024-05-29T14:34:04.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("saves and polls until success, sending the LOW auth header", async () => {
    let polls = 0;
    const fetchImpl = fetchFrom((url, init) => {
      if (url.includes("wayback/available")) return noSnapshot();
      if (url === "https://web.archive.org/save") {
        expect((init?.headers as Record<string, string>).Authorization).toBe("LOW AK:SK");
        expect(String(init?.body)).toContain(`url=${encodeURIComponent(target)}`);
        return json({ url: target, job_id: "spn2-1" });
      }
      polls++;
      return polls < 2
        ? json({ status: "pending" })
        : json({ status: "success", timestamp: "20261029120000", original_url: target });
    });
    const out = await archiveUrl(target, { keys, fetchImpl, sleep, pollIntervalMs: 1 });
    expect(out).toEqual({
      status: "archived",
      url: `https://web.archive.org/web/20261029120000/${target}`,
      captured_at: "2026-10-29T12:00:00.000Z",
    });
  });

  it("reports a blocked site as a plain, non-retryable failure", async () => {
    const fetchImpl = fetchFrom((url) => {
      if (url.includes("wayback/available")) return noSnapshot();
      if (url.endsWith("/save")) return json({ url: target, job_id: "spn2-2" });
      return json({ status: "error", status_ext: "error:blocked-url", message: "blocked" });
    });
    const out = await archiveUrl(target, { keys, fetchImpl, sleep, pollIntervalMs: 1 });
    expect(out).toEqual({ status: "failed", error: "This site blocks archive.org.", retryable: false });
  });

  it("rate limits are retryable", async () => {
    const fetchImpl = fetchFrom((url) => (url.includes("wayback/available") ? noSnapshot() : new Response("", { status: 429 })));
    const out = await archiveUrl(target, { keys, fetchImpl, sleep });
    expect(out).toMatchObject({ status: "failed", retryable: true });
  });

  it("without keys only looks up, then fails with a clear reason", async () => {
    const fetchImpl = fetchFrom(() => noSnapshot());
    const out = await archiveUrl(target, { keys: null, fetchImpl, sleep });
    expect(out).toEqual({ status: "failed", error: "archive.org keys not set", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a link that already is a saved copy needs no request", async () => {
    const fetchImpl = fetchFrom(() => noSnapshot());
    const wb = `https://web.archive.org/web/20240101000000/${target}`;
    expect(await archiveUrl(wb, { keys, fetchImpl })).toMatchObject({ status: "archived", url: wb });
    const ph = "https://archive.ph/AbC12";
    expect(await archiveUrl(ph, { keys, fetchImpl })).toEqual({ status: "archived", url: ph, captured_at: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up polling after maxWaitMs with a retryable failure", async () => {
    const fetchImpl = fetchFrom((url) => {
      if (url.includes("wayback/available")) return noSnapshot();
      if (url.endsWith("/save")) return json({ job_id: "spn2-3" });
      return json({ status: "pending" });
    });
    const out = await archiveUrl(target, { keys, fetchImpl, pollIntervalMs: 1, maxWaitMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    expect(out).toMatchObject({ status: "failed", retryable: true });
  });
});

describe("checkOriginal", () => {
  it("404 / 410 are gone, 2xx ok, 5xx unknown", async () => {
    expect(await checkOriginal(target, fetchFrom(() => new Response("", { status: 404 })))).toBe("gone");
    expect(await checkOriginal(target, fetchFrom(() => new Response("", { status: 410 })))).toBe("gone");
    expect(await checkOriginal(target, fetchFrom(() => new Response("", { status: 200 })))).toBe("ok");
    expect(await checkOriginal(target, fetchFrom(() => new Response("", { status: 503 })))).toBe("unknown");
  });

  it("falls back to GET when HEAD is refused", async () => {
    const fetchImpl = fetchFrom((_url, init) => new Response("", { status: init?.method === "HEAD" ? 405 : 200 }));
    expect(await checkOriginal(target, fetchImpl)).toBe("ok");
  });

  it("network errors are unknown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as FetchLike;
    expect(await checkOriginal(target, fetchImpl)).toBe("unknown");
  });
});

describe("getArchiveOrgKeys", () => {
  it("needs both keys", () => {
    expect(getArchiveOrgKeys({ ARCHIVE_ORG_ACCESS_KEY: "a" } as NodeJS.ProcessEnv)).toBeNull();
    expect(getArchiveOrgKeys({ ARCHIVE_ORG_ACCESS_KEY: " a ", ARCHIVE_ORG_SECRET_KEY: "b" } as NodeJS.ProcessEnv)).toEqual({ access: "a", secret: "b" });
  });
});
