import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { emitEvent } from "../events/event-store";
import { singleAttribution, type EventActor } from "../events/types";
import { getContentForEdit, editContent } from "../content-editor";
import type { SiteContext } from "../site-manager";
import { fingerprintEdits, fingerprintNotes, stableJson } from "./fingerprint";
import { child } from "../logger";

const log = child({ module: "content-proposals" });

export const PROPOSAL_CLAIM_TTL_MS = 30 * 60 * 1000;
export const RAG_SIMILARITY_THRESHOLD = 0.82;
const MIN_SUMMARY = 80;

export type ProposalStatus = "open" | "partial" | "finished" | "rejected" | "withdrawn";
export type ProposalKind = "edits" | "notes";
export type ProposalCategory = "content.field" | "content.seo";
export type EntryRowStatus = "pending" | "done" | "failed";

export type FieldUpdate = { field_path: string; value?: unknown; reset?: boolean };

export type ProposalClaim = {
  by: string;
  expiresAt: string;
  report?: string;
};

export type ProposalEntryInput = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  updates: FieldUpdate[];
};

export type ProposalEntryRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  status: EntryRowStatus;
  ops: FieldUpdate[];
  baseline_context: { values: Record<string, unknown>; note?: string };
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
  contentType: string;
  slug: string;
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
  entries: ProposalEntryRow[];
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
};

type EntryDbRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  status: EntryRowStatus;
  ops_json: string;
  baseline_context_json: string;
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
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
};

export type SimilarProposal = { id: string; title: string; score: number };

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

