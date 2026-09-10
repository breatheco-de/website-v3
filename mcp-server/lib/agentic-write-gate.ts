/**
 * Agentic role MCP write gate: draft free; live needs same-locale issue claim;
 * publish/demote/create_entry → propose_change only.
 */

import { isAgenticSwarmRoleId } from "@shared/agentic-swarm-roles";
import { getActiveRoleId } from "./auth.js";
import { buildLoopbackHeaders } from "./loopback.js";
import { getTokenUsername } from "./oauth.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

export type AgenticWriteIntent = "draft" | "live" | "publish" | "create_entry";

export type AgenticWriteGateOk = {
  allowed: true;
  /** Call refreshAgenticClaimAfterLiveWrite after a successful live mutate. */
  shouldRefreshClaim: boolean;
};

export type AgenticWriteGateResult = AgenticWriteGateOk | { allowed: false; response: McpTextResult };

/** True when the connector is `/mcp/role/:id` for a seeded agentic swarm role. */
export function isAgenticRoleSession(): boolean {
  const roleId = getActiveRoleId();
  return Boolean(roleId && isAgenticSwarmRoleId(roleId));
}

export function classifyAgenticWriteIntent(opts: {
  variant?: string | null;
  intent?: AgenticWriteIntent;
}): AgenticWriteIntent {
  if (opts.intent) return opts.intent;
  if (opts.variant && String(opts.variant).trim()) return "draft";
  return "live";
}

function proposeNextActions(opts: {
  contentType?: string;
  slug?: string;
  locale?: string;
  site?: string;
  preferDraft?: boolean;
}): NextAction[] {
  const actions: NextAction[] = [];
  if (opts.preferDraft && opts.contentType && opts.slug && opts.locale) {
    actions.push({
      tool: "create_variant",
      priority: "recommended",
      reason: "Write into a draft variant instead of live (no claim required for drafts).",
      args_hint: {
        contentType: opts.contentType,
        slug: opts.slug,
        locale: opts.locale,
        ...(opts.site ? { site: opts.site } : {}),
      },
    });
  }
  actions.push({
    tool: "propose_change",
    priority: "required",
    reason:
      "Open an edits proposal (field updates and/or promote_on_apply). Notes are reminders only — they do not write YAML.",
    args_hint: {
      ...(opts.contentType && opts.slug && opts.locale
        ? {
            entries: [
              {
                contentType: opts.contentType,
                slug: opts.slug,
                locale: opts.locale,
              },
            ],
          }
        : {}),
      ...(opts.site ? { site: opts.site } : {}),
    },
  });
  return actions;
}

async function fetchActiveClaimForEntry(opts: {
  mcpToken?: string;
  contentType: string;
  slug: string;
  locale: string;
  domain?: string;
}): Promise<{ has_active_claim: boolean; claim_issue_ids: string[] }> {
  const author = opts.mcpToken ? getTokenUsername(opts.mcpToken) : undefined;
  if (!author) return { has_active_claim: false, claim_issue_ids: [] };
  const params = new URLSearchParams({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    author,
  });
  if (opts.domain) params.set("__site", opts.domain);
  try {
    const res = await fetch(
      `http://127.0.0.1:${MAIN_SERVER_PORT}/api/validation/cache-issues/active-claim-for-entry?${params}`,
      { headers: buildLoopbackHeaders(opts.mcpToken) },
    );
    if (!res.ok) return { has_active_claim: false, claim_issue_ids: [] };
    const data = (await res.json()) as {
      has_active_claim?: boolean;
      claim_issue_ids?: string[];
    };
    return {
      has_active_claim: data.has_active_claim === true,
      claim_issue_ids: Array.isArray(data.claim_issue_ids) ? data.claim_issue_ids : [],
    };
  } catch {
    return { has_active_claim: false, claim_issue_ids: [] };
  }
}

/**
 * Enforce agentic write policy. Non-agentic / unscoped sessions always allow.
 */
export async function assertAgenticContentWriteAllowed(opts: {
  mcpToken?: string;
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  intent?: AgenticWriteIntent;
  domain?: string;
  site?: string;
}): Promise<AgenticWriteGateResult> {
  if (!isAgenticRoleSession()) {
    return { allowed: true, shouldRefreshClaim: false };
  }

  const intent = classifyAgenticWriteIntent({
    variant: opts.variant,
    intent: opts.intent,
  });

  if (intent === "draft") {
    return { allowed: true, shouldRefreshClaim: false };
  }

  if (intent === "publish" || intent === "create_entry") {
    const kind = intent === "create_entry" ? "create entries" : "publish, promote, or demote";
    return {
      allowed: false,
      response: actionRequired(
        {
          success: false,
          action_required: "agentic_propose_required",
          code: "agentic_propose_required",
          message:
            `Agentic swarm roles cannot ${kind} via MCP tools. ` +
            `Use propose_change (edits and/or promote_on_apply) so someone else can apply.`,
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
        },
        proposeNextActions({
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
          site: opts.site,
          preferDraft: intent === "publish",
        }),
      ),
    };
  }

  // live
  const claim = await fetchActiveClaimForEntry({
    mcpToken: opts.mcpToken,
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    domain: opts.domain,
  });
  if (!claim.has_active_claim) {
    return {
      allowed: false,
      response: actionRequired(
        {
          success: false,
          action_required: "agentic_claim_required",
          code: "agentic_claim_required",
          message:
            "Agentic swarm roles may edit live only while holding an active validation-issue claim " +
            "for this content type, slug, and locale. Claim an open issue first, write a draft variant, " +
            "or open an edits proposal.",
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
        },
        [
          {
            tool: "update_issue",
            priority: "required",
            reason: "Claim an open issue for this entry/locale, then retry the live write.",
            args_hint: {
              action: "claim",
              ...(opts.site ? { site: opts.site } : {}),
            },
          },
          ...proposeNextActions({
            contentType: opts.contentType,
            slug: opts.slug,
            locale: opts.locale,
            site: opts.site,
            preferDraft: true,
          }),
        ],
      ),
    };
  }

  return { allowed: true, shouldRefreshClaim: true };
}

/** Extend claim TTL after a successful agentic live write (best-effort). */
export async function refreshAgenticClaimAfterLiveWrite(opts: {
  mcpToken?: string;
  contentType: string;
  slug: string;
  locale: string;
  domain?: string;
}): Promise<void> {
  if (!isAgenticRoleSession()) return;
  const author = opts.mcpToken ? getTokenUsername(opts.mcpToken) : undefined;
  if (!author) return;
  const params = opts.domain ? `?__site=${encodeURIComponent(opts.domain)}` : "";
  try {
    await fetch(
      `http://127.0.0.1:${MAIN_SERVER_PORT}/api/validation/cache-issues/refresh-claims-for-entry${params}`,
      {
        method: "POST",
        headers: buildLoopbackHeaders(opts.mcpToken),
        body: JSON.stringify({
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
          author,
        }),
      },
    );
  } catch {
    // best-effort — write already succeeded
  }
}
