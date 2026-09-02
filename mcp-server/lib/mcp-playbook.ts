/**
 * Technical MCP playbook + conversation conventions loader for bootstrap_agent.
 * Conventions body is for non-coding agents (Claude.ai, Grok, etc.) — delivered in the tool response.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";

/** Bump when the technical playbook markdown below changes. */
export const PLAYBOOK_VERSION = "1";

/**
 * Explicit conventions seed version. Bump when editing mcp-server/agent-conventions.md
 * so agents re-fetch skill.content (known_skill_version mismatch).
 */
export const CONVENTIONS_VERSION = "2";

export const CONVENTIONS_PATH = "mcp-server/agent-conventions.md";

export const SKILL_HINT =
  "Treat skill.content as standing instructions for this connector run. " +
  "Check before and after Website MCP writes for how to report results to the human. " +
  "On later bootstrap_agent calls in the same chat, set include_skill_content: false " +
  "and/or pass known_skill_version from this response.";

export const PLAYBOOK_MARKDOWN = `# Website MCP — technical playbook

For remote chat agents (Claude.ai, Grok, custom connectors). Conversation style belongs in agent-conventions (skill.content); this playbook is protocol only.

## Session order

1. Call \`bootstrap_agent\` once near the start of the run (empty args on first call).
2. Call \`agent_session\` with \`action: "start"\` — keep \`agent_session_id\`.
3. On every content mutate, pass \`agent_session_id\` and \`report\` (min 80 chars; staff-readable plain values for copy you set — Title: …; not JSON/YAML dumps).
4. Prefer one \`agent_session\` \`summarize\` at the end.

## Envelopes

Honor \`warnings\`, \`side_effects\`, and \`next_actions\`. \`next_actions[].tool\` must be a real registered MCP tool — never invent tools.

## Multi-site and layout

- Call \`list_sites\` if unsure; always pass \`site\` (domain from sites.yml). Never assume the first site.
- Shared layout: use \`layout_target\` / confirm gates; MCP does not auto-fan-out locales.

## Depth and stale tools

- Architecture deep-dives → \`explain_site\` topics.
- Missing \`agent_session_id\` → soft Unscoped warning; write may still succeed.
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
