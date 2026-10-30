/**
 * Evidence matching for named third-party claims (partners, press, awards).
 * Pure: callers pass evidence rows, brand terms, live text and dismissals.
 */

import {
  rowTrust,
  type DatabaseEvidenceConfig,
  type EvidenceKind,
} from "@shared/evidence-kinds";
import { archiveView, type ArchiveStatus } from "@shared/evidence-archive";

export type EvidenceSource = {
  /** Content folder the database belongs to (own site or fallback site). */
  site: string;
  /** That site's domain (MCP `site` arg). */
  domain: string;
  database: string;
  label: string;
  config: DatabaseEvidenceConfig;
  rows: Record<string, unknown>[];
};

export type EvidenceRowRef = {
  site: string;
  domain: string;
  database: string;
  index: number;
  label: string;
  link: string | null;
  /** Internet Archive copy of `link` (`none` when the row has no link). */
  archive_status: ArchiveStatus;
  archive_url: string | null;
};

export type EvidenceClaimStatus =
  | "sourced"
  | "unsourced"
  | "unverified"
  | "no_evidence"
  | "already_live"
  | "dismissed";

export type EvidenceDismissal = { name: string; reason: string; by: string | null; at: number };

export type EvidenceClaim = {
  name: string;
  status: EvidenceClaimStatus;
  /** Best matching row (also set on already_live / dismissed when one exists). */
  row?: EvidenceRowRef;
  /** Status the row alone would give (already_live / dismissed keep it for context). */
  row_status?: "sourced" | "unsourced" | "unverified";
  dismissal?: EvidenceDismissal;
};

export type EvidenceCheck = {
  outcome: "ok" | "unavailable";
  claims: EvidenceClaim[];
  /** New names with no row and no dismissal — these refuse apply. */
  blocking: string[];
  databases: Array<{ site: string; domain: string; database: string; label: string; proves: EvidenceKind[] }>;
};

/** Lowercase, accent-free, punctuation-free, single-spaced. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEADING_ARTICLE = /^(the|el|la|los|las) /;

function stripArticle(n: string): string {
  return n.replace(LEADING_ARTICLE, "");
}

const MIN_NAME_LENGTH = 4;

function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Brand names ("4Geeks Academy" → also "4geeks") — never a third party. */
export function brandTerms(names: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    if (!raw) continue;
    const n = normalizeName(raw);
    if (!n) continue;
    out.add(n);
    const first = n.split(" ")[0];
    if (first && first.length >= 3) out.add(first);
  }
  return [...out];
}

function isBrandish(n: string, brand: string[]): boolean {
  return brand.some((b) => n === b || containsWords(n, b) && n.split(" ").length <= b.split(" ").length + 1);
}

type IndexEntry = { key: string; ref: EvidenceRowRef; rowStatus: "sourced" | "unsourced" | "unverified" };

function rowStatusOf(row: Record<string, unknown>, cfg: DatabaseEvidenceConfig): "sourced" | "unsourced" | "unverified" {
  if (rowTrust(row) === "unverified") return "unverified";
  const link = row[cfg.proof_field];
  return typeof link === "string" && link.trim() ? "sourced" : "unsourced";
}

function fieldValues(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(fieldValues);
  return [];
}

export type EvidenceIndex = { entries: IndexEntry[]; brand: string[] };

export function buildEvidenceIndex(sources: EvidenceSource[], brand: string[]): EvidenceIndex {
  const entries: IndexEntry[] = [];
  for (const src of sources) {
    const ignore = new Set((src.config.ignore_values ?? []).map(normalizeName));
    src.rows.forEach((row, index) => {
      const linkRaw = row[src.config.proof_field];
      const archive = archiveView(row, src.config.proof_field);
      const ref: EvidenceRowRef = {
        site: src.site,
        domain: src.domain,
        database: src.database,
        index,
        label: String(row.title ?? row.name ?? row.organization ?? `row ${index}`),
        link: typeof linkRaw === "string" && linkRaw.trim() ? linkRaw.trim() : null,
        archive_status: archive.status,
        archive_url: archive.url,
      };
      const rowStatus = rowStatusOf(row, src.config);
      for (const field of src.config.match_fields) {
        for (const value of fieldValues(row[field])) {
          const key = stripArticle(normalizeName(value));
          if (key.length < MIN_NAME_LENGTH || ignore.has(key) || isBrandish(key, brand)) continue;
          entries.push({ key, ref, rowStatus });
        }
      }
    });
  }
  return { entries, brand };
}

const STATUS_RANK = { sourced: 0, unverified: 1, unsourced: 2 } as const;

