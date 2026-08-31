/**
 * AsyncLocalStorage for MCP content-write provenance (session + report + actor).
 * Set at the start of mutating handlers; markFileAsModified reads it automatically.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { EventActor } from "./events/types";

export type ContentWriteContext = {
  agentSessionId?: string;
  report?: string;
  actor?: EventActor;
};

const storage = new AsyncLocalStorage<ContentWriteContext>();

export function getContentWriteContext(): ContentWriteContext | undefined {
  return storage.getStore();
}

export function runWithContentWriteContextAsync<T>(
  ctx: ContentWriteContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function runWithContentWriteContext<T>(ctx: ContentWriteContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Bind context for the rest of the current async continuation (use after auth in long handlers). */
export function enterContentWriteContext(ctx: ContentWriteContext): void {
  storage.enterWith(ctx);
}
