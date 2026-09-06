import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { hasCapAnyScope } from "../lib/tool-catalog.js";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import {
  clampProposalLimit,
  clampProposalOffset,
  isProposalsScoped,
  proposalNextOffset,
} from "../lib/list-proposals-mcp.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    if (username) headers["x-mcp-author"] = username;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

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

export function registerProposalTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "propose_change",
    "Create a content proposal (does not write live YAML). kind is edits when entries[] is set, otherwise notes (handoff). " +
      "Optional related_issue_ids must exist in validation-cache. Duplicate open fingerprint returns the existing proposal. " +
      "Similar open proposals require confirm_distinct: true. Requires content_view or seo_edit. " +
      "Live content is unchanged until a different user with edit caps calls update_proposal action apply (or acknowledge for notes).",
    {
      title: z.string().describe("Short title"),
      summary: z.string().describe("Why + what (min 80 chars). For notes, include steps tried."),
      rationale: z.string().optional(),
      category: z.enum(["content.field", "content.seo"]).optional(),
      related_issue_ids: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      confirm_distinct: z.boolean().optional(),
      situation_note: z.string().optional().describe("Plain-English picture of current live values."),
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
              .min(1),
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
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/admin/proposals${siteQuery(siteResult.domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            title: args.title,
            summary: args.summary,
            rationale: args.rationale,
            category: args.category,
            related_issue_ids: args.related_issue_ids,
            tags: args.tags,
            confirm_distinct: args.confirm_distinct,
            situation_note: args.situation_note,
            entries: args.entries,
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
          return fail(String(data.error ?? "propose_change failed"), { code: data.code });
        }
        return ok({
          ...data,
          warnings: [
            {
              code: "not_applied",
              message:
                "Proposal stored only. Does not write YAML, GitHub, or complete validation issues. Notes write no entries.",
            },
            {
              code: "four_eyes",
              message: "A different user with content_edit_text or seo_edit must apply or acknowledge.",
            },
          ],
          next_actions: [
            {
              tool: "list_proposals",
              reason: "Re-read the stored proposal.",
              args_hint: { proposal_id: (data as { proposal?: { id?: string } }).proposal?.id },
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
      "(counts by status/kind) — not a full proposals[] dump. Pass proposal_id, query, issue_id, status, or kind " +
      "to unlock paginated proposals[] (default limit 20, max 200; use offset / next_offset). " +
      "proposal_stats stay site-wide even when the list is filtered. Requires content_view or seo_edit.",
    {
      proposal_id: z.string().optional(),
      query: z.string().optional(),
      status: z.enum(["open", "partial", "finished", "rejected", "withdrawn"]).optional(),
      kind: z.enum(["edits", "notes"]).optional(),
      issue_id: z.string().optional(),
      limit: z.number().optional().describe("Page size when scoped (default 20, max 200)"),
      offset: z.number().optional().describe("Offset when scoped"),
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
      } else {
        // Stats come from the list endpoint; avoid loading a large default page.
        qs.set("limit", "1");
        qs.set("offset", "0");
      }
      const extra = qs.toString();
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/admin/proposals${siteQuery(siteResult.domain, extra)}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as {
          proposals?: unknown[];
          total?: number;
          stats?: unknown;
          error?: string;
        };
        if (!res.ok) return fail(String(data.error ?? "list_proposals failed"));

        const proposal_stats = data.stats ?? null;
        if (!scoped) {
          return ok({
            proposal_stats,
            next_actions: [],
          }, { warnings });
        }

        const proposals = data.proposals ?? [];
        const total = typeof data.total === "number" ? data.total : proposals.length;
        const next_offset = proposalNextOffset(offset, limit, total, proposals.length);
        return ok({
          proposal_stats,
          proposals,
          total,
          limit,
          offset,
          next_offset,
          next_actions: [],
        }, { warnings });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "update_proposal",
    "Lifecycle for a proposal (same pattern as update_issue). Actions: claim, release, withdraw, apply, acknowledge, reject. " +
      "apply writes pending/failed entries after baseline vs live contrast (skips done). acknowledge finishes notes only. " +
      "apply/acknowledge/reject require a different user than the proposer. Requires content_edit_text or seo_edit.",
    {
      proposal_id: z.string(),
      action: z.enum(["claim", "release", "withdraw", "apply", "acknowledge", "reject"]),
      report: z.string().optional(),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await requireUpdateCap(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/admin/proposals/${encodeURIComponent(args.proposal_id)}/${encodeURIComponent(args.action)}${siteQuery(siteResult.domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ report: args.report }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? "update_proposal failed"), { code: data.code });
        }
        const proposal = (data as { proposal?: { kind?: string; status?: string; related_issue_ids?: string[] } }).proposal;
        const next: Array<{
          tool: string;
          reason: string;
          priority: "recommended";
          args_hint: Record<string, unknown>;
        }> = [];
        if (proposal?.status === "finished" && proposal.related_issue_ids?.length) {
          next.push({
            tool: "update_issue",
            reason: "Proposal finished — complete linked issues only if they are actually gone after re-check.",
            priority: "recommended" as const,
            args_hint: { issue_id: proposal.related_issue_ids[0], action: "complete" },
          });
        }
        return ok({
          ...data,
          warnings: [
            {
              code: "partial_progress",
              message:
                "Edits apply remaining entries only. Proposal is finished only when every entry is done (or notes acknowledged).",
            },
          ],
          next_actions: next,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
