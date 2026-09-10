import { randomUUID } from "crypto";
import fs from "fs";
import type Database from "better-sqlite3";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { emitEvent } from "../events/event-store";
import { singleAttribution, type EventActor } from "../events/types";
import { getContentForEdit, editContent } from "../content-editor";
import type { SiteContext } from "../site-manager";
import { fingerprintEdits, fingerprintNotes, stableJson } from "./fingerprint";
import { hashVariantFileContents } from "../versioning/promote-with-teardown";
import { child } from "../logger";
import type { ContentType } from "@shared/schema";
import { getFolder } from "../content-types";
import { resolveWritableVersioningTarget } from "../shared-layout-entry";

const log = child({ module: "content-proposals" });

export const PROPOSAL_CLAIM_TTL_MS = 30 * 60 * 1000;
export const RAG_SIMILARITY_THRESHOLD = 0.82;
export const MIN_SUMMARY = 80;
export const MIN_BLOCKER_BODY = 80;

export type ProposalStatus = "open" | "partial" | "finished" | "rejected" | "withdrawn";
export type ProposalKind = "edits" | "notes";
export type ProposalCategory = "content.field" | "content.seo";
export type EntryRowStatus = "pending" | "done" | "failed";
export type ReviewMode = "soft" | "soft_variant" | "draft_backed";
export type BlockerStatus = "open" | "resolved";

export type FieldUpdate = { field_path: string; value?: unknown; reset?: boolean };

export type ProposalClaim = {
  by: string;
  expiresAt: string;
  report?: string;
  /** MCP client/model (or ui) when claim was taken — for staff “via …” lines. */
  actor?: EventActor;
};

export type ProposalEntryInput = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  updates?: FieldUpdate[];
};

export type ProposalEntryRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  variant_fingerprint: string | null;
  status: EntryRowStatus;
  ops: FieldUpdate[];
  baseline_context: { values: Record<string, unknown>; note?: string };
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
  contentType: string;
  slug: string;
};

export type ProposalBlocker = {
  id: number;
  proposal_id: string;
  kind: "blocker";
  body: string;
  status: BlockerStatus;
  author: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolve_note: string | null;
  agent_session_id: string | null;
};

export type ProposalRecord = {
  id: string;
  site: string;
  fingerprint: string;
  status: ProposalStatus;
  kind: ProposalKind;
  category: ProposalCategory;
  title: string;
  summary: string;
  rationale: string | null;
  documentation: Record<string, unknown>;
  related_issue_ids: string[];
  proposer_username: string;
  proposer_actor: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  claim: ProposalClaim | null;
  tags: string[];
  search_text: string;
  created_agent_session_id: string | null;
  promote_on_apply: boolean;
  review_mode: ReviewMode;
  open_blocker_count: number;
  entries: ProposalEntryRow[];
  blockers: ProposalBlocker[];
};

type ProposalRow = {
  id: string;
  site: string;
  fingerprint: string;
  status: ProposalStatus;
  kind: ProposalKind;
  category: ProposalCategory;
  title: string;
  summary: string;
  rationale: string | null;
  documentation_json: string;
  related_issue_ids_json: string;
  proposer_username: string;
  proposer_actor_json: string;
  created_at: number;
  updated_at: number;
  claim_json: string | null;
  tags_json: string;
  search_text: string;
  created_agent_session_id: string | null;
  promote_on_apply: number;
};

type EntryDbRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  variant_fingerprint: string | null;
  status: EntryRowStatus;
  ops_json: string;
  baseline_context_json: string;
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
};

type BlockerDbRow = {
  id: number;
  proposal_id: string;
  kind: string;
  body: string;
  status: BlockerStatus;
  author: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolve_note: string | null;
  agent_session_id: string | null;
};

export type CreateProposalInput = {
  title: string;
  summary: string;
  rationale?: string;
  category?: ProposalCategory;
  documentation?: Record<string, unknown>;
  related_issue_ids?: string[];
  tags?: string[];
  entries?: ProposalEntryInput[];
  confirm_distinct?: boolean;
  situation_note?: string;
  agent_session_id?: string;
  promote_on_apply?: boolean;
};

export type SimilarProposal = { id: string; title: string; score: number };

export type ProposalUpdateAction =
  | "claim"
  | "release"
  | "withdraw"
  | "apply"
  | "acknowledge"
  | "reject"
  | "attach_variant"
  | "add_blocker"
  | "resolve_blocker"
  | "reopen_blocker";

