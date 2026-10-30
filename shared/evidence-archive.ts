/**
 * Evidence archive copies: an Internet Archive copy of each evidence row's source link, kept by the
 * server under ARCHIVE_KEY. Never sent to pages, listings or agent item reads; clients cannot set it.
 */

export const ARCHIVE_KEY = "_archive";

export type ArchiveRecordStatus = "pending" | "archived" | "failed" | "manual";

export type OriginalLinkStatus = "ok" | "gone";

export interface ArchiveRecord {
  /** The proof link this record belongs to. A different current link makes the record stale. */
  source_url: string;
  status: ArchiveRecordStatus;
  url: string | null;
  captured_at: string | null;
  /** Plain reason when status is failed. */
  error: string | null;
  /** Staff author when status is manual (pasted backup link). */
  set_by: string | null;
  updated_at: string;
  original: { status: OriginalLinkStatus; checked_at: string } | null;
}

/** What staff and proposal review see. `none` = the row has no link to archive. */
export type ArchiveStatus = "none" | "not_archived" | "pending" | "archived" | "failed";

export interface RowArchiveView {
  status: ArchiveStatus;
  url: string | null;
  captured_at: string | null;
  error: string | null;
  /** The archived copy is a staff-pasted backup link. */
  manual: boolean;
  /** The weekly check found the original link returning 404 / 410. */
  original_gone: boolean;
}

/** One Wayback snapshot: a timestamp plus an optional replay flag (`id_`, `if_`…). Calendar pages (`2024*`) are not copies. */
const WAYBACK_URL = /^https?:\/\/(?:web\.)?archive\.org\/web\/(\d{4,14})(?:[a-z]{2}_)?\/(.+)$/i;

export function isWaybackUrl(url: string): boolean {
  return WAYBACK_URL.test(url.trim());
}

const ARCHIVE_TODAY_HOSTS = new Set([
  "archive.today",
  "archive.ph",
  "archive.is",
  "archive.li",
  "archive.vn",
  "archive.fo",
  "archive.md",
]);
/** Snapshot ids look like `/AbC12`; these same-length paths are site pages, not snapshots. */
const ARCHIVE_TODAY_PAGES = new Set(["newest", "oldest", "latest", "search", "submit", "faq", "timemap", "timegate"]);
const ARCHIVE_TODAY_SHORT = /^\/([A-Za-z0-9]{4,10})\/?$/;
const ARCHIVE_TODAY_DATED = /^\/(\d{4})\.(\d{2})\.(\d{2})-(\d{2})(\d{2})(\d{2})\/.+/;

/** archive.today snapshot (short id or dated form) and its capture time when the URL carries one. */
function archiveTodaySnapshot(url: string): { captured_at: string | null } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!ARCHIVE_TODAY_HOSTS.has(u.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  const short = ARCHIVE_TODAY_SHORT.exec(u.pathname);
  if (short) return ARCHIVE_TODAY_PAGES.has(short[1]!.toLowerCase()) ? null : { captured_at: null };
  const dated = ARCHIVE_TODAY_DATED.exec(u.pathname);
  if (!dated) return null;
  const [, y, mo, d, h, mi, s] = dated;
  return { captured_at: waybackTimestampToIso(`${y}${mo}${d}${h}${mi}${s}`) };
}

/** The link is itself a saved copy (Wayback snapshot or archive.today snapshot). */
export function isArchiveCopyUrl(url: string): boolean {
  return isWaybackUrl(url) || archiveTodaySnapshot(url) !== null;
}

/** Capture time encoded in a saved-copy URL, or null. */
export function archiveCopyCapturedAt(url: string): string | null {
  return waybackCapturedAt(url) ?? archiveTodaySnapshot(url)?.captured_at ?? null;
}

