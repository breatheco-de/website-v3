import { emitContentFileWritten } from "../../server/content-events.js";
import type { EventActor } from "../../server/events/types.js";

/** Notify the event pipeline after MCP writes YAML to disk. */
export function notifyMcpContentWrite(
  filePath: string,
  author?: string,
  opts?: { agent_session_id?: string; report?: string; actor?: EventActor },
): number | null {
  const event = emitContentFileWritten(filePath, {
    author: author ?? "mcp",
    actor: opts?.actor ?? { type: "mcp" },
    agent_session_id: opts?.agent_session_id,
    report: opts?.report,
  });
  return event?.id ?? null;
}
