import { describe, expect, it } from "vitest";
import { applyRowStamp, applyRowStampsBulk, stripRowStamp } from "./database-row-stamp";
import { ROW_STAMP_KEY, rowTrust } from "@shared/evidence-kinds";
import { ARCHIVE_KEY, archiveView } from "@shared/evidence-archive";

const evidence = {
  enabled: true,
  proves: ["press_coverage"],
  proof_field: "link_url",
  match_fields: ["organization", "tags"],
};
const now = new Date("2026-10-28T12:00:00Z");
const staff = { type: "staff" as const, author: "alice" };
const agent = { type: "agent" as const, author: "mcp" };

const verifiedRow = {
  title: "Chosen by the Bahamas",
  organization: "Government of the Bahamas",
  link_url: "https://example.com/a",
  image: "a.png",
  [ROW_STAMP_KEY]: { type: "staff", author: "alice", at: "2026-01-01T00:00:00Z" },
};

describe("applyRowStamp", () => {
  it("stamps a new agent row as unverified", () => {
    const row = applyRowStamp({ prev: null, next: { title: "x", link_url: "y" }, evidence, writer: agent, now });
    expect(rowTrust(row)).toBe("unverified");
  });

  it("drops a client-sent stamp", () => {
    const row = applyRowStamp({
      prev: null,
      next: { title: "x", [ROW_STAMP_KEY]: { type: "staff", author: "fake", at: "x" } },
      evidence,
      writer: agent,
      now,
    });
    expect((row[ROW_STAMP_KEY] as { author: string }).author).toBe("mcp");
  });

  it("an agent image-only edit keeps the verified stamp", () => {
    const row = applyRowStamp({
      prev: verifiedRow,
      next: { ...verifiedRow, image: "b.png" },
      evidence,
      writer: agent,
      now,
    });
    expect(rowTrust(row)).toBe("verified");
  });

  it("an agent link edit makes the row unverified", () => {
    const row = applyRowStamp({
      prev: verifiedRow,
      next: { ...verifiedRow, link_url: "https://example.com/b" },
      evidence,
      writer: agent,
      now,
    });
    expect(rowTrust(row)).toBe("unverified");
  });

  it("an agent excerpt edit makes the row unverified", () => {
    const row = applyRowStamp({
      prev: verifiedRow,
      next: { ...verifiedRow, excerpt: "contracted to reskill the workforce" },
      evidence,
      writer: agent,
      now,
    });
    expect(rowTrust(row)).toBe("unverified");
  });

  it("a staff proof edit verifies the row", () => {
    const unverified = { ...verifiedRow, [ROW_STAMP_KEY]: { type: "agent", author: "mcp", at: "x" } };
    const row = applyRowStamp({
      prev: unverified,
      next: { ...unverified, link_url: "https://example.com/c" },
      evidence,
      writer: staff,
      now,
    });
    expect(rowTrust(row)).toBe("verified");
  });

  it("leaves non-evidence databases unstamped", () => {
    const row = applyRowStamp({ prev: null, next: { title: "x" }, evidence: undefined, writer: agent, now });
    expect(ROW_STAMP_KEY in row).toBe(false);
  });
});

describe("_archive record", () => {
  const archive = {
    source_url: "https://example.com/a",
    status: "archived",
    url: "https://web.archive.org/web/20260101000000/https://example.com/a",
    captured_at: "2026-01-01T00:00:00.000Z",
    error: null,
    set_by: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    original: null,
  };
  const archivedRow = { ...verifiedRow, [ARCHIVE_KEY]: archive };

  it("is stripped with the stamp", () => {
    const out = stripRowStamp(archivedRow);
    expect(ARCHIVE_KEY in out).toBe(false);
    expect(ROW_STAMP_KEY in out).toBe(false);
  });

  it("a client-sent record is dropped and the previous one carried forward", () => {
    const row = applyRowStamp({
      prev: archivedRow,
      next: { ...archivedRow, image: "b.png", [ARCHIVE_KEY]: { source_url: "x", status: "manual", url: "https://evil" } },
      evidence,
      writer: agent,
      now,
    });
    expect(row[ARCHIVE_KEY]).toEqual(archive);
  });

  it("a link change keeps the old record, which is now stale", () => {
    const row = applyRowStamp({
      prev: archivedRow,
      next: { ...stripRowStamp(archivedRow), link_url: "https://example.com/b" },
      evidence,
      writer: staff,
      now,
    });
    expect(row[ARCHIVE_KEY]).toEqual(archive);
    expect(archiveView(row, "link_url").status).toBe("not_archived");
  });

  it("bulk saves keep the record when only the title changed", () => {
    const out = applyRowStampsBulk({
      prevRows: [archivedRow],
      nextRows: [{ ...stripRowStamp(archivedRow), title: "Renamed" }],
      evidence,
      writer: staff,
      now,
    });
    expect(out[0]![ARCHIVE_KEY]).toEqual(archive);
  });
});

describe("applyRowStampsBulk", () => {
  it("rows unchanged in proof fields keep their stamp even when reordered", () => {
    const other = { title: "Other", organization: "IDB", link_url: "https://example.com/idb" };
    const out = applyRowStampsBulk({
      prevRows: [verifiedRow, other],
      nextRows: [stripRowStamp({ ...other }), stripRowStamp({ ...verifiedRow, image: "c.png" })],
      evidence,
      writer: agent,
      now,
    });
    expect(rowTrust(out[1])).toBe("verified");
    expect(rowTrust(out[0])).toBe("trusted");
  });
});
