/**
 * Technical MCP playbook + agent conventions loader for bootstrap_agent.
 * Conventions body is for any MCP host — delivered in the tool response.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";

/** Bump when the technical playbook markdown below changes. */
export const PLAYBOOK_VERSION = "9";

/**
 * Explicit conventions seed version. Bump when editing mcp-server/agent-conventions.md
 * so agents re-fetch skill.content (known_skill_version mismatch).
 */
export const CONVENTIONS_VERSION = "36";

export const CONVENTIONS_PATH = "mcp-server/agent-conventions.md";

export const SKILL_HINT =
  "Treat skill.content as standing instructions for this connector run: how to read responses, " +
  "who may confirm gates, how proposals work between roles, and how to report results to the human. " +
  "Check it before and after Website MCP writes. " +
  "On later bootstrap_agent calls in the same chat, set include_skill_content: false " +
  "and/or pass known_skill_version from this response.";

export const PLAYBOOK_MARKDOWN = `# Website MCP — technical playbook

For remote chat agents (Claude.ai, Grok, custom connectors). How to read responses, who may confirm gates, how proposals work between roles, and how to report to the human belong in agent-conventions (skill.content); this playbook is protocol only.

## Identity (required for writes)

- **Production plain \`/mcp\`:** Read-only for writes. Mutating tools may appear in \`tools/list\` but every mutate returns \`action_required: role_connector_required\` with \`connector_guide.role_connectors\` (URLs) and \`swarm_setup\`. Call \`get_current_user\` / \`bootstrap_agent\` — reconnect with **one MCP connection per agent role URL**. OAuth consent for plain \`/mcp\` also warns humans.
- **Non-production (local / tunnels):** Plain \`/mcp\` may mutate freestyle when MCP write is on — no role connector and no \`agent_session_id\` gate. Caps and MCP write still apply. Optional \`agent_session\` still helps staff event trails (otherwise writes show as Unscoped).
- **MCP write off** (Security → Users → Allow using MCP to WRITE data): \`action_required: mcp_write_disabled\` + \`mcp_write_guide.course_of_action\` on bootstrap / \`get_current_user\` / direct mutates. Propose-only (\`propose_change\` / author \`update_proposal\`) remains. Ask a user admin to enable write.
- On a **role connector** (any environment): call \`agent_session\` \`start\` with exact \`model\` as \`provider/model\` (e.g. \`claude/sonnet-4.5\` or \`xai/grok-4\`). Family-only labels like \`claude\` fail. There is no \`MCP_AGENT_MODEL\` env.
- Every mutating tool on a role connector requires \`agent_session_id\` from that start (no unscoped writes). Sessions are per site; scope is username + role + OAuth client.
- If an open session already exists for that scope: \`action_required: session_conflict\` — retry with \`resume:true\` (same model) or \`force_new:true\` + report (abandon). Idle 24h fully expires a session.
- Staff path: Private → MCP Server → Connection → choose one or more roles → reconnect.
- Ownership / four-eyes = username + role (not model). Exact model is stored for staff observability.

## Session order

1. Call \`bootstrap_agent\` once near the start of the run (empty args on first call; pass \`site\` when multi-site so conventions brand correctly).
2. Call \`agent_session\` with \`action: "start"\` + exact \`model\` — keep \`agent_session_id\`.
3. On every content mutate, pass \`agent_session_id\`, \`why\` (plain English goal), and \`highlights\` when touching big fields (sections, link lists, long text). Server fills simple field values (meta.title, seo.*) for staff. Issue \`complete\` also needs \`why\` + \`highlights\`. Claim/note/summarize still use string \`report\` (min 80).
4. Prefer one \`agent_session\` \`summarize\` at the end.

## Envelopes

Honor \`warnings\`, \`side_effects\`, and \`next_actions\`. \`next_actions[].tool\` must be a real registered MCP tool — never invent tools.
Optional \`discovery_path\` (when present) is a research menu to deepen judgment before a consequential step — not \`next_actions\`, not a gate; skip is allowed.

## Multi-site and layout

- Call \`list_sites\` if unsure; always pass \`site\` (domain from sites.yml). Never assume the first site.
- Shared layout: use \`layout_target\` / confirm gates; MCP does not auto-fan-out locales.

## Products and positioning

- Vague “what is this site / brand about?” → \`list_products\` then \`get_product\` on relevant slugs (offer + personas).
- Change audience (offer/personas) → \`create_or_update_product\` with \`confirm: true\` (needs content_edit_structure).
- Make sellable / remove / pause → \`create_or_update_product\` with purchasable / actively_selling (needs product_manage). Prefer discovery_path on preview; ask the user when who-it's-for is unknown; compare peer products via list_products / get_product.
- Journey membership → \`get_product_funnel\`; journey page KPIs → \`get_product_funnel_analytics\`. Site-wide GA4 → \`get_analytics_report\` (\`metrics_view\`; topic \`analytics\`). GSC → \`get_organic_traffic\`.

## Depth and stale tools

- Architecture deep-dives → \`explain_site\` topics (overview includes a live products table).
- Missing / idle / wrong-scope \`agent_session_id\` → mutate denied (\`session_required\` / \`session_unknown\`) — start again.
- If tools look missing/stale after a deploy, ask the human to reconnect the MCP connector — agents cannot refresh tools/list mid-session.
`;

export function conventionsFilePath(
  cwd: string = process.cwd(),
): string {
  return path.join(cwd, "mcp-server", "agent-conventions.md");
}

export function loadConventionsMarkdown(cwd: string = process.cwd()): string {
  const filePath = conventionsFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return `_Missing ${CONVENTIONS_PATH} — ask a human to restore the conventions file._`;
  }
  return fs.readFileSync(filePath, "utf-8");
}

/** Content-addressed suffix so disk edits without version bump still invalidate known_skill_version. */
export function conventionsContentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 12);
}

export function resolveSkillVersion(content: string): string {
  return `${CONVENTIONS_VERSION}+${conventionsContentHash(content)}`;
}

export function shouldIncludeSkillContent(opts: {
  include_skill_content?: boolean;
  known_skill_version?: string;
  skillVersion: string;
}): boolean {
  const include = opts.include_skill_content !== false;
  if (!include) return false;
  const known = typeof opts.known_skill_version === "string" ? opts.known_skill_version.trim() : "";
  if (known && known === opts.skillVersion) return false;
  return true;
}
