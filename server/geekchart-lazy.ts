/**
 * Lazy loader for the geekchart server bundle. The bundle pulls in mermaid
 * and font measurement, which cost seconds to load; a top-level import makes
 * every module that reaches these routes pay that at load time (in CI it
 * added ~22s of test collection and starved unrelated tests past their
 * timeouts). Load it on the first actual chart render instead, once.
 */
let mod: Promise<typeof import("geekchart/server")> | null = null;

export function loadGeekchart(): Promise<typeof import("geekchart/server")> {
  return (mod ??= import("geekchart/server"));
}
