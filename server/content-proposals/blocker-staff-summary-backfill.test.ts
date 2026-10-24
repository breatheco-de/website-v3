import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { backfillSiteBlockerStaffSummaries, selectBlockersMissingStaffSummary } from "./blocker-staff-summary-backfill";

const SITE = "site_test";
const TECH = "Publish drops EN `authors` + `published_at`; apply warns display_values_change. Copy to `_common.yml` first.";
const PLAIN =
  "Approving this would remove the author name and publish date from the live English post. Copy them into the settings both languages share first.";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE content_proposals (id TEXT PRIMARY KEY, site TEXT, status TEXT, title TEXT, updated_at INTEGER);
    CREATE TABLE content_proposal_blockers (
      id INTEGER PRIMARY KEY, proposal_id TEXT, body TEXT, staff_summary TEXT, status TEXT
    );
    INSERT INTO content_proposals VALUES
      ('open-1', '${SITE}', 'open', 'Grok redirect', 1),
      ('partial-1', '${SITE}', 'partial', 'Partial post', 1),
      ('done-1', '${SITE}', 'finished', 'Finished post', 1),
      ('other-site', 'site_other', 'open', 'Other site', 1);
    INSERT INTO content_proposal_blockers VALUES
      (1, 'open-1', '${TECH}', NULL, 'open'),
      (2, 'open-1', '${TECH}', 'Already plain text written by staff for this blocker earlier.', 'open'),
      (3, 'partial-1', '${TECH}', NULL, 'resolved'),
      (4, 'done-1', '${TECH}', NULL, 'open'),
      (5, 'other-site', '${TECH}', NULL, 'open');
  `);
  return db;
}

const quiet = { log: () => {}, error: () => {} };

describe("blocker staff summary backfill", () => {
  it("selects only blockers missing a staff version on open or partial proposals of this site", () => {
    const ids = selectBlockersMissingStaffSummary(makeDb(), SITE).map((r) => r.id);
    expect(ids).toEqual([1, 3]);
  });

  it("writes plain rewrites, never touches body or proposal timestamps, and is idempotent", async () => {
    const db = makeDb();
    const complete = vi.fn(async () => PLAIN);
    const first = await backfillSiteBlockerStaffSummaries({ db, site: SITE, dryRun: false, complete, ...quiet });
    expect(first).toEqual({ updated: 2, failed: 0, total: 2 });
    const rows = db.prepare(`SELECT id, body, staff_summary FROM content_proposal_blockers ORDER BY id`).all() as Array<{
      id: number;
      body: string;
      staff_summary: string | null;
    }>;
    expect(rows.find((r) => r.id === 1)?.staff_summary).toBe(PLAIN);
    expect(rows.find((r) => r.id === 3)?.staff_summary).toBe(PLAIN);
    expect(rows.find((r) => r.id === 4)?.staff_summary).toBeNull();
    expect(rows.every((r) => r.body === TECH)).toBe(true);
    expect((db.prepare(`SELECT MAX(updated_at) AS m FROM content_proposals`).get() as { m: number }).m).toBe(1);

    const second = await backfillSiteBlockerStaffSummaries({ db, site: SITE, dryRun: false, complete, ...quiet });
    expect(second).toEqual({ updated: 0, failed: 0, total: 0 });
  });

  it("retries with the problems, then counts a blocker as failed after three code-style replies", async () => {
    const db = makeDb();
    const complete = vi
      .fn<(prompt: string, system: string) => Promise<string>>()
      .mockResolvedValueOnce("The op drops published_at from en.yml before approving this.")
      .mockResolvedValueOnce(PLAIN)
      .mockResolvedValue("Still mentions display_values_change and the schema, sorry about that.");
    const res = await backfillSiteBlockerStaffSummaries({ db, site: SITE, dryRun: false, complete, ...quiet });
    expect(res).toEqual({ updated: 1, failed: 1, total: 2 });
    expect(complete.mock.calls[1]![0]).toContain('"published_at"');
    expect(complete).toHaveBeenCalledTimes(5);
    const left = selectBlockersMissingStaffSummary(db, SITE).map((r) => r.id);
    expect(left).toEqual([3]);
  });

  it("asks for a shorter rewrite when the reply is over the limit", async () => {
    const db = makeDb();
    const tooLong = `${PLAIN} `.repeat(6).trim();
    const complete = vi
      .fn<(prompt: string, system: string) => Promise<string>>()
      .mockResolvedValueOnce(tooLong)
      .mockResolvedValueOnce(tooLong)
      .mockResolvedValue(PLAIN);
    const res = await backfillSiteBlockerStaffSummaries({ db, site: SITE, dryRun: false, complete, ...quiet });
    expect(res).toEqual({ updated: 2, failed: 0, total: 2 });
    const shorten1 = complete.mock.calls[1]![0];
    const shorten2 = complete.mock.calls[2]![0];
    expect(shorten1).toContain("at most 400 characters");
    expect(shorten2).toContain("at most 300 characters");
    expect(shorten1).toContain(tooLong);
    expect(shorten1).not.toContain("Technical note:");
  });

  it("dry run writes nothing", async () => {
    const db = makeDb();
    const res = await backfillSiteBlockerStaffSummaries({
      db,
      site: SITE,
      dryRun: true,
      complete: async () => PLAIN,
      ...quiet,
    });
    expect(res).toEqual({ updated: 0, failed: 0, total: 2 });
    expect(selectBlockersMissingStaffSummary(db, SITE).map((r) => r.id)).toEqual([1, 3]);
  });
});
