/**
 * MCP tools that write content files from this process (not through the main server)
 * check the deploy write pause first. The main server owns the pause state.
 */

import { fail, type McpTextResult } from "./respond.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/** `site_updating` failure while a deploy pauses writes; null when writes are allowed (or the check fails). */
export async function writePausedResult(tool: string): Promise<McpTextResult | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/internal/content/write-pause`, {
      headers: MCP_SERVER_SECRET ? { Authorization: `Bearer ${MCP_SERVER_SECRET}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { paused?: boolean; retry_after_seconds?: number };
    if (!data.paused) return null;
    return fail("The site is updating. Nothing was written; retry this call after retry_after_seconds.", {
      code: "site_updating",
      retry_after_seconds: data.retry_after_seconds ?? 60,
      tool,
      warnings: [],
      next_actions: [],
    });
  } catch {
    return null;
  }
}
