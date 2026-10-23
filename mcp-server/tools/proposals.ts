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

type AttachedCreateHint = { contentType: string; slug: string; locale: string };

const ENTRY_UPDATE_SCHEMA = z.object({
  field_path: z.string(),
  value: z.unknown().optional(),
  reset: z.boolean().optional(),
  op: z
    .enum(["set", "remove"])
    .optional()
    .describe(
      'remove = delete the field when published (value null works too). Page-level (common) fields are removed from {slug}/_common.yml in every locale; the draft stores null until then.',
    ),
});

const ENTRY_INPUT_SCHEMA = z.object({
  contentType: z.string(),
  slug: z.string(),
  locale: z.string(),
  variant: z
    .string()
    .optional()
    .describe(
      "Existing 0%-traffic draft to use. Omit → the proposal creates `draft` (or `draft-p{id6}` when taken) from today's live.",
    ),
  updates: z.array(ENTRY_UPDATE_SCHEMA).optional(),
  translated_from_locale: z
    .string()
    .optional()
    .describe(
      "The draft is a translation of this published locale. Apply goes context_stale if that source changes before approval.",
    ),
});

/** v1.0 create/revise: the drafts the proposal wrote (for side_effects). */
function draftsWritten(proposal: unknown): Array<Record<string, unknown>> {
  const entries = (proposal as { entries?: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
  return entries
    .filter((e) => typeof e.variant === "string" && e.status !== "done")
    .map((e) => ({
      contentType: e.contentType,
      slug: e.slug,
      locale: e.locale,
      draft: `${e.variant}.${e.locale}.yml`,
      created_by_proposal: e.created_draft === true,
    }));
}

const IDEA_SEO_TARGET_SCHEMA = z.object({
  main_keyword: z.string().describe("Exact search phrase this new page should win (one keyword, not a list)."),
  cluster: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("join"),
      pillar_path: z.string().describe("Public path of a live, same-locale hub (e.g. /en/blog/ai-engineer)."),
    }),
    z.object({
      mode: z.literal("hub"),
      members: z
        .array(z.object({ contentType: z.string(), slug: z.string() }))
        .min(1)
        .describe("Live, monitored, same-locale pages that will join the new hub after it goes live."),
    }),
    z.object({
      mode: z.literal("standalone"),
      reason: z.string().describe("Min 40 chars. Only for fast_decay_news / broken_url ideas."),
    }),
  ]),
  kw_monthly_volume: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Monthly searches for main_keyword, copied from your keyword research (never estimated). Reviewers expect it."),
  kw_difficulty: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Keyword difficulty 0–100 for main_keyword, from the same research. Reviewers expect it. Stays on the idea; not written to the page's seo block."),
});

const SEO_TARGET_OVERRIDE_SCHEMA = z.object({
  reason: z.string().describe("Min 40 chars: why seo.main_keyword / seo.pillar_path differ from the idea's locked target."),
});

const IDEA_SEO_TARGET_CODES = new Set([
  "idea_seo_target_required",
  "idea_seo_target_incomplete",
  "idea_seo_target_frozen",
  "idea_seo_target_standalone_not_allowed",
  "idea_seo_target_hub_not_live",
  "idea_seo_target_hub_members_required",
  "idea_seo_target_keyword_taken",
  "idea_seo_target_conflict",
  "idea_seo_target_hub_gone",
  "seo_target_override_invalid",
  "seo_optout_idea_born",
  "seo_index_unavailable",
]);

/** Keyword + cluster refusals (idea create / accept / set_idea_seo_target; implementing edits). */
function ideaSeoTargetFailure(
  data: Record<string, unknown>,
  ctx: { tool: "propose_change" | "update_proposal"; proposal_id?: string; site?: string },
) {
  const code = String(data.code ?? "");
  if (!IDEA_SEO_TARGET_CODES.has(code)) return null;
  const details = (data.details ?? {}) as Record<string, unknown>;
  const siteArg = ctx.site ? { site: ctx.site } : {};
  const ideaId =
    (typeof details.origin_idea_id === "string" && details.origin_idea_id) ||
    (typeof details.idea_id === "string" && details.idea_id) ||
    ctx.proposal_id;
  const exampleTarget = {
    main_keyword: "(exact phrase)",
    cluster: { mode: "join", pillar_path: "/en/blog/<hub>" },
  };
  const setTarget = ideaId
    ? {
        tool: "update_proposal",
        reason:
          "Set idea_seo_target { main_keyword, cluster } on the open idea (proposer or staff), then retry accept.",
        priority: "required" as const,
        args_hint: { proposal_id: ideaId, action: "set_idea_seo_target", idea_seo_target: exampleTarget, ...siteArg },
      }
    : {
        tool: "propose_change",
        reason: "Retry the idea with a valid idea_seo_target (nothing was filed).",
        priority: "required" as const,
        args_hint: { kind: "idea", idea_seo_target: exampleTarget, ...siteArg },
      };
  const clusters = {
    tool: "list_seo_clusters",
    reason: "Find a live same-locale hub that owns this topic.",
    priority: "recommended" as const,
    args_hint: { ...siteArg },
  };
  const research = {
    tool: "get_or_refresh_seo_research",
    reason: "Check the keyword's demand and who already ranks before choosing it.",
    priority: "optional" as const,
    args_hint: { action: "keyword_ideas", ...siteArg },
  };
  const warnings: Array<{ code: string; message: string }> = [];
  let next: Array<Record<string, unknown>> = [setTarget, clusters, research];
  switch (code) {
    case "idea_seo_target_frozen":
      warnings.push({
        code,
        message:
          "The target locked at accept and cannot change on the idea. Implementing edits may differ only with seo_target_override.reason (min 40); reviewers see locked vs proposed.",
      });
      next = [];
      break;
    case "idea_seo_target_standalone_not_allowed":
      warnings.push({
        code,
        message:
          "Standalone (no hub) is only for fast_decay_news or broken_url ideas. Pick a live hub (join) or make this page a hub with named members.",
      });
      break;
    case "idea_seo_target_keyword_taken":
      warnings.push({
        code,
        message:
          "Another live page or accepted-but-unpublished idea already targets this exact keyword. Choose a different phrase or refresh that page instead. Nothing was written.",
      });
      next = [
        {
          tool: "get_entry_seo",
          reason: "Inspect the page that owns the keyword (details.owner_path) — maybe refresh it instead of a new URL.",
          priority: "recommended",
          args_hint: { ...siteArg },
        },
        setTarget,
      ];
      break;
    case "idea_seo_target_hub_not_live":
    case "idea_seo_target_hub_gone":
      warnings.push({
        code,
        message:
          code === "idea_seo_target_hub_gone"
            ? "The idea's hub was deleted after accept. Nothing was published. Revise with seo.pillar_path pointing to a live hub plus seo_target_override.reason."
            : "The hub must be live, in the same locale, and actually a hub (is_pillar). See details.",
      });
      next =
        code === "idea_seo_target_hub_gone"
          ? [
              clusters,
              {
                tool: "update_proposal",
                reason: "revise_entries with a new seo.pillar_path + seo_target_override.reason.",
                priority: "required",
                args_hint: { proposal_id: ctx.proposal_id, action: "revise_entries", ...siteArg },
              },
            ]
          : [clusters, setTarget];
      break;
    case "idea_seo_target_hub_members_required":
      next = [
        {
          tool: "list_seo_cluster_entries",
          reason: "Pick live, monitored, same-locale pages that will join the new hub.",
          priority: "recommended",
          args_hint: { ...siteArg },
        },
        setTarget,
      ];
      break;
    case "idea_seo_target_conflict":
    case "seo_target_override_invalid":
      warnings.push({
        code,
        message:
          "seo.main_keyword / seo.pillar_path differ from the idea's locked target. Match the lock, or pass seo_target_override { reason } (min 40 chars). Standalone overrides still need a news / broken-URL idea.",
      });
      next = [
        {
          tool: ctx.tool,
          reason: "Retry with ops matching the locked target, or add seo_target_override.reason.",
          priority: "required",
          args_hint: {
            ...(ctx.proposal_id ? { proposal_id: ctx.proposal_id, action: "revise_entries" } : {}),
            seo_target_override: { reason: "(why the lock no longer fits — min 40)" },
            ...siteArg,
          },
        },
      ];
      break;
    case "seo_optout_idea_born":
      warnings.push({
        code,
        message:
          "This page came from a traffic idea. Agents cannot set seo.pillar_path: null (leave clustering) unless the idea is fast_decay_news / broken_url and a reason (min 40) is given via seo_target_override.reason. Staff can still do it in the UI.",
      });
      next = [clusters];
      break;
    case "seo_index_unavailable":
      warnings.push({
        code,
        message: "The SEO index could not be read, so keyword ownership is unknown. Fail-closed: retry later; nothing was written.",
      });
      next = [];
      break;
  }
  return fail(String(data.error ?? code), {
    code,
    details,
    warnings,
    next_actions: next,
  });
}

const URL_SLUG_OVERRIDE_SCHEMA = z.object({
  reason: z.string().describe("Min 40 chars: why this edit's slug differs from the address the accepted idea locked."),
});

const URL_SLUG_FILING_CODES = new Set([
  "locale_url_slug_required",
  "idea_url_slug_conflict",
  "url_slug_override_invalid",
  "invalid_locale_slug",
  "slug_already_owned_by_other_entry",
]);

