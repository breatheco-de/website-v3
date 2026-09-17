import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { allowedToolNames, hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { loadContentTypes, resolveSiteContext } from "../lib/content.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import {
  attentionPerspectiveFromGrants,
  clampProposalLimit,
  clampProposalOffset,
  isProposalsScoped,
  normalizeProposalStatsByKindStatus,
  PROPOSAL_STATS_SITE_WIDE_WARNING,
  proposalNextOffset,
  resolveListProposalsSort,
  shouldWarnAuthorAttentionScope,
} from "../lib/list-proposals-mcp.js";
import {
  buildProposalDiscoveryPath,
  resolveStrategyForContentType,
} from "../lib/proposal-discovery-path.js";

function stripDecisionDebugFromProposal(proposal: unknown): unknown {
  if (!proposal || typeof proposal !== "object") return proposal;
  const { decision_debug: _omit, ...rest } = proposal as Record<string, unknown>;
  return rest;
}

function stripDecisionDebugFromPayload(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  if (next.proposal) next.proposal = stripDecisionDebugFromProposal(next.proposal);
  if (Array.isArray(next.proposals)) {
    next.proposals = next.proposals.map(stripDecisionDebugFromProposal);
  }
  return next;
}

const MAIN_SERVER_PORT = process.env.PORT || "5000";

/** Reviewer-only decide toolkit (no withdraw / attach / set_no_auto_retry). */
export const PROPOSAL_REVIEW_ACTIONS = [
  "claim",
  "release",
  "apply",
  "reject",
  "accept",
  "close",
  "acknowledge",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
] as const;

/** Author toolkit when the caller can create but not review. */
export const PROPOSAL_AUTHOR_ACTIONS = [
  "claim",
  "release",
  "withdraw",
  "attach_variant",
  "set_no_auto_retry",
  "revise_entries",
  "set_review_situations",
] as const;

export const PROPOSAL_ALL_UPDATE_ACTIONS = [
  "claim",
  "release",
  "withdraw",
  "apply",
  "accept",
  "acknowledge",
  "close",
  "reject",
  "attach_variant",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
  "set_no_auto_retry",
  "revise_entries",
  "set_review_situations",
] as const;

export type ProposalUpdateActionName = (typeof PROPOSAL_ALL_UPDATE_ACTIONS)[number];

/**
 * Allowed update_proposal actions from create vs review caps.
 * Both → full set; review only → decide toolkit; create only → author toolkit.
 */
export function allowedProposalUpdateActions(
  hasCreate: boolean,
  hasReview: boolean,
): ReadonlySet<ProposalUpdateActionName> {
  if (hasCreate && hasReview) return new Set(PROPOSAL_ALL_UPDATE_ACTIONS);
  if (hasReview) return new Set(PROPOSAL_REVIEW_ACTIONS);
  if (hasCreate) return new Set(PROPOSAL_AUTHOR_ACTIONS);
  return new Set();
}

