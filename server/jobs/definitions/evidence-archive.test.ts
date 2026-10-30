import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_KEY } from "@shared/evidence-archive";
import { pendingRecord } from "../../evidence-archive/rows";
import { runEvidenceArchive, type EvidenceArchiveDeps } from "./evidence-archive";
import {
  runEvidenceArchiveSweep,
  scheduleEvidenceArchiveSweep,
  type EvidenceArchiveSweepDeps,
} from "./evidence-archive-sweep";

const link = "https://www.forbes.com/advisor/a";
const payload = { site: "site_ev", contentRoot: "/tmp/site_ev", database: "press", source_url: link };
const now = new Date("2026-10-29T12:00:00.000Z");

function archiveDeps(over: Partial<EvidenceArchiveDeps>): EvidenceArchiveDeps {
  return {
    isLive: () => true,
    archive: async () => ({ status: "archived", url: `https://web.archive.org/web/1/${link}`, captured_at: null }),
    emit: vi.fn() as unknown as EvidenceArchiveDeps["emit"],
    enqueue: vi.fn(async () => ({ queued: true })) as unknown as EvidenceArchiveDeps["enqueue"],
    now: () => now,
    ...over,
  };
}

describe("runEvidenceArchive", () => {
  it("does nothing off the live server", async () => {
    const deps = archiveDeps({ isLive: () => false, archive: vi.fn() });
    expect(await runEvidenceArchive(payload, deps)).toEqual({ status: "skipped" });
    expect(deps.archive).not.toHaveBeenCalled();
  });

  it("emits evidence_archive_done with the outcome", async () => {
    const deps = archiveDeps({});
    expect(await runEvidenceArchive(payload, deps)).toEqual({ status: "archived" });
    expect(deps.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        site: "site_ev",
        type: "evidence_archive_done",
        payload: expect.objectContaining({ database: "press", source_url: link, result: expect.objectContaining({ kind: "archive" }) }),
      }),
    );
  });

  it("retries busy failures with a delay before reporting them", async () => {
    const busy = async () => ({ status: "failed" as const, error: "busy", retryable: true });
    const first = archiveDeps({ archive: busy });
    expect(await runEvidenceArchive(payload, first)).toEqual({ status: "retry_scheduled" });
    expect(first.emit).not.toHaveBeenCalled();
    expect(first.enqueue).toHaveBeenCalledWith(
      "evidence_archive",
      expect.objectContaining({ attempt: 2 }),
      expect.objectContaining({ delayMs: 30 * 60_000 }),
    );

    const last = archiveDeps({ archive: busy });
    expect(await runEvidenceArchive({ ...payload, attempt: 3 }, last)).toEqual({ status: "failed" });
    expect(last.emit).toHaveBeenCalled();
    expect(last.enqueue).not.toHaveBeenCalled();
  });
});

describe("runEvidenceArchiveSweep", () => {
  let tempDir: string;
  let contentRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-sweep-"));
    contentRoot = path.join(tempDir, "site_ev");
    const dir = path.join(contentRoot, "db", "press");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.yml"),
      yaml.dump({
        name: "Press",
        source: { type: "local", local: { filename: "rows.yml", results_path: "press" } },
        evidence: { enabled: true, proves: ["press_coverage"], proof_field: "link_url", match_fields: ["organization"] },
      }),
    );
    const archived = {
      ...pendingRecord(null, "https://archived.example", "2026-10-01T00:00:00.000Z"),
      status: "archived",
      url: "https://web.archive.org/web/1/https://archived.example",
    };
    fs.writeFileSync(
      path.join(dir, "rows.yml"),
      yaml.dump({
        press: [
          { organization: "A", link_url: link },
          { organization: "A again", link_url: link },
          { organization: "B", link_url: "https://archived.example", [ARCHIVE_KEY]: archived },
          { organization: "C", link_url: "https://web.archive.org/web/2024/https://c.example" },
          { organization: "D" },
        ],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function sweepDeps(over: Partial<EvidenceArchiveSweepDeps> = {}): EvidenceArchiveSweepDeps {
    return {
      isLive: () => true,
      sites: () => [{ site: "site_ev", contentRoot }],
      checkOriginal: vi.fn(async () => "ok" as const),
      enqueueArchive: vi.fn(async () => true),
      emit: vi.fn() as unknown as EvidenceArchiveSweepDeps["emit"],
      now: () => now,
      recordStarted: vi.fn(),
      ...over,
    };
  }

  it("queues each unarchived link once and checks originals of archived rows", async () => {
    const deps = sweepDeps();
    expect(await runEvidenceArchiveSweep(deps)).toEqual({ queued: 1, original_changed: 0 });
    expect(deps.enqueueArchive).toHaveBeenCalledTimes(1);
    expect(deps.enqueueArchive).toHaveBeenCalledWith(
      { site: "site_ev", contentRoot, database: "press", source_url: link },
      { delayMs: 0 },
    );
    expect(deps.checkOriginal).toHaveBeenCalledTimes(1);
    expect(deps.checkOriginal).toHaveBeenCalledWith("https://archived.example");
    expect(deps.recordStarted).toHaveBeenCalledWith(now.toISOString());
  });

  it("reports an original that is gone", async () => {
    const deps = sweepDeps({ checkOriginal: vi.fn(async () => "gone" as const) });
    expect(await runEvidenceArchiveSweep(deps)).toMatchObject({ original_changed: 1 });
    expect(deps.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "evidence_archive_done",
        payload: expect.objectContaining({ source_url: "https://archived.example", result: expect.objectContaining({ kind: "original", original: "gone" }) }),
      }),
    );
  });

  it("does nothing off the live server", async () => {
    const deps = sweepDeps({ isLive: () => false });
    expect(await runEvidenceArchiveSweep(deps)).toMatchObject({ queued: 0, skipped: true });
    expect(deps.recordStarted).not.toHaveBeenCalled();
  });
});

describe("scheduleEvidenceArchiveSweep", () => {
  const base = {
    isLive: () => true,
    schedule: vi.fn(async () => true),
    enqueue: vi.fn(async () => ({ queued: true })),
    now: () => now.getTime(),
  };

  it("off the live server schedules nothing", async () => {
    const schedule = vi.fn();
    const out = await scheduleEvidenceArchiveSweep({ ...base, isLive: () => false, schedule, lastStartedAt: () => undefined } as never);
    expect(out).toEqual({ scheduled: false, catch_up: false });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("catches up when no sweep ran in the last week (first run backfills)", async () => {
    const enqueue = vi.fn(async () => ({ queued: true }));
    const out = await scheduleEvidenceArchiveSweep({ ...base, enqueue, lastStartedAt: () => undefined } as never);
    expect(out).toEqual({ scheduled: true, catch_up: true });
    expect(enqueue).toHaveBeenCalledWith("evidence_archive_sweep", {}, expect.objectContaining({ uniqueKey: "evidence_archive_sweep" }));
  });

  it("no catch-up after a recent sweep", async () => {
    const enqueue = vi.fn();
    const out = await scheduleEvidenceArchiveSweep({ ...base, enqueue, lastStartedAt: () => "2026-10-27T00:00:00.000Z" } as never);
    expect(out).toEqual({ scheduled: true, catch_up: false });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
