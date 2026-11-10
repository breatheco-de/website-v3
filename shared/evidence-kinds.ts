/**
 * Evidence databases: a private database whose rows prove named third-party claims
 * (press coverage, partnerships, awards…) during proposal review.
 */

export const EVIDENCE_KINDS = [
  "press_coverage",
  "partnership",
  "government_contract",
  "endorsement",
  "award",
  "ranking",
  "graduate_quote",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  press_coverage: "Press coverage",
  partnership: "Partnership",
  government_contract: "Government contract",
  endorsement: "Endorsement",
  award: "Award",
  ranking: "Ranking",
  graduate_quote: "Graduate quote",
};

export interface DatabaseEvidenceConfig {
  enabled: boolean;
  proves: EvidenceKind[];
  /** Row field holding the source link. A row without it is "unsourced". */
  proof_field: string;
  /** Row fields whose values are matched against names in proposal text. */
  match_fields: string[];
  /** Values never matched (in addition to the site brand and short values). */
  ignore_values?: string[];
}

/** Row key the server writes on evidence databases; never accepted from clients. */
export const ROW_STAMP_KEY = "_changed_by";

export type RowStampType = "staff" | "agent";

export interface RowStamp {
  type: RowStampType;
  author: string | null;
  at: string;
}

/**
 * Row key the server writes when staff reject a story: the row stays in the file (so agents
 * cannot re-add its link) but is hidden from pages, listings, search and proposal evidence.
 */
export const REJECTED_KEY = "_rejected";

/** Row key the server writes when a save went past a "looks like" warning. */
export const SIMILAR_TO_KEY = "_similar_to";

export interface RowRejection {
  by: string | null;
  at: string;
  /** Shared by every row rejected in one action; Restore brings the whole group back. */
  group: string;
}

export interface SimilarToEntry {
  title: string | null;
  link: string | null;
  at: string;
}

/** Fields that always count as the claim itself, besides proof_field and match_fields. */
export const EVIDENCE_CLAIM_TEXT_FIELDS = ["title", "excerpt"] as const;

export type EvidenceRowTrust = "trusted" | "verified" | "unverified" | "rejected";

export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === "string" && (EVIDENCE_KINDS as readonly string[]).includes(v);
}

/** Normalized evidence config, or null when absent / off / unusable. */
export function readEvidenceConfig(raw: unknown): DatabaseEvidenceConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const proofField = typeof r.proof_field === "string" ? r.proof_field.trim() : "";
  const matchFields = Array.isArray(r.match_fields)
    ? r.match_fields.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim())
    : [];
  if (!proofField || matchFields.length === 0) return null;
  const proves = Array.isArray(r.proves) ? r.proves.filter(isEvidenceKind) : [];
  const ignore = Array.isArray(r.ignore_values)
    ? r.ignore_values.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
  return {
    enabled: true,
    proves,
    proof_field: proofField,
    match_fields: matchFields,
    ...(ignore.length ? { ignore_values: ignore } : {}),
  };
}

/** Error message when an evidence block is present but invalid; null when OK or absent. */
export function validateEvidenceConfig(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "evidence must be an object";
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true && r.enabled !== false) return "evidence.enabled must be true or false";
  if (r.enabled === false) return null;
  if (typeof r.proof_field !== "string" || !r.proof_field.trim()) return "evidence.proof_field is required";
  if (!Array.isArray(r.match_fields) || r.match_fields.length === 0) {
    return "evidence.match_fields needs at least one field";
  }
  if (!Array.isArray(r.proves) || r.proves.length === 0) return "evidence.proves needs at least one claim kind";
  const bad = r.proves.filter((p) => !isEvidenceKind(p));
  if (bad.length) return `evidence.proves has unknown kinds: ${bad.join(", ")} (allowed: ${EVIDENCE_KINDS.join(", ")})`;
  return null;
}

/** Fields whose change by an agent makes the row unverified. */
export function evidenceProofFields(cfg: DatabaseEvidenceConfig): string[] {
  return [...new Set([cfg.proof_field, ...cfg.match_fields, ...EVIDENCE_CLAIM_TEXT_FIELDS])];
}

export function readRowStamp(row: Record<string, unknown> | null | undefined): RowStamp | null {
  const s = row?.[ROW_STAMP_KEY];
  if (!s || typeof s !== "object") return null;
  const t = (s as Record<string, unknown>).type;
  if (t !== "staff" && t !== "agent") return null;
  const author = (s as Record<string, unknown>).author;
  const at = (s as Record<string, unknown>).at;
  return { type: t, author: typeof author === "string" ? author : null, at: typeof at === "string" ? at : "" };
}

export function readRowRejection(row: Record<string, unknown> | null | undefined): RowRejection | null {
  const r = row?.[REJECTED_KEY];
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  return {
    by: typeof o.by === "string" ? o.by : null,
    at: typeof o.at === "string" ? o.at : "",
    group: typeof o.group === "string" ? o.group : "",
  };
}

export function isRowRejected(row: Record<string, unknown> | null | undefined): boolean {
  return readRowRejection(row) !== null;
}

export function readSimilarTo(row: Record<string, unknown> | null | undefined): SimilarToEntry[] {
  const v = row?.[SIMILAR_TO_KEY];
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      title: typeof e.title === "string" ? e.title : null,
      link: typeof e.link === "string" ? e.link : null,
      at: typeof e.at === "string" ? e.at : "",
    }));
}

/**
 * Rejected wins; otherwise no stamp = row predates tracking (trusted); staff stamp = verified;
 * agent stamp = unverified.
 */
export function rowTrust(row: Record<string, unknown> | null | undefined): EvidenceRowTrust {
  if (isRowRejected(row)) return "rejected";
  const s = readRowStamp(row);
  if (!s) return "trusted";
  return s.type === "staff" ? "verified" : "unverified";
}
