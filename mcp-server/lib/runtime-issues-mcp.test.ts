import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { incrementByHour } from "../../shared/runtime-issues.js";
import {
  clampRuntimeIssuesLimit,
  queryRuntimeIssuesForMcp,
  type RuntimeIssueMcpRow,
} from "./runtime-issues-mcp.js";

const now = Date.UTC(2026, 8, 21, 12, 0, 0);

function row(
  overrides: Partial<RuntimeIssueMcpRow> & { fingerprint: string; path: string },
): RuntimeIssueMcpRow {
  const lastSeen = overrides.lastSeen ?? now;
  return {
    fingerprint: overrides.fingerprint,
    kind: overrides.kind ?? "http.not_found",
    path: overrides.path,
    locale: overrides.locale ?? "en",
    count: overrides.count ?? 5,
    count30: overrides.count30,
    firstSeen: overrides.firstSeen ?? lastSeen - 86_400_000,
    lastSeen,
    sampleReferrer: overrides.sampleReferrer,
    uaBucket: overrides.uaBucket ?? "desktop",
    sources: overrides.sources ?? ["search_referrer"],
    byHour:
      overrides.byHour ??
      incrementByHour(undefined, lastSeen, (overrides.sources as never) ?? ["search_referrer"]),
    queryAttribution: overrides.queryAttribution,
    cmsReferrerCount: overrides.cmsReferrerCount ?? 0,
    likelyBot: overrides.likelyBot ?? false,
    lastProbe: overrides.lastProbe,
  };
}

describe("queryRuntimeIssuesForMcp", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const issues: RuntimeIssueMcpRow[] = [
    row({
      fingerprint: "a",
      path: "/en/old-pricing",
      sampleReferrer: "https://google.com/",
      sources: ["search_referrer"],
      queryAttribution: {
        source: ["google"],
        medium: ["cpc"],
        campaign: ["fall"],
        other: { gclid: ["abc"] },
      },
      cmsReferrerCount: 2,
    }),
    row({
      fingerprint: "b",
      path: "/en/assets/logo.png",
      sources: ["human"],
    }),
    row({
      fingerprint: "c",
      path: "/es/missing-course",
      locale: "es",
      sources: ["internal"],
      sampleReferrer: "https://4geeks.com/es",
    }),
    {
      ...row({ fingerprint: "other", path: "/en/other-kind" }),
      kind: "http.server_error",
    },
  ];

  it("refuses unknown kind", () => {
    const result = queryRuntimeIssuesForMcp(issues, { kind: "500" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_kind");
  });

  it("returns only http.not_found rows as kind 404", () => {
    const result = queryRuntimeIssuesForMcp(issues, {
      kind: "404",
      pages_only: false,
      window_days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.every((i) => i.kind === "404")).toBe(true);
    expect(result.issues.map((i) => i.fingerprint)).not.toContain("other");
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("matches path substring and includes brief proof fields", () => {
    const result = queryRuntimeIssuesForMcp(issues, {
      kind: "404",
      path: "pricing",
      pages_only: true,
      window_days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toHaveLength(1);
    const hit = result.issues[0]!;
    expect(hit.path).toBe("/en/old-pricing");
    expect(hit.count).toBeGreaterThan(0);
    expect(hit.sources).toContain("search_referrer");
    expect(hit.sampleReferrer).toContain("google");
    expect(hit.queryAttribution).toEqual({
      source: ["google"],
      medium: ["cpc"],
      campaign: ["fall"],
      other: { gclid: ["abc"] },
    });
    expect(hit.cmsReferrerCount).toBe(2);
  });

  it("filters by source tag with windowed hits", () => {
    const result = queryRuntimeIssuesForMcp(issues, {
      kind: "404",
      source: "internal",
      pages_only: true,
      window_days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.map((i) => i.fingerprint)).toEqual(["c"]);
  });

  it("query_params_only keeps attributed rows", () => {
    const result = queryRuntimeIssuesForMcp(issues, {
      kind: "404",
      query_params_only: true,
      pages_only: true,
      window_days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.map((i) => i.fingerprint)).toEqual(["a"]);
  });

  it("pages_only hides asset paths by default", () => {
    const result = queryRuntimeIssuesForMcp(issues, {
      kind: "404",
      window_days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.map((i) => i.fingerprint)).not.toContain("b");
  });
});

describe("clampRuntimeIssuesLimit", () => {
  it("defaults to 25 and caps at 100", () => {
    expect(clampRuntimeIssuesLimit(undefined)).toBe(25);
    expect(clampRuntimeIssuesLimit(0)).toBe(1);
    expect(clampRuntimeIssuesLimit(200)).toBe(100);
  });
});
