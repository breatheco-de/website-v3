/**
 * Per-site, per-environment A/B testing setup record: check token, hidden check page,
 * and the last check runs. Lives in data/<site>/ab-testing.json (persistent across deploys).
 * The check page itself lives in the site's content repo.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { getProjectRoot } from "@shared/paths";
import { getDirectory, isValidType } from "../content-types";

export type AbCheckStatus = "passed" | "failed" | "inconclusive";
export type AbCheckTrigger = "setup" | "deploy" | "manual" | "recovery";

export interface AbCheckItem {
  ok: boolean;
  detail?: string;
}

export interface AbCheckRun {
  at: string;
  trigger: AbCheckTrigger;
  deploy_sha: string | null;
  status: AbCheckStatus;
  url: string | null;
  requests: number;
  /** Visitors per version, e.g. { default: 208, b: 92 }. */
  observed: Record<string, number>;
  /** Target shares in percent, e.g. { default: 70, b: 30 }. */
  expected: Record<string, number>;
  p_value: number | null;
  checks: Record<string, AbCheckItem>;
  error?: string;
}

export interface AbCheckPageRef {
  contentType: string;
  slug: string;
  locale: string;
}

export interface AbTestingState {
  check_token: string | null;
  check_page: AbCheckPageRef | null;
  first_passed_at: string | null;
  runs: AbCheckRun[];
}

export const AB_CHECK_SLUG = "ab-check";
export const AB_CHECK_LOCALE = "en";
export const AB_CHECK_VARIANT = "b";
export const AB_CHECK_VARIANT_ALLOCATION = 30;
/** Marker in the check page's _common.yml. */
export const AB_CHECK_SYSTEM_MARKER = "ab_check";
export const AB_CHECK_CONTENT_TYPES = ["landing", "page"] as const;
const MAX_RUNS = 20;

let dataDirOverride: string | null = null;
const stateCache = new Map<string, AbTestingState>();

/** Tests: point state files at a temp dir. */
export function setAbTestingDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
  stateCache.clear();
  setUpCache?.clear();
}

function safeSiteName(contentRootName: string): string {
  return path.basename(contentRootName).replace(/[/\\]/g, "-");
}

export function abTestingStatePath(contentRootName: string): string {
  const base = dataDirOverride ?? path.join(getProjectRoot(), "data");
  return path.join(base, safeSiteName(contentRootName), "ab-testing.json");
}

function emptyState(): AbTestingState {
  return { check_token: null, check_page: null, first_passed_at: null, runs: [] };
}

export function readAbTestingState(contentRootName: string): AbTestingState {
  const key = safeSiteName(contentRootName);
  const cached = stateCache.get(key);
  if (cached) return cached;
  let state = emptyState();
  try {
    const file = abTestingStatePath(contentRootName);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<AbTestingState>;
      state = {
        check_token: typeof parsed.check_token === "string" ? parsed.check_token : null,
        check_page: parsed.check_page ?? null,
        first_passed_at: typeof parsed.first_passed_at === "string" ? parsed.first_passed_at : null,
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    }
  } catch {
    state = emptyState();
  }
  stateCache.set(key, state);
  return state;
}

