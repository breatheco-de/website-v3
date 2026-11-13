/**
 * Migration 014: landing Locations become a link to the location content type, and known
 * wrong location names on landing pages and forms are fixed. Edits are surgical (only the
 * wrong lines change) and pushed to the content repo. See scripts/migrations/014_fix_landing_locations.ts.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { ContentTypeConfigUpdate, ContentTypeEntry } from "./content-types";

const LANDING_TYPE = "landing";
const LOCATIONS_FIELD = "locations";

/** Wrong name → real location slug (only applied when the real slug exists on the site). */
export const LOCATION_RENAMES: Record<string, string> = {
  "barcelona-espana": "barcelona-spain",
  "ciudad-de-mexico": "mexicocity-mexico",
  "downtown-miami": "miami-usa",
};

export const LOCATIONS_RELATION_HINT = {
  type: "relation",
  source: "location",
  value: "slug",
  label: "Locations",
  multiple: true,
  description: "Locations this campaign landing page targets. Forms on the page use them unless a form sets its own.",
} as const;

/** New editor hint for the landing Locations field, or null when it is already a location link. */
export function planLocationsHint(entry: ContentTypeEntry | null | undefined): ContentTypeConfigUpdate | null {
  if (!entry?.editor) return null;
  const hint = entry.editor[LOCATIONS_FIELD] as { type?: string; source?: string } | undefined;
  if (!hint) return null;
  if (hint.type === "relation" && hint.source === "location") return null;
  return { editor: { ...entry.editor, [LOCATIONS_FIELD]: { ...LOCATIONS_RELATION_HINT } } as ContentTypeEntry["editor"] };
}