function siteQuery(domain: string | null, extra = ""): string {
  const parts: string[] = [];
  if (domain) parts.push(`__site=${encodeURIComponent(domain)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function hasGrantOrCap(
  mcpToken: string | undefined,
  grants: CatalogGrant[] | undefined,
  cap: string,
): Promise<boolean> {
  if (grants) return hasCapAnyScope(grants, cap);
  if (!mcpToken) return false;
  return checkCap(mcpToken, cap);
}

async function requireProposeListCap(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (
    grants &&
    (hasCapAnyScope(grants, "content_view") ||
      hasCapAnyScope(grants, "proposals_create") ||
      hasCapAnyScope(grants, "proposals_review"))
  ) {
    return null;
  }
  const okCap =
    (await checkCap(mcpToken, "content_view")) ||
    (await checkCap(mcpToken, "proposals_create")) ||
    (await checkCap(mcpToken, "proposals_review"));
  if (!okCap) return denyResponse("content_view|proposals_create|proposals_review");
  return null;
}

async function requireCreateCap(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (grants && hasCapAnyScope(grants, "proposals_create")) return null;
  const okCap = await checkCap(mcpToken, "proposals_create");
  if (!okCap) return denyResponse("proposals_create");
  return null;
}

async function requireUpdateCap(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (
    grants &&
    (hasCapAnyScope(grants, "proposals_create") || hasCapAnyScope(grants, "proposals_review"))
  ) {
    return null;
  }
  const okCap =
    (await checkCap(mcpToken, "proposals_create")) || (await checkCap(mcpToken, "proposals_review"));
  if (!okCap) return denyResponse("proposals_create|proposals_review");
  return null;
}

const BLOCKER_BODY_HINT =
  "Plain text min 80 chars: (1) what's wrong, (2) what fixed looks like, (3) why it matters. " +
  "For funnel.stage/products blockers: cite which cascade step fails (persona / product / stage) and the correct binding. " +
  "Do not list MCP tools.";

export function registerProposalTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "propose_change",
    "Create a proposal (does not write live YAML). Requires proposals_create. " +
      "Pass entries[] (or promote_on_apply) → kind edits. " +
      "Pass kind:\"idea\" for a pre-work brief (new page, update, or config pitch) — no YAML until a later edits proposal. " +
      "Omit kind with no entries → notes (wall handoff; default no_auto_retry). " +
      "Do not use notes for new-spoke pitches — use kind idea. " +
      "Optional related_entries for idea context (slug need not exist yet). " +
      "Edits: optional implements_proposal_id to link an accepted idea; required when that idea reserved the same type+slug+locale. " +
      "Edits: optional review_situations[] (catalog ids — explain_site topic proposals subtopic situations). Empty → reviewer infers from ops. " +
      "Ideas: review_situations not accepted (default-on idea_opportunity_harm on classify — topic proposals subtopic idea-opportunity-harm). " +
      "Hub/internal links → prefer review_situations:[\"internal_links\"] (subtopic internal-links). " +
      "SERP title/description → prefer review_situations:[\"serp_title_description\"] (subtopic serp-title-description). " +
      "Funnel stage/products → prefer review_situations:[\"funnel_classification\"] (subtopic funnel-classification; persona → product → stage). " +
      "Locale translation go-live → prefer review_situations:[\"locale_translation\"] with variant + promote_on_apply (subtopic translations). Soft-only polish without promote is not this pack. " +
      "Edits refuse entry_not_found (missing live+draft), mixed_risk_bundle (mixed selling/new-public/other), competing_entry_edits (second open edits on same type+slug+locale), implements_required / idea_already_in_progress. " +
      "Live-missing + named draft exists is allowed (new_public_content). Ideas refuse mixed_risk_bundle on related_entries classes. " +
      "Mutating MCP requires a role connector, agent_session start with exact model (provider/model), and agent_session_id on mutates. " +
      "Four-eyes apply/reject/accept compare human+role (not username alone). Apply/reject need proposals_review (Proposal Reviewer or Publisher).",
    {
      title: z.string().describe("Short title"),
      summary: z
        .string()
        .describe(
          "Min 80 chars. Edits (entries/promote): intent + why only — do not paste proposed field values (ops own those; list triage uses title + field_paths). Go-live with empty updates: why this draft should become live. Notes: steps tried + recommended next. Idea: pitch + desired outcome.",
        ),
      rationale: z
        .string()
        .optional()
        .describe("Optional deeper reasoning beyond summary. Do not paste proposed field values here."),
      category: z.enum(["content.field", "content.seo"]).optional(),
      kind: z
        .enum(["notes", "idea"])
        .optional()
        .describe("When no entries: idea = brief; notes = wall handoff (default). Ignored if entries set."),
      related_issue_ids: z.array(z.string()).optional(),
      related_entries: z
        .array(
          z.object({
            contentType: z.string(),
            slug: z.string(),
            locale: z.string().optional(),
          }),
        )
        .optional()
        .describe("Optional context targets for ideas (may not exist yet)."),
      tags: z.array(z.string()).optional(),
      confirm_distinct: z.boolean().optional(),
      confirm_recent_activity: z
        .boolean()
        .optional()
        .describe(
          "Required after confirm_recent_activity action_required — set true only after get_entry_activity, and only if still needed/distinct. Do not confirm same-field SERP churn (reject or revise instead).",
        ),
      situation_note: z
        .string()
        .optional()
        .describe(
          "Optional plain-English picture of current live values (baseline context). Not proposed values — those go in updates[].",
        ),
      review_situations: z
        .array(
          z.enum([
            "internal_links",
            "serp_title_description",
            "funnel_classification",
            "body_copy_edit",
            "selling_figures",
            "new_public_content",
            "promote_draft",
            "locale_translation",
          ]),
        )
        .optional()
        .describe(
          "Edits only. Optional catalog ids for how the reviewer should score this packet. Empty → infer from ops. Multi allowed; each pack reviewed independently (per-situation ship). Locale translation go-live → prefer locale_translation with variant + promote_on_apply (explain_site topic proposals subtopic translations). See explain_site topic proposals subtopic situations.",
        ),
      agent_session_id: z.string().describe("Required. From agent_session start — attach_variant later in the same session."),
      promote_on_apply: z
        .boolean()
        .optional()
        .describe("When true with a variant entry, approve promotes that draft to live (empty updates allowed)."),
      supersedes_proposal_id: z
        .string()
        .optional()
        .describe(
          "Optional: id of a rejected/withdrawn proposal this replaces (links learning; never required).",
        ),
      implements_proposal_id: z
        .string()
        .optional()
        .describe(
          "Edits only: accepted idea this work implements. Required when that idea reserved the same type+slug+locale. At most one open implements per idea.",
        ),
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
      const denied = await requireCreateCap(mcpToken, grants);
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
            kind: args.kind,
            related_issue_ids: args.related_issue_ids,
            related_entries: args.related_entries,
            tags: args.tags,
            confirm_distinct: args.confirm_distinct,
            confirm_recent_activity: args.confirm_recent_activity,
            situation_note: args.situation_note,
            review_situations: args.review_situations,
            entries: args.entries,
            agent_session_id: args.agent_session_id,
            promote_on_apply: args.promote_on_apply,
            supersedes_proposal_id: args.supersedes_proposal_id,
            implements_proposal_id: args.implements_proposal_id,
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
                    "Inspect recent writes. Same-field SERP churn + live not broken → reject (title/description-only) or revise to drop SERP ops (mixed); unrelated body/CTA writes alone ≠ reject.",
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
                    "Retry with confirm_recent_activity: true only if still needed and distinct from recent same-field edits — not for SERP churn.",
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
          if (data.code === "entry_not_found") {
            return fail(String(data.error ?? "entry not found"), {
              code: "entry_not_found",
              next_actions: [
                {
                  tool: "propose_change",
                  reason: "File kind:\"idea\" for a new-page brief, or create/draft the entry first then propose edits.",
                  priority: "required",
                  args_hint: {
                    kind: "idea",
                    title: args.title,
                    summary: args.summary,
                    ...(args.site ? { site: args.site } : {}),
                  },
                },
              ],
            });
          }
          if (data.code === "mixed_risk_bundle") {
            return fail(String(data.error ?? "mixed risk"), {
              code: "mixed_risk_bundle",
              next_actions: [
                {
                  tool: "propose_change",
                  reason: "Split into separate proposals — one risk class each (e.g. selling page vs blog meta).",
                  priority: "required",
                },
              ],
            });
          }
          if (data.code === "competing_entry_edits") {
            const existing = data.existing_proposal as { id?: string } | undefined;
            return fail(String(data.error ?? "competing edits"), {
              code: "competing_entry_edits",
              next_actions: [
                {
                  tool: "list_proposals",
                  reason: "Join the existing open edits proposal for this page/locale.",
                  priority: "required",
                  args_hint: { proposal_id: existing?.id ?? data.duplicate_of },
                },
              ],
            });
          }
          if (
            data.code === "implements_required" ||
            data.code === "idea_already_in_progress" ||
            data.code === "implements_entry_mismatch" ||
            data.code === "implements_not_found" ||
            data.code === "implements_idea_incomplete"
          ) {
            const existing = data.existing_proposal as { id?: string } | undefined;
            const ideaId = String(existing?.id ?? data.duplicate_of ?? args.implements_proposal_id ?? "");
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              next_actions: [
                {
                  tool: data.code === "idea_already_in_progress" ? "list_proposals" : "propose_change",
                  reason:
                    data.code === "idea_already_in_progress"
                      ? "Join the open edits that already implement this idea."
                      : data.code === "implements_required"
                        ? "Retry propose_change with implements_proposal_id set to the accepted idea that reserved this page."
                        : "Fix implements_proposal_id / entry to match the accepted idea, then retry.",
                  priority: "required",
                  args_hint:
                    data.code === "idea_already_in_progress"
                      ? { proposal_id: ideaId }
                      : {
                          ...args,
                          implements_proposal_id: ideaId || args.implements_proposal_id,
                        },
                },
                {
                  tool: "list_proposals",
                  reason: "List stalled accepted ideas (stalled: true) or open the idea for accepted_entry.",
                  priority: "recommended",
                  args_hint: { stalled: true, kind: "idea", status: "finished" },
                },
              ],
            });
          }
          return fail(String(data.error ?? "propose_change failed"), { code: data.code });
        }
        const proposal = (data as { proposal?: { id?: string; review_mode?: string; promote_on_apply?: boolean; escalated_siblings?: Array<{ id: string; title: string }> } })
          .proposal;
        const reviewCtx = (data as {
          review_context?: {
            agent_preview?: { warnings?: Array<{ code: string; message: string }> };
          };
        }).review_context;
        const warnings: Array<{ code: string; message: string }> = [
          {
            code: "not_applied",
            message:
              "Proposal stored only. Does not write YAML, GitHub, or complete validation issues. Notes write no entries.",
          },
          {
            code: "four_eyes",
            message:
              "A different human+role with proposals_review (Proposal Reviewer or Publisher) must apply or reject edits. Notes close with a reason (not four-eyes) — close does not fix content.",
          },
        ];
        if (reviewCtx?.agent_preview?.warnings?.length) {
          warnings.push(...reviewCtx.agent_preview.warnings);
        }
        if (proposal?.escalated_siblings?.length) {
          warnings.push({
            code: "escalated_sibling",
            message:
              `An overlapping open proposal is under steward hold: ${proposal.escalated_siblings
                .map((s) => `${s.id} (${s.title})`)
                .join("; ")}. Create succeeded; prefer joining that card or waiting for release before parallel agent work.`,
          });
        }
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
          ...stripDecisionDebugFromPayload(data as Record<string, unknown>),
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
    "List or fetch content proposals (stats-first). With no filters, returns proposal_stats only " +
      "(by_attention, by_kind_status = live KPI strip Ideas/Edits/Notes × Open/Done/Rej with zeros filled, stalled_ideas). " +
      "kpi_history is opt-in only (never default). Event Webhooks are not included. " +
      "Pass status, kind, query, issue_id, proposer_username, proposer_actor, agent_session_id, escalated, attention, or stalled for paginated summary rows " +
      "(detail:\"summary\": identity, entry_count, field_paths, attention, open/resolved blocker counts, slim stubs — no ops/values/baselines). " +
      "Filtered calls still return site-wide by_kind_status (warning proposal_stats_site_wide) — not counts for this page. " +
      "stalled:true → accepted ideas with a locked page and no open/partial/finished implements follow-up (legacy accepts without a lock are excluded). " +
      "Scoped lists default to sort=attention (role-aware: reviewers see rereview before blocked; create-only see blocked first) and open+partial when status is omitted (unless stalled). " +
      "Pass sort created_at|updated_at for chronology. Filter attention: escalated|awaiting_rereview|no_feedback|blocked. " +
      "Pass proposal_id for full detail (ops, baselines, blockers) plus live review_context and discovery_path when open|partial " +
      "(optional research menu from agent_preview think items — not next_actions; skip does not block apply). " +
      "Opt-in kpi_history attaches end-of-day stock series through yesterday (open includes partial; withdrawn omitted). " +
      "When escalated is true on a proposal, MCP must not call update_proposal until a steward releases the hold. " +
      "Requires content_view, proposals_create, or proposals_review.",
    {
      proposal_id: z.string().optional(),
      query: z.string().optional(),
      status: z.enum(["open", "partial", "finished", "rejected", "withdrawn"]).optional(),
      kind: z.enum(["edits", "notes", "idea"]).optional(),
      issue_id: z.string().optional(),
      proposer_username: z
        .string()
        .optional()
        .describe(
          "Exact case-insensitive match on row.proposer_username (not substring). " +
            "Staff UI proposers: logged-in email/username. MCP proposers: staff subject the agent acts as. " +
            "Copy from a proposal row; do not guess.",
        ),
      proposer_actor: z
        .object({
          type: z
            .enum(["ui", "mcp", "system"])
            .optional()
            .describe('Actor type: "ui" (staff UI), "mcp" (agent), "system". Staff-only = type "ui" (no staff= flag).'),
          role: z
            .string()
            .optional()
            .describe(
              "Swarm role id (e.g. copy_editor). Role alone is allowed; optional type \"mcp\" is fine too. " +
                "Copy from list rows or agent_session — do not invent role ids.",
            ),
        })
        .optional()
        .describe(
          "Partial match on proposer_actor. Pass only keys you need; provided keys AND. " +
            "No separate staff= flag — staff-only is type \"ui\".",
        ),
      agent_session_id: z
        .string()
        .optional()
        .describe(
          "Exact match on created_agent_session_id. Copy from agent_session start or a proposal row. " +
            "Staff-UI proposals are usually null and never match.",
        ),
      escalated: z
        .boolean()
        .optional()
        .describe("When true, only proposals with a steward escalate hold. When false, only non-escalated."),
      attention: z
        .enum(["escalated", "awaiting_rereview", "no_feedback", "blocked"])
        .optional()
        .describe(
          "Triage bucket filter. awaiting_rereview = blockers fixed, needs re-check; no_feedback = never had blockers; " +
            "blocked = open needs-changes; escalated = steward hold.",
        ),
      stalled: z
        .boolean()
        .optional()
        .describe(
          "When true, only accepted ideas with a locked page and no successful implements follow-up (open/partial/finished). Use to pick up greenlit work.",
        ),
      limit: z.number().optional().describe("Page size when scoped (default 20, max 200)"),
      offset: z.number().optional().describe("Offset when scoped"),
      sort: z
        .string()
        .optional()
        .describe(
          "Scoped only: attention (default when omitted) | created_at | updated_at. Invalid values fail.",
        ),
      sort_dir: z
        .string()
        .optional()
        .describe(
          "Scoped only: asc | desc (default desc). Ignored when sort is attention (rank is fixed; within-bucket newest first).",
        ),
      kpi_history: z
        .boolean()
        .optional()
        .describe(
          "When true, attach kpi_history (end-of-day stock through yesterday). Default false keeps payloads small.",
        ),
      kpi_granularity: z
        .enum(["day", "week"])
        .optional()
        .describe("Only when kpi_history is true. Default day."),
      kpi_from: z
        .string()
        .optional()
        .describe("Only when kpi_history is true. YYYY-MM-DD (UTC), within 90-day retention."),
      kpi_to: z
        .string()
        .optional()
        .describe("Only when kpi_history is true. YYYY-MM-DD (UTC), capped at yesterday."),
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
      const perspective = attentionPerspectiveFromGrants(grants);

      if (!scoped) {
        warnings.push({
          code: "proposals_need_filter",
          message:
            "Unscoped list_proposals returns proposal_stats only (by_kind_status = live KPI strip counts; " +
            "kpi_history not included unless requested). Pass status, kind, query, issue_id, proposal_id, " +
            "proposer_username, proposer_actor, agent_session_id, escalated, attention, or stalled to load proposals[].",
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
        try {
          const resolved = resolveListProposalsSort(args);
          sort = resolved.sort;
          sort_dir = resolved.sortDir;
        } catch (e) {
          return fail((e as Error).message, { code: "invalid_sort" });
        }
        if (sort === "attention" && shouldWarnAuthorAttentionScope(perspective, args)) {
          warnings.push({
            code: "attention_author_scope_hint",
            message:
              "Author attention order ranks blocked work first across the whole site. " +
              "Pass proposer_username or agent_session_id to focus on your own queue.",
          });
        }
        warnings.push({ ...PROPOSAL_STATS_SITE_WIDE_WARNING });
      }

      const qs = new URLSearchParams();
      if (scoped) {
        if (args.proposal_id) qs.set("proposal_id", args.proposal_id);
        if (args.query) qs.set("q", args.query);
        if (args.status) qs.set("status", args.status);
        if (args.kind) qs.set("kind", args.kind);
        if (args.issue_id) qs.set("issue_id", args.issue_id);
        if (args.proposer_username?.trim()) qs.set("proposer_username", args.proposer_username.trim());
        if (args.proposer_actor?.type) qs.set("proposer_actor_type", args.proposer_actor.type);
        if (args.proposer_actor?.role?.trim()) {
          qs.set("proposer_actor_role", args.proposer_actor.role.trim());
        }
        if (args.agent_session_id?.trim()) qs.set("agent_session_id", args.agent_session_id.trim());
        if (args.escalated === true) qs.set("escalated", "1");
        if (args.escalated === false) qs.set("escalated", "0");
        if (args.attention) qs.set("attention", args.attention);
        if (args.stalled === true) qs.set("stalled", "1");
        if (args.stalled === false) qs.set("stalled", "0");
        qs.set("limit", String(limit));
        qs.set("offset", String(offset));
        qs.set("sort", sort);
        qs.set("sort_dir", sort_dir);
        if (sort === "attention") {
          qs.set("attention_perspective", perspective);
        }
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
          proposals_view?: "summary" | "full";
          sort?: string;
          sort_dir?: string;
          status_bias_applied?: boolean;
          attention_perspective?: string | null;
          review_context?: {
            summary?: string;
            damage_class?: string;
            block_apply?: boolean;
            situation_changed_since_filed?: boolean;
            agent_preview?: {
              think_items?: Array<{ id: string; title: string; why: string; look_for: string[] }>;
              warnings?: Array<{ code: string; message: string }>;
            };
          } | null;
        };
        if (!res.ok) return fail(String(data.error ?? "list_proposals failed"));

        const proposal_stats = normalizeProposalStatsByKindStatus(data.stats);

        let kpi_history: unknown = undefined;
        if (args.kpi_history === true) {
          const kQs = new URLSearchParams();
          kQs.set("granularity", args.kpi_granularity === "week" ? "week" : "day");
          if (args.kind) kQs.set("kind", args.kind);
          if (args.kpi_from) kQs.set("from", args.kpi_from);
          if (args.kpi_to) kQs.set("to", args.kpi_to);
          const kUrl = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/admin/proposals/kpis${siteQuery(siteResult.domain, kQs.toString())}`;
          const kRes = await fetch(kUrl, { headers: buildLoopbackHeaders(mcpToken) });
          const kData = (await kRes.json()) as { error?: string; series?: unknown };
          if (!kRes.ok) {
            return fail(String(kData.error ?? "kpi_history failed"), { code: "kpi_history_failed" });
          }
          kpi_history = kData;
          warnings.push({
            code: "kpi_history_stock",
            message:
              "kpi_history is end-of-day stock through yesterday (not throughput). " +
              "Open includes partial; withdrawn is omitted. Finish times use closed_at with updated_at fallback on older rows.",
          });
        }

        if (!scoped) {
          return ok(
            {
              proposal_stats,
              ...(kpi_history !== undefined ? { kpi_history } : {}),
              next_actions: [],
            },
            { warnings },
          );
        }

        const proposals = data.proposals ?? [];
        const total = typeof data.total === "number" ? data.total : proposals.length;
        const next_offset = proposalNextOffset(offset, limit, total, proposals.length);
        const proposals_view =
          data.proposals_view ?? (args.proposal_id?.trim() ? "full" : "summary");
        if (proposals_view === "summary") {
          warnings.push({
            code: "proposals_summary_only",
            message:
              "Multi-row list returns summary rows (entry_count, field_paths, attention, slim stubs — no ops/values/baselines). Pass proposal_id for full detail before apply/reject.",
          });
        }
        for (const p of proposals as Array<{
          review_mode?: string;
          open_blocker_count?: number;
          escalated?: boolean;
          escalated_note?: string | null;
          escalated_siblings?: Array<{ id: string; title: string }>;
        }>) {
          if (p.review_mode === "draft_backed" || p.review_mode === "soft_variant") {
            warnings.push({
              code: "review_variant_before_apply",
              message: "At least one listed proposal involves a draft — preview before judging.",
            });
            break;
          }
        }
        for (const p of proposals as Array<{
          escalated?: boolean;
          escalated_note?: string | null;
          escalated_siblings?: Array<{ id: string; title: string }>;
          id?: string;
        }>) {
          if (p.escalated) {
            warnings.push({
              code: "proposal_escalated",
              message:
                `Proposal ${p.id ?? ""} has a steward hold — MCP update_proposal is blocked until release.` +
                (p.escalated_note ? ` Note: ${String(p.escalated_note).slice(0, 200)}` : ""),
            });
          } else if (p.escalated_note) {
            warnings.push({
              code: "proposal_escalated_history",
              message: `Proposal ${p.id ?? ""} was previously escalated. Prior note: ${String(p.escalated_note).slice(0, 200)}`,
            });
          }
          if (p.escalated_siblings?.length) {
            warnings.push({
              code: "escalated_sibling",
              message:
                `Overlapping escalated sibling(s): ${p.escalated_siblings
                  .map((s) => `${s.id} (${s.title})`)
                  .join("; ")}. Create still succeeds; prefer joining or waiting on the hold.`,
            });
          }
        }

        let discovery_path: ReturnType<typeof buildProposalDiscoveryPath>["discovery_path"] = null;
        const review_context = data.review_context ?? null;
        const proposalId = args.proposal_id?.trim();
        if (proposalId) {
          const match = (proposals as Array<{
            id?: string;
            status?: string;
            kind?: string;
            title?: string;
            summary?: string;
            escalated?: boolean;
            escalated_note?: string | null;
            entries?: Array<{
              contentType: string;
              slug: string;
              locale: string;
              variant?: string | null;
              status?: string;
              ops?: Array<{ field_path?: string } | null> | null;
            }>;
            related_entries?: Array<{
              contentType: string;
              slug: string;
              locale?: string;
            }>;
            open_blocker_count?: number;
            blockers?: unknown[];
            recent_activity?: Array<{ entryKey: string; writeCount: number; windowDays: number }>;
          }>).find((p) => p.id === proposalId);
          if (match && (match.status === "open" || match.status === "partial")) {
            const entries = match.entries ?? [];
            const first =
              entries.find((e) => !e.status || e.status === "pending" || e.status === "failed") ??
              entries[0];
            let strategy = null as ReturnType<typeof resolveStrategyForContentType>;
            if (first?.contentType) {
              try {
                const configs = loadContentTypes(siteResult.contentPath);
                strategy = resolveStrategyForContentType(configs[first.contentType]?.strategy);
              } catch {
                strategy = null;
              }
            }
            const allowed = grants ? new Set(allowedToolNames(grants)) : null;
            const built = buildProposalDiscoveryPath({
              proposal: {
                id: match.id ?? proposalId,
                status: match.status ?? "open",
                kind: match.kind ?? "edits",
                title: match.title,
                summary: match.summary,
                escalated: match.escalated,
                escalated_note: match.escalated_note,
                entries: match.entries,
                related_entries: match.related_entries,
                open_blocker_count: match.open_blocker_count,
                blockers: match.blockers,
              },
              allowedTools: allowed,
              strategy,
              reviewContext: review_context,
              recentActivity: match.recent_activity ?? null,
            });
            discovery_path = built.discovery_path;
            warnings.push(...built.warnings);
          }
        }

        return ok(
          {
            proposal_stats,
            ...(kpi_history !== undefined ? { kpi_history } : {}),
            proposals: Array.isArray(proposals)
              ? proposals.map(stripDecisionDebugFromProposal)
              : proposals,
            proposals_view,
            total,
            limit,
            offset,
            next_offset,
            sort: data.sort ?? sort,
            sort_dir: data.sort_dir ?? sort_dir,
            attention_perspective:
              data.attention_perspective ?? (sort === "attention" ? perspective : null),
            status_bias_applied: Boolean(data.status_bias_applied),
            discovery_path,
            ...(review_context ? { review_context } : {}),
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
    "Lifecycle for a proposal. Requires proposals_create and/or proposals_review — actions depend on caps. " +
      "proposals_review (Reviewer): claim | release | apply | reject | accept | close | acknowledge | blockers. Approve can change live/draft. " +
      "proposals_create only (authors): claim | release | withdraw | attach_variant | set_no_auto_retry | revise_entries | set_review_situations — cannot apply/reject/accept. " +
      "Both (Publisher): full set. " +
      "Reject is rare (bad/impossible/illegal/harmful/duplicate/target missing): confirm_reject + reject_kind + close_note (min 80). Prefer add_blocker for polish; then revise_entries (proposer; idle or self-claim). " +
      "attach_variant: same creating session only. accept (ideas): four-eyes by human+role; blockers block; next_step min 20; accepted_entry {contentType,slug,locale} required (locks the page); no YAML. " +
      "close notes/ideas: close_reason + close_note. Withdraw: close_note min 20. Open blockers block apply/accept only (revise does not clear them). Four-eyes = username+role. " +
      "Multi-situation: review each pack independently; drop failing ops via revise_entries then apply (atomic). " +
      "Before apply, list_proposals(proposal_id) for live review_context.",
    {
      proposal_id: z.string(),
      action: z.enum([
        "claim",
        "release",
        "withdraw",
        "apply",
        "accept",
        "acknowledge",
        "close",
        "reject",
        "attach_variant",
        "add_blocker",
        "resolve_blocker",
        "reopen_blocker",
        "set_no_auto_retry",
        "revise_entries",
        "set_review_situations",
      ]),
      report: z.string().optional(),
      agent_session_id: z.string().describe("Required. From agent_session start."),
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
          "For apply/revise_entries: required after confirm_recent_activity action_required — set true only after get_entry_activity when still needed/distinct. Do not confirm same-field SERP churn.",
        ),
      close_reason: z
        .enum(["wont_fix", "fixed_elsewhere", "tracked_elsewhere", "other"])
        .optional()
        .describe("For close / acknowledge: disposition (not a content fix)"),
      close_note: z
        .string()
        .optional()
        .describe(
          "For close (min 20 except wont_fix); withdraw (min 20); reject (min 80 — why this must not ship)",
        ),
      next_step: z
        .string()
        .optional()
        .describe("For accept: free-text next step after greenlight (min 20)"),
      accepted_entry: z
        .object({
          contentType: z.string(),
          slug: z.string(),
          locale: z.string(),
        })
        .optional()
        .describe(
          "For accept: required locked page (contentType, slug, locale). Follow-up edits must implement this idea and match this entry.",
        ),
      no_auto_retry: z
        .boolean()
        .optional()
        .describe("For set_no_auto_retry: MCP must hold an active claim"),
      confirm_reject: z
        .boolean()
        .optional()
        .describe("For reject: required true after reviewing reject_kind options (not for polish)"),
      reject_kind: z
        .enum([
          "bad_idea",
          "not_implementable",
          "illegal_or_policy",
          "harmful",
          "duplicate_weaker",
          "target_missing",
        ])
        .optional()
        .describe("For reject: why this must die (not polish)"),
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
        .optional()
        .describe("For revise_entries: full replacement of pending/failed entries (done rows kept)"),
      review_situations: z
        .array(
          z.enum([
            "internal_links",
            "serp_title_description",
            "funnel_classification",
            "body_copy_edit",
            "selling_figures",
            "new_public_content",
            "promote_draft",
            "locale_translation",
          ]),
        )
        .optional()
        .describe(
          "For set_review_situations: replace author-declared situations on open/partial edits (proposer or staff). Empty array clears declaration (infer on read).",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireUpdateCap(mcpToken, grants);
      if (denied) return denied;
      const hasCreate = await hasGrantOrCap(mcpToken, grants, "proposals_create");
      const hasReview = await hasGrantOrCap(mcpToken, grants, "proposals_review");
      const allowed = allowedProposalUpdateActions(hasCreate, hasReview);
      if (!allowed.has(args.action as ProposalUpdateActionName)) {
        return fail(
          `Action '${args.action}' is not allowed for your proposal caps ` +
            `(create=${hasCreate}, review=${hasReview}). ` +
            (hasReview && !hasCreate
              ? "Reviewer cannot withdraw, attach_variant, set_no_auto_retry, revise_entries, or set_review_situations."
              : hasCreate && !hasReview
                ? "Authors cannot apply, reject, accept, close, or manage blockers — use Proposal Reviewer or Publisher."
                : "Need proposals_create and/or proposals_review."),
          { code: "proposal_action_not_allowed", action: args.action },
        );
      }
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
            next_step: args.next_step,
            accepted_entry: args.accepted_entry,
            no_auto_retry: args.no_auto_retry,
            confirm_reject: args.confirm_reject,
            reject_kind: args.reject_kind,
            entries: args.entries,
            review_situations: args.review_situations,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (data.code === "confirm_reject") {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_reject",
                reject_kinds: [
                  "bad_idea",
                  "not_implementable",
                  "illegal_or_policy",
                  "harmful",
                  "duplicate_weaker",
                  "target_missing",
                ],
                ...data,
              },
              [
                {
                  tool: "update_proposal",
                  reason:
                    "Reject only if the idea must not ship. For polish use add_blocker instead. To reject: confirm_reject true + reject_kind + close_note (min 80).",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "reject",
                    confirm_reject: true,
                    reject_kind: "bad_idea",
                    close_note: "(why this must not ship — min 80 chars)",
                    site: args.site,
                  },
                },
                {
                  tool: "update_proposal",
                  reason: "Prefer add_blocker when the idea is fine but the payload needs changes.",
                  priority: "recommended",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "add_blocker",
                    body: "(what's wrong, what fixed looks like, why — min 80)",
                    site: args.site,
                  },
                },
              ],
            );
          }
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
                  reason:
                    "Inspect recent writes before approving. Same-field SERP churn + live not broken → reject duplicate_weaker (title/description-only) or revise_entries to drop SERP ops (mixed); do not confirm churn.",
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
                    "Retry apply with confirm_recent_activity: true only if still needed and distinct (compose with confirm_end_experiment when needed) — not for same-field SERP churn.",
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
          if (data.code === "accepted_entry_required" || data.code === "accepted_entry_taken") {
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              next_actions: [
                {
                  tool: "update_proposal",
                  reason:
                    data.code === "accepted_entry_taken"
                      ? "Pick a different contentType/slug/locale — another accepted idea already locked that page."
                      : "Retry accept with accepted_entry { contentType, slug, locale } plus next_step.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "accept",
                    next_step: args.next_step,
                    accepted_entry: args.accepted_entry ?? {
                      contentType: "blog",
                      slug: "example-slug",
                      locale: "en",
                    },
                    site: args.site,
                  },
                },
              ],
            });
          }
          if (data.code === "target_missing") {
            return fail(String(data.error ?? "target missing"), {
              code: "target_missing",
              next_actions: [
                {
                  tool: "update_proposal",
                  reason:
                    "Reject with reject_kind target_missing + confirm_reject + note, or withdraw — apply is blocked because the page no longer exists.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "reject",
                    confirm_reject: true,
                    reject_kind: "target_missing",
                    close_note: "(page gone — why reject vs restore — min 80)",
                    site: args.site,
                  },
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
          if (data.code === "escalated" || data.code === "steward_ui_only") {
            return fail(String(data.error ?? "proposal escalated"), {
              code: data.code,
              next_actions: [],
              warnings: [
                {
                  code: "proposal_escalated",
                  message:
                    "Steward hold — agents cannot mutate this proposal until a Platform Steward releases it in the staff UI. Reading is fine.",
                },
              ],
            });
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
        if (args.action === "reject") {
          warnings.push({
            code: "reject_terminal",
            message:
              "Rejected — no YAML change. Prefer add_blocker + revise_entries for polish. Optional: propose_change with supersedes_proposal_id when filing a different idea.",
          });
        }

        const next: Array<{
          tool: string;
          reason: string;
          priority: "required" | "recommended" | "optional";
          args_hint: Record<string, unknown>;
        }> = [];

        if (args.action === "reject") {
          next.push({
            tool: "propose_change",
            reason:
              "Optional: file a replacement and pass supersedes_proposal_id to link learning from this reject note.",
            priority: "optional",
            args_hint: {
              supersedes_proposal_id: args.proposal_id,
              site: args.site,
            },
          });
        }

        if (args.action === "revise_entries") {
          next.push({
            tool: "update_proposal",
            reason: "Resolve each open blocker with what changed, then re-preview before apply.",
            priority: "recommended",
            args_hint: {
              proposal_id: args.proposal_id,
              action: "resolve_blocker",
              site: args.site,
            },
          });
        }

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
          ...stripDecisionDebugFromPayload(data as Record<string, unknown>),
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
      "Priority on proposal review when title/description ops or recent writes exist — use before confirm_recent_activity on propose_change / update_proposal apply. " +
      "Same-field SERP churn + live not broken → reject (title/description-only) or revise to drop SERP ops (mixed); unrelated body/CTA writes alone ≠ reject. " +
      "events[] is unfiltered history; gate_write_count excludes the current agent_session_id when provided. " +
      "Does not write YAML. Requires content_view, proposals_create, or proposals_review.",
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
          site: siteResult.contentFolder,
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
          site: siteResult.contentFolder,
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
