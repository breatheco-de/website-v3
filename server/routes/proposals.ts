import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api";
import * as userStore from "../user-store";
import { requireAnyCapability } from "./_helpers";
import {
  proposalServiceForSite,
  exportAllProposals,
  toProposalSummary,
  proposalDeletedError,
} from "../content-proposals";
import type { SiteContext } from "../site-manager";
import {
  parseProposalSort,
  parseProposerActorType,
  parseEscalatedQuery,
  parseOutcomeReviewQuery,
  type CreateProposalInput,
  type ProposalUpdateAction,
} from "../content-proposals/service";
import {
  parseProposalAttention,
  parseAttentionPerspective,
} from "../content-proposals/attention";
import { checkBulkDeleteRequest } from "../content-proposals/bulk-delete-gate";
import { child } from "../logger";
import { resolveEventActor } from "./_helpers";
import { getProposalSettings } from "../settings";

const log = child({ module: "routes/proposals" });

function actorUsername(
  auth: { username: string | null; author: string | null },
): string {
  return (auth.username || auth.author || "dev").trim() || "dev";
}

async function requireProposalRead(req: Request, res: Response) {
  const auth = await requireAnyCapability(req, res, ["content_view", "seo_edit"]);
  if (!auth.authorized) return null;
  return { ...auth, actor: actorUsername(auth) };
}

async function requireProposalWrite(req: Request, res: Response) {
  const auth = await requireAnyCapability(req, res, ["content_edit_text", "seo_edit"]);
  if (!auth.authorized) return null;
  return { ...auth, actor: actorUsername(auth) };
}

function siteService(req: Request, res: Response) {
  const site = res.locals.site as SiteContext | undefined;
  if (!site) {
    res.status(500).json({ error: "Site context missing" });
    return null;
  }
  return proposalServiceForSite(site);
}

function siteName(res: Response): string | null {
  const site = res.locals.site as SiteContext | undefined;
  return site?.contentRootName ?? null;
}

const WRITE_ACTIONS = new Set<ProposalUpdateAction>([
  "apply",
  "acknowledge",
  "close",
  "reject",
  "accept",
  "claim",
  "release",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
  "attach_variant",
  "set_no_auto_retry",
  "revise_entries",
  "set_review_situations",
  "set_idea_funnel",
  "set_idea_seo_target",
  "set_related_entries",
  "escalate",
  "deescalate",
  "review_outcome",
  "set_outcome_lesson",
]);

const OUTCOME_ACTIONS = new Set<ProposalUpdateAction>(["review_outcome", "set_outcome_lesson"]);

const ALL_ACTIONS = new Set<ProposalUpdateAction>([
  "claim",
  "release",
  "withdraw",
  "apply",
  "acknowledge",
  "close",
  "reject",
  "accept",
  "attach_variant",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
  "set_no_auto_retry",
  "revise_entries",
  "set_review_situations",
  "set_idea_funnel",
  "set_idea_seo_target",
  "set_related_entries",
  "escalate",
  "deescalate",
  "review_outcome",
  "set_outcome_lesson",
  "revert",
]);

