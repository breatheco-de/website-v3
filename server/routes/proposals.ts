import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api";
import * as userStore from "../user-store";
import { requireAnyCapability } from "./_helpers";
import { proposalServiceForSite } from "../content-proposals";
import type { SiteContext } from "../site-manager";
import type { CreateProposalInput } from "../content-proposals/service";

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

export function registerProposalRoutes(app: Express): void {
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
    const stats = svc.stats();
    const { proposals, total } = svc.list({
      issue_id: issueId,
      status: status as never,
      kind: kind as never,
      query,
      proposal_id: proposalId,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
    });
    res.json({ proposals, total, stats });
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
    const result = await svc.create(body, {
      username: auth.actor,
      actor: { type: req.headers["x-mcp-author"] ? "mcp" : "ui" },
    });
    if (!result.ok) {
      const status = result.code === "similar_proposals" ? 409 : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });

  api.post(app, "/api/admin/proposals/:id/:action", { rate: "staffWrite" }, async (req, res) => {
    const action = req.params.action as
      | "claim"
      | "release"
      | "withdraw"
      | "apply"
      | "acknowledge"
      | "reject";
    const allowed = new Set(["claim", "release", "withdraw", "apply", "acknowledge", "reject"]);
    if (!allowed.has(action)) {
      res.status(400).json({ error: `Unknown action: ${action}` });
      return;
    }

    const needsWrite =
      action === "apply" ||
      action === "acknowledge" ||
      action === "reject" ||
      action === "claim" ||
      action === "release";
    let auth = needsWrite
      ? await requireProposalWrite(req, res)
      : await requireProposalRead(req, res);
    if (!auth) return;

    let asStaff = needsWrite;
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

    if (action === "apply" && auth.username && process.env.NODE_ENV === "production") {
      const svcPeek = siteService(req, res);
      if (!svcPeek) return;
      const current = svcPeek.get(req.params.id);
      if (current?.kind === "edits") {
        for (const entry of current.entries) {
          const seo = entry.ops.some((o) => o.field_path.startsWith("meta.") || o.field_path.startsWith("seo."));
          const text = entry.ops.some((o) => !o.field_path.startsWith("meta.") && !o.field_path.startsWith("seo."));
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
    });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "four_eyes" ? 403 : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });
}