function mapEntry(row: EntryDbRow): ProposalEntryRow {
  const { contentType, slug } = splitEntryKey(row.entry_key);
  return {
    id: row.id,
    proposal_id: row.proposal_id,
    entry_key: row.entry_key,
    locale: row.locale,
    variant: row.variant,
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

function mapProposal(row: ProposalRow, entries: ProposalEntryRow[]): ProposalRecord {
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
    entries,
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

function loadProposal(db: Database.Database, id: string): ProposalRecord | null {
  const row = db.prepare(`SELECT * FROM content_proposals WHERE id = ?`).get(id) as ProposalRow | undefined;
  if (!row) return null;
  return mapProposal(row, loadEntries(db, id));
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
  findSimilar?: (query: string) => Promise<SimilarProposal[]>;
  indexSearch?: (proposal: ProposalRecord) => Promise<void>;
};

export function createProposalService(deps: ProposalServiceDeps) {
  const site = deps.site;

  function get(id: string): ProposalRecord | null {
    return loadProposal(dbFor(site), id);
  }

  function list(opts: {
    status?: ProposalStatus;
    kind?: ProposalKind;
    issue_id?: string;
    query?: string;
    proposal_id?: string;
    limit?: number;
  }): ProposalRecord[] {
    if (opts.proposal_id) {
      const one = get(opts.proposal_id);
      return one ? [one] : [];
    }
    const db = dbFor(site);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let sql = `SELECT * FROM content_proposals WHERE site = ?`;
    const params: unknown[] = [site];
    if (opts.status) {
      sql += ` AND status = ?`;
      params.push(opts.status);
    }
    if (opts.kind) {
      sql += ` AND kind = ?`;
      params.push(opts.kind);
    }
    if (opts.issue_id) {
      sql += ` AND related_issue_ids_json LIKE ?`;
      params.push(`%${opts.issue_id}%`);
    }
    if (opts.query?.trim()) {
      sql += ` AND search_text LIKE ?`;
      params.push(`%${opts.query.trim().toLowerCase()}%`);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as ProposalRow[];
    let records = rows.map((r) => mapProposal(r, loadEntries(db, r.id)));
    if (opts.issue_id) {
      records = records.filter((p) => p.related_issue_ids.includes(opts.issue_id!));
    }
    return records;
  }

  async function create(
    input: CreateProposalInput,
    proposer: { username: string; actor?: Record<string, unknown> },
  ): Promise<
    | { ok: true; proposal: ProposalRecord; duplicate?: boolean; similar?: SimilarProposal[] }
    | { ok: false; code: string; error: string; similar?: SimilarProposal[]; duplicate_of?: string }
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

    const entriesIn = input.entries ?? [];
    const kind: ProposalKind = entriesIn.length > 0 ? "edits" : "notes";
    if (kind === "edits") {
      for (const e of entriesIn) {
        if (!e.contentType || !e.slug || !e.locale) {
          return { ok: false, code: "entry_required", error: "Each entry needs contentType, slug, and locale" };
        }
        if (!e.updates?.length) {
          return { ok: false, code: "updates_required", error: `Entry ${e.contentType}/${e.slug} has no field updates` };
        }
      }
    }

    const category: ProposalCategory = input.category ?? (kind === "notes" ? "content.field" : inferCategory(entriesIn));
    const fingerprint =
      kind === "notes"
        ? fingerprintNotes({ site, category, relatedIssueIds: related, summary })
        : fingerprintEdits({ site, category, entries: entriesIn });

    const db = dbFor(site);
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
      ...entriesIn.map((e) => `${e.contentType}/${e.slug} ${e.updates.map((u) => u.field_path).join(" ")}`),
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

    const captured: Array<{ input: ProposalEntryInput; baseline: { values: Record<string, unknown>; note?: string } }> =
      [];
    for (const e of entriesIn) {
      const baseline = deps.captureBaseline(e);
      if (baseline.error) {
        return { ok: false, code: "baseline_failed", error: baseline.error };
      }
      captured.push({
        input: e,
        baseline: { values: baseline.values, note: input.situation_note },
      });
    }

    const now = Date.now();
    const id = randomUUID();
    const search_text = searchBlob;
    db.prepare(
      `INSERT INTO content_proposals (
        id, site, fingerprint, status, kind, category, title, summary, rationale,
        documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
        created_at, updated_at, claim_json, tags_json, search_text
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      search_text,
    );

    for (const cap of captured) {
      db.prepare(
        `INSERT INTO content_proposal_entries (
          proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json
        ) VALUES (?,?,?,?,?,?,?)`,
      ).run(
        id,
        makeEntryKey(cap.input.contentType, cap.input.slug),
        cap.input.locale,
        cap.input.variant || null,
        "pending",
        JSON.stringify(cap.input.updates),
        JSON.stringify(cap.baseline),
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
    action: "claim" | "release" | "withdraw" | "apply" | "acknowledge" | "reject",
    caller: { username: string; report?: string; asStaff?: boolean },
  ): Promise<{ ok: true; proposal: ProposalRecord } | { ok: false; code: string; error: string; proposal?: ProposalRecord }> {
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

    if (action === "apply") {
      if (proposal.kind !== "edits") {
        return { ok: false, code: "wrong_kind", error: "apply is for edits proposals; use acknowledge for notes" };
      }
      if (caller.username === proposal.proposer_username) {
        return { ok: false, code: "four_eyes", error: "Four-eyes: someone other than the proposer must apply" };
      }
      const work = proposal.entries.filter((e) => e.status === "pending" || e.status === "failed");
      for (const entry of work) {
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

  return { get, list, create, update };
}

function inferCategory(entries: ProposalEntryInput[]): ProposalCategory {
  const seo = entries.some((e) =>
    e.updates.some((u) => u.field_path.startsWith("meta.") || u.field_path.startsWith("seo.")),
  );
  return seo ? "content.seo" : "content.field";
}

export function captureBaselineFromSite(ctx: SiteContext, entry: ProposalEntryInput): {
  values: Record<string, unknown>;
  error?: string;
} {
  const loaded = getContentForEdit(entry.contentType, entry.slug, entry.locale, entry.variant, undefined, ctx.contentIndex);
  if (!loaded.content) {
    return { values: {}, error: loaded.error || "Content not found" };
  }
  const values: Record<string, unknown> = {};
  for (const u of entry.updates) {
    values[u.field_path] = getByPath(loaded.content, u.field_path);
  }
  return { values };
}

export async function applyUpdatesOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
): Promise<{ ok: boolean; error?: string }> {
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
    findSimilar: (q) => findSimilarProposals(site, q),
    indexSearch: (p) => indexProposalSearch(site, p),
  });
}
