/**
 * Save-time duplicate checks for evidence databases. Pure over the rows the route just read, so the
 * check and the write happen with no await in between (two concurrent saves cannot both pass).
 */

import {
  SIMILAR_TO_KEY,
  readEvidenceConfig,
  readSimilarTo,
  type SimilarToEntry,
} from "@shared/evidence-kinds";
import { rowProofLink } from "@shared/evidence-archive";
import {
  findEvidenceDuplicates,
  newlySimilar,
  normalizeEvidenceUrl,
  similarAcknowledged,
  type DuplicateBlockCode,
  type SimilarRow,
} from "@shared/evidence-duplicates";

export type DuplicateRefusalCode = DuplicateBlockCode | "similar_rows";

export interface DuplicateRefusal {
  status: 409;
  body: {
    error: string;
    code: DuplicateRefusalCode;
    existing_index?: number;
    existing?: { title: string | null; link: string | null; rejected: boolean };
    similar?: SimilarRow[];
    input_index?: number;
  };
}

export type GuardResult = { ok: true; similarTo: SimilarToEntry[] | null } | { ok: false; refusal: DuplicateRefusal };

/** Fields whose change re-runs the "looks like" check on an edit. */
const SIMILARITY_FIELDS = ["title", "organization", "year", "locale", "kind", "translation_key"] as const;

export function linkChanged(prev: Record<string, unknown>, next: Record<string, unknown>, proofField: string): boolean {
  return normalizeEvidenceUrl(rowProofLink(prev, proofField)) !== normalizeEvidenceUrl(rowProofLink(next, proofField));
}

export function similarityFieldsChanged(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return SIMILARITY_FIELDS.some((f) => JSON.stringify(prev[f] ?? null) !== JSON.stringify(next[f] ?? null));
}

function refusalMessage(code: DuplicateRefusalCode, label: string, title: string | null, count: number): string {
  const named = title ? `"${title}"` : "an existing row";
  switch (code) {
    case "redirect_link":
      return "This link only redirects (news aggregator or link shortener). Use the publisher's own article link.";
    case "rejected_link":
      return `Staff rejected this story (${named}). It cannot be added again unless staff restore it on the Databases page.`;
    case "duplicate_link":
      return `This link is already in ${label}: ${named}. Saving would add a second copy, so pages may show the story twice.`;
    case "similar_rows":
      return `This looks like ${count} existing row${count === 1 ? "" : "s"} about the same story. Confirm the save if this is different coverage.`;
  }
}

/**
 * Check one row about to be written to an evidence database. Non-evidence databases always pass.
 * - `checkLink: false` (edit that keeps the link) skips link rules so existing duplicates keep saving.
 * - `prev` (edits): only rows that became similar because of this edit are reported.
 * - `allowDuplicate` (staff Save anyway) passes duplicate / rejected / similar; never redirect links.
 * - `acknowledged` (agents) passes `similar_rows` when it lists every similar index.
 */
export function guardEvidenceWrite(opts: {
  evidence: unknown;
  label: string;
  rows: Record<string, unknown>[];
  candidate: Record<string, unknown>;
  excludeIndex?: number;
  prev?: Record<string, unknown> | null;
  checkLink: boolean;
  checkSimilar?: boolean;
  allowDuplicate: boolean;
  acknowledged: unknown;
  ignoreWords: ReadonlySet<string>;
  now?: Date;
}): GuardResult {
  const cfg = readEvidenceConfig(opts.evidence);
  if (!cfg) return { ok: true, similarTo: null };
  const base = {
    rows: opts.rows,
    proofField: cfg.proof_field,
    excludeIndex: opts.excludeIndex,
    ignoreWords: opts.ignoreWords,
    checkLink: opts.checkLink,
  };
  const check = findEvidenceDuplicates({ ...base, candidate: opts.candidate });

  if (check.blocked) {
    const b = check.blocked;
    if (b.code === "redirect_link" || !opts.allowDuplicate) {
      return {
        ok: false,
        refusal: {
          status: 409,
          body: {
            error: refusalMessage(b.code, opts.label, b.title ?? null, 0),
            code: b.code,
            ...(b.index !== undefined
              ? {
                  existing_index: b.index,
                  existing: { title: b.title ?? null, link: b.link ?? null, rejected: b.code === "rejected_link" },
                }
              : {}),
          },
        },
      };
    }
  }

  if (opts.checkSimilar === false) return { ok: true, similarTo: null };
  let similar = check.similar;
  if (opts.prev) {
    similar = newlySimilar(findEvidenceDuplicates({ ...base, candidate: opts.prev }).similar, similar);
  }
  if (similar.length === 0) return { ok: true, similarTo: null };
  if (!opts.allowDuplicate && !similarAcknowledged(similar, opts.acknowledged)) {
    return {
      ok: false,
      refusal: {
        status: 409,
        body: { error: refusalMessage("similar_rows", opts.label, null, similar.length), code: "similar_rows", similar },
      },
    };
  }
  const at = (opts.now ?? new Date()).toISOString();
  const kept = opts.prev ? readSimilarTo(opts.prev) : [];
  const seen = new Set(kept.map((e) => `${e.title ?? ""}\u0000${e.link ?? ""}`));
  const added = similar
    .map((s) => ({ title: s.title, link: s.link, at }))
    .filter((e) => !seen.has(`${e.title ?? ""}\u0000${e.link ?? ""}`));
  return { ok: true, similarTo: [...kept, ...added] };
}

/** Write the "looks like" note decided by the guard onto a stamped row (server-only key). */
export function applySimilarTo(row: Record<string, unknown>, similarTo: SimilarToEntry[] | null): Record<string, unknown> {
  if (!similarTo || similarTo.length === 0) return row;
  return { ...row, [SIMILAR_TO_KEY]: similarTo };
}
