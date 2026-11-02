/**
 * MCP update_ads_issue — start an Ads Run, Re-check, Mark as fixed, Undo (same as the Ads UI buttons).
 * Never edits Meta / Google campaigns; only changes which issues are open, pending or resolved.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { denyResponse } from "../lib/auth.js";
import { hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail, type McpSideEffect, type McpWarning, type NextAction } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB } from "../lib/entry-helpers.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MIN_REPORT = 40;

const ISSUES_PATH = "{content_root}/validation-cache.json";
const JOBS_PATH = ".cache/{site}/ads-diagnostics/jobs/";

const READ_BACK: NextAction = {
  tool: "get_paid_traffic",
  priority: "recommended",
  reason: "Read the issue list again to see the result (Runs take ~1–3 min; Re-checks a few seconds)",
  args_hint: { mode: "diagnostics" },
};

type Action = "run" | "recheck" | "mark_fixed" | "undo";

export function adsIssueActionMeta(action: Action, body: Record<string, unknown>): { warnings: McpWarning[]; side_effects: McpSideEffect[]; next_actions: NextAction[] } {
  const common: McpWarning = {
    code: "ads_issue_no_platform_change",
    message: "Changes issue state only. Never edits Meta / Google campaigns, ads, budgets or settings, and does not run Sync (Sync updates numbers, not issues).",
  };
  if (action === "run") {
    return {
      warnings: [
        common,
        { code: "ads_run_scope", message: "Replaces issues only for platforms it can reach; a skipped platform keeps its issues (shown as not_checked). Pending (marked-fixed) issues are judged on their own schedule; actions made after the Run started win." },
      ],
      side_effects: [{ kind: "ads_run_started", summary: `Background Run ${String(body.job_id ?? "")} started (fork worker). Issues save when it finishes.`, paths: [JOBS_PATH, ISSUES_PATH] }],
      next_actions: [READ_BACK],
    };
  }
  if (action === "recheck") {
    return {
      warnings: [
        common,
        { code: "ads_recheck_scope", message: `Re-checks only this issue / resource (lane ${String(body.lane ?? "")}${body.coalesced ? ", merged into a queued batch" : ""}). If Meta can't be reached the issue stays open with last_check couldnt_check.` },
      ],
      side_effects: [{ kind: "ads_recheck_queued", summary: `Re-check job ${String(body.job_id ?? "")} queued.`, paths: [JOBS_PATH, ISSUES_PATH] }],
      next_actions: [READ_BACK],
    };
  }
  if (action === "mark_fixed") {
    const verify = (body.verify ?? {}) as { label?: string; verify_after?: string | null };
    return {
      warnings: [
        common,
        { code: "ads_pending_not_resolved", message: `Issue is pending, not resolved: ${verify.label ?? "waiting to confirm"}. It confirms (resolved) or reopens on a later Run / Re-check; early failure reopens it, early pass never resolves it. Undo reopens it now.` },
      ],
      side_effects: [{ kind: "ads_issue_marked_fixed", summary: `Marked fixed → pending verification${verify.verify_after ? ` (earliest ${verify.verify_after})` : ""}; report saved on the issue.`, paths: [ISSUES_PATH] }],
      next_actions: [],
    };
  }
  return {
    warnings: [common],
    side_effects: [{ kind: "ads_issue_reopened", summary: "Pending mark removed; the issue is open again.", paths: [ISSUES_PATH] }],
    next_actions: [],
  };
}

export function registerAdsIssueTools(mcp: McpServer, mcpToken?: string, grants?: CatalogGrant[]): void {
  mcp.tool(
    "update_ads_issue",
    "Ads diagnostics actions (same as the Ads UI). Requires metrics_view. " +
      "run: start a full background Run of every Ads check (409 ads_run_busy / ads_sync_active when busy). " +
      "recheck: re-check one issue (issue_id) or resource (platform + level + resource_id); only for instant checks or pending issues that are ready_to_verify (409 ads_recheck_not_instant / ads_recheck_not_ready). Accounts or > 50 ads run in the background worker. " +
      "mark_fixed: for non-instant checks after you fixed something — issue goes pending (after_sync waits for the next Sync; fresh_days waits for new days of data from the first full day after the mark, account time zone) and resolves or reopens later. Requires report. " +
      "undo: remove a mark_fixed; issue is open again. " +
      "Read verify.action on get_paid_traffic diagnostics issues to pick the action. Never edits ad platforms. " +
      MULTI_SITE_TOOL_BLURB,
    {
      action: z.enum(["run", "recheck", "mark_fixed", "undo"]).describe("run | recheck | mark_fixed | undo"),
      issue_id: z.string().max(240).optional().describe("Issue id from get_paid_traffic diagnostics (ads:{platform}:{code}:{level}:{resource}). Required for mark_fixed / undo; or use platform + level + resource_id for recheck."),
      platform: z.enum(["meta", "google"]).optional().describe("recheck by resource: platform"),
      level: z.enum(["account", "campaign", "adset", "ad"]).optional().describe("recheck by resource: level"),
      resource_id: z.string().max(40).optional().describe("recheck by resource: account / campaign / ad set / ad id"),
      platforms: z.array(z.enum(["meta", "google"])).max(2).optional().describe("run: limit to these platforms (default both)"),
      report: z.string().max(2000).optional().describe(`mark_fixed: required (min ${MIN_REPORT} chars) — what you changed and where (account / campaign / ad ids, site page).`),
      model: z.string().optional().describe("Exact model (provider/model); stored on the mark."),
      agent_session_id: z.string().describe("Required. From agent_session start."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ action, issue_id, platform, level, resource_id, platforms, report, model, agent_session_id, site }) => {
      if (mcpToken && grants && !hasCapAnyScope(grants, "metrics_view")) return denyResponse("metrics_view");
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);

      let path: string;
      let body: Record<string, unknown>;
      if (action === "run") {
        path = "run";
        body = platforms?.length ? { platforms } : {};
      } else if (action === "recheck") {
        path = "recheck";
        if (issue_id) body = { issue_id };
        else if (platform && level && resource_id) body = { platform, level, id: resource_id };
        else return fail("recheck needs issue_id, or platform + level + resource_id.", { code: "ads_recheck_scope_required" });
      } else {
        if (!issue_id) return fail(`${action} needs issue_id.`, { code: "ads_issue_id_required" });
        path = action === "mark_fixed" ? "mark-fixed" : "undo";
        body = { issue_id };
        if (action === "mark_fixed") {
          const r = report?.trim() ?? "";
          if (r.length < MIN_REPORT) {
            return fail(`mark_fixed needs a report (min ${MIN_REPORT} chars): what you changed and where.`, {
              code: "ads_report_required",
              hint: "Example: \"Added utm_id/utm_content to the 12 ads in campaign 1203… via Ads Manager URL parameters.\"",
            });
          }
          body = { issue_id, report: r, ...(model ? { model } : {}) };
        }
      }

      const params = new URLSearchParams();
      const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/diagnostics/ads/${path}?${params}`, {
        method: "POST",
        headers: buildLoopbackHeaders(mcpToken, { agentSessionId: agent_session_id, model, site: siteResult.domain }),
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const code = typeof data.code === "string" ? data.code : `http_${res.status}`;
        const busy = code === "ads_run_busy" || code === "ads_sync_active";
        return fail(String(data.error ?? `Server error: ${res.status}`), {
          code,
          ...(busy ? { hint: "Wait for the running Run / Sync to finish (get_paid_traffic diagnostics shows run.active), then retry." } : {}),
          ...(code === "ads_recheck_not_instant" ? { hint: "Use action mark_fixed with a report instead." } : {}),
        });
      }
      const meta = adsIssueActionMeta(action, data);
      return ok({ message: `update_ads_issue ${action}: ok`, ...data }, meta);
    },
  );
}
