/**
 * Git commit message attribution for staff UI vs MCP agents.
 * Auto-sync commits keep the staff email in [Auto-sync] for token resolution;
 * MCP writes add a leading [Author: agent-label] prefix (e.g. claude, cursor).
 */

export type GitCommitActor = {
  type: "ui" | "mcp" | "system";
  client?: string;
  model?: string;
  source?: string;
};

function normalizeModelLabel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gpt") || lower.includes("openai")) return "gpt";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("composer")) return "composer";
  const short = model.split(/[-/@]/)[0]?.trim() ?? model;
  return short.length > 24 ? short.slice(0, 24) : short;
}

function normalizeClientLabel(client: string): string {
  const c = client.toLowerCase();
  if (c.includes("claude")) return "claude";
  if (c.includes("cursor")) return "cursor";
  if (c.includes("chatgpt") || c.includes("openai")) return "gpt";
  return client.replace(/\s+/g, "-").toLowerCase().slice(0, 32);
}

/** Short agent label for [Author: …] from MCP/system actor provenance. */
export function formatAgentAuthorLabel(actor: GitCommitActor | undefined): string | undefined {
  if (!actor) return undefined;
  if (actor.type === "mcp") {
    if (actor.model) return normalizeModelLabel(actor.model);
    if (actor.client) return normalizeClientLabel(actor.client);
    return "mcp";
  }
  if (actor.type === "system" && actor.source) {
    const src = actor.source.trim();
    if (src === "agent" || src.includes("agent")) return "agent";
    return normalizeClientLabel(src);
  }
  return undefined;
}

/** Build auto-commit message; optional agentLabel adds a leading [Author: …] prefix. */
export function formatAutoSyncCommitMessage(
  author: string,
  fileNames: string,
  agentLabel?: string,
): string {
  const autoSync = `[Auto-sync] ${author} updated ${fileNames}`;
  const label = agentLabel?.trim();
  return label ? `[Author: ${label}] ${autoSync}` : autoSync;
}

/** Staff author from [Auto-sync] Author updated file — ignores leading [Author: agent] prefix. */
export function parseAutoSyncCommitAuthor(message: string): string | null {
  const match = message.match(/\[Auto-sync\]\s+(.+?)\s+updated\s+/);
  return match ? match[1].trim() : null;
}

/** First [Author: …] tag in a commit message (agent or legacy staff attribution). */
export function parseCommitAuthorTag(message: string): string | undefined {
  const match = message.match(/\[Author:\s*([^\]]+)\]/);
  return match ? match[1].trim() : undefined;
}
