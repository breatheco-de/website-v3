/**
 * Duplicate checks for evidence databases (press mentions and similar banks of linked stories).
 * Pure functions over raw rows; the server enforces them on every write and MCP pre-checks bulk adds.
 */

import { isRowRejected } from "./evidence-kinds";
import { rowProofLink, waybackOriginalUrl } from "./evidence-archive";

/** Hosts that only redirect to the real article; the publisher's own link is required instead. */
export const REDIRECT_LINK_HOSTS: ReadonlySet<string> = new Set([
  "news.google.com",
  "feedproxy.google.com",
  "t.co",
  "bit.ly",
  "lnkd.in",
  "ow.ly",
  "buff.ly",
  "tinyurl.com",
  "goo.gl",
]);

/** Word-overlap score at or above which two titles count as the same story. */
export const SIMILAR_TITLE_MIN = 0.5;

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "amp"]);
const HOST_PREFIX = /^(?:www|m|amp)\./;

function unwrapWayback(url: string): string {
  let out = url.trim();
  for (let i = 0; i < 3; i++) {
    const inner = waybackOriginalUrl(out);
    if (!inner) break;
    out = inner;
  }
  return out;
}

function parseLoose(url: string): URL | null {
  const s = url.trim();
  if (!s) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function bareHost(u: URL): string {
  let host = u.hostname.toLowerCase();
  while (HOST_PREFIX.test(host)) host = host.replace(HOST_PREFIX, "");
  return host;
}

/**
 * Comparable form of a story link: Wayback copies unwrapped to the page they copy; scheme,
 * `www.` / `m.` / `amp.`, AMP path suffix, trailing slash, fragment and tracking params ignored.
 * archive.today short ids cannot be unwrapped and compare as themselves.
 */
export function normalizeEvidenceUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const u = parseLoose(unwrapWayback(url));
  if (!u) return url.trim().toLowerCase();
  const host = bareHost(u);
  const path = u.pathname.replace(/\/amp\/?$/i, "").replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([k, v]) => {
      const key = k.toLowerCase();
      if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) return false;
      if (key === "outputtype" && v.toLowerCase() === "amp") return false;
      return true;
    })
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `${host}${path}${query}`;
}

/** The link only redirects (news aggregator or link shortener), so it cannot identify the story. */
export function isRedirectLink(url: string | null | undefined): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  const u = parseLoose(unwrapWayback(url));
  return !!u && REDIRECT_LINK_HOSTS.has(bareHost(u));
}

