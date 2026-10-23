/**
 * A/B testing setup: create the hidden check page in the site's content (pushed to the
 * content repo), generate the check token, and run the first check. Also recovery when
 * the setup record is lost but the check page still exists.
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { getDirectory } from "../content-types";
import { markFileAsModified } from "../sync-state";
import { child } from "../logger";
import { runAbCheck, type AbCheckSite, type RunAbCheckOptions } from "./check";
import { invalidateActiveTestsCache } from "./active-tests";
import {
  AB_CHECK_LOCALE,
  AB_CHECK_SLUG,
  AB_CHECK_SYSTEM_MARKER,
  AB_CHECK_VARIANT,
  AB_CHECK_VARIANT_ALLOCATION,
  checkPageContentType,
  checkPageExists,
  ensureCheckToken,
  invalidateAbTestingSetUpCache,
  readAbTestingState,
  setCheckPage,
  type AbCheckPageRef,
  type AbCheckRun,
} from "./state";

const log = child({ module: "ab-testing/setup" });

export interface AbSetupSite extends AbCheckSite {
  config?: { domain?: string; githubRepoUrl?: string };
  contentIndex?: AbCheckSite["contentIndex"] & { upsertEntry?(filePath: string): void };
}

function dumpYaml(data: unknown): string {
  return yaml.dump(data, { indent: 2, lineWidth: 120, quotingType: '"', forceQuotes: false });
}

/** File contents of the hidden check page, keyed by basename. */
export function checkPageFiles(): Record<string, string> {
  const meta = {
    page_title: "A/B check",
    description: "System page used to verify A/B testing. Not for visitors.",
    robots: "noindex, nofollow",
  };
  return {
    "_common.yml": dumpYaml({
      slug: AB_CHECK_SLUG,
      system: AB_CHECK_SYSTEM_MARKER,
      sitemap: false,
    }),
    [`${AB_CHECK_LOCALE}.yml`]: dumpYaml({
      title: "A/B check: Default",
      ab_check_version: "default",
      meta,
      sections: [],
    }),
    [`${AB_CHECK_VARIANT}.${AB_CHECK_LOCALE}.yml`]: dumpYaml({
      title: "A/B check: B",
      ab_check_version: AB_CHECK_VARIANT,
      meta,
      sections: [],
    }),
    "versioning.yml": dumpYaml({
      [AB_CHECK_LOCALE]: {
        variants: [{ slug: AB_CHECK_VARIANT, allocation: AB_CHECK_VARIANT_ALLOCATION }],
      },
    }),
  };
}

export interface SetupResult {
  ok: boolean;
  error?: string;
  code?: "no_content_type" | "push_failed";
  created: string[];
  commitSha: string | null;
  /** Set when content sync is off locally: files stay on disk only. */
  warning?: string;
  page: AbCheckPageRef | null;
  run: AbCheckRun | null;
  set_up: boolean;
}

/**
 * Create missing check-page files, push them, then run the first check.
 * Safe to repeat: existing files are kept.
 */
export async function setupAbTesting(
  site: AbSetupSite,
  opts: { author?: string; checkOptions?: Partial<RunAbCheckOptions> } = {},
): Promise<SetupResult> {
  const contentType = checkPageContentType(site.contentRoot);
  if (!contentType) {
    return {
      ok: false,
      code: "no_content_type",
      error: "This site has no landing or page content type to host the check page.",
      created: [],
      commitSha: null,
      page: null,
      run: null,
      set_up: false,
    };
  }

  const dir = path.join(site.contentRoot, getDirectory(contentType, site.contentRoot), AB_CHECK_SLUG);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  for (const [name, body] of Object.entries(checkPageFiles())) {
    const abs = path.join(dir, name);
    if (fs.existsSync(abs)) continue;
    fs.writeFileSync(abs, body, "utf-8");
    created.push(abs);
    markFileAsModified(abs, opts.author || "System", undefined, site.contentRoot);
  }

  if (created.length) {
    try {
      site.contentIndex?.upsertEntry?.(path.join(dir, `${AB_CHECK_LOCALE}.yml`));
    } catch (err) {
      log.warn({ err }, "[ab-testing] content index refresh failed");
    }
  }
  // Re-read every versioning.yml from disk (the pause migration runs in another process).
  site.versioningManager?.clearCache();
  invalidateActiveTestsCache();

  let commitSha: string | null = null;
  let warning: string | undefined;
  if (created.length) {
    const rel = created.map((abs) => path.relative(process.cwd(), abs).replace(/\\/g, "/"));
    const { commitAndPush } = await import("../github");
    const pushed = await commitAndPush("A/B testing: add hidden check page used to verify page tests", {
      files: rel,
      contentRoot: site.contentRootName,
      repoUrl: site.config?.githubRepoUrl,
      onlyBlockOnOverlap: true,
    });
    commitSha = pushed.commitHash ?? null;
    if (!commitSha) {
      const syncOff = /not enabled|not configured/i.test(pushed.error ?? "");
      if (syncOff && process.env.NODE_ENV !== "production") {
        warning = "Content sync is off here, so the check page was saved locally only.";
      } else {
        return {
          ok: false,
          code: "push_failed",
          error: `Couldn't push the check page to the content repo: ${pushed.error ?? "no commit SHA"}`,
          created: rel,
          commitSha: null,
          page: null,
          run: null,
          set_up: false,
        };
      }
    }
  }

  const page: AbCheckPageRef = { contentType, slug: AB_CHECK_SLUG, locale: AB_CHECK_LOCALE };
  setCheckPage(site.contentRootName, page);
  ensureCheckToken(site.contentRootName);
  invalidateAbTestingSetUpCache();

  const result = await runAbCheck(site, { trigger: "setup", ...opts.checkOptions });
  invalidateAbTestingSetUpCache();
  const run = result.not_set_up ? null : result.run;
  return {
    ok: true,
    created: created.map((abs) => path.relative(process.cwd(), abs).replace(/\\/g, "/")),
    commitSha,
    ...(warning ? { warning } : {}),
    page,
    run,
    set_up: run?.status === "passed" || !!readAbTestingState(site.contentRootName).first_passed_at,
  };
}

/**
 * The check page exists but this server has no setup record (state file lost):
 * rebuild the token and run the check. No-op when the record is intact.
 */
export async function recoverAbTestingIfNeeded(
  site: AbSetupSite,
  opts: Partial<RunAbCheckOptions> = {},
): Promise<AbCheckRun | null> {
  const page = checkPageExists(site);
  if (!page) return null;
  const state = readAbTestingState(site.contentRootName);
  if (state.check_token && state.first_passed_at) return null;
  setCheckPage(site.contentRootName, page);
  ensureCheckToken(site.contentRootName);
  const result = await runAbCheck(site, { trigger: "recovery", ...opts });
  invalidateAbTestingSetUpCache();
  return result.not_set_up ? null : result.run;
}
