export const ROBOTS_CHANGE_ON_PUBLISH_CODE = "robots_change_on_publish";

/** Answer to `robots_change_on_publish`: keep this language's live robots, or publish the draft's. */
export type RobotsOnPublish = "keep_live" | "use_draft";

export function parseRobotsOnPublish(v: unknown): RobotsOnPublish | undefined {
  return v === "keep_live" || v === "use_draft" ? v : undefined;
}

/** "" for the default (index, follow); otherwise a lowercased, comma-normalized directive. */
export function normalizeRobotsValue(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim().toLowerCase().replace(/\s*,\s*/g, ", ");
  return s === "index, follow" || s === "all" ? "" : s;
}

export function robotsLabel(normalized: string): string {
  return normalized || "index, follow";
}
