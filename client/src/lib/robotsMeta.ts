/** Robots values that mean the default (index, follow). */
const DEFAULT_ROBOTS_ALIASES = new Set(["", "index, follow", "index,follow", "all"]);

export const EXPLICIT_INDEX_ROBOTS = "index, follow";

/** Collapse equivalent spellings of the default to "" so the form shows the default radio. */
export function normalizeRobotsForForm(robots: string | null | undefined): string {
  const raw = (robots ?? "").trim();
  return DEFAULT_ROBOTS_ALIASES.has(raw.toLowerCase().replace(/\s+/g, " ")) ? "" : raw;
}

export function robotsHasNoindex(robots: string | null | undefined): boolean {
  return (robots ?? "").toLowerCase().includes("noindex");
}