/** Best row whose match value equals or contains the name (or the name contains a short match value). */
export function findEvidenceRow(
  index: EvidenceIndex,
  name: string,
): { ref: EvidenceRowRef; rowStatus: "sourced" | "unsourced" | "unverified" } | null {
  const n = stripArticle(normalizeName(name));
  if (n.length < MIN_NAME_LENGTH) return null;
  let best: IndexEntry | null = null;
  for (const e of index.entries) {
    const hit = e.key === n || containsWords(e.key, n) || (e.key.split(" ").length <= 4 && containsWords(n, e.key));
    if (!hit) continue;
    if (!best || STATUS_RANK[e.rowStatus] < STATUS_RANK[best.rowStatus]) best = e;
  }
  return best ? { ref: best.ref, rowStatus: best.rowStatus } : null;
}

/** Known names from evidence rows that appear in the text (short values and brand excluded). */
export function knownNamesInText(index: EvidenceIndex, text: string): string[] {
  const t = normalizeName(text);
  const out = new Map<string, string>();
  for (const e of index.entries) {
    if (e.key.split(" ").length > 5) continue;
    if (containsWords(t, e.key) && !out.has(e.key)) out.set(e.key, e.key);
  }
  return [...out.values()];
}

const NAME_STOPWORDS = new Set(
  [
    "the", "a", "an", "we", "our", "us", "you", "this", "that", "these", "in", "on", "at", "for", "with", "and",
    "el", "la", "los", "las", "un", "una", "nuestro", "nuestra", "este", "esta", "en", "con", "y",
    "ai", "ia", "learn", "students", "graduates", "estudiantes", "see", "more", "read", "leer",
  ],
);

/** Cue verbs and connectors that start a sentence capitalized ("Chosen alongside…", "Elegidos por…"). */
const CUE_WORD =
  /^(chosen|selected|picked|hired|contracted|partner(?:ed|s|ship)?|featured|covered|recogni[sz]ed|awarded|endorsed|accredited|ranked|trusted|backed|together|alongside|proudly|now|elegid[oa]s?|seleccionad[oa]s?|contratad[oa]s?|junto|aliad[oa]s?|reconocid[oa]s?|premiad[oa]s?|destacad[oa]s?|respaldad[oa]s?|avalad[oa]s?)$/;

const NAME_RE =
  /[A-ZÁÉÍÓÚÑ0-9][\p{L}0-9&.'’-]*(?:\s+(?:(?:of|the|de|del|la|las|los)\s+)*[A-ZÁÉÍÓÚÑ][\p{L}0-9&.'’-]*)*/gu;

/**
 * Capitalized names in the same sentence as a third-party cue ("alongside Harvard, Oxford, and Columbia",
 * "chosen by the Government of the Bahamas"). Brand, stopwords and short tokens dropped.
 */
export function candidateNamesNearCues(text: string, cue: RegExp, brand: string[]): string[] {
  const out = new Map<string, string>();
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/);
  const cueGlobal = new RegExp(cue.source, cue.flags.includes("g") ? cue.flags : `${cue.flags}g`);
  for (const sentence of sentences) {
    cueGlobal.lastIndex = 0;
    if (!cueGlobal.test(sentence)) continue;
    for (const m of sentence.matchAll(NAME_RE)) {
      const raw = m[0].replace(/[.'’-]+$/, "").trim();
      const n = stripArticle(normalizeName(raw));
      if (n.length < MIN_NAME_LENGTH - 1 || NAME_STOPWORDS.has(n) || CUE_WORD.test(n) || isBrandish(n, brand)) continue;
      if (/^\d+$/.test(n)) continue;
      const display = raw.replace(/^(The|El|La|Los|Las)\s+/, "");
      if (!out.has(n)) out.set(n, display);
    }
  }
  return [...out.values()];
}

/**
 * Turn confirmed relationship names into claims. Live text and dismissals decide already_live /
 * dismissed; everything else is the row status or no_evidence (which blocks).
 */
export function resolveEvidenceClaims(opts: {
  names: string[];
  index: EvidenceIndex;
  liveText: string;
  dismissals: EvidenceDismissal[];
}): { claims: EvidenceClaim[]; blocking: string[] } {
  const live = normalizeName(opts.liveText);
  const dismissedBy = new Map(opts.dismissals.map((d) => [stripArticle(normalizeName(d.name)), d]));
  const seen = new Set<string>();
  const claims: EvidenceClaim[] = [];
  const blocking: string[] = [];
  for (const name of opts.names) {
    const n = stripArticle(normalizeName(name));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const found = findEvidenceRow(opts.index, name);
    const base: Pick<EvidenceClaim, "row" | "row_status"> = found
      ? { row: found.ref, row_status: found.rowStatus }
      : {};
    if (live && containsWords(live, n)) {
      claims.push({ name, status: "already_live", ...base });
      continue;
    }
    const dismissal = dismissedBy.get(n);
    if (dismissal && !found) {
      claims.push({ name, status: "dismissed", dismissal });
      continue;
    }
    if (found) {
      claims.push({ name, status: found.rowStatus, ...base });
      continue;
    }
    claims.push({ name, status: "no_evidence" });
    blocking.push(name);
  }
  return { claims, blocking };
}
