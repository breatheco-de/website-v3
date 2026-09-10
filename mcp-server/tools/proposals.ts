import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { hasCapAnyScope } from "../lib/tool-catalog.js";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import {
  clampProposalLimit,
  clampProposalOffset,
  isProposalsScoped,
  parseProposalSort,
  proposalNextOffset,
} from "../lib/list-proposals-mcp.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

function siteQuery(domain: string | null, extra = ""): string {
  const parts: string[] = [];
  if (domain) parts.push(`__site=${encodeURIComponent(domain)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function requireProposeListCap(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (grants && (hasCapAnyScope(grants, "content_view") || hasCapAnyScope(grants, "seo_edit"))) return null;
  const okCap =
    (await checkCap(mcpToken, "content_view")) || (await checkCap(mcpToken, "seo_edit"));
  if (!okCap) return denyResponse("content_view|seo_edit");
  return null;
}

async function requireUpdateCap(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (grants && (hasCapAnyScope(grants, "content_edit_text") || hasCapAnyScope(grants, "seo_edit"))) return null;
  const okCap =
    (await checkCap(mcpToken, "content_edit_text")) || (await checkCap(mcpToken, "seo_edit"));
  if (!okCap) return denyResponse("content_edit_text|seo_edit");
  return null;
}

const BLOCKER_BODY_HINT =
  "Plain text min 80 chars: (1) what's wrong, (2) what fixed looks like, (3) why it matters. Do not list MCP tools.";

export function registerProposalTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "propose_change",
    "Create a content proposal (does not write live YAML). kind is edits when entries[] is set (or promote_on_apply), otherwise notes. " +
      "Notes default to no_auto_retry: another notes handoff on the same related_issue_id is blocked until claim + set_no_auto_retry false (or close). " +
      "Optional variant on an entry: soft = apply field patches into that draft; with promote_on_apply = go-live when approved. " +
      "At most one open proposal per variant — joining the existing proposal is required. " +
      "Pass agent_session_id to allow same-session attach_variant later. " +
      "Edits proposals soft-block when linked entries have recent writes (confirm_recent_activity after get_entry_activity). " +
      "Requires content_view or seo_edit. Four-eyes apply/reject (not close).",
    {
      title: z.string().describe("Short title"),
      summary: z.string().describe("Why + what (min 80 chars). For notes, include steps tried."),
      rationale: z.string().optional(),
      category: z.enum(["content.field", "content.seo"]).optional(),
      related_issue_ids: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      confirm_distinct: z.boolean().optional(),
      confirm_recent_activity: z
        .boolean()
        .optional()
        .describe(
          "Required after confirm_recent_activity action_required — set true only after inspecting get_entry_activity.",
        ),
      situation_note: z.string().optional().describe("Plain-English picture of current live values."),
      agent_session_id: z.string().optional().describe("From agent_session start — required to attach_variant later in the same session."),
      promote_on_apply: z
        .boolean()
        .optional()
        .describe("When true with a variant entry, approve promotes that draft to live (empty updates allowed)."),
      entries: z
        .array(
          z.object({
            contentType: z.string(),
            slug: z.string(),
            locale: z.string(),
            variant: z.string().optional(),
            updates: z
              .array(
                z.object({
                  field_path: z.string(),
                  value: z.unknown().optional(),
                  reset: z.boolean().optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireProposeListCap(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/admin/proposals${siteQuery(siteResult.domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: buildLoopbackHeaders(mcpToken, { agentSessionId: args.agent_session_id }),
          body: JSON.stringify({
            title: args.title,
            summary: args.summary,
            rationale: args.rationale,
            category: args.category,
            related_issue_ids: args.related_issue_ids,
            tags: args.tags,
            confirm_distinct: args.confirm_distinct,
            confirm_recent_activity: args.confirm_recent_activity,
            situation_note: args.situation_note,
            entries: args.entries,
            agent_session_id: args.agent_session_id,
            promote_on_apply: args.promote_on_apply,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (data.code === "similar_proposals") {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_distinct",
                ...data,
              },
              [
                {
                  tool: "propose_change",
                  reason: "Retry with confirm_distinct: true if this is a different idea.",
                  priority: "required",
                  args_hint: { ...args, confirm_distinct: true },
                },
                {
                  tool: "list_proposals",
                  reason: "Inspect similar proposals first.",
                  priority: "recommended",
                },
              ],
            );
          }
          if (data.code === "confirm_recent_activity") {
            const firstEntry = args.entries?.[0];
            return actionRequired(
              {
                success: false,
                action_required: "confirm_recent_activity",
                ...data,
              },
              [
                {
                  tool: "get_entry_activity",
                  reason:
                    "Inspect recent writes on the linked entry (SEO/traffic may still be catching up).",
                  priority: "required",
                  args_hint: firstEntry
                    ? {
                        contentType: firstEntry.contentType,
                        slug: firstEntry.slug,
                        locale: firstEntry.locale,
                        ...(firstEntry.variant ? { variant: firstEntry.variant } : {}),
                        ...(args.site ? { site: args.site } : {}),
                        ...(args.agent_session_id
                          ? { agent_session_id: args.agent_session_id }
                          : {}),
                      }
                    : undefined,
                },
                {
                  tool: "propose_change",
                  reason:
                    "Retry with confirm_recent_activity: true only if this proposal is still distinct from recent edits.",
                  priority: "required",
                  args_hint: { ...args, confirm_recent_activity: true },
                },
              ],
            );
          }
          if (data.code === "activity_unavailable") {
            return actionRequired(
              {
                success: false,
                action_required: "retry_when_activity_available",
                ...data,
              },
              [
                {
                  tool: "propose_change",
                  reason: "Retry when entry activity history is readable (fail-closed; do not invent confirm).",
                  priority: "required",
                  args_hint: { ...args },
                },
              ],
            );
          }
          if (data.code === "proposal_exists") {
            const existing = data.existing_proposal as { id?: string } | undefined;
            return actionRequired(
              {
                success: false,
                action_required: "join_existing_proposal",
                ...data,
              },
              [
                {
                  tool: "list_proposals",
                  reason: "Open the existing proposal for this variant and claim or add_blocker there.",
                  priority: "required",
                  args_hint: { proposal_id: existing?.id ?? data.duplicate_of },
                },
              ],
            );
          }
          if (data.code === "notes_no_auto_retry") {
            const existing = data.existing_proposal as { id?: string } | undefined;
            return actionRequired(
              {
                success: false,
                action_required: "join_existing_notes",
                ...data,
              },
              [
                {
                  tool: "list_proposals",
                  reason:
                    "Join the open notes handoff (no auto-retry). Claim it, or set_no_auto_retry false after claim to allow another notes attempt. Prefer an edits proposal for a real fix.",
                  priority: "required",
                  args_hint: { proposal_id: existing?.id },
                },
              ],
            );
          }
          return fail(String(data.error ?? "propose_change failed"), { code: data.code });
        }
        const proposal = (data as { proposal?: { id?: string; review_mode?: string; promote_on_apply?: boolean } })
          .proposal;
        const warnings: Array<{ code: string; message: string }> = [
          {
            code: "not_applied",
            message:
              "Proposal stored only. Does not write YAML, GitHub, or complete validation issues. Notes write no entries.",
          },
          {
            code: "four_eyes",
            message:
              "A different user with content_edit_text or seo_edit must apply or reject edits. Notes close with a reason (not four-eyes) — close does not fix content.",
          },
        ];
        if (proposal?.review_mode === "draft_backed" || proposal?.promote_on_apply) {
          warnings.push({
            code: "review_variant_before_apply",
            message:
              "This proposal includes a draft for go-live. Preview the attached variant before apply/reject. Soft field diffs alone are not enough.",
          });
        } else if (proposal?.review_mode === "soft_variant") {
          warnings.push({
            code: "review_variant_before_apply",
            message:
              "This soft proposal targets a draft variant. Preview that variant; apply writes field patches into the draft (does not promote).",
          });
        }
        return ok({
          ...data,
          warnings,
          next_actions: [
            {
              tool: "list_proposals",
              reason: "Re-read the stored proposal.",
              args_hint: { proposal_id: proposal?.id },
              priority: "optional",
            },
          ],
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "list_proposals",
    "List or fetch content proposals (stats-first). With no filters, returns proposal_stats only. " +
      "Pass proposal_id, query, issue_id, status, or kind for paginated proposals[] (includes review_mode, open_blocker_count, blockers). " +
      "Requires content_view or seo_edit.",
    {
      proposal_id: z.string().optional(),
      query: z.string().optional(),
      status: z.enum(["open", "partial", "finished", "rejected", "withdrawn"]).optional(),
      kind: z.enum(["edits", "notes"]).optional(),
      issue_id: z.string().optional(),
      limit: z.number().optional().describe("Page size when scoped (default 20, max 200)"),
      offset: z.number().optional().describe("Offset when scoped"),
      sort: z
        .string()
        .optional()
        .describe("Scoped only: created_at | updated_at (default updated_at). Invalid values fail."),
      sort_dir: z
        .string()
        .optional()
        .describe("Scoped only: asc | desc (default desc). Invalid values fail."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireProposeListCap(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);

      const scoped = isProposalsScoped(args);
      const limit = clampProposalLimit(args.limit);
      const offset = clampProposalOffset(args.offset);
      const warnings: Array<{ code: string; message: string }> = [];
      const sortArgsPresent = args.sort != null || args.sort_dir != null;

      if (!scoped) {
        warnings.push({
          code: "proposals_need_filter",
          message:
            "Unscoped list_proposals returns proposal_stats only. Pass status, kind, query, issue_id, or proposal_id to load proposals[].",
        });
        if (args.limit != null || args.offset != null) {
          warnings.push({
            code: "proposals_need_filter",
            message: "limit/offset without a scope filter are ignored.",
          });
        }
        if (sortArgsPresent) {
          warnings.push({
            code: "proposals_sort_ignored",
            message: "sort/sort_dir without a scope filter are ignored (stats only).",
          });
        }
      }

      let sort = "updated_at";
      let sort_dir = "desc";
      if (scoped) {
        const parsed = parseProposalSort(args.sort, args.sort_dir);
        if (!parsed.ok) return fail(parsed.error, { code: "invalid_sort" });
        sort = parsed.sort;
        sort_dir = parsed.sortDir;
      }

      const qs = new URLSearchParams();
      if (scoped) {
        if (args.proposal_id) qs.set("proposal_id", args.proposal_id);
        if (args.query) qs.set("q", args.query);
        if (args.status) qs.set("status", args.status);
        if (args.kind) qs.set("kind", args.kind);
        if (args.issue_id) qs.set("issue_id", args.issue_id);
        qs.set("limit", String(limit));
        qs.set("offset", String(offset));
        qs.set("sort", sort);
        qs.set("sort_dir", sort_dir);
      } else {
        qs.set("limit", "1");
        qs.set("offset", "0");
      }
      const extra = qs.toString();
      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/admin/proposals${siteQuery(siteResult.domain, extra)}`;
        const res = await fetch(url, { headers: buildLoopbackHeaders(mcpToken) });
        const data = (await res.json()) as {
          proposals?: unknown[];
          total?: number;
          stats?: unknown;
          error?: string;
        };
        if (!res.ok) return fail(String(data.error ?? "list_proposals failed"));

        const proposal_stats = data.stats ?? null;
        if (!scoped) {
          return ok(
            {
              proposal_stats,
              next_actions: [],
            },
            { warnings },
          );
        }

        const proposals = data.proposals ?? [];
        const total = typeof data.total === "number" ? data.total : proposals.length;
        const next_offset = proposalNextOffset(offset, limit, total, proposals.length);
        for (const p of proposals as Array<{ review_mode?: string; open_blocker_count?: number }>) {
          if (p.review_mode === "draft_backed" || p.review_mode === "soft_variant") {
            warnings.push({
              code: "review_variant_before_apply",
              message: "At least one listed proposal involves a draft — preview before judging.",
            });
            break;
          }
        }
        return ok(
          {
            proposal_stats,
            proposals,
            total,
            limit,
            offset,
            next_offset,
            sort,
            sort_dir,
            next_actions: [],
          },
          { warnings },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "update_proposal",
    "Lifecycle for a proposal. Actions: claim | release | withdraw | apply | close | acknowledge (alias of close) | reject | " +
      "attach_variant (same creating session only; write-once) | add_blocker (feedback; no claim) | " +
      "resolve_blocker (active claimant only) | reopen_blocker | set_no_auto_retry (notes; MCP must claim first). " +
      "close requires close_reason (wont_fix | fixed_elsewhere | tracked_elsewhere | other); close_note min 20 except wont_fix. " +
      "Close finishes notes without changing YAML — not a success path for fixes. " +
      "Open blockers block apply only (not reject/withdraw/close). " +
      "promote_on_apply apply may require confirm_end_experiment when other variants have traffic. " +
      "Requires content_edit_text or seo_edit.",
    {
      proposal_id: z.string(),
      action: z.enum([
        "claim",
        "release",
        "withdraw",
        "apply",
        "acknowledge",
        "close",
        "reject",
        "attach_variant",
        "add_blocker",
        "resolve_blocker",
        "reopen_blocker",
        "set_no_auto_retry",
      ]),
      report: z.string().optional(),
      agent_session_id: z.string().optional(),
      body: z.string().optional().describe(`For add_blocker: ${BLOCKER_BODY_HINT}`),
      blocker_id: z.number().optional().describe("For resolve_blocker / reopen_blocker"),
      resolve_note: z.string().optional().describe("For resolve_blocker: what changed (min 20 chars)"),
      variant: z.string().optional().describe("For attach_variant"),
      promote_on_apply: z.boolean().optional().describe("For attach_variant: mark go-live on approve"),
      confirm_end_experiment: z
        .boolean()
        .optional()
        .describe("For apply on draft_backed when siblings have traffic"),
      confirm_recent_activity: z
        .boolean()
        .optional()
        .describe(
          "For apply: required after confirm_recent_activity action_required — set true only after get_entry_activity.",
        ),
      close_reason: z
        .enum(["wont_fix", "fixed_elsewhere", "tracked_elsewhere", "other"])
        .optional()
        .describe("For close / acknowledge: disposition (not a content fix)"),
      close_note: z
        .string()
        .optional()
        .describe("For close: required min 20 chars except wont_fix (say where / what)"),
      no_auto_retry: z
        .boolean()
        .optional()
        .describe("For set_no_auto_retry: MCP must hold an active claim"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireUpdateCap(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/admin/proposals/${encodeURIComponent(args.proposal_id)}/${encodeURIComponent(args.action)}${siteQuery(siteResult.domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: buildLoopbackHeaders(mcpToken, { agentSessionId: args.agent_session_id }),
          body: JSON.stringify({
            report: args.report,
            agent_session_id: args.agent_session_id,
            body: args.body,
            blocker_id: args.blocker_id,
            resolve_note: args.resolve_note,
            variant: args.variant,
            promote_on_apply: args.promote_on_apply,
            confirm_end_experiment: args.confirm_end_experiment,
            confirm_recent_activity: args.confirm_recent_activity,
            close_reason: args.close_reason,
            close_note: args.close_note,
            no_auto_retry: args.no_auto_retry,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (data.code === "confirm_end_experiment") {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_end_experiment",
                ...data,
              },
              [
                {
                  tool: "update_proposal",
                  reason: "Confirm ending the experiment, then retry apply with confirm_end_experiment: true.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "apply",
                    confirm_end_experiment: true,
                    confirm_recent_activity: args.confirm_recent_activity,
                    site: args.site,
                  },
                },
              ],
            );
          }
          if (data.code === "confirm_recent_activity") {
            const proposal = data.proposal as
              | {
                  entries?: Array<{
                    contentType?: string;
                    slug?: string;
                    locale?: string;
                    variant?: string | null;
                    status?: string;
                  }>;
                }
              | undefined;
            const entry =
              proposal?.entries?.find((e) => e.status === "pending" || e.status === "failed") ??
              proposal?.entries?.[0];
            return actionRequired(
              {
                success: false,
                action_required: "confirm_recent_activity",
                ...data,
              },
              [
                {
                  tool: "get_entry_activity",
                  reason: "Inspect recent writes before approving — traffic/CTR may still reflect prior edits.",
                  priority: "required",
                  args_hint: entry?.contentType
                    ? {
                        contentType: entry.contentType,
                        slug: entry.slug,
                        locale: entry.locale,
                        ...(entry.variant ? { variant: entry.variant } : {}),
                        ...(args.site ? { site: args.site } : {}),
                        ...(args.agent_session_id
                          ? { agent_session_id: args.agent_session_id }
                          : {}),
                      }
                    : undefined,
                },
                {
                  tool: "update_proposal",
                  reason:
                    "Retry apply with confirm_recent_activity: true after inspecting activity (compose with confirm_end_experiment when needed).",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "apply",
                    confirm_recent_activity: true,
                    confirm_end_experiment: args.confirm_end_experiment,
                    site: args.site,
                  },
                },
              ],
            );
          }
          if (data.code === "activity_unavailable") {
            return actionRequired(
              {
                success: false,
                action_required: "retry_when_activity_available",
                ...data,
              },
              [
                {
                  tool: "update_proposal",
                  reason: "Retry apply when entry activity history is readable (fail-closed).",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "apply",
                    site: args.site,
                  },
                },
              ],
            );
          }
          if (data.code === "proposal_blocked") {
            return fail(String(data.error ?? "proposal blocked"), {
              code: "proposal_blocked",
              next_actions: [
                {
                  tool: "list_proposals",
                  reason: "Read open blockers, then claim and fix before apply.",
                  priority: "required",
                  args_hint: { proposal_id: args.proposal_id },
                },
              ],
            });
          }
          if (data.code === "not_claimant") {
            return fail(String(data.error ?? "not claimant"), {
              code: "not_claimant",
              next_actions: [
                {
                  tool: "update_proposal",
                  reason: data.claim_expired
                    ? "Claim expired — claim again, then resolve_blocker."
                    : "Claim the proposal before resolve_blocker.",
                  priority: "required",
                  args_hint: { proposal_id: args.proposal_id, action: "claim", site: args.site },
                },
              ],
            });
          }
          if (data.code === "proposal_exists") {
            return actionRequired(
              {
                success: false,
                action_required: "join_existing_proposal",
                ...data,
              },
              [
                {
                  tool: "list_proposals",
                  reason: "Join the existing open proposal for this variant.",
                  priority: "required",
                  args_hint: {
                    proposal_id: (data.existing_proposal as { id?: string } | undefined)?.id,
                  },
                },
              ],
            );
          }
          return fail(String(data.error ?? "update_proposal failed"), { code: data.code });
        }

        const proposal = (
          data as {
            proposal?: {
              kind?: string;
              status?: string;
              related_issue_ids?: string[];
              open_blocker_count?: number;
              review_mode?: string;
              entries?: Array<{ contentType?: string; slug?: string; locale?: string; variant?: string | null }>;
            };
          }
        ).proposal;
        const warnings: Array<{ code: string; message: string }> = [
          ...(Array.isArray(data.warnings) ? (data.warnings as Array<{ code: string; message: string }>) : []),
        ];
        if (!warnings.some((w) => w.code === "partial_progress") && args.action === "apply") {
          warnings.push({
            code: "partial_progress",
            message:
              "Edits apply remaining entries only. Proposal is finished only when every entry is done (or notes closed with a reason).",
          });
        }
        if (args.action === "close" || args.action === "acknowledge") {
          warnings.push({
            code: "close_no_content_change",
            message:
              "Notes closed. Does not write YAML, complete issues, or apply a fix. Prefer an edits proposal when there is a real change to approve.",
          });
        }

        const next: Array<{
          tool: string;
          reason: string;
          priority: "required" | "recommended" | "optional";
          args_hint: Record<string, unknown>;
        }> = [];

        if (args.action === "resolve_blocker" && proposal?.open_blocker_count === 0) {
          const entry = proposal.entries?.[0];
          warnings.push({
            code: "blockers_cleared_repreview",
            message:
              "All blockers cleared. Re-preview before apply — cleared blockers do not mean approved.",
          });
          next.push({
            tool: "get_entry_content",
            reason: "Re-preview the draft (or live entry) after fixes before apply.",
            priority: "required",
            args_hint: {
              slug: entry?.slug,
              contentType: entry?.contentType,
              locale: entry?.locale,
              ...(entry?.variant ? { variant: entry.variant } : {}),
              site: args.site,
            },
          });
        }

        if (proposal?.status === "finished" && proposal.related_issue_ids?.length) {
          next.push({
            tool: "update_issue",
            reason: "Proposal finished — complete linked issues only if they are actually gone after re-check.",
            priority: "recommended",
            args_hint: { issue_id: proposal.related_issue_ids[0], action: "complete" },
          });
        }

        return ok({
          ...data,
          warnings,
          next_actions: next,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "get_entry_activity",
    "List recent people/agent writes for a CMS entry (14-day window). " +
      "Use before confirm_recent_activity on propose_change / update_proposal apply. " +
      "events[] is unfiltered history; gate_write_count excludes the current agent_session_id when provided. " +
      "Does not write YAML. Requires content_view or seo_edit.",
    {
      contentType: z.string(),
      slug: z.string(),
      locale: z.string(),
      variant: z.string().optional().describe("When set, activity includes this draft key as well as live."),
      limit: z.number().int().min(1).max(100).optional().describe("Max events to return (default 20)"),
      agent_session_id: z
        .string()
        .optional()
        .describe("When set, gate_write_count omits this session's writes (same as proposal create gate)."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireProposeListCap(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "get_entry_activity", args);
      try {
        const { listEntryActivityEvents, resolveProposalEntryActivity } = await import(
          "../../server/content-proposals/entry-activity.js"
        );
        const listed = listEntryActivityEvents({
          site: siteResult.contentRootName,
          contentType: args.contentType,
          slug: args.slug,
          locale: args.locale,
          variant: args.variant,
          limit: args.limit,
        });
        if (!listed.ok) {
          return fail(listed.error, { code: listed.code });
        }
        const gated = resolveProposalEntryActivity({
          site: siteResult.contentRootName,
          entries: [
            {
              contentType: args.contentType,
              slug: args.slug,
              locale: args.locale,
              variant: args.variant,
            },
          ],
          excludeAgentSessionId: args.agent_session_id,
        });
        if (!gated.ok) {
          return fail(gated.error, { code: gated.code });
        }
        const events = (listed.events ?? []).map((ev) => ({
          id: ev.id,
          type: ev.type,
          created_at: ev.created_at,
          author: ev.attribution?.[0]?.author ?? null,
          actor: ev.attribution?.[0]?.actor ?? null,
          agent_session_id: ev.agent_session_id ?? null,
          entry_key:
            typeof ev.payload?.entryKey === "string"
              ? ev.payload.entryKey
              : [
                  (ev.resource as { contentType?: string })?.contentType,
                  (ev.resource as { slug?: string })?.slug,
                  (ev.resource as { locale?: string })?.locale,
                ]
                  .filter(Boolean)
                  .join("/") || null,
          path:
            typeof (ev.resource as { path?: string })?.path === "string"
              ? (ev.resource as { path: string }).path
              : typeof ev.payload?.path === "string"
                ? ev.payload.path
                : null,
        }));
        return ok({
          activity: listed.activity,
          gate_write_count: gated.gateWriteCount,
          window_days: listed.windowDays,
          events,
          warnings: [
            {
              code: "inspect_only",
              message:
                "Read-only. Confirming recent activity on propose_change/apply does not write YAML or complete validation issues.",
            },
          ],
          next_actions: [],
        });
      } catch (e) {
        return fail((e as Error).message, { code: "activity_unavailable" });
      }
    },
  );
}
