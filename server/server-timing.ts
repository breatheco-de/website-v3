/**
 * `Server-Timing` for HTML documents. Each mark records the time since the previous
 * mark (or the request start), so the steps add up to `total`. Durations and generic
 * step names only; the header is public.
 */

import type { Response } from "express";

type TimingState = { start: number; last: number; steps: Array<[string, number]> };

function stateOf(res: Response): TimingState | undefined {
  return (res.locals as { serverTiming?: TimingState }).serverTiming;
}

export function startServerTiming(res: Response, now = performance.now()): void {
  (res.locals as { serverTiming?: TimingState }).serverTiming = { start: now, last: now, steps: [] };
}

/** Close the step that ends now. No-op when timing was not started for this response. */
export function markTiming(res: Response, name: string, now = performance.now()): void {
  const state = stateOf(res);
  if (!state) return;
  state.steps.push([name, now - state.last]);
  state.last = now;
}

export function hasTimingSteps(res: Response): boolean {
  return (stateOf(res)?.steps.length ?? 0) > 0;
}

/** Header value with every closed step plus `total`. Null when timing was not started. */
export function serverTimingHeader(res: Response, now = performance.now()): string | null {
  const state = stateOf(res);
  if (!state) return null;
  const parts = state.steps.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`);
  parts.push(`total;dur=${(now - state.start).toFixed(1)}`);
  return parts.join(", ");
}

/** Set the header before the body is sent. Sending itself cannot be timed. */
export function applyServerTiming(res: Response): void {
  if (res.headersSent) return;
  const header = serverTimingHeader(res);
  if (header) res.setHeader("Server-Timing", header);
}
