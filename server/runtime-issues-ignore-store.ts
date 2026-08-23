/**
 * Per-site staff ignore rules for runtime 404 digestion.
 * Separate file from the 404 log so Reset and last-write-wins counts cannot wipe rules.
 */

import * as fs from "fs";
import * as path from "path";
import {
  SYNC_FILENAMES,
  runtimeIssuesIgnoreReadKeys,
  siteSyncGcsKey,
} from "@shared/gcsKeys";
import {
  emptyIgnoreState,
  hydrateIgnoreRule,
  ignoreRuleIdentity,
  ignoreStateSchema,
  pathMatchesAnyIgnoreRule,
  validateIgnoreRuleInput,
  BUILTIN_IGNORE_RULE_INPUTS,
  type IgnoreRule,
  type IgnoreRuleInput,
  type IgnoreState,
} from "@shared/runtime-issues-ignore";
import { gcs } from "./gcs";
import { child } from "./logger";

const log = child({ module: "runtime-issues-ignore" });
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEBOUNCE_MS = 5_000;

type SiteBucket = {
  state: IgnoreState;
  loaded: boolean;
  contentRoot?: string;
};

const bySite = new Map<string, SiteBucket>();

function localPathForSite(site: string, contentRoot?: string): string {
  if (contentRoot) {
    return path.join(contentRoot, `.${SYNC_FILENAMES.runtimeIssuesIgnore}`);
  }
  return path.join(process.cwd(), "data", "runtime-issues-ignore", `${site}.json`);
}

function gcsKey(site: string): string {
  return siteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesIgnore);
}

function ensureBuiltinIgnoreRules(state: IgnoreState): IgnoreState {
  const existing = new Set(state.rules.map(ignoreRuleIdentity));
  const added: IgnoreRule[] = [];
  for (const input of BUILTIN_IGNORE_RULE_INPUTS) {
    const identity = ignoreRuleIdentity(input);
    if (existing.has(identity)) continue;
    const rule = validateIgnoreRuleInput(input);
    if (!rule) continue;
    existing.add(identity);
    added.push(rule);
  }
  if (!added.length) return state;
  return {
    ...state,
    updatedAt: Date.now(),
    rules: [...state.rules, ...added],
  };
}

function ensureBucket(site: string, contentRoot?: string): SiteBucket {
  let b = bySite.get(site);
  if (!b) {
    b = { state: emptyIgnoreState(), loaded: false, contentRoot };
    bySite.set(site, b);
  } else if (contentRoot && !b.contentRoot) {
    b.contentRoot = contentRoot;
  }
  return b;
}

function saveLocal(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  try {
    const file = localPathForSite(site, b.contentRoot);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(b.state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err, site }, "failed to save local runtime-issues-ignore");
  }
}

function saveToBucket(site: string): void {
  if (!IS_PRODUCTION || !gcs.available) return;
  const b = bySite.get(site);
  if (!b) return;
  try {
    const content = JSON.stringify(b.state, null, 2);
    gcs.debouncedUpload(gcsKey(site), Buffer.from(content, "utf-8"), "application/json", DEBOUNCE_MS);
  } catch (err) {
    log.error({ err, site }, "failed to schedule GCS upload for runtime-issues-ignore");
  }
}

function save(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  b.state.updatedAt = Date.now();
  saveLocal(site);
  saveToBucket(site);
}

function loadLocalInto(site: string, contentRoot?: string): IgnoreState {
  try {
    const file = localPathForSite(site, contentRoot);
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      const parsed = ignoreStateSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
  } catch (err) {
    log.error({ err, site }, "failed to load local runtime-issues-ignore");
  }
  return emptyIgnoreState();
}

function ensureLoadedSync(site: string, contentRoot?: string): SiteBucket {
  const b = ensureBucket(site, contentRoot);
  if (!b.loaded) {
    b.state = ensureBuiltinIgnoreRules(loadLocalInto(site, contentRoot));
    b.loaded = true;
    saveLocal(site);
  }
  return b;
}