/** Per-language address refusals on edits create / revise_entries. */
function urlSlugFilingFailure(
  data: Record<string, unknown>,
  ctx: { tool: "propose_change" | "update_proposal"; proposal_id?: string; site?: string },
) {
  const code = String(data.code ?? "");
  if (!URL_SLUG_FILING_CODES.has(code)) return null;
  const details = (data.details ?? {}) as Record<string, unknown>;
  const conflict = code === "idea_url_slug_conflict" || code === "url_slug_override_invalid";
  return fail(String(data.error ?? code), {
    code,
    details: { ...details, property_path: "slug" },
    warnings: [
      {
        code,
        message: conflict
          ? `The accepted idea locked this language's address${typeof details.locked_url_slug === "string" ? ` "${details.locked_url_slug}"` : ""}. Drop the slug update (the draft is seeded with the locked address) or pass url_slug_override { reason } (min 40 chars).`
          : 'A new language of a live page needs its own address: add { field_path: "slug", value: "<address-in-this-language>" } (free in that language; same word as the folder only for a name).',
      },
      {
        code: "url_slug_non_effects",
        message:
          "Nothing was filed. The folder name stays the page ID in every language; other languages' addresses do not change. Uniqueness is checked again at publish.",
      },
    ],
    next_actions: [
      {
        tool: ctx.tool,
        reason: conflict
          ? "Retry without the slug update, or with url_slug_override.reason."
          : "Retry with a slug update for this language.",
        priority: "required",
        args_hint: {
          ...(ctx.proposal_id ? { proposal_id: ctx.proposal_id, action: "revise_entries" } : {}),
          ...(conflict
            ? { url_slug_override: { reason: "(why the locked address no longer fits — min 40)" } }
            : { updates_add: [{ field_path: "slug", value: "<address-in-this-language>" }] }),
          ...(ctx.site ? { site: ctx.site } : {}),
        },
      },
    ],
  });
}

const APPLY_FOLLOW_UP_CODES = new Set([
  "idea_seo_hub_members_follow_up",
  "idea_page_released_waiting_ideas",
  "dependents_ready",
  "hub_link_follow_up",
  "hub_has_open_edits",
]);

/**
 * Follow-ups carried in create/apply warnings: hub members and hub links (propose_change),
 * dependents ready after their predecessor finished (update_proposal apply), and ideas waiting
 * on a released page or the open hub proposal blocking a hub link (list_proposals).
 */
function followUpActionsFromWarnings(warnings: unknown): Array<{
  tool: string;
  reason: string;
  priority: "required" | "recommended" | "optional";
  args_hint: Record<string, unknown>;
}> {
  if (!Array.isArray(warnings)) return [];
  const out: ReturnType<typeof followUpActionsFromWarnings> = [];
  for (const w of warnings as Array<{ code?: string; details?: { next_actions?: unknown } }>) {
    if (!w?.code || !APPLY_FOLLOW_UP_CODES.has(w.code) || !Array.isArray(w.details?.next_actions)) continue;
    for (const a of w.details.next_actions as Array<Record<string, unknown>>) {
      const priority =
        a.priority === "required" || a.priority === "optional" ? a.priority : "recommended";
      out.push({
        tool: String(a.tool ?? "propose_change"),
        reason: String(a.reason ?? ""),
        priority,
        args_hint: (a.args_hint as Record<string, unknown>) ?? {},
      });
    }
  }
  return out;
}

/** Shared error mapping for v1.0 draft-first codes (create + update). */
function draftFirstFailure(
  data: Record<string, unknown>,
  ctx: { tool: "propose_change" | "update_proposal"; proposal_id?: string; site?: string },
) {
  const code = String(data.code ?? "");
  const details = (data.details ?? {}) as Record<string, unknown>;
  const existing = data.existing_proposal as { id?: string } | undefined;
  const siteArg = ctx.site ? { site: ctx.site } : {};
  switch (code) {
    case "legacy_version":
      return fail(String(data.error ?? "legacy proposal"), {
        code,
        warnings: [
          {
            code: "legacy_read_only",
            message:
              "Filed before proposals 1.0 (no system_version). Only withdraw / reject / release / outcome review work. Nothing was written.",
          },
        ],
        next_actions: [
          {
            tool: "propose_change",
            reason: "Re-file the same change as a new 1.0 proposal (updates are written into a draft; apply promotes it).",
            priority: "required",
            args_hint: { supersedes_proposal_id: ctx.proposal_id, ...siteArg },
          },
          {
            tool: "update_proposal",
            reason: "Withdraw the legacy proposal once the replacement exists.",
            priority: "recommended",
            args_hint: { proposal_id: ctx.proposal_id, action: "withdraw", ...siteArg },
          },
        ],
      });
    case "context_stale":
    case "draft_missing":
      return fail(String(data.error ?? code), {
        code,
        ...(details.conflicting_fields ? { conflicting_fields: details.conflicting_fields } : {}),
        details,
        warnings: [
          {
            code: "needs_author",
            message:
              code === "draft_missing"
                ? "The proposal's draft file is gone. Nothing was published. The proposal moved to attention needs_author."
                : details.reason === "layout_owner_changed"
                  ? "layout_owner_changed: the entry was reattached to the shared template (layout_owner entry → shared_template) after filing, so the draft's sections would be ignored. Nothing was published. The proposal moved to attention needs_author — revise to fields only, or withdraw."
                  : "Live (or the translation source) changed after the draft was made and could not be merged automatically. Nothing was published. The proposal moved to attention needs_author (out of the reviewer queue).",
          },
        ],
        next_actions: [
          {
            tool: "update_proposal",
            reason:
              "Author (or staff co-author): revise_entries with the full intended updates — resets the draft from today's live and clears stale.",
            priority: "required",
            args_hint: { proposal_id: ctx.proposal_id, action: "revise_entries", ...siteArg },
          },
          {
            tool: "list_proposals",
            reason: "Read merge_preview / conflicting_fields / source_changed per entry.",
            priority: "recommended",
            args_hint: { proposal_id: ctx.proposal_id },
          },
        ],
      });
    case "draft_base_unknown":
      return actionRequired(
        { success: false, action_required: "confirm_base_unknown", ...data },
        [
          {
            tool: "update_proposal",
            reason:
              "The draft has no recorded starting point (pre-1.0 draft), so live changes since then cannot be detected. Preview with dry_run, then retry apply with confirm_base_unknown: true to publish the draft as-is (may undo recent live edits).",
            priority: "required",
            args_hint: { proposal_id: ctx.proposal_id, action: "apply", confirm_base_unknown: true, ...siteArg },
          },
        ],
      );
    case "confirm_affected_entries":
      return actionRequired(
        { success: false, action_required: "confirm_affected_entries", ...data },
        [
          {
            tool: "update_proposal",
            reason: `Template change reaches ${String(details.count ?? "N")} attached page(s) in that locale (detached pages unaffected). Preview a sample, then retry apply with confirm_affected_entries equal to that count.`,
            priority: "required",
            args_hint: {
              proposal_id: ctx.proposal_id,
              action: "apply",
              confirm_affected_entries: details.count,
              ...siteArg,
            },
          },
        ],
      );
    case "all_or_nothing_blocked":
      return fail(String(data.error ?? code), {
        code,
        details,
        warnings: [
          {
            code: "nothing_published",
            message: "all_or_nothing: at least one entry cannot publish, so no entry was published. Failed entries carry last_error.",
          },
        ],
        next_actions: [
          {
            tool: "list_proposals",
            reason: "Read each pending entry's last_error, fix via revise_entries, then apply again.",
            priority: "required",
            args_hint: { proposal_id: ctx.proposal_id },
          },
        ],
      });
    case "four_eyes_co_author":
      return fail(String(data.error ?? code), {
        code,
        next_actions: [
          {
            tool: "list_proposals",
            reason: "You edited this proposal's draft directly (co-author). A different human+role must apply it.",
            priority: "required",
            args_hint: { proposal_id: ctx.proposal_id },
          },
        ],
      });
    case "revert_conflicts":
      return fail(String(data.error ?? code), {
        code,
        conflicting_fields: data.conflicting_fields ?? details.conflicting_fields,
        warnings: [
          {
            code: "revert_not_created",
            message: "No revert proposal was created. These fields changed again after the proposal was applied; live is unchanged.",
          },
        ],
        next_actions: [
          {
            tool: "propose_change",
            reason: "File a normal edits proposal with the values you want for the conflicting fields.",
            priority: "recommended",
            args_hint: { ...siteArg },
          },
        ],
      });
    case "not_applied":
    case "nothing_to_revert":
      return fail(String(data.error ?? code), { code, next_actions: [] });
    case "competing_shared_fields":
      return fail(String(data.error ?? code), {
        code,
        warnings: [
          {
            code: "common_fields_all_languages",
            message: "Page-level (common) fields live in {slug}/_common.yml and change every locale — only one open proposal per page may stage them.",
          },
        ],
        next_actions: [
          {
            tool: "update_proposal",
            reason: "Join the open proposal that already stages page-level fields: revise_entries on it instead of filing a second one.",
            priority: "required",
            args_hint: { proposal_id: existing?.id ?? details.proposal_id, action: "revise_entries", ...siteArg },
          },
        ],
      });
    case "draft_in_proposal":
      return fail(String(data.error ?? code), {
        code,
        ...(details.env ? { env: details.env } : {}),
        next_actions: [
          {
            tool: "list_proposals",
            reason: details.env
              ? `That draft belongs to a proposal in ${String(details.env)} — review it there, or omit variant so this proposal creates its own draft.`
              : "That draft already belongs to an open proposal — join it, or omit variant so this proposal creates its own draft.",
            priority: "required",
            args_hint: { proposal_id: details.proposal_id },
          },
        ],
      });
    case "variant_has_traffic":
      return fail(String(data.error ?? code), {
        code,
        next_actions: [
          {
            tool: ctx.tool,
            reason: "Variants with traffic cannot be proposal drafts. Omit variant (the proposal creates a new 0% draft) or name a 0% draft.",
            priority: "required",
            args_hint: ctx.tool === "update_proposal" ? { proposal_id: ctx.proposal_id, action: "revise_entries", ...siteArg } : { ...siteArg },
          },
        ],
      });
    case "attached_draft_structure":
      return fail(String(data.error ?? code), {
        code,
        next_actions: [
          {
            tool: ctx.tool,
            reason: "Attached posts take field updates only (structure lives on the shared template). Drop sections/layout updates, or detach the page first.",
            priority: "required",
            args_hint: ctx.tool === "update_proposal" ? { proposal_id: ctx.proposal_id, action: "revise_entries", ...siteArg } : { ...siteArg },
          },
        ],
      });
    default:
      return null;
  }
}

