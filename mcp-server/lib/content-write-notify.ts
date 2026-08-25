import { emitContentFileWritten } from "../../server/content-events.js";

/** Notify the event pipeline after MCP writes YAML to disk. */
export function notifyMcpContentWrite(filePath: string, author?: string): number | null {
  const event = emitContentFileWritten(filePath, { author: author ?? "mcp" });
  return event?.id ?? null;
}
