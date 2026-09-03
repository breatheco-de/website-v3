import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUrlTargets = vi.fn();
const runDiagnosticsJob = vi.fn();
const issuesBySlugFromTargets = vi.fn();
const effectiveValidatorNames = vi.fn();

vi.mock("../../scripts/validation/runDiagnosticsJob", () => ({
  resolveUrlTargets: (...args: unknown[]) => resolveUrlTargets(...args),
  runDiagnosticsJob: (...args: unknown[]) => runDiagnosticsJob(...args),
  issuesBySlugFromTargets: (...args: unknown[]) => issuesBySlugFromTargets(...args),
  effectiveValidatorNames: (...args: unknown[]) => effectiveValidatorNames(...args),
}));

vi.mock("child_process", () => ({
  fork: vi.fn(() => {
    throw new Error("fork should not be called for one-slug sync");
  }),
}));

import {
  clearDiagnosticsRuntimeForTests,
  isDiagnosticsRunning,
  markAsyncJobRunningForTests,
  markSyncInFlightForTests,
  startDiagnosticsJob,
} from "./diagnosticsJobService";

const contentRoot = "/tmp/diag-sync-test-root";
const targets = [
  {
    url: "https://example.com/en/page",
    slug: "one-page",
    filePath: "/tmp/en.yml",
    locale: "en",
    type: "pages",
  },
];

function mockCache() {
  return {
    getByUrl: vi.fn(() => undefined),
    reloadFromDisk: vi.fn(),
    flush: vi.fn(async () => {}),
  } as any;
}

describe("startDiagnosticsJob one-slug sync", () => {
  beforeEach(() => {
    clearDiagnosticsRuntimeForTests();
    vi.clearAllMocks();
    effectiveValidatorNames.mockReturnValue({
      pageValidators: ["seo-depth"],
      siteWideValidators: [],
      partial: false,
    });
    resolveUrlTargets.mockResolvedValue(targets);
    issuesBySlugFromTargets.mockReturnValue({
      issuesBySlug: { "one-page": [] },
      lastFullRunAtBySlug: { "one-page": "2026-09-03T00:00:00.000Z" },
      cacheMisses: [],
    });
    runDiagnosticsJob.mockResolvedValue({
      summary: { errorCount: 0, warningCount: 0 },
      validatorResults: [],
      issuesBySlug: { "one-page": [] },
      resultsPayload: { summary: { errorCount: 0, warningCount: 0 }, issuesBySlug: {} },
    });
  });

  it("returns completed mode sync for exactly one slug without taking site lock", async () => {
    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page"],
      freshness: "hard",
      callerId: "agent-a",
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.mode).toBe("sync");
      expect(result.site_job_parallel).toBe(false);
      expect(result.summary).toEqual({ errorCount: 0, warningCount: 0 });
    }
    expect(runDiagnosticsJob).toHaveBeenCalledTimes(1);
    expect(isDiagnosticsRunning(contentRoot)).toBe(false);
  });

  it("still syncs when a site async job is running (site_job_parallel)", async () => {
    markAsyncJobRunningForTests(contentRoot);
    expect(isDiagnosticsRunning(contentRoot)).toBe(true);

    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page"],
      freshness: "hard",
      callerId: "agent-a",
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.mode).toBe("sync");
      expect(result.site_job_parallel).toBe(true);
    }
    expect(runDiagnosticsJob).toHaveBeenCalledTimes(1);
  });

  it("returns diagnostics_sync_busy when same callerId already has a sync in flight", async () => {
    markSyncInFlightForTests("agent-a", { slug: "other", urlCount: 2 });

    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page"],
      freshness: "hard",
      callerId: "agent-a",
    });

    expect(result).toMatchObject({
      status: "busy",
      code: "diagnostics_sync_busy",
    });
    expect(runDiagnosticsJob).not.toHaveBeenCalled();
  });

  it("allows a different callerId while another sync is in flight", async () => {
    markSyncInFlightForTests("agent-a", { slug: "other", urlCount: 2 });

    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page"],
      freshness: "hard",
      callerId: "agent-b",
    });

    expect(result.status).toBe("completed");
    expect(runDiagnosticsJob).toHaveBeenCalledTimes(1);
  });

  it("returns site diagnostics_busy for multi-slug while async job running", async () => {
    markAsyncJobRunningForTests(contentRoot);
    resolveUrlTargets.mockResolvedValue([
      ...targets,
      {
        url: "https://example.com/en/other",
        slug: "two-page",
        filePath: "/tmp/other.yml",
        locale: "en",
        type: "pages",
      },
    ]);

    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page", "two-page"],
      freshness: "hard",
      callerId: "agent-a",
    });

    expect(result).toMatchObject({
      status: "busy",
      code: "diagnostics_busy",
    });
    expect(runDiagnosticsJob).not.toHaveBeenCalled();
  });
});
