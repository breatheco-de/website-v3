/**
 * Data migration 004: move the `ads:` block from settings.yml to ads-config.yml (per site).
 * The block is moved as text (comments and formatting kept), and both results are checked by
 * parsing them again before anything is written. Nothing changes in Meta or Google.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { isDeepStrictEqual } from "util";
import { ADS_CONFIG_FILENAME } from "./ads-config";

type Log = (...args: unknown[]) => void;

/** Top-level `key:` block (until the next top-level key) and the text without it. */
export function extractTopLevelBlock(text: string, key: string): { block: string | null; rest: string } {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*(#.*)?$`).test(l));
  if (start < 0) return { block: null, rest: text };
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end]!;
    if (l.trim() === "" || /^\s/.test(l)) {
      end++;
      continue;
    }
    if (l.startsWith("#")) {
      // A top-level comment belongs to the next key unless more block lines follow it.
      let j = end;
      while (j < lines.length && lines[j]!.startsWith("#")) j++;
      if (j < lines.length && /^\s+\S/.test(lines[j]!)) {
        end = j;
        continue;
      }
    }
    break;
  }
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim() !== "").map((l) => l.match(/^(\s*)/)![1]!.length));
  const block = body.map((l) => (l.trim() === "" ? "" : l.slice(Number.isFinite(indent) ? indent : 0))).join("\n");
  const rest = [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  return { block: block.trim() === "" ? "" : `${block.replace(/\s+$/, "")}\n`, rest };
}

export type AdsConfigMigrationPlan =
  | { action: "nothing"; reason: string }
  | { action: "recover"; files: string[] }
  | { action: "move"; adsConfigText: string; settingsText: string }
  | { action: "drop_leftover"; differed: boolean; settingsText: string }
  | { action: "blocked"; reason: string };

function parse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: yaml.load(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
}

/**
 * Pure: what the migration does for one site. `pending` = local files not pushed yet
 * (`<contentFolder>/settings.yml`, `<contentFolder>/ads-config.yml`).
 */
export function planAdsConfigMigration(input: {
  settingsText: string | null;
  adsConfigText: string | null;
  pending: string[];
  contentFolder: string;
}): AdsConfigMigrationPlan {
  const settingsFile = `${input.contentFolder}/settings.yml`;
  const adsFile = `${input.contentFolder}/${ADS_CONFIG_FILENAME}`;
  if (input.settingsText == null) return { action: "nothing", reason: "settings.yml not found" };
  const settings = parse(input.settingsText);
  if (!settings.ok) return { action: "blocked", reason: `settings.yml can't be read (${settings.error})` };
  const settingsObj = (settings.value ?? {}) as Record<string, unknown>;
  const hasLegacy = settingsObj.ads != null && typeof settingsObj.ads === "object";

  if (!hasLegacy) {
    const recover = input.adsConfigText != null ? [adsFile, settingsFile].filter((f) => input.pending.includes(f)) : [];
    if (recover.length > 0) return { action: "recover", files: recover };
    return { action: "nothing", reason: input.adsConfigText != null ? "already moved" : "no ads settings on this site" };
  }

  const { block, rest } = extractTopLevelBlock(input.settingsText, "ads");
  if (block == null) return { action: "blocked", reason: "the ads: block in settings.yml isn't a plain top-level block; move it by hand" };
  const restParsed = parse(rest);
  const { ads: _ads, ...expectedRest } = settingsObj;
  if (!restParsed.ok || !isDeepStrictEqual(restParsed.value ?? {}, expectedRest)) {
    return { action: "blocked", reason: "removing the ads: block would change other settings; move it by hand" };
  }

  if (input.adsConfigText != null) {
    const current = parse(input.adsConfigText);
    if (!current.ok) return { action: "blocked", reason: `${ADS_CONFIG_FILENAME} can't be read (${current.error}); fix it before removing the old block` };
    return { action: "drop_leftover", differed: !isDeepStrictEqual(current.value ?? {}, settingsObj.ads), settingsText: rest };
  }

  const moved = parse(block);
  if (!moved.ok || !isDeepStrictEqual(moved.value ?? {}, settingsObj.ads)) {
    const dumped = yaml.dump(settingsObj.ads, { lineWidth: 120, noRefs: true, sortKeys: false });
    return { action: "move", adsConfigText: dumped, settingsText: rest };
  }
  return { action: "move", adsConfigText: block, settingsText: rest };
}

export type AdsConfigMigrationDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (file: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
};

async function defaultDeps(): Promise<AdsConfigMigrationDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (file, contentRoot) => {
      markFileAsModified(file, "migration:004", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
  };
}

export async function runAdsConfigMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: AdsConfigMigrationDeps;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  let failed = false;
  let matched = false;

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const root = path.isAbsolute(s.contentRoot) ? s.contentRoot : path.join(process.cwd(), s.contentRoot);
    const settingsPath = path.join(root, "settings.yml");
    const adsPath = path.join(root, ADS_CONFIG_FILENAME);
    const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : null);
    const settingsFile = `${s.name}/settings.yml`;
    const adsFile = `${s.name}/${ADS_CONFIG_FILENAME}`;
    const plan = planAdsConfigMigration({ settingsText: read(settingsPath), adsConfigText: read(adsPath), pending: deps.pending(s.name), contentFolder: s.name });

    const push = async (files: string[], message: string): Promise<boolean> => {
      const res = await deps.push(s.name, files, message);
      if (!res.success || !res.commitHash) {
        error("push_failed", res.error ?? "no commit SHA returned");
        error("files", files);
        return false;
      }
      log("commitSha", res.commitHash);
      return true;
    };

    switch (plan.action) {
      case "nothing":
        log("nothing_to_do", plan.reason);
        break;
      case "blocked":
        error("blocked", plan.reason);
        failed = true;
        break;
      case "recover":
        log("recovery", "the move already happened; pushing files still pending", plan.files);
        if (!opts.dryRun && !(await push(plan.files, "Move ads settings to ads-config.yml (push files left by an interrupted run)"))) failed = true;
        break;
      case "move":
        log("move", `copy the ads: block from settings.yml to ${ADS_CONFIG_FILENAME}, then remove it from settings.yml`);
        if (opts.dryRun) break;
        fs.writeFileSync(adsPath, plan.adsConfigText, "utf-8");
        fs.writeFileSync(settingsPath, plan.settingsText, "utf-8");
        deps.markModified(ADS_CONFIG_FILENAME, s.contentRoot);
        deps.markModified("settings.yml", s.contentRoot);
        if (!(await push([adsFile, settingsFile], "Move ads settings from settings.yml to ads-config.yml"))) failed = true;
        break;
      case "drop_leftover":
        log(
          "drop_leftover",
          `${ADS_CONFIG_FILENAME} already exists and wins; removing the old ads: block from settings.yml`,
          plan.differed ? "(the old block differed from ads-config.yml; its values are discarded)" : "(the old block matched ads-config.yml)",
        );
        if (opts.dryRun) break;
        fs.writeFileSync(settingsPath, plan.settingsText, "utf-8");
        deps.markModified("settings.yml", s.contentRoot);
        if (!(await push([settingsFile], "Remove the old ads: block from settings.yml (ads-config.yml wins)"))) failed = true;
        break;
    }
  }
  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed };
}