export async function loadRuntimeIssuesIgnoreForSite(
  site: string,
  contentRoot?: string,
): Promise<void> {
  const b = ensureBucket(site, contentRoot);

  if (!IS_PRODUCTION || !gcs.available) {
    b.state = ensureBuiltinIgnoreRules(loadLocalInto(site, contentRoot));
    b.loaded = true;
    saveLocal(site);
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(runtimeIssuesIgnoreReadKeys(site));
    if (result) {
      const parsed = ignoreStateSchema.safeParse(JSON.parse(result.data.toString("utf-8")));
      b.state = ensureBuiltinIgnoreRules(parsed.success ? parsed.data : emptyIgnoreState());
      saveLocal(site);
      log.info({ site }, "loaded runtime-issues-ignore from GCS");
    } else {
      b.state = ensureBuiltinIgnoreRules(loadLocalInto(site, contentRoot));
      log.info({ site }, "no runtime-issues-ignore in GCS — using local");
    }
  } catch (err) {
    log.error({ err, site }, "GCS load failed for runtime-issues-ignore");
    b.state = ensureBuiltinIgnoreRules(loadLocalInto(site, contentRoot));
  }
  b.loaded = true;
  saveLocal(site);
}

export async function loadAllRuntimeIssuesIgnoreFromBucket(
  sites: Array<{ site: string; contentRoot: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => loadRuntimeIssuesIgnoreForSite(s.site, s.contentRoot)));
}

export function listIgnoreRules(site: string, contentRoot?: string): IgnoreRule[] {
  return [...ensureLoadedSync(site, contentRoot).state.rules];
}

export function isPathIgnored(site: string, path: string, contentRoot?: string): boolean {
  const b = ensureLoadedSync(site, contentRoot);
  return pathMatchesAnyIgnoreRule(path, b.state.rules);
}

export function addIgnoreRules(
  site: string,
  inputs: IgnoreRuleInput[],
  opts?: { contentRoot?: string; seedPaths?: string[] },
): { ignored: IgnoreRule[]; added: IgnoreRule[] } {
  const b = ensureLoadedSync(site, opts?.contentRoot);
  const existingIds = new Set(b.state.rules.map(ignoreRuleIdentity));
  const added: IgnoreRule[] = [];
  const seedPaths = opts?.seedPaths;

  for (const input of inputs) {
    const rule = validateIgnoreRuleInput(input);
    if (!rule) {
      throw new Error("Invalid ignore rule");
    }
    if (seedPaths?.length && !seedPaths.some((p) => pathMatchesAnyIgnoreRule(p, [rule]))) {
      throw new Error("Ignore rule does not match a selected path");
    }
    const identity = ignoreRuleIdentity(rule);
    if (existingIds.has(identity)) continue;
    existingIds.add(identity);
    const stored = hydrateIgnoreRule(input);
    added.push(stored);
  }

  if (added.length) {
    b.state.rules = [...b.state.rules, ...added];
    save(site);
  }
  return { ignored: b.state.rules, added };
}

export function removeIgnoreRules(
  site: string,
  ids: string[],
  contentRoot?: string,
): { ignored: IgnoreRule[] } {
  const b = ensureLoadedSync(site, contentRoot);
  const idSet = new Set(ids);
  b.state.rules = b.state.rules.filter((r) => !idSet.has(r.id));
  save(site);
  return { ignored: b.state.rules };
}

export async function reuploadRuntimeIssuesIgnoreToBucket(
  site: string,
  contentRoot?: string,
): Promise<{ success: boolean; uploaded: boolean; gcsKey: string; reason?: string }> {
  const key = gcsKey(site);
  if (!IS_PRODUCTION) {
    return { success: false, uploaded: false, gcsKey: key, reason: "GCS sync only runs in production." };
  }
  if (!gcs.available) {
    return { success: false, uploaded: false, gcsKey: key, reason: "GCS is unavailable." };
  }
  const b = ensureLoadedSync(site, contentRoot);
  saveLocal(site);
  await gcs.upload(key, Buffer.from(JSON.stringify(b.state, null, 2), "utf-8"), "application/json");
  return { success: true, uploaded: true, gcsKey: key };
}

/** Test helper */
export function _resetRuntimeIssuesIgnoreForTests(): void {
  bySite.clear();
}
