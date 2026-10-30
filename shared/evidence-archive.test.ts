import { describe, expect, it } from "vitest";
import {
  ARCHIVE_KEY,
  archiveView,
  archiveCopyCapturedAt,
  isArchiveCopyUrl,
  isWaybackUrl,
  normalizeBackupArchiveUrl,
  rowNeedsArchive,
  waybackTimestampToIso,
} from "./evidence-archive";

const link = "https://www.forbes.com/advisor/a";
const rec = (over: Record<string, unknown> = {}) => ({
  source_url: link,
  status: "archived",
  url: `https://web.archive.org/web/20240529143404/${link}`,
  captured_at: "2024-05-29T14:34:04.000Z",
  error: null,
  set_by: null,
  updated_at: "2026-10-01T00:00:00.000Z",
  original: null,
  ...over,
});

describe("archiveView", () => {
  it("none when the row has no link", () => {
    expect(archiveView({ title: "x" }, "link_url").status).toBe("none");
  });

  it("not_archived when there is no record", () => {
    expect(archiveView({ link_url: link }, "link_url").status).toBe("not_archived");
  });

  it("a record for another link is stale", () => {
    const row = { link_url: "https://other.example/b", [ARCHIVE_KEY]: rec() };
    expect(archiveView(row, "link_url").status).toBe("not_archived");
  });

  it("archived with url and capture date", () => {
    const v = archiveView({ link_url: link, [ARCHIVE_KEY]: rec() }, "link_url");
    expect(v).toMatchObject({ status: "archived", url: rec().url, manual: false, original_gone: false });
  });

  it("a link that already is a Wayback URL counts as archived", () => {
    const wb = "https://web.archive.org/web/20261008134545/https://www.entnerd.com/x/";
    const v = archiveView({ link_url: wb }, "link_url");
    expect(v.status).toBe("archived");
    expect(v.url).toBe(wb);
    expect(v.captured_at).toBe("2026-10-08T13:45:45.000Z");
  });

  it("an archive.today link counts as archived and is never queued", () => {
    const ph = "https://archive.ph/2024.05.29-143404/https://a.com/x";
    expect(archiveView({ link_url: ph }, "link_url")).toMatchObject({ status: "archived", url: ph, captured_at: "2024-05-29T14:34:04.000Z" });
    expect(rowNeedsArchive({ link_url: ph }, "link_url")).toBe(false);
  });

  it("a Wayback calendar link is not a copy, so it still needs archiving", () => {
    const cal = "https://web.archive.org/web/2024*/https://a.com/x";
    expect(archiveView({ link_url: cal }, "link_url").status).toBe("not_archived");
    expect(rowNeedsArchive({ link_url: cal }, "link_url")).toBe(true);
  });

  it("manual copies are archived and flagged; original gone surfaces", () => {
    const v = archiveView(
      { link_url: link, [ARCHIVE_KEY]: rec({ status: "manual", url: "https://archive.ph/abc", original: { status: "gone", checked_at: "x" } }) },
      "link_url",
    );
    expect(v).toMatchObject({ status: "archived", manual: true, original_gone: true });
  });

  it("failed keeps the reason", () => {
    const v = archiveView({ link_url: link, [ARCHIVE_KEY]: rec({ status: "failed", url: null, error: "blocked" }) }, "link_url");
    expect(v).toMatchObject({ status: "failed", error: "blocked" });
  });
});