export function writeAbTestingState(contentRootName: string, state: AbTestingState): void {
  const file = abTestingStatePath(contentRootName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  stateCache.set(safeSiteName(contentRootName), state);
  setUpCache.delete(safeSiteName(contentRootName));
}

/** Return the check token, creating one when missing (setup / recovery). */
export function ensureCheckToken(contentRootName: string): string {
  const state = readAbTestingState(contentRootName);
  if (state.check_token) return state.check_token;
  const token = crypto.randomBytes(24).toString("hex");
  writeAbTestingState(contentRootName, { ...state, check_token: token });
  return token;
}

export function verifyCheckToken(contentRootName: string, provided: string | undefined | null): boolean {
  if (!provided) return false;
  const token = readAbTestingState(contentRootName).check_token;
  if (!token) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function recordAbCheckRun(contentRootName: string, run: AbCheckRun): AbTestingState {
  const state = readAbTestingState(contentRootName);
  const next: AbTestingState = {
    ...state,
    first_passed_at: state.first_passed_at ?? (run.status === "passed" ? run.at : null),
    runs: [run, ...state.runs].slice(0, MAX_RUNS),
  };
  writeAbTestingState(contentRootName, next);
  return next;
}

export function setCheckPage(contentRootName: string, page: AbCheckPageRef): void {
  const state = readAbTestingState(contentRootName);
  writeAbTestingState(contentRootName, { ...state, check_page: page });
}

/** Most recent run, including inconclusive ones. */
export function latestRun(contentRootName: string): AbCheckRun | null {
  return readAbTestingState(contentRootName).runs[0] ?? null;
}

/** Most recent run that passed or failed (inconclusive runs never change the outcome). */
export function latestConclusiveRun(contentRootName: string): AbCheckRun | null {
  return readAbTestingState(contentRootName).runs.find((r) => r.status !== "inconclusive") ?? null;
}

function readCommonYml(dir: string): Record<string, unknown> | null {
  try {
    const file = path.join(dir, "_common.yml");
    if (!fs.existsSync(file)) return null;
    return (yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function entryDir(contentRoot: string, contentType: string, slug: string): string {
  return path.join(contentRoot, getDirectory(contentType, contentRoot), slug);
}

/** Content type the check page uses on this site: landing, else page. */
export function checkPageContentType(contentRoot: string): string | null {
  for (const t of AB_CHECK_CONTENT_TYPES) {
    if (isValidType(t, contentRoot)) return t;
  }
  return null;
}

/** Locate the check page in content by its system marker. */
export function findCheckPage(contentRoot: string): AbCheckPageRef | null {
  for (const contentType of AB_CHECK_CONTENT_TYPES) {
    if (!isValidType(contentType, contentRoot)) continue;
    const common = readCommonYml(entryDir(contentRoot, contentType, AB_CHECK_SLUG));
    if (common?.system === AB_CHECK_SYSTEM_MARKER) {
      return { contentType, slug: AB_CHECK_SLUG, locale: AB_CHECK_LOCALE };
    }
  }
  return null;
}

function checkPageFilesExist(contentRoot: string, page: AbCheckPageRef): boolean {
  const dir = entryDir(contentRoot, page.contentType, page.slug);
  return (
    fs.existsSync(path.join(dir, `${page.locale}.yml`)) &&
    fs.existsSync(path.join(dir, `${AB_CHECK_VARIANT}.${page.locale}.yml`)) &&
    fs.existsSync(path.join(dir, "versioning.yml"))
  );
}

/** True for the hidden A/B check page (locked system page). */
export function isAbCheckPage(contentType: string, slug: string, contentRoot: string): boolean {
  if (slug !== AB_CHECK_SLUG) return false;
  if (!(AB_CHECK_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    // Accept directory aliases (e.g. "landings").
    const match = AB_CHECK_CONTENT_TYPES.find(
      (t) => isValidType(t, contentRoot) && getDirectory(t, contentRoot) === contentType,
    );
    if (!match) return false;
    contentType = match;
  }
  if (!isValidType(contentType, contentRoot)) return false;
  return readCommonYml(entryDir(contentRoot, contentType, slug))?.system === AB_CHECK_SYSTEM_MARKER;
}

export const SYSTEM_PAGE_LOCKED_CODE = "system_page_locked";
export const SYSTEM_PAGE_LOCKED_MESSAGE =
  "This page is used by A/B testing setup and can't be changed. Only Settings → Tracking → A/B testing → Setup can create or re-create it.";

/** Lock error for writes that target the hidden check page (null when allowed). */
export function abCheckPageLock(
  contentType: string | undefined,
  slug: string | undefined,
  contentRootOrName: string | undefined,
): { code: typeof SYSTEM_PAGE_LOCKED_CODE; error: string } | null {
  if (!contentType || !slug || slug !== AB_CHECK_SLUG || !contentRootOrName) return null;
  const root = path.isAbsolute(contentRootOrName) ? contentRootOrName : path.join(process.cwd(), contentRootOrName);
  try {
    return isAbCheckPage(contentType, slug, root)
      ? { code: SYSTEM_PAGE_LOCKED_CODE, error: SYSTEM_PAGE_LOCKED_MESSAGE }
      : null;
  } catch {
    return null;
  }
}

export interface AbSiteRef {
  contentRoot: string;
  contentRootName: string;
}

const SET_UP_TTL_MS = 15_000;
const setUpCache = new Map<string, { value: boolean; at: number }>();

/** Drop the cached set-up flag (after setup, recovery, content pulls). */
export function invalidateAbTestingSetUpCache(): void {
  setUpCache.clear();
}

/** Check page exists in content and a check has passed at least once here. Gates serving. */
export function isAbTestingSetUp(site: AbSiteRef): boolean {
  const key = safeSiteName(site.contentRootName);
  const hit = setUpCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < SET_UP_TTL_MS) return hit.value;
  const state = readAbTestingState(site.contentRootName);
  let value = false;
  if (state.first_passed_at) {
    const page = findCheckPage(site.contentRoot);
    value = !!page && checkPageFilesExist(site.contentRoot, page);
  }
  setUpCache.set(key, { value, at: now });
  return value;
}

/** Latest passed/failed run passed (no runs yet counts as not ok). */
export function isLatestCheckOk(contentRootName: string): boolean {
  return latestConclusiveRun(contentRootName)?.status === "passed";
}

export function checkPageExists(site: AbSiteRef): AbCheckPageRef | null {
  const page = findCheckPage(site.contentRoot);
  return page && checkPageFilesExist(site.contentRoot, page) ? page : null;
}

export function _resetAbTestingStateCacheForTests(): void {
  stateCache.clear();
  setUpCache.clear();
}
