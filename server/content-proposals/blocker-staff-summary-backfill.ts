/**
 * One-time backfill: write a plain-English staff_summary for blockers filed before it existed.
 * Only blockers with no staff version on open or partial proposals; `body` is never changed and
 * proposal timestamps are not touched (inactivity clocks stay as they are).
 */

import type Database from "better-sqlite3";
import { BLOCKER_STAFF_SUMMARY_HINT, STAFF_SUMMARY_MAX, checkStaffSummary } from "./blocker-staff-summary";

type Log = (...args: unknown[]) => void;
export type CompleteFn = (prompt: string, systemPrompt: string) => Promise<string>;

export type BlockerNeedingSummary = {
  id: number;
  proposal_id: string;
  proposal_title: string;
  body: string;
};

/** Models overshoot the length they are asked for, so aim well under the hard limit. */
const TARGET_CHARS = 500;
const SHORTEN_TARGET_CHARS = 450;
const MAX_ATTEMPTS = 3;

const SYSTEM_PROMPT =
  "You rewrite technical review notes for a marketing website's staff. The note was written by an AI reviewer " +
  "for the AI author of a content change. Rewrite it for a staff member who has not read the code and must decide " +
  "whether to approve. Keep every consequence and the required action; drop field names, file names, warning codes " +
  `and tool names. Aim for about ${TARGET_CHARS} characters; never exceed ${STAFF_SUMMARY_MAX}. ` +
  "Reply with only the rewritten note, no preamble or quotes.\n\nRules: " +
  BLOCKER_STAFF_SUMMARY_HINT;

export function selectBlockersMissingStaffSummary(db: Database.Database, site: string): BlockerNeedingSummary[] {
  return db
    .prepare(
      `SELECT b.id, b.proposal_id, p.title AS proposal_title, b.body
       FROM content_proposal_blockers b
       INNER JOIN content_proposals p ON p.id = b.proposal_id
       WHERE p.site = ? AND p.status IN ('open', 'partial')
         AND (b.staff_summary IS NULL OR TRIM(b.staff_summary) = '')
       ORDER BY b.id`,
    )
    .all(site) as BlockerNeedingSummary[];
}

function cleanReply(raw: string): string {
  return raw
    .trim()
    .replace(/^["“']+|["”']+$/g, "")
    .trim();
}

export async function rewriteBlockerForStaff(
  complete: CompleteFn,
  blocker: Pick<BlockerNeedingSummary, "proposal_title" | "body">,
): Promise<{ ok: true; text: string } | { ok: false; problems: string[]; text: string }> {
  const base = `Proposal: ${blocker.proposal_title}\n\nTechnical note:\n${blocker.body}`;
  let text = cleanReply(await complete(base, SYSTEM_PROMPT));
  let check = checkStaffSummary(text);

  for (let attempt = 2; !check.ok && attempt <= MAX_ATTEMPTS; attempt++) {
    const tooLong = text.trim().length > STAFF_SUMMARY_MAX;
    const shorten = tooLong
      ? `\n\nCut it to at most ${SHORTEN_TARGET_CHARS} characters in 2-3 sentences: keep what changes for visitors, ` +
        "what must happen before approving, and who does it; drop background and the parts that already pass review."
      : "";
    const retry =
      `${base}\n\nYour previous rewrite was rejected:\n${text}\n\nProblems to fix:\n- ${check.problems.join("\n- ")}${shorten}`;
    text = cleanReply(await complete(retry, SYSTEM_PROMPT));
    check = checkStaffSummary(text);
  }
  return check.ok ? { ok: true, text } : { ok: false, problems: check.problems, text };
}

export async function backfillSiteBlockerStaffSummaries(opts: {
  db: Database.Database;
  site: string;
  dryRun: boolean;
  complete: CompleteFn;
  log?: Log;
  error?: Log;
}): Promise<{ updated: number; failed: number; total: number }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const rows = selectBlockersMissingStaffSummary(opts.db, opts.site);
  log("blockers_missing_staff_summary", rows.length);
  const update = opts.db.prepare(
    `UPDATE content_proposal_blockers SET staff_summary = ?
     WHERE id = ? AND (staff_summary IS NULL OR TRIM(staff_summary) = '')`,
  );

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    let res: Awaited<ReturnType<typeof rewriteBlockerForStaff>>;
    try {
      res = await rewriteBlockerForStaff(opts.complete, row);
    } catch (e) {
      failed += 1;
      error("rewrite_error", { blocker_id: row.id, proposal_id: row.proposal_id, error: (e as Error).message });
      continue;
    }
    if (!res.ok) {
      failed += 1;
      error("rewrite_not_plain", { blocker_id: row.id, proposal_id: row.proposal_id, problems: res.problems, text: res.text });
      continue;
    }
    log("blocker", { blocker_id: row.id, proposal: row.proposal_title, before: row.body, after: res.text });
    if (!opts.dryRun) {
      update.run(res.text, row.id);
      updated += 1;
    }
  }
  return { updated, failed, total: rows.length };
}

export async function runBlockerStaffSummaryBackfill(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const { getSiteContextMap } = await import("../site-manager");
  const { ensurePipelineDb } = await import("../pipeline-db/runner");
  const { getSiteSqlite } = await import("../db");
  const { getLLMService } = await import("../ai/LLMService");

  let llm: ReturnType<typeof getLLMService>;
  try {
    llm = getLLMService();
  } catch (e) {
    error("llm_unavailable", (e as Error).message);
    return { failed: true };
  }
  const complete: CompleteFn = (prompt, systemPrompt) =>
    llm.complete(prompt, { systemPrompt, temperature: 0.3, maxTokens: 600 });

  let failed = false;
  let matched = false;
  for (const ctx of Array.from(getSiteContextMap().values())) {
    const site = ctx.contentRootName;
    if (opts.site && site !== opts.site) continue;
    matched = true;
    ensurePipelineDb(site);
    log("site", site);
    const report = await backfillSiteBlockerStaffSummaries({
      db: getSiteSqlite(site),
      site,
      dryRun: opts.dryRun,
      complete,
      log,
      error,
    });
    log("report", report);
    if (report.failed > 0) failed = true;
  }
  if (opts.site && !matched) {
    error("unknown_site", opts.site);
    failed = true;
  }
  return { failed };
}
