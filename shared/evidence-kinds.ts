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

/** Fields that always count as the claim itself, besides proof_field and match_fields. */
export const EVIDENCE_CLAIM_TEXT_FIELDS = ["title", "excerpt"] as const;

export type EvidenceRowTrust = "trusted" | "verified" | "unverified";

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

/** No stamp = row predates tracking (trusted); staff stamp = verified; agent stamp = unverified. */
export function rowTrust(row: Record<string, unknown> | null | undefined): EvidenceRowTrust {
  const s = readRowStamp(row);
  if (!s) return "trusted";
  return s.type === "staff" ? "verified" : "unverified";
}