/** `- wrong-slug` list items under the top-level `locations:` key, renamed in place. */
export function renameLocationListText(raw: string, known: Set<string>): { text: string; renamed: Array<[string, string]> } {
  const lines = raw.split("\n");
  const renamed: Array<[string, string]> = [];
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^locations:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (inList && /^\S/.test(line)) inList = false;
    if (!inList) continue;
    const m = line.match(/^(\s*-\s*)(["']?)([A-Za-z0-9_-]+)\2(\s*)$/);
    if (!m) continue;
    const to = LOCATION_RENAMES[m[3]!];
    if (to && known.has(to)) {
      lines[i] = `${m[1]}${m[2]}${to}${m[2]}${m[4]}`;
      renamed.push([m[3]!, to]);
    }
  }
  return { text: lines.join("\n"), renamed };
}

/** `default: wrong-slug` inside a form's `location:` field block, renamed in place. */
export function renameFormLocationDefaultText(
  raw: string,
  known: Set<string>,
): { text: string; renamed: Array<[string, string]> } {
  const lines = raw.split("\n");
  const renamed: Array<[string, string]> = [];
  let locationIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    if (/^\s+location:\s*$/.test(line)) {
      locationIndent = indent;
      continue;
    }
    if (locationIndent !== null && line.trim() && indent <= locationIndent) locationIndent = null;
    if (locationIndent === null) continue;
    const m = line.match(/^(\s+default:\s*)(["']?)([A-Za-z0-9_-]+)\2(\s*)$/);
    if (!m) continue;
    const to = LOCATION_RENAMES[m[3]!];
    if (to && known.has(to)) {
      lines[i] = `${m[1]}${m[2]}${to}${m[2]}${m[4]}`;
      renamed.push([m[3]!, to]);
    }
  }
  return { text: lines.join("\n"), renamed };
}

/** Page location values that are still not real locations (reported, not changed). */
export function remainingUnknownLocations(raw: string, known: Set<string>): string[] {
  try {
    const data = yaml.load(raw) as Record<string, unknown> | null;
    const list = data?.[LOCATIONS_FIELD];
    if (!Array.isArray(list)) return [];
    return list.filter((v): v is string => typeof v === "string" && !known.has(v));
  } catch {
    return [];
  }
}

type Log = (...args: unknown[]) => void;

export type LandingLocationsDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (absFile: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
  contentType: (root: string) => ContentTypeEntry | null;
  updateContentType: (root: string, update: ContentTypeConfigUpdate) => void;
  folder: (root: string, type: string) => string | null;
  knownLocations: (root: string) => Set<string>;
};

async function defaultDeps(): Promise<LandingLocationsDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  const { getContentTypeConfig, updateContentTypeConfig, getFolder } = await import("./content-types");
  const { locationNameIndex } = await import("./location-catalog");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (absFile, contentRoot) => {
      markFileAsModified(absFile, "migration:014", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
    contentType: (root) => (getContentTypeConfig(LANDING_TYPE, root) as ContentTypeEntry | undefined) ?? null,
    updateContentType: (root, update) => updateContentTypeConfig(LANDING_TYPE, update, root),
    folder: (root, type) => {
      try {
        return getFolder(type, root);
      } catch {
        return null;
      }
    },
    knownLocations: (root) => locationNameIndex(root).known,
  };
}

export async function runLandingLocationsMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: LandingLocationsDeps;
}): Promise<{ failed: boolean; changed: number }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  const rootOf = (contentRoot: string) => (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot));
  let failed = false;
  let matched = false;
  let changed = 0;

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const root = rootOf(s.contentRoot);
    const entry = deps.contentType(root);
    const landingFolder = entry ? deps.folder(root, LANDING_TYPE) : null;
    const known = deps.knownLocations(root);
    if (!entry || !landingFolder || known.size === 0) {
      log("skip", "no landing content type or no locations on this site");
      continue;
    }

    const files: string[] = [];
    const repoContentTypes = `${s.name}/content-types.yml`;
    const pending = deps.pending(s.name).filter(
      (f) => f === repoContentTypes || f.startsWith(`${s.name}/${landingFolder}/`),
    );

    const hintPlan = planLocationsHint(entry);
    if (hintPlan) {
      changed += 1;
      log("content_type", `${repoContentTypes}: ${LANDING_TYPE}.editor.${LOCATIONS_FIELD} → link to location`);
      if (!opts.dryRun) {
        deps.updateContentType(root, hintPlan);
        deps.markModified(path.join(root, "content-types.yml"), s.contentRoot);
        files.push(repoContentTypes);
      }
    }

    const landingDir = path.join(root, landingFolder);
    const pages = fs.existsSync(landingDir)
      ? fs.readdirSync(landingDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      : [];
    for (const page of pages) {
      const dir = path.join(landingDir, page.name);
      for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
        const abs = path.join(dir, file);
        const raw = fs.readFileSync(abs, "utf-8");
        const isCommon = /^_common\.ya?ml$/.test(file);
        const res = isCommon ? renameLocationListText(raw, known) : renameFormLocationDefaultText(raw, known);
        const repoPath = `${s.name}/${landingFolder}/${page.name}/${file}`;
        if (res.renamed.length > 0) {
          changed += 1;
          log("fix", repoPath, res.renamed.map(([a, b]) => `${a} → ${b}`).join(", "));
          if (!opts.dryRun) {
            fs.writeFileSync(abs, res.text, "utf-8");
            deps.markModified(abs, s.contentRoot);
            files.push(repoPath);
          }
        }
        if (isCommon) {
          const left = remainingUnknownLocations(res.text, known);
          if (left.length) log("still_unknown", repoPath, left.join(", "), "(fix by hand in Page Meta → Fields)");
        }
      }
    }

    for (const f of pending) if (!files.includes(f)) files.push(f);
    if (pending.length) log("recovery", "pushing files left by an interrupted run", pending);
    if (opts.dryRun || files.length === 0) {
      if (!opts.dryRun) log("nothing_to_do");
      continue;
    }
    const res = await deps.push(
      s.name,
      files,
      "Landings: Locations links to the location content type; fix wrong location names",
    );
    if (!res.success || !res.commitHash) {
      error("push_failed", res.error ?? "no commit SHA returned");
      error("files", files);
      failed = true;
      continue;
    }
    log("commitSha", res.commitHash);
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed, changed };
}
