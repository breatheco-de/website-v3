import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api";
import * as userStore from "../user-store";
import { requireAnyCapability } from "./_helpers";
import { proposalServiceForSite, exportAllProposals } from "../content-proposals";
import type { SiteContext } from "../site-manager";
import {
  parseProposalSort,
  type CreateProposalInput,
  type ProposalUpdateAction,
} from "../content-proposals/service";
import { child } from "../logger";

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
  "reject",
  "claim",
  "release",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
  "attach_variant",
]);

const ALL_ACTIONS = new Set<ProposalUpdateAction>([
  "claim",
  "release",
  "withdraw",
  "apply",
  "acknowledge",
  "reject",
  "attach_variant",
  "add_blocker",
  "resolve_blocker",
  "reopen_blocker",
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
    const stats = svc.stats();
    const { proposals, total } = svc.list({
      issue_id: issueId,
      status: status as never,
      kind: kind as never,
      query,
      proposal_id: proposalId,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
      sort: parsedSort.sort,
      sortDir: parsedSort.sortDir,
    });
    res.json({
      proposals,
      total,
      stats,
      sort: parsedSort.sort,
      sort_dir: parsedSort.sortDir,
    });
  });

  api.get(app, "/api/admin/proposals/:id", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireProposalRead(req, res);
    if (!auth) return;
    const svc = siteService(req, res);
    if (!svc) return;
    const proposal = svc.get(req.params.id);
    if (!proposal) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }
    res.json({ proposal });
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
        actor: { type: req.headers["x-mcp-author"] ? "mcp" : "ui" },
      },
    );
    if (!result.ok) {
      const status =
        result.code === "similar_proposals" || result.code === "proposal_exists" ? 409 : 400;
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

    let asStaff = needsWrite && action !== "attach_variant" && action !== "add_blocker";
    if (action === "withdraw") {
      const svcPeek = siteService(req, res);
      if (!svcPeek) return;
      const current = svcPeek.get(req.params.id);
      if (current && current.proposer_username !== auth.actor) {
        auth = await requireProposalWrite(req, res);
        if (!auth) return;
        asStaff = true;
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
      promote_on_apply: req.body?.promote_on_apply === true,
    });
    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "four_eyes"
            ? 403
            : result.code === "proposal_exists" || result.code === "confirm_end_experiment"
              ? 409
              : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });
}