type AcceptedEntryCreateMode = "attached" | "page" | "manual";

export function attachedIdeaEditsAction(
  proposal: {
    id?: string;
    attached_create_entry?: AttachedCreateHint | null;
    accepted_entry_create_mode?: AcceptedEntryCreateMode | null;
  },
  site?: string,
): {
  tool: string;
  reason: string;
  priority: "required";
  args_hint: Record<string, unknown>;
} | null {
  const ae = proposal.attached_create_entry;
  if (!ae?.contentType || !ae.slug || !ae.locale || !proposal.id) return null;
  if (proposal.accepted_entry_create_mode === "page") {
    return {
      tool: "propose_change",
      reason:
        "This accepted idea reserved a new section-built page (no shared template) and there is no file yet. File edits with implements_proposal_id, review_situations [\"new_public_content\"], no variant, and field updates that include the whole layout as ONE update { field_path: \"sections\", value: [...] } (non-empty; each section checked against the component registry) plus required fields. The proposal creates the entry folder, _common.yml, and an unpublished draft; a different role’s apply publishes it. Do not call create_entry. Publishing a page with no sections is refused (empty_page).",
      priority: "required",
      args_hint: {
        implements_proposal_id: proposal.id,
        review_situations: ["new_public_content"],
        entries: [
          {
            contentType: ae.contentType,
            slug: ae.slug,
            locale: ae.locale,
            updates: [{ field_path: "sections", value: ["<section objects>"] }],
          },
        ],
        ...(site ? { site } : {}),
      },
    };
  }
  return {
    tool: "propose_change",
    reason:
      "This accepted idea reserved an attached slug and there is no file yet. File edits with implements_proposal_id, review_situations [\"new_public_content\"], and field updates only — no variant. The proposal creates the entry folder and its draft (unpublished); a different role’s apply publishes it. Do not call create_entry. The shared template is not changed.",
    priority: "required",
    args_hint: {
      implements_proposal_id: proposal.id,
      review_situations: ["new_public_content"],
      entries: [{ contentType: ae.contentType, slug: ae.slug, locale: ae.locale }],
      ...(site ? { site } : {}),
    },
  };
}

export type UnrequestedProposalLike = {
  id?: string;
  status?: string;
  entries?: Array<{
    contentType?: string;
    slug?: string;
    locale?: string;
    status?: string;
    requested_ops?: Array<{ field_path: string }>;
    unrequested_fields?: string[];
  }>;
};