describe("rowNeedsArchive", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  it("true without a record, false once archived or manual", () => {
    expect(rowNeedsArchive({ link_url: link }, "link_url")).toBe(true);
    expect(rowNeedsArchive({ link_url: link, [ARCHIVE_KEY]: rec() }, "link_url")).toBe(false);
    expect(rowNeedsArchive({ link_url: link, [ARCHIVE_KEY]: rec({ status: "manual" }) }, "link_url")).toBe(false);
  });

  it("false for empty or Wayback links", () => {
    expect(rowNeedsArchive({}, "link_url")).toBe(false);
    expect(rowNeedsArchive({ link_url: "https://web.archive.org/web/2024/https://a.com" }, "link_url")).toBe(false);
  });

  it("failed retries only after the wait", () => {
    const failed = { link_url: link, [ARCHIVE_KEY]: rec({ status: "failed", updated_at: "2026-10-25T00:00:00Z" }) };
    expect(rowNeedsArchive(failed, "link_url", { now, retryFailedAfterMs: 7 * 86400_000 })).toBe(false);
    expect(rowNeedsArchive(failed, "link_url", { now, retryFailedAfterMs: 86400_000 })).toBe(true);
    expect(rowNeedsArchive(failed, "link_url", { now, retryFailedAfterMs: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("pending is re-queued only when stuck for over an hour", () => {
    const fresh = { link_url: link, [ARCHIVE_KEY]: rec({ status: "pending", updated_at: "2026-10-28T23:30:00Z" }) };
    const stuck = { link_url: link, [ARCHIVE_KEY]: rec({ status: "pending", updated_at: "2026-10-28T20:00:00Z" }) };
    expect(rowNeedsArchive(fresh, "link_url", { now })).toBe(false);
    expect(rowNeedsArchive(stuck, "link_url", { now })).toBe(true);
  });
});

describe("helpers", () => {
  it("parses Wayback timestamps", () => {
    expect(waybackTimestampToIso("20240529143404")).toBe("2024-05-29T14:34:04.000Z");
    expect(waybackTimestampToIso("2024")).toBe("2024-01-01T00:00:00.000Z");
    expect(waybackTimestampToIso("nope")).toBeNull();
  });

  it("recognizes Wayback snapshots but not calendar pages", () => {
    expect(isWaybackUrl("https://web.archive.org/web/20240529143404/https://a.com/x")).toBe(true);
    expect(isWaybackUrl("https://web.archive.org/web/20240529143404id_/https://a.com/x")).toBe(true);
    expect(isWaybackUrl("https://web.archive.org/web/2024*/https://a.com/x")).toBe(false);
    expect(isWaybackUrl("https://web.archive.org/web/*/https://a.com/x")).toBe(false);
    expect(isWaybackUrl("https://a.com/x")).toBe(false);
  });

  it("recognizes archive.today snapshots on every mirror", () => {
    expect(isArchiveCopyUrl("https://archive.ph/AbC12")).toBe(true);
    expect(isArchiveCopyUrl("https://archive.today/AbC12")).toBe(true);
    expect(isArchiveCopyUrl("https://www.archive.is/AbC12/")).toBe(true);
    expect(isArchiveCopyUrl("https://archive.ph/2024.05.29-143404/https://a.com/x")).toBe(true);
    expect(archiveCopyCapturedAt("https://archive.ph/2024.05.29-143404/https://a.com/x")).toBe("2024-05-29T14:34:04.000Z");
    expect(archiveCopyCapturedAt("https://archive.ph/AbC12")).toBeNull();
  });

  it("archive.today site pages and other hosts are not copies", () => {
    expect(isArchiveCopyUrl("https://archive.ph/newest/https://a.com/x")).toBe(false);
    expect(isArchiveCopyUrl("https://archive.ph/newest")).toBe(false);
    expect(isArchiveCopyUrl("https://archive.ph/")).toBe(false);
    expect(isArchiveCopyUrl("https://archive.org/details/some-item")).toBe(false);
    expect(isArchiveCopyUrl("https://notarchive.ph/AbC12")).toBe(false);
  });

  it("accepts only http(s) backup links", () => {
    expect(normalizeBackupArchiveUrl(" https://archive.ph/abc ")).toBe("https://archive.ph/abc");
    expect(normalizeBackupArchiveUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBackupArchiveUrl("not a url")).toBeNull();
    expect(normalizeBackupArchiveUrl(42)).toBeNull();
  });
});