export type ProposalUpdateCaller = {
  username: string;
  report?: string;
  asStaff?: boolean;
  agent_session_id?: string;
  /** Provenance for claim (and any future actor-storing actions). */
  actor?: EventActor;
  body?: string;
  blocker_id?: number;
  resolve_note?: string;
  variant?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  confirm_end_experiment?: boolean;
  promote_on_apply?: boolean;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function splitEntryKey(entryKey: string): { contentType: string; slug: string } {
  const i = entryKey.indexOf("/");
  if (i <= 0) return { contentType: entryKey, slug: "" };
  return { contentType: entryKey.slice(0, i), slug: entryKey.slice(i + 1) };
}

function makeEntryKey(contentType: string, slug: string): string {
  return `${contentType}/${slug}`;
}

function getByPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function rollupStatus(kind: ProposalKind, entries: ProposalEntryRow[]): ProposalStatus {
  if (kind === "notes") return "open";
  if (entries.length === 0) return "open";
  if (entries.every((e) => e.status === "done")) return "finished";
  if (entries.some((e) => e.status === "done")) return "partial";
  return "open";
}

export function deriveReviewMode(opts: {
  promote_on_apply: boolean;
  entries: Array<{ variant?: string | null }>;
}): ReviewMode {
  if (opts.promote_on_apply) return "draft_backed";
  if (opts.entries.some((e) => Boolean(e.variant))) return "soft_variant";
  return "soft";
}

function mapBlocker(row: BlockerDbRow): ProposalBlocker {
  return {
    id: row.id,
    proposal_id: row.proposal_id,
    kind: "blocker",
    body: row.body,
    status: row.status,
    author: row.author,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    resolve_note: row.resolve_note,
    agent_session_id: row.agent_session_id,
  };
}

function mapEntry(row: EntryDbRow): ProposalEntryRow {
  const { contentType, slug } = splitEntryKey(row.entry_key);
  return {
    id: row.id,
    proposal_id: row.proposal_id,
    entry_key: row.entry_key,
    locale: row.locale,
    variant: row.variant,
    variant_fingerprint: row.variant_fingerprint ?? null,
    status: row.status,
    ops: parseJson(row.ops_json, []),
    baseline_context: parseJson(row.baseline_context_json, { values: {} }),
    last_error: row.last_error,
    applied_at: row.applied_at,
    applied_by: row.applied_by,
    contentType,
    slug,
  };
}

function mapProposal(
  row: ProposalRow,
  entries: ProposalEntryRow[],
  blockers: ProposalBlocker[],
): ProposalRecord {
  const promote_on_apply = Boolean(row.promote_on_apply);
  return {
    id: row.id,
    site: row.site,
    fingerprint: row.fingerprint,
    status: row.status,
    kind: row.kind,
    category: row.category,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    documentation: parseJson(row.documentation_json, {}),
    related_issue_ids: parseJson(row.related_issue_ids_json, []),
    proposer_username: row.proposer_username,
    proposer_actor: parseJson(row.proposer_actor_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    claim: parseJson(row.claim_json, null),
    tags: parseJson(row.tags_json, []),
    search_text: row.search_text,
    created_agent_session_id: row.created_agent_session_id ?? null,
    promote_on_apply,
    review_mode: deriveReviewMode({ promote_on_apply, entries }),
    open_blocker_count: blockers.filter((b) => b.status === "open").length,
    entries,
    blockers,
  };
}

function dbFor(site: string): Database.Database {
  ensurePipelineDb(site);
  return getSiteSqlite(site);
}

function loadEntries(db: Database.Database, proposalId: string): ProposalEntryRow[] {
  const rows = db
    .prepare(`SELECT * FROM content_proposal_entries WHERE proposal_id = ? ORDER BY id`)
    .all(proposalId) as EntryDbRow[];
  return rows.map(mapEntry);
}

function loadBlockers(db: Database.Database, proposalId: string): ProposalBlocker[] {
  try {
    const rows = db
      .prepare(`SELECT * FROM content_proposal_blockers WHERE proposal_id = ? ORDER BY id`)
      .all(proposalId) as BlockerDbRow[];
    return rows.map(mapBlocker);
  } catch {
    return [];
  }
}

function loadProposal(db: Database.Database, id: string): ProposalRecord | null {
  const row = db.prepare(`SELECT * FROM content_proposals WHERE id = ?`).get(id) as ProposalRow | undefined;
  if (!row) return null;
  return mapProposal(row, loadEntries(db, id), loadBlockers(db, id));
}

function persistRollup(db: Database.Database, proposal: ProposalRecord): ProposalStatus {
  if (proposal.kind === "notes") return proposal.status;
  const next = rollupStatus(proposal.kind, proposal.entries);
  db.prepare(`UPDATE content_proposals SET status = ?, updated_at = ? WHERE id = ?`).run(
    next,
    Date.now(),
    proposal.id,
  );
  return next;
}

function activeClaim(
  proposal: ProposalRecord,
  now = Date.now(),
): { active: ProposalClaim | null; expired: boolean } {
  const claim = proposal.claim;
  if (!claim) return { active: null, expired: false };
  if (new Date(claim.expiresAt).getTime() <= now) return { active: null, expired: true };
  return { active: claim, expired: false };
}

function emitProposalEvent(
  site: string,
  type:
    | "proposal_created"
    | "proposal_applied_progress"
    | "proposal_finished"
    | "proposal_acknowledged"
    | "proposal_rejected"
    | "proposal_withdrawn",
  proposalId: string,
  author: string,
  payload: Record<string, unknown> = {},
  actor?: EventActor,
): void {
  emitEvent({
    site,
    type,
    attribution: singleAttribution(author, actor),
    payload: { proposal_id: proposalId, ...payload },
  });
}

export type ProposalServiceDeps = {
  site: string;
  issueExists: (id: string) => boolean;
  captureBaseline: (entry: ProposalEntryInput) => { values: Record<string, unknown>; error?: string };
  applyUpdates: (
    entry: ProposalEntryRow,
    author: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readVariantFingerprint?: (entry: {
    contentType: string;
    slug: string;
    locale: string;
    variant: string;
  }) => { fingerprint: string; error?: string };
  promoteEntry?: (
    entry: ProposalEntryRow,
    author: string,
    opts: { confirm_end_experiment?: boolean },
  ) => Promise<{
    ok: boolean;
    error?: string;
    code?: string;
    traffic_siblings?: Array<{ slug: string; locale: string; allocation: number }>;
  }>;
  findSimilar?: (query: string) => Promise<SimilarProposal[]>;
  indexSearch?: (proposal: ProposalRecord) => Promise<void>;
};

export type ProposalStats = {
  total: number;
  by_status: Record<ProposalStatus, number>;
  by_kind: Record<ProposalKind, number>;
};

const EMPTY_STATUS_COUNTS: Record<ProposalStatus, number> = {
  open: 0,
  partial: 0,
  finished: 0,
  rejected: 0,
  withdrawn: 0,
};

const EMPTY_KIND_COUNTS: Record<ProposalKind, number> = {
  edits: 0,
  notes: 0,
};

export const PROPOSAL_SORT_FIELDS = ["created_at", "updated_at"] as const;
export type ProposalSortField = (typeof PROPOSAL_SORT_FIELDS)[number];
export type ProposalSortDir = "asc" | "desc";

export function parseProposalSort(
  sort?: string | null,
  sortDir?: string | null,
):
  | { ok: true; sort: ProposalSortField; sortDir: ProposalSortDir }
  | { ok: false; error: string } {
  const fieldRaw = sort == null || String(sort).trim() === "" ? "updated_at" : String(sort).trim();
  if (fieldRaw !== "created_at" && fieldRaw !== "updated_at") {
    return {
      ok: false,
      error: `Invalid sort '${fieldRaw}'. Allowed: created_at, updated_at`,
    };
  }
  const dirRaw =
    sortDir == null || String(sortDir).trim() === "" ? "desc" : String(sortDir).trim();
  if (dirRaw !== "asc" && dirRaw !== "desc") {
    return {
      ok: false,
      error: `Invalid sort_dir '${dirRaw}'. Allowed: asc, desc`,
    };
  }
  return { ok: true, sort: fieldRaw, sortDir: dirRaw };
}

function compareProposalsBySort(
  a: ProposalRecord,
  b: ProposalRecord,
  sort: ProposalSortField,
  sortDir: ProposalSortDir,
): number {
  const factor = sortDir === "asc" ? 1 : -1;
  const av = a[sort];
  const bv = b[sort];
  if (av !== bv) return (av - bv) * factor;
  return a.id.localeCompare(b.id);
}

function findOpenProposalForVariant(
  db: Database.Database,
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  variant: string,
): ProposalRecord | null {
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.status IN ('open','partial')
         AND e.entry_key = ? AND e.locale = ? AND e.variant = ?
       LIMIT 1`,
    )
    .all(site, entryKey, locale, variant) as Array<{ id: string }>;
  if (!rows[0]) return null;
  return loadProposal(db, rows[0].id);
}

/** Open proposals referencing a variant (for delete_variant warnings). */
export function listOpenProposalsForVariant(
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  variant: string,
): Array<{ id: string; title: string; status: ProposalStatus }> {
  const db = dbFor(site);
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.status FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.status IN ('open','partial')
         AND e.entry_key = ? AND e.locale = ? AND e.variant = ?`,
    )
    .all(site, entryKey, locale, variant) as Array<{
    id: string;
    title: string;
    status: ProposalStatus;
  }>;
  return rows;
}

export function createProposalService(deps: ProposalServiceDeps) {
  const site = deps.site;

  function get(id: string): ProposalRecord | null {
    return loadProposal(dbFor(site), id);
  }

  function stats(): ProposalStats {
    const db = dbFor(site);
    const by_status = { ...EMPTY_STATUS_COUNTS };
    const by_kind = { ...EMPTY_KIND_COUNTS };
    const statusRows = db
      .prepare(`SELECT status, COUNT(*) AS n FROM content_proposals WHERE site = ? GROUP BY status`)
      .all(site) as Array<{ status: ProposalStatus; n: number }>;
    for (const row of statusRows) {
      if (row.status in by_status) by_status[row.status] = Number(row.n) || 0;
    }
    const kindRows = db
      .prepare(`SELECT kind, COUNT(*) AS n FROM content_proposals WHERE site = ? GROUP BY kind`)
      .all(site) as Array<{ kind: ProposalKind; n: number }>;
    for (const row of kindRows) {
      if (row.kind in by_kind) by_kind[row.kind] = Number(row.n) || 0;
    }
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM content_proposals WHERE site = ?`)
      .get(site) as { n: number };
    return {
      total: Number(totalRow?.n) || 0,
      by_status,
      by_kind,
    };
  }

  function exportAll(): ProposalRecord[] {
    return exportAllProposals(site);
  }

  function list(opts: {
    status?: ProposalStatus;
    kind?: ProposalKind;
    issue_id?: string;
    query?: string;
    proposal_id?: string;
    limit?: number;
    offset?: number;
    sort?: ProposalSortField;
    sortDir?: ProposalSortDir;
  }): { proposals: ProposalRecord[]; total: number } {
    if (opts.proposal_id) {
      const one = get(opts.proposal_id);
      return { proposals: one ? [one] : [], total: one ? 1 : 0 };
    }
    const db = dbFor(site);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(0, opts.offset ?? 0);
    const sort: ProposalSortField = opts.sort ?? "updated_at";
    const sortDir: ProposalSortDir = opts.sortDir ?? "desc";
    const orderSql = `ORDER BY ${sort} ${sortDir.toUpperCase()}, id ASC`;

    let where = `WHERE site = ?`;
    const params: unknown[] = [site];
    if (opts.status) {
      where += ` AND status = ?`;
      params.push(opts.status);
    }
    if (opts.kind) {
      where += ` AND kind = ?`;
      params.push(opts.kind);
    }
    if (opts.issue_id) {
      where += ` AND related_issue_ids_json LIKE ?`;
      params.push(`%${opts.issue_id}%`);
    }
    if (opts.query?.trim()) {
      where += ` AND search_text LIKE ?`;
      params.push(`%${opts.query.trim().toLowerCase()}%`);
    }

    if (opts.issue_id) {
      const rows = db
        .prepare(`SELECT * FROM content_proposals ${where} ${orderSql}`)
        .all(...params) as ProposalRow[];
      let records = rows
        .map((r) => mapProposal(r, loadEntries(db, r.id), loadBlockers(db, r.id)))
        .filter((p) => p.related_issue_ids.includes(opts.issue_id!));
      records = [...records].sort((a, b) => compareProposalsBySort(a, b, sort, sortDir));
      const total = records.length;
      return { proposals: records.slice(offset, offset + limit), total };
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM content_proposals ${where}`)
      .get(...params) as { n: number };
    const total = Number(totalRow?.n) || 0;
    const rows = db
      .prepare(
        `SELECT * FROM content_proposals ${where} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ProposalRow[];
    const proposals = rows.map((r) =>
      mapProposal(r, loadEntries(db, r.id), loadBlockers(db, r.id)),
    );
    return { proposals, total };
  }

  async function create(
    input: CreateProposalInput,
    proposer: { username: string; actor?: EventActor | Record<string, unknown> },
  ): Promise<
    | { ok: true; proposal: ProposalRecord; duplicate?: boolean; similar?: SimilarProposal[] }
    | {
        ok: false;
        code: string;
        error: string;
        similar?: SimilarProposal[];
        duplicate_of?: string;
        existing_proposal?: ProposalRecord;
      }
  > {
    const summary = (input.summary || "").trim();
    if (summary.length < MIN_SUMMARY) {
      return { ok: false, code: "summary_too_short", error: `summary required (min ${MIN_SUMMARY} characters)` };
    }
    const title = (input.title || "").trim();
    if (!title) return { ok: false, code: "title_required", error: "title is required" };

    const related = [...new Set((input.related_issue_ids ?? []).map((id) => id.trim()).filter(Boolean))];
    for (const id of related) {
      if (!deps.issueExists(id)) {
        return { ok: false, code: "unknown_issue_id", error: `Unknown issue id: ${id}` };
      }
    }

    const promote_on_apply = Boolean(input.promote_on_apply);
    const entriesIn = (input.entries ?? []).map((e) => ({
      ...e,
      updates: e.updates ?? [],
    }));
    const kind: ProposalKind = entriesIn.length > 0 || promote_on_apply ? "edits" : "notes";

    if (promote_on_apply) {
      if (entriesIn.length !== 1) {
        return {
          ok: false,
          code: "promote_entry_required",
          error: "promote_on_apply requires exactly one entry with contentType, slug, locale, and variant",
        };
      }
      const e = entriesIn[0]!;
      if (!e.contentType || !e.slug || !e.locale || !e.variant?.trim()) {
        return {
          ok: false,
          code: "promote_variant_required",
          error: "promote_on_apply requires contentType, slug, locale, and variant on the entry",
        };
      }
    }

    if (kind === "edits") {
      for (const e of entriesIn) {
        if (!e.contentType || !e.slug || !e.locale) {
          return { ok: false, code: "entry_required", error: "Each entry needs contentType, slug, and locale" };
        }
        if (!promote_on_apply && !e.updates?.length) {
          return { ok: false, code: "updates_required", error: `Entry ${e.contentType}/${e.slug} has no field updates` };
        }
      }
    }

    const db = dbFor(site);

    for (const e of entriesIn) {
      if (!e.variant?.trim()) continue;
      const existingVariant = findOpenProposalForVariant(
        db,
        site,
        e.contentType,
        e.slug,
        e.locale,
        e.variant.trim(),
      );
      if (existingVariant) {
        return {
          ok: false,
          code: "proposal_exists",
          error: `An open proposal already references variant '${e.variant}' for ${e.contentType}/${e.slug} (${e.locale}). Join that proposal instead of creating another.`,
          duplicate_of: existingVariant.id,
          existing_proposal: existingVariant,
        };
      }
    }

    const category: ProposalCategory =
      input.category ?? (kind === "notes" ? "content.field" : inferCategory(entriesIn));
    const fingerprint =
      kind === "notes"
        ? fingerprintNotes({ site, category, relatedIssueIds: related, summary })
        : fingerprintEdits({
            site,
            category,
            entries: entriesIn.map((e) => ({
              contentType: e.contentType,
              slug: e.slug,
              locale: e.locale,
              variant: e.variant,
              updates: e.updates ?? [],
            })),
          });

    const existing = db
      .prepare(
        `SELECT id FROM content_proposals WHERE site = ? AND fingerprint = ? AND status IN ('open','partial') LIMIT 1`,
      )
      .get(site, fingerprint) as { id: string } | undefined;
    if (existing) {
      const dup = get(existing.id)!;
      return { ok: true, proposal: dup, duplicate: true };
    }

    const searchBlob = [
      title,
      summary,
      input.rationale ?? "",
      ...(input.tags ?? []),
      ...related,
      ...entriesIn.map(
        (e) =>
          `${e.contentType}/${e.slug} ${e.variant ?? ""} ${(e.updates ?? []).map((u) => u.field_path).join(" ")}`,
      ),
      promote_on_apply ? "promote_on_apply" : "",
    ]
      .join(" ")
      .toLowerCase();

    if (!input.confirm_distinct && deps.findSimilar) {
      try {
        const similar = (await deps.findSimilar(searchBlob)).filter((s) => s.score >= RAG_SIMILARITY_THRESHOLD);
        if (similar.length) {
          return {
            ok: false,
            code: "similar_proposals",
            error: "Similar open proposals exist. Pass confirm_distinct: true to create anyway.",
            similar,
          };
        }
      } catch (err) {
        log.warn({ err }, "proposal RAG similar search failed");
      }
    }

    const captured: Array<{
      input: ProposalEntryInput & { updates: FieldUpdate[] };
      baseline: { values: Record<string, unknown>; note?: string };
      variant_fingerprint: string | null;
    }> = [];
    for (const e of entriesIn) {
      const updates = e.updates ?? [];
      let baseline: { values: Record<string, unknown>; note?: string } = {
        values: {},
        note: input.situation_note,
      };
      if (updates.length) {
        const capturedBaseline = deps.captureBaseline({ ...e, updates });
        if (capturedBaseline.error) {
          return { ok: false, code: "baseline_failed", error: capturedBaseline.error };
        }
        baseline = { values: capturedBaseline.values, note: input.situation_note };
      }
      let variant_fingerprint: string | null = null;
      if (e.variant?.trim() && deps.readVariantFingerprint) {
        const fp = deps.readVariantFingerprint({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant.trim(),
        });
        if (fp.error) return { ok: false, code: "baseline_failed", error: fp.error };
        variant_fingerprint = fp.fingerprint;
      }
      captured.push({
        input: { ...e, updates },
        baseline,
        variant_fingerprint,
      });
    }

    if (promote_on_apply && captured.length === 0) {
      return { ok: false, code: "promote_entry_required", error: "promote_on_apply requires an entry" };
    }

    const now = Date.now();
    const id = randomUUID();
    const sessionId = input.agent_session_id?.trim() || null;
    db.prepare(
      `INSERT INTO content_proposals (
        id, site, fingerprint, status, kind, category, title, summary, rationale,
        documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
        created_at, updated_at, claim_json, tags_json, search_text,
        created_agent_session_id, promote_on_apply
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      site,
      fingerprint,
      "open",
      kind,
      category,
      title,
      summary,
      input.rationale?.trim() || null,
      JSON.stringify(input.documentation ?? {}),
      JSON.stringify(related),
      proposer.username,
      JSON.stringify(proposer.actor ?? {}),
      now,
      now,
      null,
      JSON.stringify(input.tags ?? []),
      searchBlob,
      sessionId,
      promote_on_apply ? 1 : 0,
    );

    for (const cap of captured) {
      db.prepare(
        `INSERT INTO content_proposal_entries (
          proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json, variant_fingerprint
        ) VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        makeEntryKey(cap.input.contentType, cap.input.slug),
        cap.input.locale,
        cap.input.variant || null,
        "pending",
        JSON.stringify(cap.input.updates),
        JSON.stringify(cap.baseline),
        cap.variant_fingerprint,
      );
    }

    const proposal = get(id)!;
    emitProposalEvent(site, "proposal_created", id, proposer.username);
    if (deps.indexSearch) {
      deps.indexSearch(proposal).catch((err) => log.warn({ err }, "proposal index failed"));
    }
    return { ok: true, proposal };
  }

  async function update(
    id: string,
    action: ProposalUpdateAction,
    caller: ProposalUpdateCaller,
  ): Promise<
    | {
        ok: true;
        proposal: ProposalRecord;
        warnings?: Array<{ code: string; message: string }>;
        traffic_siblings?: Array<{ slug: string; locale: string; allocation: number }>;
      }
    | {
        ok: false;
        code: string;
        error: string;
        proposal?: ProposalRecord;
        claim_expired?: boolean;
        traffic_siblings?: Array<{ slug: string; locale: string; allocation: number }>;
        existing_proposal?: ProposalRecord;
      }
  > {
    const db = dbFor(site);
    const proposal = get(id);
    if (!proposal) return { ok: false, code: "not_found", error: "Proposal not found" };

    const report = caller.report?.trim() ?? "";
    const now = Date.now();

    if (action === "claim") {
      const claim = proposal.claim;
      if (claim && new Date(claim.expiresAt).getTime() > now && claim.by !== caller.username) {
        return { ok: false, code: "claimed", error: `Claimed by ${claim.by} until ${claim.expiresAt}` };
      }
      const next: ProposalClaim = {
        by: caller.username,
        expiresAt: new Date(now + PROPOSAL_CLAIM_TTL_MS).toISOString(),
        ...(report ? { report } : {}),
        ...(caller.actor ? { actor: caller.actor } : {}),
      };
      db.prepare(`UPDATE content_proposals SET claim_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(next),
        now,
        id,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "release") {
      if (proposal.claim && report && report.length < MIN_SUMMARY) {
        return { ok: false, code: "report_too_short", error: `release report min ${MIN_SUMMARY} characters` };
      }
      db.prepare(`UPDATE content_proposals SET claim_json = NULL, updated_at = ? WHERE id = ?`).run(now, id);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "withdraw") {
      if (proposal.proposer_username !== caller.username && !caller.asStaff) {
        return { ok: false, code: "not_proposer", error: "Only the proposer or an editor can withdraw" };
      }
      if (proposal.status === "finished") {
        return { ok: false, code: "already_finished", error: "Finished proposals cannot be withdrawn" };
      }
      db.prepare(`UPDATE content_proposals SET status = 'withdrawn', claim_json = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        id,
      );
      emitProposalEvent(site, "proposal_withdrawn", id, caller.username);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "reject") {
      if (caller.username === proposal.proposer_username) {
        return { ok: false, code: "four_eyes", error: "Four-eyes: someone other than the proposer must reject" };
      }
      db.prepare(`UPDATE content_proposals SET status = 'rejected', claim_json = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        id,
      );
      emitProposalEvent(site, "proposal_rejected", id, caller.username);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "acknowledge") {
      if (proposal.kind !== "notes") {
        return { ok: false, code: "wrong_kind", error: "acknowledge is for notes proposals; use apply for edits" };
      }
      if (caller.username === proposal.proposer_username) {
        return { ok: false, code: "four_eyes", error: "Four-eyes: someone other than the proposer must acknowledge" };
      }
      db.prepare(`UPDATE content_proposals SET status = 'finished', claim_json = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        id,
      );
      emitProposalEvent(site, "proposal_acknowledged", id, caller.username);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "add_blocker") {
      if (proposal.status === "finished" || proposal.status === "rejected" || proposal.status === "withdrawn") {
        return { ok: false, code: "closed", error: "Cannot add blockers to a closed proposal" };
      }
      const body = (caller.body || "").trim();
      if (body.length < MIN_BLOCKER_BODY) {
        return {
          ok: false,
          code: "blocker_too_short",
          error: `blocker body required (min ${MIN_BLOCKER_BODY} characters): what's wrong, what fixed looks like, and why`,
        };
      }
      db.prepare(
        `INSERT INTO content_proposal_blockers (
          proposal_id, kind, body, status, author, created_at, agent_session_id
        ) VALUES (?,?,?,?,?,?,?)`,
      ).run(id, "blocker", body, "open", caller.username, now, caller.agent_session_id?.trim() || null);
      db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "resolve_blocker") {
      const { active, expired } = activeClaim(proposal, now);
      if (!active || active.by !== caller.username) {
        return {
          ok: false,
          code: "not_claimant",
          error: expired
            ? "Claim expired. Claim the proposal again, then resolve the blocker."
            : "Only the active claimant may resolve blockers. Claim the proposal first.",
          claim_expired: expired,
          proposal,
        };
      }
      const blockerId = caller.blocker_id;
      if (!blockerId) return { ok: false, code: "blocker_required", error: "blocker_id is required" };
      const resolveNote = (caller.resolve_note || "").trim();
      if (resolveNote.length < 20) {
        return {
          ok: false,
          code: "resolve_note_too_short",
          error: "resolve_note required (min 20 characters): what changed",
        };
      }
      const blocker = proposal.blockers.find((b) => b.id === blockerId);
      if (!blocker) return { ok: false, code: "blocker_not_found", error: "Blocker not found" };
      if (blocker.status !== "open") {
        return { ok: false, code: "blocker_not_open", error: "Blocker is not open" };
      }
      db.prepare(
        `UPDATE content_proposal_blockers
         SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolve_note = ?
         WHERE id = ? AND proposal_id = ?`,
      ).run(now, caller.username, resolveNote, blockerId, id);
      db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      const fresh = get(id)!;
      const warnings =
        fresh.open_blocker_count === 0
          ? [
              {
                code: "blockers_cleared_repreview",
                message:
                  "All blockers are resolved. Re-preview the draft (or soft diffs) before apply — cleared blockers do not mean approved.",
              },
            ]
          : undefined;
      return { ok: true, proposal: fresh, warnings };
    }

    if (action === "reopen_blocker") {
      const blockerId = caller.blocker_id;
      if (!blockerId) return { ok: false, code: "blocker_required", error: "blocker_id is required" };
      const blocker = proposal.blockers.find((b) => b.id === blockerId);
      if (!blocker) return { ok: false, code: "blocker_not_found", error: "Blocker not found" };
      if (blocker.status !== "resolved") {
        return { ok: false, code: "blocker_not_resolved", error: "Only resolved blockers can be reopened" };
      }
      db.prepare(
        `UPDATE content_proposal_blockers
         SET status = 'open', resolved_at = NULL, resolved_by = NULL, resolve_note = NULL
         WHERE id = ? AND proposal_id = ?`,
      ).run(blockerId, id);
      db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "attach_variant") {
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot attach a variant to a closed proposal" };
      }
      const session = caller.agent_session_id?.trim();
      if (!proposal.created_agent_session_id) {
        return {
          ok: false,
          code: "session_required",
          error: "This proposal has no creating session; variant attach is not allowed",
        };
      }
      if (!session || session !== proposal.created_agent_session_id) {
        return {
          ok: false,
          code: "session_mismatch",
          error: "attach_variant is only allowed in the same agent session that created the proposal",
        };
      }
      const entry = proposal.entries[0];
      if (!entry) {
        return { ok: false, code: "entry_required", error: "Proposal has no entries to attach a variant to" };
      }
      if (entry.variant) {
        return {
          ok: false,
          code: "variant_locked",
          error: `Variant '${entry.variant}' is already attached and cannot be changed`,
        };
      }
      const variant = (caller.variant || "").trim();
      if (!variant) return { ok: false, code: "variant_required", error: "variant is required" };

      const existingVariant = findOpenProposalForVariant(
        db,
        site,
        entry.contentType,
        entry.slug,
        entry.locale,
        variant,
      );
      if (existingVariant && existingVariant.id !== id) {
        return {
          ok: false,
          code: "proposal_exists",
          error: `An open proposal already references variant '${variant}'`,
          existing_proposal: existingVariant,
        };
      }

      let fingerprint: string | null = null;
      if (deps.readVariantFingerprint) {
        const fp = deps.readVariantFingerprint({
          contentType: entry.contentType,
          slug: entry.slug,
          locale: entry.locale,
          variant,
        });
        if (fp.error) return { ok: false, code: "baseline_failed", error: fp.error };
        fingerprint = fp.fingerprint;
      }

      db.prepare(
        `UPDATE content_proposal_entries SET variant = ?, variant_fingerprint = ? WHERE id = ?`,
      ).run(variant, fingerprint, entry.id);
      if (caller.promote_on_apply) {
        db.prepare(`UPDATE content_proposals SET promote_on_apply = 1, updated_at = ? WHERE id = ?`).run(now, id);
      } else {
        db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      }
      return { ok: true, proposal: get(id)! };
    }

    if (action === "apply") {
      if (proposal.kind !== "edits") {
        return { ok: false, code: "wrong_kind", error: "apply is for edits proposals; use acknowledge for notes" };
      }
      if (caller.username === proposal.proposer_username) {
        return { ok: false, code: "four_eyes", error: "Four-eyes: someone other than the proposer must apply" };
      }
      if (proposal.open_blocker_count > 0) {
        return {
          ok: false,
          code: "proposal_blocked",
          error: `Cannot apply while ${proposal.open_blocker_count} open blocker(s) remain`,
          proposal,
        };
      }

      const work = proposal.entries.filter((e) => e.status === "pending" || e.status === "failed");
      for (const entry of work) {
        if (proposal.promote_on_apply) {
          if (!entry.variant) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run("promote_on_apply requires an attached variant", entry.id);
            continue;
          }
          if (deps.readVariantFingerprint && entry.variant_fingerprint) {
            const fp = deps.readVariantFingerprint({
              contentType: entry.contentType,
              slug: entry.slug,
              locale: entry.locale,
              variant: entry.variant,
            });
            if (fp.error || fp.fingerprint !== entry.variant_fingerprint) {
              db.prepare(
                `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
              ).run(
                fp.error
                  ? `context_stale: ${fp.error}`
                  : "context_stale: variant file contents changed since the proposal was created",
                entry.id,
              );
              continue;
            }
          }
          if (!deps.promoteEntry) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run("promote not configured", entry.id);
            continue;
          }
          const promoted = await deps.promoteEntry(entry, caller.username, {
            confirm_end_experiment: caller.confirm_end_experiment,
          });
          if (!promoted.ok) {
            if (promoted.code === "confirm_end_experiment") {
              return {
                ok: false,
                code: "confirm_end_experiment",
                error: promoted.error ?? "confirm_end_experiment required",
                traffic_siblings: promoted.traffic_siblings,
                proposal,
              };
            }
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run(promoted.error ?? "promote failed", entry.id);
            continue;
          }
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
          ).run(Date.now(), caller.username, entry.id);
          continue;
        }

        // Soft apply (live or into variant)
        if (!entry.ops.length) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
          ).run(Date.now(), caller.username, entry.id);
          continue;
        }

        if (entry.variant && deps.readVariantFingerprint && entry.variant_fingerprint) {
          const fp = deps.readVariantFingerprint({
            contentType: entry.contentType,
            slug: entry.slug,
            locale: entry.locale,
            variant: entry.variant,
          });
          if (fp.error || fp.fingerprint !== entry.variant_fingerprint) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run(
              fp.error
                ? `context_stale: ${fp.error}`
                : "context_stale: variant file contents changed since the proposal was created",
              entry.id,
            );
            continue;
          }
        }

        const live = deps.captureBaseline({
          contentType: entry.contentType,
          slug: entry.slug,
          locale: entry.locale,
          variant: entry.variant || undefined,
          updates: entry.ops,
        });
        if (live.error) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(live.error, entry.id);
          continue;
        }
        const stalePaths: string[] = [];
        for (const op of entry.ops) {
          const was = entry.baseline_context.values[op.field_path];
          const nowVal = live.values[op.field_path];
          if (!valuesEqual(was, nowVal)) stalePaths.push(op.field_path);
        }
        if (stalePaths.length) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(`context_stale: ${stalePaths.join(", ")}`, entry.id);
          continue;
        }
        const applied = await deps.applyUpdates(entry, caller.username);
        if (!applied.ok) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(applied.error ?? "apply failed", entry.id);
          continue;
        }
        db.prepare(
          `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
        ).run(Date.now(), caller.username, entry.id);
      }
      const updated = get(id)!;
      const next = persistRollup(db, updated);
      const fresh = get(id)!;
      emitProposalEvent(site, "proposal_applied_progress", id, caller.username, {
        status: next,
        done: fresh.entries.filter((e) => e.status === "done").length,
        total: fresh.entries.length,
      });
      if (next === "finished") {
        emitProposalEvent(site, "proposal_finished", id, caller.username);
      }
      return { ok: true, proposal: fresh };
    }

    return { ok: false, code: "unknown_action", error: `Unknown action: ${action}` };
  }

  return { get, list, stats, exportAll, create, update };
}

/** Full site dump for production → local pull (includes entries + blockers). */
export function exportAllProposals(site: string): ProposalRecord[] {
  const db = dbFor(site);
  const rows = db
    .prepare(`SELECT * FROM content_proposals WHERE site = ? ORDER BY updated_at DESC, id ASC`)
    .all(site) as ProposalRow[];
  return rows.map((r) => mapProposal(r, loadEntries(db, r.id), loadBlockers(db, r.id)));
}

function syncAutoincrement(db: Database.Database, table: string): void {
  const row = db.prepare(`SELECT MAX(id) AS m FROM ${table}`).get() as { m: number | null };
  const max = Number(row?.m) || 0;
  try {
    if (max <= 0) {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
      return;
    }
    const existing = db
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`)
      .get(table) as { seq: number } | undefined;
    if (existing) {
      db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(max, table);
    } else {
      db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(table, max);
    }
  } catch {
    /* sqlite_sequence may be absent until first AUTOINCREMENT write */
  }
}

/**
 * Dev-only helper: wipe this site's proposals and insert a production snapshot.
 * Remaps `site` to the local content root; preserves proposal / entry / blocker ids.
 */
export function replaceProposalsFromSnapshot(site: string, proposals: ProposalRecord[]): number {
  const db = dbFor(site);
  const insertProposal = db.prepare(
    `INSERT INTO content_proposals (
      id, site, fingerprint, status, kind, category, title, summary, rationale,
      documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
      created_at, updated_at, claim_json, tags_json, search_text,
      created_agent_session_id, promote_on_apply
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertEntry = db.prepare(
    `INSERT INTO content_proposal_entries (
      id, proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json,
      last_error, applied_at, applied_by, variant_fingerprint
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertBlocker = db.prepare(
    `INSERT INTO content_proposal_blockers (
      id, proposal_id, kind, body, status, author, created_at, resolved_at, resolved_by,
      resolve_note, agent_session_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const run = db.transaction((rows: ProposalRecord[]) => {
    db.prepare(
      `DELETE FROM content_proposal_blockers
       WHERE proposal_id IN (SELECT id FROM content_proposals WHERE site = ?)`,
    ).run(site);
    db.prepare(
      `DELETE FROM content_proposal_entries
       WHERE proposal_id IN (SELECT id FROM content_proposals WHERE site = ?)`,
    ).run(site);
    db.prepare(`DELETE FROM content_proposals WHERE site = ?`).run(site);

    for (const p of rows) {
      insertProposal.run(
        p.id,
        site,
        p.fingerprint,
        p.status,
        p.kind,
        p.category,
        p.title,
        p.summary,
        p.rationale,
        JSON.stringify(p.documentation ?? {}),
        JSON.stringify(p.related_issue_ids ?? []),
        p.proposer_username,
        JSON.stringify(p.proposer_actor ?? {}),
        p.created_at,
        p.updated_at,
        p.claim ? JSON.stringify(p.claim) : null,
        JSON.stringify(p.tags ?? []),
        p.search_text ?? "",
        p.created_agent_session_id ?? null,
        p.promote_on_apply ? 1 : 0,
      );
      for (const e of p.entries ?? []) {
        insertEntry.run(
          e.id,
          p.id,
          e.entry_key || makeEntryKey(e.contentType, e.slug),
          e.locale,
          e.variant ?? null,
          e.status,
          JSON.stringify(e.ops ?? []),
          JSON.stringify(e.baseline_context ?? { values: {} }),
          e.last_error ?? null,
          e.applied_at ?? null,
          e.applied_by ?? null,
          e.variant_fingerprint ?? null,
        );
      }
      for (const b of p.blockers ?? []) {
        insertBlocker.run(
          b.id,
          p.id,
          b.kind || "blocker",
          b.body,
          b.status,
          b.author,
          b.created_at,
          b.resolved_at ?? null,
          b.resolved_by ?? null,
          b.resolve_note ?? null,
          b.agent_session_id ?? null,
        );
      }
    }

    syncAutoincrement(db, "content_proposal_entries");
    syncAutoincrement(db, "content_proposal_blockers");
    return rows.length;
  });

  return run(proposals);
}

function inferCategory(entries: ProposalEntryInput[]): ProposalCategory {
  const seo = entries.some((e) =>
    (e.updates ?? []).some((u) => u.field_path.startsWith("meta.") || u.field_path.startsWith("seo.")),
  );
  return seo ? "content.seo" : "content.field";
}

export function captureBaselineFromSite(ctx: SiteContext, entry: ProposalEntryInput): {
  values: Record<string, unknown>;
  error?: string;
} {
  const loaded = getContentForEdit(
    entry.contentType,
    entry.slug,
    entry.locale,
    entry.variant,
    undefined,
    ctx.contentIndex,
  );
  if (!loaded.content) {
    return { values: {}, error: loaded.error || "Content not found" };
  }
  const values: Record<string, unknown> = {};
  for (const u of entry.updates ?? []) {
    values[u.field_path] = getByPath(loaded.content, u.field_path);
  }
  return { values };
}

export function readVariantFingerprintFromSite(
  ctx: SiteContext,
  entry: { contentType: string; slug: string; locale: string; variant: string },
): { fingerprint: string; error?: string } {
  const resolved = resolveWritableVersioningTarget(entry.contentType, entry.slug, ctx.contentRoot);
  if (!resolved.ok) {
    return { fingerprint: "", error: resolved.error };
  }
  const filePath = ctx.versioningManager.getVariantFilePath(
    entry.contentType,
    resolved.slug,
    entry.variant,
    entry.locale,
  );
  if (!fs.existsSync(filePath)) {
    return { fingerprint: "", error: "Variant file not found" };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return { fingerprint: hashVariantFileContents(raw) };
}

export async function applyUpdatesOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!entry.ops.length) return { ok: true };
  const operations = entry.ops.map((u) =>
    u.reset
      ? { action: "update_field" as const, path: u.field_path, value: null }
      : { action: "update_field" as const, path: u.field_path, value: u.value },
  );
  const result = await editContent({
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    variant: entry.variant || undefined,
    operations,
    author,
    contentRoot: ctx.contentRoot,
    ci: ctx.contentIndex,
    skipSharedLayoutFanOut: true,
  });
  if (!result.success) return { ok: false, error: result.error || "Write failed" };
  return { ok: true };
}

export async function promoteEntryOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
  opts: { confirm_end_experiment?: boolean },
): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
  traffic_siblings?: Array<{ slug: string; locale: string; allocation: number }>;
}> {
  if (!entry.variant) return { ok: false, code: "variant_required", error: "variant required for promote" };
  const { promoteVariantWithOptionalTeardown } = await import("../versioning/promote-with-teardown");
  const resolved = resolveWritableVersioningTarget(entry.contentType, entry.slug, ctx.contentRoot);
  if (!resolved.ok) {
    return { ok: false, code: "not_found", error: resolved.error };
  }
  const folder = getFolder(entry.contentType as ContentType);
  const result = await promoteVariantWithOptionalTeardown({
    contentType: entry.contentType,
    slug: resolved.slug,
    locale: entry.locale,
    variantSlug: entry.variant,
    author,
    contentRoot: ctx.contentRoot,
    contentRootName: ctx.contentRootName,
    folder,
    templateMode: resolved.templateMode,
    versioningManager: ctx.versioningManager,
    ci: ctx.contentIndex,
    cache: ctx.validationCache,
    confirmEndExperiment: opts.confirm_end_experiment,
    endExperimentMode: true,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      error: result.error,
      traffic_siblings: result.traffic_siblings,
    };
  }
  return { ok: true };
}

function proposalCollection(site: string): string {
  return `cms_proposals_${site.replace(/[^\w-]+/g, "-")}`;
}

async function indexProposalSearch(site: string, proposal: ProposalRecord): Promise<void> {
  const { upsertItem } = await import("../vector-search");
  await upsertItem(
    proposalCollection(site),
    {
      id: proposal.id,
      slug: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      rationale: proposal.rationale ?? "",
      tags: proposal.tags.join(" "),
      search_text: proposal.search_text,
      status: proposal.status,
    },
    ["title", "summary", "rationale", "tags", "search_text"],
  );
}

async function findSimilarProposals(site: string, query: string): Promise<SimilarProposal[]> {
  const { search } = await import("../vector-search");
  const hits = await search(proposalCollection(site), query, 8);
  return hits.map((h) => ({ id: h.slug, title: h.slug, score: h.score }));
}

export function proposalServiceForSite(ctx: SiteContext) {
  const site = ctx.contentRootName;
  return createProposalService({
    site,
    issueExists: (id) => Boolean(ctx.validationCache.getIssueById(id)),
    captureBaseline: (entry) => captureBaselineFromSite(ctx, entry),
    applyUpdates: (entry, author) => applyUpdatesOnSite(ctx, entry, author),
    readVariantFingerprint: (entry) => readVariantFingerprintFromSite(ctx, entry),
    promoteEntry: (entry, author, opts) => promoteEntryOnSite(ctx, entry, author, opts),
    findSimilar: (q) => findSimilarProposals(site, q),
    indexSearch: (p) => indexProposalSearch(site, p),
  });
}
