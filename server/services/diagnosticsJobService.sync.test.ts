import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

const resolveUrlTargets = vi.fn();
const issuesBySlugFromTargets = vi.fn();
const effectiveValidatorNames = vi.fn();
const fork = vi.fn();

vi.mock("../../scripts/validation/runDiagnosticsJob", () => ({
  resolveUrlTargets: (...args: unknown[]) => resolveUrlTargets(...args),
  issuesBySlugFromTargets: (...args: unknown[]) => issuesBySlugFromTargets(...args),
  effectiveValidatorNames: (...args: unknown[]) => effectiveValidatorNames(...args),
  runDiagnosticsJob: vi.fn(() => {
    throw new Error("runDiagnosticsJob must not run in-process");
  }),
}));

vi.mock("child_process", () => ({
  fork: (...args: unknown[]) => fork(...args),
}));

import {
  clearDiagnosticsRuntimeForTests,
  isDiagnosticsRunning,
  markAsyncJobRunningForTests,
  startDiagnosticsJob,
} from "./diagnosticsJobService";

const contentRoot = "/tmp/diag-async-test-root";
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

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    connected: boolean;
  };
  child.send = vi.fn(() => true);
  child.kill = vi.fn();
  child.connected = true;
  return child;
}

describe("startDiagnosticsJob always async (including one slug)", () => {
  beforeEach(() => {
    clearDiagnosticsRuntimeForTests();
    vi.clearAllMocks();
    fork.mockImplementation(() => mockChild());
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
  });

  it("queues a forked job for exactly one slug (no in-process sync)", async () => {
    const result = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "test",
      ci: {} as any,
      cache: mockCache(),
      slugs: ["one-page"],
      freshness: "hard",
      callerId: "agent-a",
    });

    expect(result.status).toBe("queued");
    if (result.status === "queued" || result.status === "running") {
      expect(result.job_id).toMatch(/^diag-/);
      expect(result.scope.slugs).toEqual(["one-page"]);
    }
    expect(fork).toHaveBeenCalledTimes(1);
    expect(isDiagnosticsRunning(contentRoot)).toBe(true);
  });

  it("returns site diagnostics_busy for one slug while async job running", async () => {
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

    expect(result).toMatchObject({
      status: "busy",
      code: "diagnostics_busy",
    });
    expect(fork).not.toHaveBeenCalled();
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
    expect(fork).not.toHaveBeenCalled();
  });
});