export function registerProposalRoutes(app: Express): void {
  /** Full dump for local pull-production (and staff export). */
  api.get(app, "/api/admin/proposals/export", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const site = siteName(res);
    if (!site) {
      res.status(500).json({ error: "Site context missing" });
      return;
    }
    const proposals = exportAllProposals(site);
    res.json({
      proposals,
      total: proposals.length,
      education:
        "Full proposal dump for this site (entries + blockers). Used by local Download from production.",
    });
  });

  /** Dev-only: replace local proposals with production snapshot (never uploads). */
  api.post(app, "/api/admin/proposals/pull-production", { rate: "staffWrite" }, async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({
        error: "dev_only",
        message: "Pulling production proposals is only available in development.",
      });
      return;
    }

    const auth = await requireProposalRead(req, res);
    if (!auth) return;

    const site =
      (typeof req.body?.site === "string" && req.body.site) ||
      siteName(res);
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }

    const productionOrigin =
      typeof req.body?.productionOrigin === "string" ? req.body.productionOrigin : undefined;

    try {
      const { pullProductionProposals } = await import("../content-proposals/pull-production");
      const result = await pullProductionProposals(site, productionOrigin);
      if (!result.success) {
        if (result.code === "production_staff_token_required") {
          res.status(401).json({
            error: result.reason ?? result.error ?? "Production staff token required",
            code: result.code,
            productionOrigin: result.productionOrigin,
            envVar: result.envVar,
            success: false,
            pulled: false,
            imported: 0,
          });
          return;
        }
        res.status(400).json({
          error: result.reason ?? "Failed to pull production proposals",
          ...result,
        });
        return;
      }
      res.json({
        ...result,
        education:
          "Replaced local proposals with production rows. Draft YAML files and live content were not pulled. Nothing was uploaded to production.",
      });
    } catch (err) {
      log.error({ err, site }, "Failed to pull production proposals");
      res.status(500).json({ error: "Failed to pull production proposals" });
    }
  });

  api.get(app, "/api/admin/proposals", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const issueId = typeof req.query.issue_id === "string" ? req.query.issue_id : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const proposalId = typeof req.query.proposal_id === "string" ? req.query.proposal_id : undefined;
    const proposerUsername =
      typeof req.query.proposer_username === "string" ? req.query.proposer_username : undefined;
    const proposerActorRole =
      typeof req.query.proposer_actor_role === "string" ? req.query.proposer_actor_role : undefined;
    const agentSessionId =
      typeof req.query.agent_session_id === "string" ? req.query.agent_session_id : undefined;
    const reviewerUsername =
      typeof req.query.reviewer_username === "string" ? req.query.reviewer_username : undefined;
    const escalatedRaw = typeof req.query.escalated === "string" ? req.query.escalated : undefined;
    const parsedEscalated = parseEscalatedQuery(escalatedRaw);
    if (!parsedEscalated.ok) {
      res.status(400).json({ error: parsedEscalated.error });
      return;
    }
    const outcomeReviewRaw =
      typeof req.query.outcome_review === "string" ? req.query.outcome_review : undefined;
    const parsedOutcomeReview = parseOutcomeReviewQuery(outcomeReviewRaw);
    if (!parsedOutcomeReview.ok) {
      res.status(400).json({ error: parsedOutcomeReview.error });
      return;
    }
    const attentionRaw = typeof req.query.attention === "string" ? req.query.attention : undefined;
    const parsedAttention = parseProposalAttention(attentionRaw);
    if (!parsedAttention.ok) {
      res.status(400).json({ error: parsedAttention.error });
      return;
    }
    const stalledRaw = typeof req.query.stalled === "string" ? req.query.stalled : undefined;
    const stalled =
      stalledRaw === "1" || stalledRaw === "true"
        ? true
        : stalledRaw === "0" || stalledRaw === "false"
          ? false
          : stalledRaw != null && stalledRaw !== ""
            ? null
            : undefined;
    if (stalled === null) {
      res.status(400).json({ error: "stalled must be 1/true or 0/false when set" });
      return;
    }
    const needsReviewRaw = typeof req.query.needs_review === "string" ? req.query.needs_review : undefined;
    const needsReview =
      needsReviewRaw === "1" || needsReviewRaw === "true"
        ? true
        : needsReviewRaw === "0" || needsReviewRaw === "false"
          ? false
          : needsReviewRaw != null && needsReviewRaw !== ""
            ? null
            : undefined;
    if (needsReview === null) {
      res.status(400).json({ error: "needs_review must be 1/true or 0/false when set" });
      return;
    }
    const perspectiveRaw =
      typeof req.query.attention_perspective === "string"
        ? req.query.attention_perspective
        : undefined;
    const parsedPerspective = parseAttentionPerspective(perspectiveRaw);
    if (!parsedPerspective.ok) {
      res.status(400).json({ error: parsedPerspective.error });
      return;
    }
    const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
    const offsetRaw = req.query.offset ? Number(req.query.offset) : undefined;
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort : undefined;
    const sortDirRaw =
      typeof req.query.sort_dir === "string"
        ? req.query.sort_dir
        : typeof req.query.sortDir === "string"
          ? req.query.sortDir
          : undefined;
    const parsedSort = parseProposalSort(sortRaw, sortDirRaw);
    if (!parsedSort.ok) {
      res.status(400).json({ error: parsedSort.error });
      return;
    }
    const actorTypeRaw =
      typeof req.query.proposer_actor_type === "string" ? req.query.proposer_actor_type : undefined;
    const parsedActorType = parseProposerActorType(actorTypeRaw);
    if (!parsedActorType.ok) {
      res.status(400).json({ error: parsedActorType.error });
      return;
    }
    const stats = svc.stats();
    const attentionPerspective =
      parsedPerspective.perspective ??
      (parsedSort.sort === "attention" ? "reviewer" : undefined);
    let { proposals, total, status_bias_applied, attention_perspective } = svc.list({
      issue_id: issueId,
      status: status as never,
      kind: kind as never,
      query,
      proposal_id: proposalId,
      proposer_username: proposerUsername,
      proposer_actor_type: parsedActorType.type,
      proposer_actor_role: proposerActorRole,
      agent_session_id: agentSessionId,
      reviewer_username: reviewerUsername,
      escalated: parsedEscalated.escalated,
      outcome_review: parsedOutcomeReview.outcome_review,
      attention: parsedAttention.attention,
      stalled: stalled === true ? true : undefined,
      needs_review: needsReview === true ? true : undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
      sort: parsedSort.sort,
      sortDir: parsedSort.sortDir,
      attention_perspective: attentionPerspective,
      caller_username: auth.actor,
    });

    let review_context = null as Awaited<ReturnType<typeof svc.classifyLive>> | null;
    if (proposalId && proposals.length === 1) {
      const p = proposals[0]!;
      review_context = await svc.classifyLive(p, { persistIfMissingSnapshot: true });
      // Refresh list row snapshot fields after lazy fill
      const refreshed = svc.get(p.id);
      if (refreshed) proposals = [refreshed];
      const content_type_strategies = svc.contentTypeStrategiesFor(proposals[0]!);
      res.json({
        proposals,
        total,
        stats,
        sort: parsedSort.sort,
        sort_dir: parsedSort.sortDir,
        status_bias_applied,
        attention_perspective,
        proposals_view: "full",
        ...(review_context ? { review_context } : {}),
        ...(content_type_strategies ? { content_type_strategies } : {}),
      });
      return;
    }

    res.json({
      proposals: proposals.map(toProposalSummary),
      total,
      stats,
      sort: parsedSort.sort,
      sort_dir: parsedSort.sortDir,
      status_bias_applied,
      attention_perspective,
      proposals_view: "summary",
    });
  });

  api.get(app, "/api/admin/proposals/proposers", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const daysRaw = req.query.days != null ? Number(req.query.days) : 30;
    const days = Number.isFinite(daysRaw) ? daysRaw : 30;
    const proposers = svc.listRecentProposers({ days });
    res.json({ proposers, days: Math.min(Math.max(days, 1), 365) });
  });

  api.get(app, "/api/admin/proposals/reviewers", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const daysRaw = req.query.days != null ? Number(req.query.days) : 30;
    const days = Number.isFinite(daysRaw) ? daysRaw : 30;
    const reviewers = svc.listRecentReviewers({ days });
    res.json({ reviewers, days: Math.min(Math.max(days, 1), 365) });
  });

  api.get(app, "/api/admin/proposals/kpis", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const kindRaw = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const granularityRaw =
      typeof req.query.granularity === "string" ? req.query.granularity : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const freshRaw = typeof req.query.fresh === "string" ? req.query.fresh : undefined;
    const kind =
      kindRaw === "idea" || kindRaw === "edits" || kindRaw === "notes" ? kindRaw : null;
    const granularity =
      granularityRaw === "today" ? "today" : granularityRaw === "week" ? "week" : "day";
    const fresh = freshRaw === "1" || freshRaw === "true";
    const history = svc.kpiHistory({ kind, granularity, from, to, fresh });
    res.json(history);
  });

  api.get(app, "/api/admin/proposals/:id", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const proposal = svc.get(req.params.id);
    if (!proposal) {
      const deleted = svc.deletion(req.params.id);
      if (deleted) {
        res.status(410).json(proposalDeletedError(deleted));
        return;
      }
      res.status(404).json({ error: "Proposal not found" });
      return;
    }
    const review_context = await svc.classifyLive(proposal, { persistIfMissingSnapshot: true });
    const fresh = svc.get(req.params.id) ?? proposal;
    const content_type_strategies = svc.contentTypeStrategiesFor(fresh);
    const refs = svc.referencedProposals(fresh);
    res.json({
      proposal: fresh,
      review_context,
      ...(content_type_strategies ? { content_type_strategies } : {}),
      deleted_refs: refs.missing,
      referenced_proposals: refs.byId,
    });
  });

  api.post(app, "/api/admin/proposals/bulk-delete", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const gate = checkBulkDeleteRequest({
      actorType: resolveEventActor(req)?.type ?? null,
      username: auth.username,
      hasDeleteCapability: Boolean(
        auth.username && userStore.hasCapability(auth.username, "proposals_delete"),
      ),
      ids: req.body?.ids,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ ok: false, code: gate.code, error: gate.error });
      return;
    }
    const svc = siteService(req, res);
    if (!svc) return;
    const { results } = await svc.deleteProposals(gate.ids, {
      username: auth.username!,
      actor: resolveEventActor(req),
    });
    res.json({
      ok: true,
      results,
      deleted: results.filter((r) => r.status === "deleted").length,
    });
  });

  api.post(app, "/api/admin/proposals", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const body = req.body as CreateProposalInput;
    const result = await svc.create(
      {
        ...body,
        agent_session_id:
          typeof req.body?.agent_session_id === "string"
            ? req.body.agent_session_id
            : typeof req.headers["x-agent-session-id"] === "string"
              ? req.headers["x-agent-session-id"]
              : body.agent_session_id,
      },
      {
        username: auth.actor,
        actor: resolveEventActor(req, { model: req.body?.model }),
      },
    );
    if (!result.ok) {
      const status =
        result.code === "similar_proposals" ||
        result.code === "proposal_exists" ||
        result.code === "notes_no_auto_retry" ||
        result.code === "confirm_recent_activity" ||
        result.code === "activity_unavailable" ||
        result.code === "competing_entry_edits" ||
        result.code === "mixed_risk_bundle" ||
        result.code === "supersedes_already_replaced" ||
        result.code === "supersedes_not_closed" ||
        result.code === "implements_required" ||
        result.code === "idea_already_in_progress" ||
        result.code === "implements_entry_mismatch" ||
        result.code === "implements_not_found" ||
        result.code === "competing_shared_fields" ||
        result.code === "draft_in_proposal" ||
        result.code === "variant_has_traffic"
          ? 409
          : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });

  api.post(app, "/api/admin/proposals/:id/:action", { rate: "staffWrite" }, async (req, res) => {
    const action = req.params.action as ProposalUpdateAction;
    if (!ALL_ACTIONS.has(action)) {
      res.status(400).json({ error: `Unknown action: ${action}` });
      return;
    }

    const needsWrite = WRITE_ACTIONS.has(action) || action === "withdraw";
    let auth = needsWrite
      ? await requireProposalWrite(req, res)
      : await requireProposalRead(req, res);
    if (!auth) return;

    const actor = resolveEventActor(req, { model: req.body?.model });
    const siteCtx = res.locals.site as SiteContext | undefined;
    const proposalPolicy = getProposalSettings(siteCtx?.contentRoot);

    if (action === "escalate" || action === "deescalate") {
      if (actor?.type === "mcp") {
        res.status(403).json({
          ok: false,
          code: "steward_ui_only",
          error: "Escalate and release are staff steward actions in the UI — agents cannot set them.",
        });
        return;
      }
      if (proposalPolicy.hold.stewards_only) {
        if (!auth.username || !userStore.userHasRole(auth.username, "platform_steward")) {
          res.status(403).json({
            ok: false,
            code: "steward_required",
            error: "Only a Platform Steward can escalate or release a proposal hold.",
          });
          return;
        }
      } else if (
        !auth.username ||
        !userStore.hasCapability(auth.username, "proposals_review")
      ) {
        res.status(403).json({
          ok: false,
          code: "review_required",
          error: "proposals_review is required to escalate or release a proposal hold.",
        });
        return;
      }
    }

    if (OUTCOME_ACTIONS.has(action)) {
      if (actor?.type === "mcp") {
        res.status(403).json({
          ok: false,
          code: "steward_ui_only",
          error:
            "Outcome reviews are set by staff stewards in the UI only — agents can read outcome_review fields but cannot set them.",
        });
        return;
      }
      if (!auth.username || !userStore.userHasRole(auth.username, "platform_steward")) {
        res.status(403).json({
          ok: false,
          code: "steward_required",
          error: "Only a Platform Steward can review a proposal outcome.",
        });
        return;
      }
    }

    let asStaff = needsWrite && action !== "attach_variant" && action !== "add_blocker";
    if (action === "set_no_auto_retry") {
      // Staff UI may flip without claim; MCP must claim (enforced in service via actor.type).
      asStaff = true;
    }
    if (action === "set_review_situations") {
      // Staff UI may retag; MCP authors must be proposer (enforced in service).
      asStaff = actor?.type !== "mcp";
    }
    if (action === "set_idea_funnel" || action === "set_idea_seo_target" || action === "set_related_entries") {
      asStaff = actor?.type !== "mcp";
    }
    if (action === "escalate" || action === "deescalate" || OUTCOME_ACTIONS.has(action)) {
      asStaff = true;
    }
    if (action === "withdraw") {
      // MCP never gets staff bypass — service honors withdraw.mcp (incl. disabled).
      if (actor?.type === "mcp") {
        asStaff = false;
      } else {
        const staffMode = proposalPolicy.withdraw.staff;
        if (staffMode === "proposer_only") {
          asStaff = false;
        } else if (staffMode === "steward_only") {
          asStaff = Boolean(
            auth.username && userStore.userHasRole(auth.username, "platform_steward"),
          );
        } else {
          // any_editor
          asStaff = true;
        }
        if (asStaff) {
          const svcPeek = siteService(req, res);
          if (!svcPeek) return;
          const current = svcPeek.get(req.params.id);
          if (current && current.proposer_username !== auth.actor) {
            auth = await requireProposalWrite(req, res);
            if (!auth) return;
          }
        }
      }
    }

    if (action === "apply") {
      const svcPeek = siteService(req, res);
      if (!svcPeek) return;
      const current = svcPeek.get(req.params.id);
      if (current?.promote_on_apply && auth.username && process.env.NODE_ENV === "production") {
        for (const entry of current.entries) {
          if (!userStore.hasCapability(auth.username, "content_promote_variant", entry.contentType)) {
            res.status(403).json({
              error: `content_promote_variant required for ${entry.contentType}`,
            });
            return;
          }
        }
      } else if (current?.kind === "edits" && auth.username && process.env.NODE_ENV === "production") {
        for (const entry of current.entries) {
          const seo = entry.ops.some(
            (o) => o.field_path.startsWith("meta.") || o.field_path.startsWith("seo."),
          );
          const text = entry.ops.some(
            (o) => !o.field_path.startsWith("meta.") && !o.field_path.startsWith("seo."),
          );
          if (text && !userStore.hasCapability(auth.username, "content_edit_text", entry.contentType)) {
            res.status(403).json({ error: `content_edit_text required for ${entry.contentType}` });
            return;
          }
          if (seo && !userStore.hasCapability(auth.username, "seo_edit", entry.contentType)) {
            res.status(403).json({ error: `seo_edit required for ${entry.contentType}` });
            return;
          }
        }
      }
    }

    const svc = siteService(req, res);
    if (!svc) return;
    const result = await svc.update(req.params.id, action, {
      username: auth.actor,
      report: typeof req.body?.report === "string" ? req.body.report : undefined,
      asStaff,
      actor,
      agent_session_id:
        typeof req.body?.agent_session_id === "string"
          ? req.body.agent_session_id
          : typeof req.headers["x-agent-session-id"] === "string"
            ? req.headers["x-agent-session-id"]
            : undefined,
      body: typeof req.body?.body === "string" ? req.body.body : undefined,
      blocker_id:
        typeof req.body?.blocker_id === "number"
          ? req.body.blocker_id
          : typeof req.body?.blocker_id === "string"
            ? Number(req.body.blocker_id)
            : undefined,
      resolve_note: typeof req.body?.resolve_note === "string" ? req.body.resolve_note : undefined,
      variant: typeof req.body?.variant === "string" ? req.body.variant : undefined,
      confirm_end_experiment: req.body?.confirm_end_experiment === true,
      confirm_base_unknown: req.body?.confirm_base_unknown === true,
      confirm_text_limits: req.body?.confirm_text_limits === true,
      caller_is_mcp: typeof req.headers["x-mcp-author"] === "string",
      confirm_affected_entries:
        typeof req.body?.confirm_affected_entries === "number" ? req.body.confirm_affected_entries : undefined,
      dry_run: req.body?.dry_run === true,
      all_or_nothing:
        typeof req.body?.all_or_nothing === "boolean" ? req.body.all_or_nothing : undefined,
      confirm_recent_activity: req.body?.confirm_recent_activity === true,
      confirm_new_values: req.body?.confirm_new_values === true,
      promote_on_apply: req.body?.promote_on_apply === true,
      close_reason: typeof req.body?.close_reason === "string" ? req.body.close_reason : undefined,
      close_note: typeof req.body?.close_note === "string" ? req.body.close_note : undefined,
      next_step: typeof req.body?.next_step === "string" ? req.body.next_step : undefined,
      accepted_entry:
        req.body?.accepted_entry && typeof req.body.accepted_entry === "object"
          ? req.body.accepted_entry
          : undefined,
      no_auto_retry:
        typeof req.body?.no_auto_retry === "boolean" ? req.body.no_auto_retry : undefined,
      confirm_reject: req.body?.confirm_reject === true,
      reject_kind: typeof req.body?.reject_kind === "string" ? req.body.reject_kind : undefined,
      entries: Array.isArray(req.body?.entries) ? req.body.entries : undefined,
      review_situations: Array.isArray(req.body?.review_situations)
        ? req.body.review_situations
        : undefined,
      idea_funnel:
        req.body?.idea_funnel && typeof req.body.idea_funnel === "object"
          ? req.body.idea_funnel
          : undefined,
      idea_seo_target:
        req.body?.idea_seo_target && typeof req.body.idea_seo_target === "object"
          ? req.body.idea_seo_target
          : undefined,
      seo_target_override: req.body?.seo_target_override ?? undefined,
      related_entries: Array.isArray(req.body?.related_entries) ? req.body.related_entries : undefined,
      escalated_note:
        typeof req.body?.escalated_note === "string" ? req.body.escalated_note : undefined,
      outcome_review:
        typeof req.body?.outcome_review === "string" ? req.body.outcome_review : undefined,
      outcome_review_note:
        typeof req.body?.outcome_review_note === "string" ? req.body.outcome_review_note : undefined,
      outcome_review_expected:
        typeof req.body?.outcome_review_expected === "string"
          ? req.body.outcome_review_expected
          : undefined,
      outcome_lesson_captured:
        typeof req.body?.outcome_lesson_captured === "boolean"
          ? req.body.outcome_lesson_captured
          : undefined,
      outcome_lesson_note:
        typeof req.body?.outcome_lesson_note === "string" ? req.body.outcome_lesson_note : undefined,
    });
    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "proposal_deleted"
            ? 410
          : result.code === "four_eyes" ||
              result.code === "not_claimant" ||
              result.code === "not_proposer" ||
              result.code === "withdraw_disabled" ||
              result.code === "steward_ui_only" ||
              result.code === "escalated" ||
              result.code === "four_eyes_co_author"
            ? 403
            : result.code === "proposal_exists" ||
                result.code === "confirm_end_experiment" ||
                result.code === "confirm_recent_activity" ||
                result.code === "confirm_reject" ||
                result.code === "activity_unavailable" ||
                result.code === "notes_no_auto_retry" ||
                result.code === "claimed" ||
                result.code === "not_closed" ||
                result.code === "not_bad" ||
                result.code === "legacy_version" ||
                result.code === "all_or_nothing_blocked" ||
                result.code === "competing_shared_fields" ||
                result.code === "draft_in_proposal" ||
                result.code === "variant_has_traffic" ||
                result.code === "draft_base_unknown" ||
                result.code === "confirm_affected_entries" ||
                result.code === "revert_conflicts"
              ? 409
              : result.code === "text_limits_exceeded"
                ? 422
                : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });
}
