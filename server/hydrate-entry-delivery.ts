/**
 * Entry delivery hydration: relations, then live_request (+ CT function re-run).
 * Call this on get/SSR paths — not resolveRelationsOnEntry alone when live fields matter.
 */

import {
  resolveRelationsOnEntry,
  type ResolveRelationsOptions,
} from "./resolve-relations";
import { resolveLiveRequestsOnEntry } from "./live-request";

/**
 * Hydrate an entry bag for page/API delivery:
 * 1. `editor.type: relation`
 * 2. `editor.type: live_request` (then re-run CT `function:` mappings)
 */
export async function hydrateEntryForDelivery(
  contentType: string,
  entry: Record<string, unknown>,
  opts: ResolveRelationsOptions = {},
): Promise<Record<string, unknown>> {
  const withRelations = await resolveRelationsOnEntry(contentType, entry, opts);
  const withLive = await resolveLiveRequestsOnEntry(contentType, withRelations, {
    contentRoot: opts.contentRoot,
  });
  return (withLive && typeof withLive === "object" ? withLive : withRelations) as Record<
    string,
    unknown
  >;
}
