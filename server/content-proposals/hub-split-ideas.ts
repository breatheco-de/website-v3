/**
 * Read-only lookup of hub-split ideas in flight, for the HUB_OVERLOADED diagnostic.
 * Kept out of service.ts so validators do not load the whole proposal service.
 */

import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { parseIdeaSeoTarget } from "./idea-seo-target";

export type OpenHubSplitIdea = {
  id: string;
  title: string;
  status: string;
  /** Members (contentType/slug) of this idea that currently sit in the hub being checked. */
  members: string[];
};

/**
 * Hub-mode ideas still in flight (open, or accepted with no finished implementing edit) whose
 * members include pages listed in `hubMemberKeys` (contentType/slug of the hub's current members).
 */
export function listOpenHubSplitIdeas(site: string, hubMemberKeys: string[]): OpenHubSplitIdea[] {
  const want = new Set(hubMemberKeys);
  if (!want.size) return [];
  let rows: Array<{ id: string; title: string; status: string; idea_seo_target_json: string }> = [];
  try {
    ensurePipelineDb(site);
    rows = getSiteSqlite(site)
      .prepare(
        `SELECT p.id, p.title, p.status, p.idea_seo_target_json FROM content_proposals p
         WHERE p.site = ? AND p.kind = 'idea' AND p.idea_seo_target_json IS NOT NULL
           AND (p.status = 'open' OR (p.close_reason = 'accepted' AND NOT EXISTS (
             SELECT 1 FROM content_proposals c
             WHERE c.implements_proposal_id = p.id AND c.status = 'finished'
           )))
         ORDER BY p.created_at`,
      )
      .all(site) as typeof rows;
  } catch {
    return [];
  }
  const out: OpenHubSplitIdea[] = [];
  for (const row of rows) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(row.idea_seo_target_json);
    } catch {
      continue;
    }
    const target = parseIdeaSeoTarget(raw);
    if (!target || target.cluster.mode !== "hub") continue;
    const members = target.cluster.members
      .map((m) => `${m.contentType}/${m.slug}`)
      .filter((k) => want.has(k));
    if (members.length) out.push({ id: row.id, title: row.title, status: row.status, members });
  }
  return out;
}