const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "by", "with", "from", "as", "is", "are",
  "was", "be", "its", "it", "this", "that", "into", "over", "about", "after", "new", "how", "why", "what",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "de", "del", "en", "con", "por", "para",
  "al", "que", "se", "su", "sus", "es", "son", "como", "mas", "sobre",
]);

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleWords(title: string, ignore: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeText(title).split(" ")) {
    if (!w || TITLE_STOPWORDS.has(w) || ignore.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** Brand phrases ("4geeks academy") → single ignored words. */
export function ignoreWordSet(terms: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of terms ?? []) for (const w of normalizeText(t).split(" ")) if (w) out.add(w);
  return out;
}

/** Share of distinct meaningful words two titles have in common (0..1). */
export function titleSimilarity(a: string, b: string, ignore: ReadonlySet<string> = new Set()): number {
  const wa = titleWords(a, ignore);
  const wb = titleWords(b, ignore);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

export type DuplicateBlockCode = "redirect_link" | "rejected_link" | "duplicate_link";

export interface DuplicateBlock {
  code: DuplicateBlockCode;
  /** Stored position of the row that already has the link (not set for redirect_link). */
  index?: number;
  title?: string | null;
  link?: string | null;
}

export type SimilarSignal = "title" | "organization_year" | "same_link_other_locale";

export interface SimilarRow {
  index: number;
  title: string | null;
  link: string | null;
  signals: SimilarSignal[];
  rejected: boolean;
}

export interface DuplicateCheck {
  blocked: DuplicateBlock | null;
  similar: SimilarRow[];
}

function text(row: Record<string, unknown>, field: string): string {
  const v = row[field];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function titleOf(row: Record<string, unknown>): string | null {
  return text(row, "title") || null;
}

function sameScope(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (text(a, "locale").toLowerCase() !== text(b, "locale").toLowerCase()) return false;
  const ka = text(a, "kind").toLowerCase();
  const kb = text(b, "kind").toLowerCase();
  return !ka || !kb || ka === kb;
}

function sameTranslation(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ta = text(a, "translation_key");
  return !!ta && ta === text(b, "translation_key");
}

/**
 * Compare one candidate row with the stored rows (raw, rejected ones included).
 * `checkLink: false` skips every link rule — used when an edit leaves the link unchanged, so
 * duplicates that already exist keep saving.
 */
export function findEvidenceDuplicates(opts: {
  rows: Record<string, unknown>[];
  candidate: Record<string, unknown>;
  proofField: string;
  excludeIndex?: number;
  ignoreWords?: ReadonlySet<string>;
  checkLink?: boolean;
}): DuplicateCheck {
  const { rows, candidate, proofField, excludeIndex } = opts;
  const ignore = opts.ignoreWords ?? new Set<string>();
  const checkLink = opts.checkLink !== false;
  const rawLink = rowProofLink(candidate, proofField);
  const link = normalizeEvidenceUrl(rawLink);

  if (checkLink && rawLink && isRedirectLink(rawLink)) {
    return { blocked: { code: "redirect_link", link: rawLink }, similar: [] };
  }

  let rejectedHit: DuplicateBlock | null = null;
  let duplicateHit: DuplicateBlock | null = null;
  const similar: SimilarRow[] = [];
  const candTitle = titleOf(candidate) ?? "";
  const candOrg = normalizeText(text(candidate, "organization"));
  const candYear = text(candidate, "year");

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (index === excludeIndex || !row || typeof row !== "object") continue;
    const rowLink = rowProofLink(row, proofField);
    const sameLink = !!link && normalizeEvidenceUrl(rowLink) === link;
    const rejected = isRowRejected(row);
    const signals: SimilarSignal[] = [];

    if (sameLink) {
      if (!checkLink) continue;
      const hit = { index, title: titleOf(row), link: rowLink };
      if (rejected) {
        rejectedHit ??= { code: "rejected_link", ...hit };
        continue;
      }
      if (text(row, "locale").toLowerCase() === text(candidate, "locale").toLowerCase()) {
        duplicateHit ??= { code: "duplicate_link", ...hit };
        continue;
      }
      if (sameTranslation(row, candidate)) continue;
      signals.push("same_link_other_locale");
    } else if (!sameTranslation(row, candidate) && sameScope(row, candidate)) {
      const rowTitle = titleOf(row);
      if (candTitle && rowTitle && titleSimilarity(candTitle, rowTitle, ignore) >= SIMILAR_TITLE_MIN) {
        signals.push("title");
      }
      const org = normalizeText(text(row, "organization"));
      if (candOrg && candYear && org === candOrg && text(row, "year") === candYear) {
        signals.push("organization_year");
      }
    }

    if (signals.length) similar.push({ index, title: titleOf(row), link: rowLink, signals, rejected });
  }

  return { blocked: rejectedHit ?? duplicateHit, similar };
}

/** Similar rows the edit introduced: present after the change but not before it. */
export function newlySimilar(before: SimilarRow[], after: SimilarRow[]): SimilarRow[] {
  const had = new Set(before.map((s) => s.index));
  return after.filter((s) => !had.has(s.index));
}

/** Every index in `similar` is listed in the acknowledgement. */
export function similarAcknowledged(similar: SimilarRow[], acknowledged: unknown): boolean {
  if (similar.length === 0) return true;
  if (!Array.isArray(acknowledged)) return false;
  const ack = new Set(acknowledged.filter((n): n is number => typeof n === "number"));
  return similar.every((s) => ack.has(s.index));
}

/**
 * Rows one Reject action covers: the row, its other-language rows (same `translation_key`) and,
 * when `includeSameLink`, other rows with the same link. Sorted stored positions.
 */
export function rejectionGroup(opts: {
  rows: Record<string, unknown>[];
  index: number;
  proofField: string;
  includeSameLink: boolean;
}): { translations: number[]; sameLink: number[]; all: number[] } {
  const { rows, index, proofField } = opts;
  const target = rows[index];
  if (!target) return { translations: [], sameLink: [], all: [] };
  const link = normalizeEvidenceUrl(rowProofLink(target, proofField));
  const translations: number[] = [];
  const sameLink: number[] = [];
  rows.forEach((row, i) => {
    if (i === index || !row) return;
    if (sameTranslation(row, target)) translations.push(i);
    else if (link && normalizeEvidenceUrl(rowProofLink(row, proofField)) === link) sameLink.push(i);
  });
  const all = [index, ...translations, ...(opts.includeSameLink ? sameLink : [])].sort((a, b) => a - b);
  return { translations, sameLink, all };
}
