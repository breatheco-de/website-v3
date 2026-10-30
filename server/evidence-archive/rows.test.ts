import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const marked: Array<{ file: string; author?: string; contentRoot?: string }> = [];
vi.mock("../sync-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync-state")>();
  return {
    ...actual,
    markFileAsModified: (file: string, author?: string, _ex?: unknown, contentRoot?: string) => {
      marked.push({ file, author, contentRoot });
    },
  };
});

import { ARCHIVE_KEY, readArchiveRecord, type ArchiveRecord } from "@shared/evidence-archive";
import { applyEvidenceArchiveDone, EVIDENCE_ARCHIVE_AUTHOR } from "./apply";
import { evidenceDatabase, listEvidenceDatabases, manualRecord, mergeArchiveResult, pendingRecord } from "./rows";

const link = "https://www.forbes.com/advisor/a";
const snap = `https://web.archive.org/web/20261029120000/${link}`;

let tempDir: string;
let contentRoot: string;

function writeDb(rows: Record<string, unknown>[], evidence: unknown = { enabled: true, proves: ["press_coverage"], proof_field: "link_url", match_fields: ["organization"] }) {
  const dir = path.join(contentRoot, "db", "press");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.yml"),
    yaml.dump({ name: "Press", source: { type: "local", local: { filename: "rows.yml", results_path: "press" } }, evidence }),
  );
  fs.writeFileSync(path.join(dir, "rows.yml"), yaml.dump({ press: rows }));
}

function rowsOnDisk(): Record<string, unknown>[] {
  return (yaml.load(fs.readFileSync(path.join(contentRoot, "db", "press", "rows.yml"), "utf-8")) as { press: Record<string, unknown>[] }).press;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-archive-"));
  contentRoot = path.join(tempDir, "site_ev");
  marked.length = 0;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const archivedResult = (at: string) => ({
  kind: "archive" as const,
  outcome: { status: "archived" as const, url: snap, captured_at: "2026-10-29T12:00:00.000Z" },
  at,
});
const failedResult = (at: string) => ({
  kind: "archive" as const,
  outcome: { status: "failed" as const, error: "This site blocks archive.org.", retryable: false },
  at,
});

describe("mergeArchiveResult", () => {
  const pending = pendingRecord(null, link, "2026-10-29T10:00:00.000Z");

  it("archives a pending record", () => {
    expect(mergeArchiveResult(pending, link, archivedResult("2026-10-29T11:00:00.000Z"))).toMatchObject({ status: "archived", url: snap });
  });

  it("never replaces a staff-pasted copy", () => {
    const manual = manualRecord(null, link, "https://archive.ph/x", "alice", "2026-10-01T00:00:00.000Z");
    expect(mergeArchiveResult(manual, link, archivedResult("2026-10-29T11:00:00.000Z"))).toBeNull();
  });

  it("drops results older than the record", () => {
    expect(mergeArchiveResult(pending, link, archivedResult("2026-10-29T09:00:00.000Z"))).toBeNull();
  });

  it("a failure never downgrades an archived copy", () => {
    const archived = mergeArchiveResult(pending, link, archivedResult("2026-10-29T11:00:00.000Z"))!;
    expect(mergeArchiveResult(archived, link, failedResult("2026-10-29T12:00:00.000Z"))).toBeNull();
  });

  it("original checks only touch existing records", () => {
    expect(mergeArchiveResult(null, link, { kind: "original", original: "gone", at: "2026-10-29T12:00:00.000Z" })).toBeNull();
    const archived = mergeArchiveResult(pending, link, archivedResult("2026-10-29T11:00:00.000Z"))!;
    const gone = mergeArchiveResult(archived, link, { kind: "original", original: "gone", at: "2026-10-29T12:00:00.000Z" });
    expect(gone?.original).toEqual({ status: "gone", checked_at: "2026-10-29T12:00:00.000Z" });
    expect(gone?.status).toBe("archived");
  });
});

describe("applyEvidenceArchiveDone", () => {
  it("writes to every row whose link matches (not by index) and marks the file modified", () => {
    writeDb([
      { title: "Other", organization: "IDB", link_url: "https://idb.example" },
      { title: "Forbes", organization: "Forbes", link_url: link, [ARCHIVE_KEY]: pendingRecord(null, link, "2026-10-29T10:00:00.000Z") },
    ]);
    const changed = applyEvidenceArchiveDone(contentRoot, { database: "press", source_url: link, result: archivedResult("2026-10-29T11:00:00.000Z") });
    expect(changed).toBe(1);
    const rows = rowsOnDisk();
    expect(ARCHIVE_KEY in rows[0]!).toBe(false);
    expect(readArchiveRecord(rows[1])).toMatchObject({ status: "archived", url: snap });
    expect(marked).toEqual([{ file: "db/press/rows.yml", author: EVIDENCE_ARCHIVE_AUTHOR, contentRoot }]);
  });

  it("is idempotent and skips manual records", () => {
    const manual: ArchiveRecord = manualRecord(null, link, "https://archive.ph/x", "alice", "2026-10-01T00:00:00.000Z");
    writeDb([{ title: "Forbes", organization: "Forbes", link_url: link, [ARCHIVE_KEY]: manual }]);
    expect(applyEvidenceArchiveDone(contentRoot, { database: "press", source_url: link, result: archivedResult("2026-10-29T11:00:00.000Z") })).toBe(0);
    expect(readArchiveRecord(rowsOnDisk()[0])).toMatchObject({ status: "manual", url: "https://archive.ph/x" });
    expect(marked).toEqual([]);
  });

  it("ignores a link that is no longer on any row", () => {
    writeDb([{ title: "Forbes", organization: "Forbes", link_url: "https://new.example" }]);
    expect(applyEvidenceArchiveDone(contentRoot, { database: "press", source_url: link, result: archivedResult("2026-10-29T11:00:00.000Z") })).toBe(0);
  });

  it("rejects malformed payloads and non-evidence databases", () => {
    writeDb([{ link_url: link }], null);
    expect(evidenceDatabase(contentRoot, "press")).toBeNull();
    expect(listEvidenceDatabases(contentRoot)).toEqual([]);
    expect(applyEvidenceArchiveDone(contentRoot, { database: "press", source_url: link, result: archivedResult("2026-10-29T11:00:00.000Z") })).toBe(0);
    expect(applyEvidenceArchiveDone(contentRoot, { database: "../x", source_url: link, result: { kind: "nope" } })).toBe(0);
  });
});