/** Wayback timestamp (YYYYMMDDhhmmss, possibly shorter) → ISO string, or null. */
export function waybackTimestampToIso(ts: string): string | null {
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?$/.exec(ts.trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Capture time encoded in a Wayback snapshot URL, or null. */
export function waybackCapturedAt(url: string): string | null {
  const m = WAYBACK_URL.exec(url.trim());
  return m ? waybackTimestampToIso(m[1]!) : null;
}

/** Trimmed proof link of a row, or null when empty / not a string. */
export function rowProofLink(row: Record<string, unknown> | null | undefined, proofField: string): string | null {
  const v = row?.[proofField];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const RECORD_STATUSES: readonly ArchiveRecordStatus[] = ["pending", "archived", "failed", "manual"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function readArchiveRecord(row: Record<string, unknown> | null | undefined): ArchiveRecord | null {
  const raw = row?.[ARCHIVE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const source = str(r.source_url);
  const status = r.status;
  if (!source || typeof status !== "string" || !(RECORD_STATUSES as readonly string[]).includes(status)) return null;
  const o = r.original as Record<string, unknown> | null | undefined;
  const original =
    o && typeof o === "object" && (o.status === "ok" || o.status === "gone")
      ? { status: o.status as OriginalLinkStatus, checked_at: str(o.checked_at) ?? "" }
      : null;
  return {
    source_url: source,
    status: status as ArchiveRecordStatus,
    url: str(r.url),
    captured_at: str(r.captured_at),
    error: str(r.error),
    set_by: str(r.set_by),
    updated_at: str(r.updated_at) ?? "",
    original,
  };
}

/** The row's record when it belongs to the row's current link; a stale record counts as absent. */
export function currentArchiveRecord(
  row: Record<string, unknown> | null | undefined,
  proofField: string,
): ArchiveRecord | null {
  const link = rowProofLink(row, proofField);
  const rec = readArchiveRecord(row);
  return link && rec && rec.source_url === link ? rec : null;
}

export function archiveView(row: Record<string, unknown> | null | undefined, proofField: string): RowArchiveView {
  const empty: RowArchiveView = {
    status: "none",
    url: null,
    captured_at: null,
    error: null,
    manual: false,
    original_gone: false,
  };
  const link = rowProofLink(row, proofField);
  if (!link) return empty;
  if (isArchiveCopyUrl(link)) {
    return { ...empty, status: "archived", url: link, captured_at: archiveCopyCapturedAt(link) };
  }
  const rec = currentArchiveRecord(row, proofField);
  if (!rec) return { ...empty, status: "not_archived" };
  const original_gone = rec.original?.status === "gone";
  if (rec.status === "manual" || (rec.status === "archived" && rec.url)) {
    return {
      ...empty,
      status: "archived",
      url: rec.url,
      captured_at: rec.captured_at,
      manual: rec.status === "manual",
      original_gone,
    };
  }
  if (rec.status === "pending") return { ...empty, status: "pending", original_gone };
  if (rec.status === "failed") return { ...empty, status: "failed", error: rec.error, original_gone };
  return { ...empty, status: "not_archived", original_gone };
}

/** The row needs an archive attempt: it has a link that is not an archive link and no usable copy. */
export function rowNeedsArchive(
  row: Record<string, unknown> | null | undefined,
  proofField: string,
  opts: { now?: number; retryFailedAfterMs?: number } = {},
): boolean {
  const link = rowProofLink(row, proofField);
  if (!link || isArchiveCopyUrl(link)) return false;
  const rec = currentArchiveRecord(row, proofField);
  if (!rec) return true;
  if (rec.status === "archived" || rec.status === "manual") return false;
  const age = (opts.now ?? Date.now()) - Date.parse(rec.updated_at);
  const wait = opts.retryFailedAfterMs ?? 0;
  if (rec.status === "pending") return !Number.isFinite(age) || age > Math.max(wait, 60 * 60 * 1000);
  return !Number.isFinite(age) || age >= wait;
}

/** Http(s) URL accepted as a staff-pasted backup copy, or null. */
export function normalizeBackupArchiveUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
