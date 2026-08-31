/**
 * Load and filter mcp-server/agent-changelog.yml; build bootstrap_agent payload.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  CONVENTIONS_PATH,
  PLAYBOOK_MARKDOWN,
  PLAYBOOK_VERSION,
  SKILL_HINT,
  loadConventionsMarkdown,
  resolveSkillVersion,
  shouldIncludeSkillContent,
} from "./mcp-playbook.js";

export const AGENT_CHANGELOG_WINDOW_DAYS = 6;

export const TOOL_LIST_REFRESH_RECOMMENDATION =
  "This tool does not refresh the host MCP tool list. If tools look missing or stale after a deploy, ask the human to refresh/reconnect the MCP connector (Cursor: refresh MCP server; Claude custom connector: reconnect). tools/list does not update mid-session.";

export interface AgentChangelogEntry {
  date: string;
  summary: string;
  agent_impact?: string[];
  paths?: string[];
  tools_changed?: boolean;
}

export interface AgentChangelogPayload {
  generated_at: string;
  window_days: number;
  entries: AgentChangelogEntry[];
  session_guidance: string[];
  tool_list_refresh_recommendation: string;
}

export interface BootstrapSkillPayload {
  path: string;
  version: string;
  hint: string;
  content?: string;
}

export interface BootstrapPayload {
  generated_at: string;
  window_days: number;
  entries: AgentChangelogEntry[];
  playbook_version: string;
  playbook: string;
  skill: BootstrapSkillPayload;
  session_guidance: string[];
  tool_list_refresh_recommendation: string;
}

export type BootstrapPayloadOpts = {
  include_skill_content?: boolean;
  known_skill_version?: string;
  now?: Date;
  changelogFilePath?: string;
  cwd?: string;
};

function parseEntryDate(dateStr: string): Date | null {
  const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function filterChangelogEntries(
  entries: AgentChangelogEntry[],
  now: Date = new Date(),
  windowDays: number = AGENT_CHANGELOG_WINDOW_DAYS,
): AgentChangelogEntry[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => {
      const d = parseEntryDate(e.date);
      return d !== null && d.getTime() >= cutoff;
    })
    .sort((a, b) => {
      const da = parseEntryDate(a.date)?.getTime() ?? 0;
      const db = parseEntryDate(b.date)?.getTime() ?? 0;
      return db - da;
    });
}

export function loadAgentChangelogFile(
  filePath: string = path.join(process.cwd(), "mcp-server", "agent-changelog.yml"),
): { entries: AgentChangelogEntry[]; window_days: number } {
  if (!fs.existsSync(filePath)) {
    return { entries: [], window_days: AGENT_CHANGELOG_WINDOW_DAYS };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as {
    window_days?: number;
    entries?: AgentChangelogEntry[];
  } | null;
  const window_days =
    typeof parsed?.window_days === "number" && parsed.window_days > 0
      ? parsed.window_days
      : AGENT_CHANGELOG_WINDOW_DAYS;
  const entries = Array.isArray(parsed?.entries) ? parsed!.entries! : [];
  return { entries, window_days };
}

/** @deprecated Prefer buildBootstrapPayload — kept for unit tests of changelog filtering. */
export function buildAgentChangelogPayload(
  now: Date = new Date(),
  filePath?: string,
): AgentChangelogPayload {
  const { entries, window_days } = loadAgentChangelogFile(filePath);
  const filtered = filterChangelogEntries(entries, now, window_days);
  const anyToolsChanged = filtered.some((e) => e.tools_changed);
  return {
    generated_at: now.toISOString(),
    window_days,
    entries: filtered,
    session_guidance: [
      "Call bootstrap_agent near the start of a content/MCP session, or when agent-facing behavior looks wrong.",
      "Use entries[].agent_impact for dense facts; call explain_site / get_content_type_info for deeper playbooks.",
      ...(anyToolsChanged
        ? ["Recent entries changed tools — consider asking the human to refresh the MCP connector."]
        : []),
    ],
    tool_list_refresh_recommendation: TOOL_LIST_REFRESH_RECOMMENDATION,
  };
}

export function buildBootstrapPayload(opts: BootstrapPayloadOpts = {}): BootstrapPayload {
  const now = opts.now ?? new Date();
  const cwd = opts.cwd ?? process.cwd();
  const { entries, window_days } = loadAgentChangelogFile(
    opts.changelogFilePath ?? path.join(cwd, "mcp-server", "agent-changelog.yml"),
  );
  const filtered = filterChangelogEntries(entries, now, window_days);
  const anyToolsChanged = filtered.some((e) => e.tools_changed);
  const conventionsMd = loadConventionsMarkdown(cwd);
  const skillVersion = resolveSkillVersion(conventionsMd);
  const includeContent = shouldIncludeSkillContent({
    include_skill_content: opts.include_skill_content,
    known_skill_version: opts.known_skill_version,
    skillVersion,
  });

  const skill: BootstrapSkillPayload = {
    path: CONVENTIONS_PATH,
    version: skillVersion,
    hint: SKILL_HINT,
  };
  if (includeContent) {
    skill.content = conventionsMd;
  }

  return {
    generated_at: now.toISOString(),
    window_days,
    entries: filtered,
    playbook_version: PLAYBOOK_VERSION,
    playbook: PLAYBOOK_MARKDOWN,
    skill,
    session_guidance: [
      "Call bootstrap_agent once near the start of an MCP content run (Claude.ai, Grok, or any connector). First call: omit params (or include_skill_content: true).",
      "Treat skill.content (when present) as standing conversation conventions for this chat; follow them before/after writes when reporting to the human.",
      "Next: agent_session action start — pass agent_session_id + report (min 80) on mutates; prefer one summarize at end.",
      "On later bootstrap_agent calls in the same chat: include_skill_content: false and/or known_skill_version matching skill.version (changelog and playbook still returned).",
      "Use entries[].agent_impact for recent deltas; explain_site / get_content_type_info for deep architecture.",
      ...(anyToolsChanged
        ? ["Recent entries changed tools — ask the human to refresh/reconnect the MCP connector."]
        : []),
    ],
    tool_list_refresh_recommendation: TOOL_LIST_REFRESH_RECOMMENDATION,
  };
}
