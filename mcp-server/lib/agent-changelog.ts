/**
 * Load and filter mcp-server/agent-changelog.yml for get_agent_changelog.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

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
      "Call near the start of a content/MCP session, or when agent-facing behavior looks wrong.",
      "Use entries[].agent_impact for dense facts; call explain_site / get_content_type_info for deeper playbooks.",
      ...(anyToolsChanged
        ? ["Recent entries changed tools — consider asking the human to refresh the MCP connector."]
        : []),
    ],
    tool_list_refresh_recommendation: TOOL_LIST_REFRESH_RECOMMENDATION,
  };
}