/** Open entries whose draft changes fields the author never sent → warning + revise next_action. */
export function unrequestedFieldsFollowUp(
  proposals: UnrequestedProposalLike[],
  proposalId: string,
  site?: string,
): {
  warnings: Array<{ code: string; message: string }>;
  next_actions: Array<{ tool: string; reason: string; priority: "recommended"; args_hint: Record<string, unknown> }>;
} | null {
  const p = proposals.find((x) => x.id === proposalId);
  if (!p || (p.status !== "open" && p.status !== "partial")) return null;
  const hits = (p.entries ?? []).filter(
    (e) => (!e.status || e.status === "pending" || e.status === "failed") && e.unrequested_fields?.length,
  );
  if (!hits.length) return null;
  const lines = hits.map(
    (e) =>
      `${e.contentType}/${e.slug} (${e.locale}): ${e.unrequested_fields!.join(", ")} ` +
      `(requested: ${(e.requested_ops ?? []).map((o) => o.field_path).join(", ") || "none"})`,
  );
  return {
    warnings: [
      {
        code: "draft_has_unrequested_fields",
        message:
          `The draft changes fields its author did not send, and apply would publish them: ${lines.join("; ")}. ` +
          "Usual causes: an old draft seeded with page-level copies, a migration rewrite, or a co-author edit. " +
          "Author: revise_entries with only the ops you intend — a draft this proposal created restarts from today's live (unless a person co-authored it). " +
          "Reviewer: judge these fields like any other op; if they are unintended, add a blocker asking the author to revise.",
      },
    ],
    next_actions: [
      {
        tool: "update_proposal",
        reason: "Author: drop the unrequested fields by revising with only the intended ops (restarts the draft from today's live).",
        priority: "recommended",
        args_hint: {
          proposal_id: proposalId,
          action: "revise_entries",
          entries: hits.map((e) => ({
            contentType: e.contentType,
            slug: e.slug,
            locale: e.locale,
            updates: "<only the ops you intend>",
          })),
          ...(site ? { site } : {}),
        },
      },
    ],
  };
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
  "set_idea_funnel",
  "set_related_entries",
  "set_idea_seo_target",
  "set_applies_after",
  "revert",
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
  "set_idea_funnel",
  "set_related_entries",
  "set_idea_seo_target",
  "set_applies_after",
  "revert",
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
  "Markdown, min 80 chars. Start with a one-sentence verdict, then a blank line, then a numbered list " +
  "with one item per problem: what's wrong, what fixed looks like, why it matters. " +
  "Wrap field paths, slugs and URLs in `backticks`. No headings or tables. " +
  "For funnel.stage/products blockers: cite which cascade step fails (persona / product / stage) and the correct binding. " +
  "Do not list MCP tools.";

export function registerProposalTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "propose_change",
    "Create a proposal (never writes live YAML). Requires proposals_create. " +
      "Pass entries[] (or promote_on_apply) → kind edits. " +
      "Edits (1.0): updates are written into a 0%-traffic draft now (named variant, or `draft` / `draft-p{id6}` created from today's live); apply only promotes that draft. Live is unchanged until apply. " +
      "Page-level (common) fields — funnel.*, published_at, detached, authors — publish to {slug}/_common.yml for every locale (warning common_fields_all_languages); meta.robots/priority/change_frequency are per locale. Remove a field with {field_path, op:\"remove\"}. " +
      "Check layout_owner (get_content_type_info / get_entry_content): entry → a new page or new language needs one full sections update (registry-checked); shared_template → fields only. " +
      "To change the layout of every attached entry, target slug template (one entry per locale, all_or_nothing: true); apply needs confirm_affected_entries. " +
      "Optional all_or_nothing (publish every entry or none) and per-entry translated_from_locale. " +
      "Pass kind:\"idea\" for a pre-work brief (new page, update, or config pitch) — no YAML until a later edits proposal. " +
      "Omit kind with no entries → notes (wall handoff; default no_auto_retry). " +
      "Do not use notes for new-spoke pitches — use kind idea. " +
      "Ideas: name the target page type in related_entries [{contentType, slug, locale}] — contentType is a content-types.yml key (not a folder name, not tags like surface:*); slug need not exist yet. Read get_content_type_info(contentType).strategy (purpose + constraints) before writing the brief. Unknown types refuse (unknown_content_type); fix later with update_proposal set_related_entries. " +
      "Edits: optional implements_proposal_id to link an accepted idea; required when that idea reserved the same type+slug+locale. " +
      "Edits: optional review_situations[] (catalog ids — explain_site topic proposals subtopic situations). Empty → reviewer infers from ops. " +
      "Ideas: optional one demand label — anticipated_demand (launch → lasting queries; empty volume OK), existing_demand (current search rank/cite; author documents SERP maturity/weight class/asset in brief), fast_decay_news (announcement only → expect reject), broken_url (missing address; call get_runtime_issues first and paste path/count/sources/referrer/queryAttribution; only roles with that tool). " +
      "idea_opportunity_harm is always on for ideas — do not file it. Omit review_situations on ideas that are not those three. " +
      "New-URL ideas: optional idea_funnel { stage, products } (products \"all\" only with stage awareness). Soft warning idea_funnel_missing when omitted; accept refuses until set (set_idea_funnel). " +
      "New-URL ideas on SEO-monitored types: idea_seo_target { main_keyword, cluster: join|hub|standalone, kw_monthly_volume, kw_difficulty } — soft warnings idea_seo_target_missing / idea_seo_target_metrics_missing; accept refuses until set (set_idea_seo_target); locks at accept and seeds the new draft's seo block (keyword + hub only; kw_* stay on the idea). Implementing edits whose seo ops differ from the lock need seo_target_override.reason. " +
      "New language of a page already live in another language: the draft needs its own slug (this language's address; folder name stays the page ID). An implemented idea's locked accepted_entry.url_slug is seeded (warning idea_url_slug_locked); a different { field_path: \"slug\" } update needs url_slug_override.reason (idea_url_slug_conflict); with no locked address, file a slug update or refuse locale_url_slug_required. " +
      "Hub/internal links → prefer review_situations:[\"internal_links\"] (subtopic internal-links); a hub link to a new page chains with applies_after_proposal_id = that page's proposal. " +
      "Original-hub rewrite after a split → review_situations:[\"hub_split\"] + applies_after_proposal_id = the new hub's proposal (subtopic hub-split). " +
      "SERP title/description → prefer review_situations:[\"serp_title_description\"] (subtopic serp-title-description). " +
      "Funnel stage/products → prefer review_situations:[\"funnel_classification\"] (subtopic funnel-classification; persona → product → stage). " +
      "Locale translation go-live → prefer review_situations:[\"locale_translation\"] with variant + promote_on_apply (subtopic translations). Soft-only polish without promote is not this pack. " +
      "Edits refuse entry_not_found (missing live+draft), mixed_risk_bundle (mixed selling/new-public/other), competing_entry_edits (second open edits on same type+slug+locale), competing_shared_fields (another open proposal stages page-level fields), draft_in_proposal, variant_has_traffic, implements_required / idea_already_in_progress, sections_required (new page/language of a layout_owner entry or template without a full sections update), page_create_no_draft, invalid_sections (registry shape), locale_url_slug_required / idea_url_slug_conflict (new language address). Apply refuses locale_url_slug_required when the draft still has no own slug. " +
      "Live-missing + named draft exists is allowed (new_public_content). Ideas refuse mixed_risk_bundle on related_entries classes. " +
      "Mutating MCP requires a role connector, agent_session start with exact model (provider/model), and agent_session_id on mutates. " +
      "Four-eyes apply/reject/accept compare human+role (not username alone). Apply/reject need proposals_review (Proposal Reviewer or Publisher).",
    {
      title: z.string().describe("Short title"),
      summary: z
        .string()
        .describe(
          "Min 80 chars. Edits (entries/promote): intent + why only — do not paste proposed field values (ops own those; list triage uses title + field_paths). Go-live with empty updates: why this draft should become live. Notes: steps tried + recommended next. Idea: pitch + desired outcome; when the page is built around an existing file (PDF lead magnet, video, image), name its gallery media_id and public src URL here or in rationale. Markdown renders for staff (bare URLs become links).",
        ),
      rationale: z
        .string()
        .optional()
        .describe(
          "Optional deeper reasoning beyond summary (Markdown). Do not paste proposed field values here. Ideas: existing file the page depends on → media_id + public src URL.",
        ),
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
        .describe(
          "Ideas: target page type + slug (slug may not exist yet). contentType must be a content-types.yml key; unknown types refuse (unknown_content_type). Soft warning idea_content_type_missing when omitted.",
        ),
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
            "hub_split",
            "serp_title_description",
            "funnel_classification",
            "body_copy_edit",
            "selling_figures",
            "new_public_content",
            "promote_draft",
            "locale_translation",
            "anticipated_demand",
            "existing_demand",
            "fast_decay_news",
            "broken_url",
          ]),
        )
        .optional()
        .describe(
          "Edits: optional catalog ids (infer when empty). Ideas: at most one of anticipated_demand | existing_demand | fast_decay_news | broken_url (idea_opportunity_harm is always on — do not file it). Notes: refuse. See explain_site topic proposals subtopic situations / idea-opportunity-harm / existing-demand / broken-url.",
        ),
      agent_session_id: z.string().describe("Required. From agent_session start — attach_variant later in the same session."),
      promote_on_apply: z
        .boolean()
        .optional()
        .describe("When true with a variant entry, approve promotes that draft to live (empty updates allowed)."),
      all_or_nothing: z
        .boolean()
        .optional()
        .describe("Edits: apply publishes every entry or none (all_or_nothing_blocked lists what failed)."),
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
      applies_after_proposal_id: z
        .string()
        .optional()
        .describe(
          "Edits only: order-only chain. Apply is refused (predecessor_not_applied) until that edits proposal is fully applied (partial does not count); applying it never applies this one. Use for a hub link to a new page (subtopic internal-links) or a hub split rewrite / member move (subtopic hub-split). If the predecessor is rejected/withdrawn this gets a predecessor_closed blocker. Not supersedes_proposal_id (that links a closed predecessor).",
        ),
      idea_funnel: z
        .object({
          stage: z.enum(["awareness", "consideration", "decision", "post-enrollment"]),
          products: z.union([
            z.literal("all"),
            z
              .array(
                z.object({
                  product: z.string(),
                  persona: z.string().optional(),
                }),
              )
              .min(1),
          ]),
        })
        .optional()
        .describe(
          'Ideas (new-URL): structured funnel. products "all" only when stage is awareness. Soft warning if missing; accept refuses until set.',
        ),
      idea_seo_target: IDEA_SEO_TARGET_SCHEMA.optional().describe(
        "Ideas (new-URL, SEO-monitored type): keyword + cluster the new page targets. join = live same-locale hub; hub = this page becomes a hub (named live members); standalone = fast_decay_news / broken_url only, reason min 40. Soft warning if missing; accept refuses until set. Locks at accept and is seeded into the new page's draft seo block.",
      ),
      seo_target_override: SEO_TARGET_OVERRIDE_SCHEMA.optional().describe(
        "Edits implementing an idea: required when seo.main_keyword / seo.pillar_path differ from the idea's locked target (reason min 40). Also the reason channel when an agent sets seo.pillar_path: null on an idea-born page (news / broken-URL ideas only).",
      ),
      url_slug_override: URL_SLUG_OVERRIDE_SCHEMA.optional().describe(
        "Edits implementing an idea: required when a slug update differs from the address the idea locked (accepted_entry.url_slug); reason min 40.",
      ),
      entries: z.array(ENTRY_INPUT_SCHEMA).optional(),
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
            all_or_nothing: args.all_or_nothing,
            supersedes_proposal_id: args.supersedes_proposal_id,
            implements_proposal_id: args.implements_proposal_id,
            applies_after_proposal_id: args.applies_after_proposal_id,
            idea_funnel: args.idea_funnel,
            idea_seo_target: args.idea_seo_target,
            seo_target_override: args.seo_target_override,
            url_slug_override: args.url_slug_override,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const seoTarget = ideaSeoTargetFailure(data, { tool: "propose_change", site: args.site });
          if (seoTarget) return seoTarget;
          const urlSlug = urlSlugFilingFailure(data, { tool: "propose_change", site: args.site });
          if (urlSlug) return urlSlug;
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
          const draftFirst = draftFirstFailure(data, { tool: "propose_change", site: args.site });
          if (draftFirst) return draftFirst;
          if (data.code === "database_entry_required") {
            return fail(String(data.error ?? "database row required"), {
              code: "database_entry_required",
              next_actions: [
                {
                  tool: "explain_site",
                  reason:
                    "This workflow cannot create a database row. The accepted idea can stay. Field updates work once the row exists (they write overrides).",
                  priority: "required",
                  args_hint: { topic: "shared-layout" },
                },
              ],
            });
          }
          if (data.code === "required_fields_missing" || data.code === "attached_sections_refused") {
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              next_actions: [
                {
                  tool: "propose_change",
                  reason:
                    data.code === "attached_sections_refused"
                      ? "Drop sections[] updates. Attached posts take field updates only. The accepted idea still holds the slug."
                      : "Add the named required field updates and retry. The accepted idea still holds the slug. The proposal creates the draft — do not call create_entry.",
                  priority: "required",
                  args_hint: {
                    implements_proposal_id: args.implements_proposal_id,
                    review_situations: ["new_public_content"],
                    ...(args.site ? { site: args.site } : {}),
                  },
                },
              ],
            });
          }
          if (data.code === "sections_required" && (data.details as { new_locale?: boolean } | undefined)?.new_locale) {
            const details = data.details as {
              layout_owner?: string;
              detached?: boolean;
              is_shared_template?: boolean;
              entry?: { contentType?: string; slug?: string; locale?: string };
            };
            const target = details.entry ?? {};
            const siteHint = args.site ? { site: args.site } : {};
            return fail(String(data.error ?? data.code), {
              code: "sections_required",
              details,
              next_actions: [
                {
                  tool: "get_entry_content",
                  reason:
                    "Read the source-locale page (e.g. en) as the starting point: copy its full sections array and translate every section. Nothing was written.",
                  priority: "required",
                  args_hint: {
                    contentType: target.contentType,
                    slug: target.slug,
                    locale: "en",
                    ...siteHint,
                  },
                },
                {
                  tool: "propose_change",
                  reason: details.is_shared_template
                    ? "New template language: resubmit with ONE full { field_path: \"sections\", value: [...] } update (the whole translated shared layout). It applies to every attached entry in that language."
                    : `New language of a layout_owner entry${details.detached ? " (detached)" : ""} page: resubmit with ONE full { field_path: "sections", value: [...] } update (the whole translated layout) plus the translated fields.`,
                  priority: "required",
                },
                {
                  tool: "get_component_schema",
                  reason: "Check component contracts (variants, required props) for the translated sections.",
                  priority: "recommended",
                  args_hint: { componentType: "hero", ...siteHint },
                },
              ],
            });
          }
          if (data.code === "sections_required" || data.code === "page_create_no_draft") {
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              next_actions: [
                {
                  tool: "propose_change",
                  reason:
                    "New section-built page: resubmit with implements_proposal_id, no variant, no promote_on_apply, and the whole layout as ONE update { field_path: \"sections\", value: [...] } (non-empty) plus required fields. The proposal creates the folder and draft — do not call create_entry.",
                  priority: "required",
                  args_hint: {
                    implements_proposal_id: args.implements_proposal_id,
                    review_situations: ["new_public_content"],
                    ...(args.site ? { site: args.site } : {}),
                  },
                },
                {
                  tool: "get_component_schema",
                  reason: "Pick components and variants for the sections array (shared + site registry).",
                  priority: "recommended",
                  args_hint: { componentType: "hero", ...(args.site ? { site: args.site } : {}) },
                },
              ],
            });
          }
          if (data.code === "invalid_sections") {
            const details = (data.details ?? {}) as {
              property_path?: string;
              issues?: Array<{ property_path: string; message: string }>;
            };
            const failingIdx = /^sections\[(\d+)\]/.exec(details.property_path ?? "")?.[1];
            const firstEntry = args.entries?.[0] as { updates?: Array<{ field_path: string; value?: unknown }> } | undefined;
            const sectionsValue = firstEntry?.updates?.find((u) => u.field_path === "sections")?.value;
            const failingType =
              failingIdx != null && Array.isArray(sectionsValue)
                ? (sectionsValue[Number(failingIdx)] as { type?: unknown } | undefined)?.type
                : undefined;
            return fail(String(data.error ?? "invalid sections"), {
              code: "invalid_sections",
              property_path: details.property_path,
              issues: details.issues ?? [],
              next_actions: [
                {
                  tool: "get_component_schema",
                  reason: `Check the component contract for the failing section (${details.property_path ?? "sections"}): valid variants and required props.`,
                  priority: "required",
                  args_hint: {
                    ...(typeof failingType === "string" ? { componentType: failingType } : {}),
                    ...(args.site ? { site: args.site } : {}),
                  },
                },
                {
                  tool: "propose_change",
                  reason: "Fix every listed issue in the sections array and resubmit. Nothing was written.",
                  priority: "required",
                },
              ],
            });
          }
          if (data.code === "entry_not_found") {
            if (args.implements_proposal_id) {
              return fail(String(data.error ?? "entry not found"), {
                code: "entry_not_found",
                next_actions: [
                  {
                    tool: "list_proposals",
                    reason:
                      "This page type cannot be created from a proposal. Tell the human a person must create the page in the CMS first; then resubmit with the same implements_proposal_id.",
                    priority: "required",
                    args_hint: { proposal_id: args.implements_proposal_id },
                  },
                ],
              });
            }
            return fail(String(data.error ?? "entry not found"), {
              code: "entry_not_found",
              next_actions: [
                {
                  tool: "propose_change",
                  reason:
                    "For a new page, accept an idea that locks the slug, then resubmit edits with implements_proposal_id and no variant — the proposal creates the entry folder and draft. Section-built types (downloadable, landing, …) also need a full { field_path: \"sections\", value: [...] } update. Do not call create_entry.",
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
          if (data.code === "unknown_content_type") {
            const details = (data.details ?? {}) as { unknown?: string[]; valid_types?: string[] };
            return fail(String(data.error ?? "unknown content type"), {
              code: "unknown_content_type",
              details,
              warnings: [
                {
                  code: "nothing_saved",
                  message:
                    "No idea was created. related_entries[].contentType must be a content type key from content-types.yml (e.g. landing), not a folder name (e.g. landings) or a tag.",
                },
              ],
              next_actions: [
                {
                  tool: "get_content_type_info",
                  reason:
                    "Pick the target content type from details.valid_types and read its strategy (purpose + constraints) before rewriting the brief.",
                  priority: "recommended",
                  args_hint: {
                    contentType: details.valid_types?.[0],
                    ...(args.site ? { site: args.site } : {}),
                  },
                },
                {
                  tool: "propose_change",
                  reason: "Retry with related_entries[].contentType set to a valid type key.",
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
        const proposal = (data as {
          proposal?: {
            id?: string;
            kind?: string;
            system_version?: string | null;
            review_mode?: string;
            promote_on_apply?: boolean;
            escalated_siblings?: Array<{ id: string; title: string }>;
            entries?: Array<{
              contentType?: string;
              slug?: string;
              locale?: string;
              variant?: string | null;
            }>;
          };
        }).proposal;
        const drafts = proposal?.kind === "edits" ? draftsWritten(proposal) : [];
        const reviewCtx = (data as {
          review_context?: {
            agent_preview?: { warnings?: Array<{ code: string; message: string }> };
          };
        }).review_context;
        const warnings: Array<{ code: string; message: string }> = [
          ...(Array.isArray(data.warnings) ? (data.warnings as Array<{ code: string; message: string }>) : []),
          drafts.length
            ? {
                code: "not_applied",
                message:
                  "Updates were written into the draft(s) in side_effects.drafts_written (0% traffic — visitors do not see them). Live is unchanged until apply promotes them. Editing those drafts outside the proposal makes you a co-author (cannot approve).",
              }
            : {
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
            ...(drafts.length
              ? [
                  {
                    tool: "get_entry_content",
                    reason: "Preview the draft the proposal wrote (pass variant).",
                    args_hint: {
                      contentType: drafts[0]!.contentType,
                      slug: drafts[0]!.slug,
                      locale: drafts[0]!.locale,
                      variant: String(drafts[0]!.draft).split(".")[0],
                      ...(args.site ? { site: args.site } : {}),
                    },
                    priority: "optional" as const,
                  },
                ]
              : []),
            ...followUpActionsFromWarnings(data.warnings),
            {
              tool: "list_proposals",
              reason: "Re-read the stored proposal (author_diff, undo_cost, merge state).",
              args_hint: { proposal_id: proposal?.id },
              priority: "optional" as const,
            },
          ],
          ...(drafts.length
            ? {
                side_effects: {
                  drafts_written: drafts,
                  non_effects: ["live YAML unchanged until apply", "no GitHub push by itself", "linked issues not completed"],
                },
              }
            : {}),
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "list_proposals",
    "List or fetch content proposals (stats-first). With no filters, returns proposal_stats only " +
      "(by_attention, by_kind_status = live KPI strip Ideas/Edits/Notes × Open/Done/Rej with zeros filled, stalled_ideas, needs_review_edits). " +
      "kpi_history is opt-in only (never default). Event Webhooks are not included. " +
      "Pass status, kind, query, issue_id, proposer_username, proposer_actor, agent_session_id, reviewer_username, escalated, attention, stalled, or needs_review for paginated summary rows " +
      "(detail:\"summary\": identity, entry_count, field_paths, attention, open/resolved blocker counts, " +
      "reviewer_action_by/_at = latest non-author feedback (not approval), closed_by/close_reason, slim stubs — no ops/values/baselines). " +
      "Filtered calls still return site-wide by_kind_status (warning proposal_stats_site_wide) — not counts for this page. " +
      "stalled:true → accepted ideas with a locked page and no open/partial/finished implements follow-up (legacy accepts without a lock are excluded). " +
      "needs_review:true → open|partial edits whose attention is predecessor_applied, awaiting_rereview or no_feedback (author rewrite or cleared blockers, nothing still waiting on the author). Excludes blocked and escalated. Forces that queue even if status/kind differ. " +
      "Scoped lists default to sort=attention (role-aware: reviewers see predecessor_applied first, then rereview before blocked; create-only see blocked first) and open+partial when status is omitted (unless stalled). " +
      "Pass sort created_at|updated_at for chronology. Filter attention: predecessor_applied|escalated|awaiting_rereview|no_feedback|blocked|needs_author. " +
      "predecessor_applied = applies_after_proposal_id points at a finished proposal (its page is live; this one should ship now). Rows carry applies_after_proposal_id, applied_before_proposal_ids (dependents) and dependent_overdue_flagged_at (daily sweep: still open 48h after the predecessor finished — flag only, never escalates or closes). " +
      "needs_author = 1.0 draft went stale (live or translation source moved, conflict, or draft missing) — out of the reviewer queue until the author revises; stale_flagged_at set after 10 idle days, closes as abandoned_stale after 30. " +
      "blocked = open blockers. Daily sweep (any kind, open|partial, not escalated): 10 days with no real work → blocked_flagged_at (event proposal_blocked_flagged); 30 → withdrawn close_reason abandoned_blocked (no prior flag required; partial: published entries stay live; drafts the proposal created deleted, pre-existing unlinked). " +
      "Clock = newest open blocker / revise_entries / author-marked fix / reviewer action — claim and release do NOT reset it. Zero open blockers (awaiting_rereview) never auto-closes. " +
      "awaiting_rereview = blockers fixed, or the author rewrote entries / marked a blocker fixed, and no open blockers remain. " +
      "Pass proposal_id for full detail (ops, baselines, blockers) plus live review_context and discovery_path when open|partial " +
      "(optional research menu from agent_preview think items — not next_actions; skip does not block apply). " +
      "Opt-in kpi_history attaches per-bucket flow series (metric:\"flow\", each bucket restarts at 0): open = created in bucket, " +
      "finished/rejected = closed into that status in bucket. today = UTC hours 0..now; day = last 28 UTC days + today; " +
      "week = last 12 Monday-start UTC weeks + current week. Last point partial:true when its bucket contains now. " +
      "Partial counts as created; withdrawn omitted. Live pile stays proposal_stats.by_kind_status. " +
      "When escalated is true on a proposal, MCP must not call update_proposal until a steward releases the hold. " +
      "outcome_review* / outcome_lesson* fields = human-only steward retro on closed proposals (good|bad, what went wrong, what should have happened, lesson captured). " +
      "Informational for retros — agents cannot set them and they do not gate any action. Filter outcome_review: good|bad|none|bad_open (bad_open = bad with no lesson captured; none = closed, unreviewed, excluding system closures abandoned_stale|abandoned_blocked|legacy_version). " +
      "proposal_stats.by_outcome = whole-site all-time { good, bad, bad_open, none } with the same meanings. " +
      "Requires content_view, proposals_create, or proposals_review.",
    {
      proposal_id: z.string().optional(),
      query: z
        .string()
        .optional()
        .describe(
          "Whitespace-separated terms (max 8), ALL must match; each term is a case-insensitive substring of title/summary/rationale/tags/issue ids/entry paths, proposal id (full or prefix), or proposer_username",
        ),
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
      reviewer_username: z
        .string()
        .optional()
        .describe(
          "Exact case-insensitive username match on row.reviewer_action_by (latest non-author blocker add/resolve/reopen) " +
            "OR closed_by when status is finished|rejected. Withdrawn closers never match; earlier reviewers replaced by a later one never match. " +
            "Username only — agents acting as a staff subject match that subject. Combine with status to narrow; omit status to include closed.",
        ),
      escalated: z
        .boolean()
        .optional()
        .describe("When true, only proposals with a steward escalate hold. When false, only non-escalated."),
      outcome_review: z
        .enum(["good", "bad", "none", "bad_open"])
        .optional()
        .describe(
          "Steward outcome review on closed proposals (finished|rejected|withdrawn). good | bad; bad_open = bad with no lesson captured yet; " +
            "none = closed and not reviewed, excluding system closures (close_reason abandoned_stale | abandoned_blocked | legacy_version). Omit status (or use a closed status) — open/partial never match.",
        ),
      attention: z
        .enum(["predecessor_applied", "escalated", "awaiting_rereview", "no_feedback", "blocked", "needs_author"])
        .optional()
        .describe(
          "Triage bucket filter. predecessor_applied = the applies_after predecessor is fully applied — review and apply now; needs_author = stale 1.0 draft waiting on the author (revise_entries); awaiting_rereview = blockers fixed, or the author rewrote the packet / marked a blocker fixed, and nothing is still waiting on the author; " +
            "no_feedback = never had blockers and no author update since filing; " +
            "blocked = open needs-changes (wins over a later author rewrite); escalated = steward hold.",
        ),
      stalled: z
        .boolean()
        .optional()
        .describe(
          "When true, only accepted ideas with a locked page and no successful implements follow-up (open/partial/finished). Use to pick up greenlit work.",
        ),
      needs_review: z
        .boolean()
        .optional()
        .describe(
          "When true, only open or in-progress edits that still need a reviewer: predecessor_applied, awaiting_rereview or no_feedback. " +
            "Waiting on the author and steward holds are excluded. Same queue as the staff Edits “needs review” badge.",
        ),
      limit: z.number().optional().describe("Page size when scoped (default 20, max 200)"),
      offset: z.number().optional().describe("Offset when scoped"),
      sort: z
        .string()
        .optional()
        .describe(
          "Scoped only: attention (default when omitted) | created_at | updated_at | outcome_recent (verdict time, else close time, else updated — pairs with outcome_review). Invalid values fail.",
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
          "When true, attach kpi_history per-bucket flow series (open = created, finished/rejected = closed in bucket). " +
            "Default false keeps payloads small. Buckets include the in-progress one (partial:true).",
        ),
      kpi_granularity: z
        .enum(["today", "day", "week"])
        .optional()
        .describe(
          "Only when kpi_history is true. Default day. " +
            "today = per UTC hour for today; day = per UTC day, last 28 days + today; " +
            "week = per Monday-start UTC week, last 12 weeks + current (point day = week-start date).",
        ),
      kpi_from: z
        .string()
        .optional()
        .describe(
          "Only when kpi_history is true (day/week). YYYY-MM-DD (UTC). day: clamped to the last 90 days; " +
            "week: snapped to its Monday, no earlier than 12 weeks before the current week.",
        ),
      kpi_to: z
        .string()
        .optional()
        .describe(
          "Only when kpi_history is true (day/week). YYYY-MM-DD (UTC), capped at today (today's bucket is partial).",
        ),
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
            "proposer_username, proposer_actor, agent_session_id, reviewer_username, escalated, outcome_review, attention, or stalled to load proposals[].",
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
        if (args.reviewer_username?.trim()) qs.set("reviewer_username", args.reviewer_username.trim());
        if (args.escalated === true) qs.set("escalated", "1");
        if (args.escalated === false) qs.set("escalated", "0");
        if (args.outcome_review) qs.set("outcome_review", args.outcome_review);
        if (args.attention) qs.set("attention", args.attention);
        if (args.stalled === true) qs.set("stalled", "1");
        if (args.stalled === false) qs.set("stalled", "0");
        if (args.needs_review === true) qs.set("needs_review", "1");
        if (args.needs_review === false) qs.set("needs_review", "0");
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
          const g = args.kpi_granularity;
          kQs.set(
            "granularity",
            g === "today" ? "today" : g === "week" ? "week" : "day",
          );
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
          const bucketDesc =
            g === "today"
              ? "per UTC hour for today"
              : g === "week"
                ? "per Monday-start UTC week (last 12 + current; point day = week-start date)"
                : "per UTC day (last 28 + today)";
          warnings.push({
            code: "kpi_history_flow",
            message:
              `kpi_history is flow ${bucketDesc}, not stock — each bucket restarts at 0. ` +
              "Series open = proposals created in the bucket (partial status counts); finished/rejected = closed into that status in the bucket " +
              "(closed_at, updated_at fallback on older rows). Withdrawn omitted. Last point partial:true = bucket still in progress. " +
              "Current pile (open now / finished / rejected totals) = proposal_stats.by_kind_status.",
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
        const ideaRows = proposals as Array<{
          id?: string;
          accepted_entry?: AttachedCreateHint | null;
          attached_create_entry?: AttachedCreateHint | null;
          accepted_entry_create_mode?: AcceptedEntryCreateMode | null;
        }>;
        const attachedNext = ideaRows
          .map((p) => attachedIdeaEditsAction(p, args.site))
          .filter((action): action is NonNullable<typeof action> => action != null)
          .slice(0, 3);
        for (const p of ideaRows) {
          if (p.accepted_entry_create_mode !== "manual" || !p.accepted_entry) continue;
          const ae = p.accepted_entry;
          warnings.push({
            code: "accepted_entry_not_creatable",
            message:
              `Accepted idea ${p.id} reserved ${ae.contentType}/${ae.slug} (${ae.locale}), which does not exist and cannot be created by a proposal (database row). ` +
              "A human must create the page in the CMS first; then file edits with implements_proposal_id. Do not retry propose_change until it exists.",
          });
        }
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

        const proposalId = args.proposal_id?.trim();
        const unrequestedNext = proposalId
          ? unrequestedFieldsFollowUp(
              proposals as Array<UnrequestedProposalLike>,
              proposalId,
              args.site,
            )
          : null;
        if (unrequestedNext) warnings.push(...unrequestedNext.warnings);

        let discovery_path: ReturnType<typeof buildProposalDiscoveryPath>["discovery_path"] = null;
        const review_context = data.review_context ?? null;
        if (proposalId) {
          const match = (proposals as Array<{
            id?: string;
            status?: string;
            kind?: string;
            title?: string;
            summary?: string;
            escalated?: boolean;
            escalated_note?: string | null;
            idea_seo_target?: { main_keyword: string; cluster: { mode: string; pillar_path?: string } } | null;
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
                idea_seo_target: match.idea_seo_target ?? null,
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
            next_actions: [...attachedNext, ...(unrequestedNext?.next_actions ?? [])],
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
      "proposals_create only (authors): claim | release | withdraw | attach_variant | set_no_auto_retry | revise_entries | set_review_situations | set_idea_funnel | set_related_entries | set_idea_seo_target | set_applies_after | revert — cannot apply/reject/accept. " +
      "set_related_entries (open ideas, proposer): replace related_entries (target page type + slug); unknown content types refuse (unknown_content_type); refused after accept. " +
      "set_applies_after (open edits, proposer): chain after another edits proposal (empty unlinks). Order only: apply refuses predecessor_not_applied until the predecessor is finished; applying the predecessor returns dependents_ready + one apply next_action per open dependent (nothing auto-applied). Rejecting/withdrawing a predecessor adds a predecessor_closed blocker to each open dependent. " +
      "1.0 edits: apply promotes the proposal's draft(s); dry_run returns merge_preview without writing. Stale drafts rebuild on today's live when fields do not overlap; otherwise context_stale (needs_author). " +
      "revert (finished/partial 1.0 edits): files a new proposal that puts back pre-apply values; live unchanged until that one is approved; revert_conflicts when fields changed again. " +
      "Legacy (pre-1.0) proposals return legacy_version for anything but withdraw/reject/release — re-file. " +
      "Both (Publisher): full set. " +
      "Reject is rare (bad/impossible/illegal/harmful/duplicate/target missing): confirm_reject + reject_kind + close_note (min 80). Prefer add_blocker for polish; then revise_entries (proposer; idle or self-claim). " +
      "attach_variant: same creating session only. accept (ideas): four-eyes by human+role; blockers block; next_step min 20; accepted_entry {contentType,slug,locale} required (locks the page until an implementing edit is applied with none open; accepted_entry_taken → leave the idea open, accept later); slug = folder name (page ID in every language). New language of a page already live in another language: url_slug required (this language's own address word, e.g. es que-es-manus-ia; url_slug_required otherwise). Address (url_slug, else slug) must be free in that language and not look like another language (slug_locale_mismatch; slug_language_ack: true when it is a name). The implementing edit's draft is seeded with url_slug. new-URL ideas need idea_funnel first (no YAML); SEO-monitored new pages also need idea_seo_target (hub live + same locale; keyword not held by a live page or another accepted idea). " +
      "apply of a hub-mode idea's first go-live returns warning idea_seo_hub_members_follow_up + one propose_change next_action per member (chain each with applies_after_proposal_id; moved members also update their in-body hub link). " +
      "apply that finishes a join-mode idea's page with no chained hub-link proposal returns hub_link_follow_up (or hub_has_open_edits when the hub already has open edits). " +
      "apply that frees an idea's page returns idea_page_released_waiting_ideas + one list_proposals next_action per open idea waiting on it (nothing auto-accepted). " +
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
        "set_idea_funnel",
        "set_related_entries",
        "set_idea_seo_target",
        "set_applies_after",
        "revert",
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
      confirm_new_values: z
        .boolean()
        .optional()
        .describe(
          "For apply of a new attached post: true only after principal approval of a URL param (for example category) not seen on same-locale peers.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("For apply (1.0): run every check and return merge_preview per entry; writes nothing."),
      all_or_nothing: z
        .boolean()
        .optional()
        .describe("For revise_entries (1.0): toggle publish-every-entry-or-none."),
      confirm_base_unknown: z
        .boolean()
        .optional()
        .describe("For apply (1.0): publish drafts with no recorded base as-is, only after draft_base_unknown and a dry_run preview."),
      confirm_affected_entries: z
        .number()
        .int()
        .optional()
        .describe("For apply of a shared-template proposal: must equal affected_entries.count from list_proposals(proposal_id)."),
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
          url_slug: z
            .string()
            .optional()
            .describe(
              "This language's own public address word (written as slug: in {locale}.yml). Required when the page is already live in another language.",
            ),
          slug_language_ack: z
            .boolean()
            .optional()
            .describe("true when an address that looks like another language is intended (a name that works in every language)."),
        })
        .optional()
        .describe(
          "For accept: required locked page (contentType, slug = folder name, locale, url_slug for a new language). Follow-up edits must implement this idea and match this entry.",
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
        .array(ENTRY_INPUT_SCHEMA)
        .optional()
        .describe(
          "For revise_entries: full replacement of pending/failed entries (done rows kept). 1.0: drafts this proposal created restart from today's live, then updates are written.",
        ),
      review_situations: z
        .array(
          z.enum([
            "internal_links",
            "hub_split",
            "serp_title_description",
            "funnel_classification",
            "body_copy_edit",
            "selling_figures",
            "new_public_content",
            "promote_draft",
            "locale_translation",
            "anticipated_demand",
            "existing_demand",
            "fast_decay_news",
            "broken_url",
          ]),
        )
        .optional()
        .describe(
          "For set_review_situations: replace author-declared situations on open/partial edits or ideas (proposer or staff). Edits: any edit catalog id. Ideas: at most one of anticipated_demand | existing_demand | fast_decay_news | broken_url. Empty array clears declaration.",
        ),
      idea_funnel: z
        .object({
          stage: z.enum(["awareness", "consideration", "decision", "post-enrollment"]),
          products: z.union([
            z.literal("all"),
            z
              .array(
                z.object({
                  product: z.string(),
                  persona: z.string().optional(),
                }),
              )
              .min(1),
          ]),
        })
        .optional()
        .describe(
          'For set_idea_funnel (open ideas, proposer/staff): stage + products. "all" only with awareness. Frozen after accept.',
        ),
      related_entries: z
        .array(
          z.object({
            contentType: z.string(),
            slug: z.string(),
            locale: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          "For set_related_entries (open ideas, proposer): full replacement. contentType must be a content-types.yml key (not a folder name); slug may not exist yet. Empty array clears.",
        ),
      idea_seo_target: IDEA_SEO_TARGET_SCHEMA.optional().describe(
        "For set_idea_seo_target (open ideas, proposer/staff): main_keyword + cluster (join live same-locale hub | hub with named live members | standalone for fast_decay_news / broken_url, reason min 40) + kw_monthly_volume and kw_difficulty from your keyword research. Send the whole target (replaces the stored one). Frozen after accept.",
      ),
      seo_target_override: SEO_TARGET_OVERRIDE_SCHEMA.optional().describe(
        "For revise_entries on edits implementing an idea: reason (min 40) when seo.main_keyword / seo.pillar_path differ from the locked target, or when setting seo.pillar_path: null on an idea-born page (news / broken-URL only).",
      ),
      url_slug_override: URL_SLUG_OVERRIDE_SCHEMA.optional().describe(
        "For revise_entries on edits implementing an idea: reason (min 40) when a slug update differs from the address the idea locked.",
      ),
      applies_after_proposal_id: z
        .string()
        .optional()
        .describe(
          "For set_applies_after (open edits, proposer/staff): edits proposal this one publishes after; empty string unlinks. Refuses cycles, self, closed (rejected/withdrawn) and non-edits predecessors.",
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
              ? "Reviewer cannot withdraw, attach_variant, set_no_auto_retry, revise_entries, set_review_situations, set_idea_funnel, set_related_entries, set_idea_seo_target, or set_applies_after."
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
            confirm_new_values: args.confirm_new_values,
            dry_run: args.dry_run,
            all_or_nothing: args.all_or_nothing,
            confirm_base_unknown: args.confirm_base_unknown,
            confirm_affected_entries: args.confirm_affected_entries,
            close_reason: args.close_reason,
            close_note: args.close_note,
            next_step: args.next_step,
            accepted_entry: args.accepted_entry,
            no_auto_retry: args.no_auto_retry,
            confirm_reject: args.confirm_reject,
            reject_kind: args.reject_kind,
            entries: args.entries,
            review_situations: args.review_situations,
            idea_funnel: args.idea_funnel,
            related_entries: args.related_entries,
            idea_seo_target: args.idea_seo_target,
            seo_target_override: args.seo_target_override,
            url_slug_override: args.url_slug_override,
            ...(args.action === "set_applies_after"
              ? { applies_after_proposal_id: args.applies_after_proposal_id ?? null }
              : {}),
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const seoTarget = ideaSeoTargetFailure(data, {
            tool: "update_proposal",
            proposal_id: args.proposal_id,
            site: args.site,
          });
          if (seoTarget) return seoTarget;
          if (args.action === "revise_entries") {
            const urlSlug = urlSlugFilingFailure(data, {
              tool: "update_proposal",
              proposal_id: args.proposal_id,
              site: args.site,
            });
            if (urlSlug) return urlSlug;
          }
          if (data.code === "predecessor_not_applied") {
            const details = (data.details ?? {}) as { applies_after_proposal_id?: string; predecessor_status?: string | null };
            return fail(String(data.error ?? "predecessor not applied"), {
              code: "predecessor_not_applied",
              details,
              warnings: [
                {
                  code: "nothing_applied",
                  message:
                    "Nothing was published. This proposal is chained (applies_after_proposal_id) and waits until its predecessor is fully applied (finished); partial does not count. Applying the predecessor does not apply this one.",
                },
              ],
              next_actions: details.applies_after_proposal_id
                ? [
                    {
                      tool: "list_proposals",
                      reason: "Open the predecessor: review/apply it first, or ask its author to finish it.",
                      priority: "required",
                      args_hint: { proposal_id: details.applies_after_proposal_id, ...(args.site ? { site: args.site } : {}) },
                    },
                  ]
                : [
                    {
                      tool: "update_proposal",
                      reason: "The predecessor no longer exists — the proposer unlinks it (empty applies_after_proposal_id).",
                      priority: "required",
                      args_hint: { proposal_id: args.proposal_id, action: "set_applies_after", applies_after_proposal_id: "" },
                    },
                  ],
            });
          }
          if (
            data.code === "applies_after_cycle" ||
            data.code === "applies_after_closed" ||
            data.code === "applies_after_not_found" ||
            data.code === "applies_after_edits_only"
          ) {
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              warnings: [{ code: "nothing_saved", message: "applies_after_proposal_id unchanged." }],
              next_actions: [
                {
                  tool: "list_proposals",
                  reason: "Find the open or finished edits proposal this one must publish after, then retry set_applies_after.",
                  priority: "recommended",
                  args_hint: { kind: "edits", ...(args.site ? { site: args.site } : {}) },
                },
              ],
            });
          }
          if (data.code === "unknown_content_type") {
            const details = (data.details ?? {}) as { unknown?: string[]; valid_types?: string[] };
            return fail(String(data.error ?? "unknown content type"), {
              code: "unknown_content_type",
              details,
              warnings: [
                {
                  code: "nothing_saved",
                  message: "related_entries unchanged. Use content type keys from details.valid_types (not folder names or tags).",
                },
              ],
              next_actions: [
                {
                  tool: "update_proposal",
                  reason: "Retry set_related_entries with valid content type keys.",
                  priority: "required",
                  args_hint: { proposal_id: args.proposal_id, action: "set_related_entries" },
                },
              ],
            });
          }
          const draftFirst = draftFirstFailure(data, {
            tool: "update_proposal",
            proposal_id: args.proposal_id,
            site: args.site,
          });
          if (draftFirst) return draftFirst;
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
                    body: "(Markdown: one-line verdict, blank line, numbered list — one item per problem: wrong / fix / why; min 80)",
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
          if (data.code === "confirm_new_values") {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_new_values",
                ...data,
              },
              [
                {
                  tool: "update_proposal",
                  reason:
                    "A URL param on this new post (for example category) is not used by other posts in this language. Retry apply with confirm_new_values: true only after a principal approved that value. Do not create a draft.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "apply",
                    confirm_new_values: true,
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
          if (data.code === "proposal_deleted") {
            return fail(String(data.error ?? "Proposal was deleted by staff"), {
              code: "proposal_deleted",
              proposal_id: args.proposal_id,
              deleted_by: data.deleted_by,
              deleted_at: data.deleted_at,
              warnings: [
                "Staff permanently deleted this proposal (staff UI bulk delete). Do not re-file the same change unless staff ask.",
              ],
              next_actions: [],
            });
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
          if (data.code === "accepted_entry_taken") {
            const d = (data.details ?? {}) as { holder_id?: string; open_edit_id?: string | null; releases_when?: string };
            const watchId = d.open_edit_id || d.holder_id;
            return fail(String(data.error ?? data.code), {
              code: "accepted_entry_taken",
              details: d,
              warnings: [
                "Leave this idea open; do not close it as tracked_elsewhere. The page frees up once the holder's implementing edit is applied (with none still open); accept again then.",
                "Applying the holder's edit returns idea_page_released_waiting_ideas listing this idea when its related_entries name the page.",
              ],
              next_actions: watchId
                ? [
                    {
                      tool: "list_proposals",
                      reason: d.open_edit_id
                        ? "Track the open edit that holds the page; accept this idea after it is applied."
                        : "The holder idea has no applied edit yet (stalled); its follow-up edit must ship before this idea can be accepted.",
                      priority: "recommended",
                      args_hint: { proposal_id: watchId },
                    },
                  ]
                : [],
            });
          }
          if (
            args.action === "accept" &&
            (data.code === "url_slug_required" ||
              data.code === "slug_locale_mismatch" ||
              data.code === "slug_already_owned_by_other_entry" ||
              data.code === "invalid_locale_slug")
          ) {
            const d = (data.details ?? {}) as Record<string, unknown>;
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              details: d,
              warnings: [
                "accepted_entry.slug stays the folder name (page ID in every language). url_slug is only this language's public address.",
                "Nothing was accepted; the idea stays open. Other languages' addresses do not change.",
              ],
              next_actions: [
                {
                  tool: "update_proposal",
                  reason:
                    data.code === "slug_locale_mismatch"
                      ? "Retry accept with an address in this language, or slug_language_ack: true when it is a name."
                      : "Retry accept with accepted_entry.url_slug set to a free address in this language.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "accept",
                    next_step: args.next_step,
                    accepted_entry: { ...(args.accepted_entry ?? {}), url_slug: "<address-in-this-language>" },
                    site: args.site,
                  },
                },
              ],
            });
          }
          if (data.code === "accepted_entry_required") {
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              next_actions: [
                {
                  tool: "update_proposal",
                  reason: "Retry accept with accepted_entry { contentType, slug, locale } plus next_step.",
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
          if (
            data.code === "required_fields_missing" ||
            data.code === "attached_sections_refused" ||
            data.code === "database_entry_required" ||
            data.code === "sections_required" ||
            data.code === "invalid_sections"
          ) {
            const sectionDetails = (data.details ?? {}) as {
              property_path?: string;
              issues?: Array<{ property_path: string; message: string }>;
              new_locale?: boolean;
              is_shared_template?: boolean;
              entry?: { contentType?: string; slug?: string; locale?: string };
            };
            const newLocale = data.code === "sections_required" && sectionDetails.new_locale === true;
            return fail(String(data.error ?? data.code), {
              code: String(data.code),
              ...(data.code === "invalid_sections"
                ? { property_path: sectionDetails.property_path, issues: sectionDetails.issues ?? [] }
                : {}),
              ...(data.details && data.code !== "invalid_sections" ? { details: data.details } : {}),
              next_actions: [
                ...(newLocale
                  ? [
                      {
                        tool: "get_entry_content",
                        reason:
                          "Read the source-locale page (e.g. en): copy its full sections array and translate every section.",
                        priority: "required" as const,
                        args_hint: {
                          contentType: sectionDetails.entry?.contentType,
                          slug: sectionDetails.entry?.slug,
                          locale: "en",
                          site: args.site,
                        },
                      },
                    ]
                  : []),
                {
                  tool: "update_proposal",
                  reason:
                    data.code === "database_entry_required"
                      ? "This workflow cannot create a database row. The accepted idea can stay. Field updates work once the row exists."
                      : data.code === "attached_sections_refused"
                        ? "Drop sections[] updates and retry revise_entries. The accepted idea still holds the slug."
                        : newLocale
                          ? sectionDetails.is_shared_template
                            ? "New template language: include the whole translated shared layout as ONE update { field_path: \"sections\", value: [...] } and retry revise_entries. It applies to every attached entry in that language."
                            : "New language of a layout_owner entry page: include the whole translated layout as ONE update { field_path: \"sections\", value: [...] } and retry revise_entries."
                          : data.code === "sections_required"
                            ? "Include the whole layout as ONE update { field_path: \"sections\", value: [...] } (non-empty) and retry revise_entries."
                            : data.code === "invalid_sections"
                              ? `Fix the listed section issues (${sectionDetails.property_path ?? "sections"}) — see get_component_schema — and retry revise_entries. Nothing was written.`
                              : "Add the named required fields and retry revise_entries. The accepted idea still holds the slug.",
                  priority: "required",
                  args_hint: {
                    proposal_id: args.proposal_id,
                    action: "revise_entries",
                    site: args.site,
                  },
                },
                ...(newLocale
                  ? [
                      {
                        tool: "get_component_schema",
                        reason: "Check component contracts (variants, required props) for the translated sections.",
                        priority: "recommended" as const,
                        args_hint: { componentType: "hero", site: args.site },
                      },
                    ]
                  : []),
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
              system_version?: string | null;
              entries?: Array<{
                contentType?: string;
                slug?: string;
                locale?: string;
                variant?: string | null;
              }>;
            };
          }
        ).proposal;
        const warnings: Array<{ code: string; message: string }> = [
          ...(Array.isArray(data.warnings) ? (data.warnings as Array<{ code: string; message: string }>) : []),
        ];
        if (args.action === "apply" && args.dry_run) {
          warnings.push({
            code: "dry_run_no_write",
            message: "dry_run: nothing was published. merge_preview shows what apply would publish per entry (rebuild keeps newer live fields).",
          });
        } else if (!warnings.some((w) => w.code === "partial_progress") && args.action === "apply") {
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

        if (args.action === "apply") next.push(...followUpActionsFromWarnings(data.warnings));

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

        if (args.action === "revert") {
          const created = (data as { proposal?: { id?: string } }).proposal;
          warnings.push({
            code: "revert_proposal_created",
            message:
              "A new proposal was filed that puts back the pre-apply values (reverts_proposal_id set). Live is unchanged until a different human+role approves it.",
          });
          next.push({
            tool: "list_proposals",
            reason: "Review the revert proposal (it goes through normal four-eyes approval).",
            priority: "recommended",
            args_hint: { proposal_id: created?.id },
          });
        }

        if (args.action === "accept" && warnings.some((w) => w.code === "accepted_entry_needs_layout")) {
          next.push({
            tool: "get_component_schema",
            reason:
              "Optional: the follow-up edits for this layout_owner entry page must send the whole layout as ONE full sections update — pick components and variants from the registry.",
            priority: "optional",
            args_hint: { componentType: "hero", site: args.site },
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
