import { gcs } from "./gcs";
import { getBucketName } from "./site-config";
import { getAllJobStates } from "./db-job-state";
import { getSiteContextMap } from "./site-manager";
import { hasMultipleSites } from "./site-config";
import {
  evaluateDatabaseHealth,
  isAuthFetchError,
  lastGoodCacheInputs,
} from "../scripts/validation/shared/databaseHealthChecks";

export type SystemAlertSeverity = "critical" | "warning";

export type SystemAlertCode =
  | "gcs_migration_required"
  | "mcp_auth_key_missing"
  | "mcp_bucket_mismatch"
  | "mcp_auth_blobs_missing"
  | "database_auth_env_missing"
  | "database_auth_failed"
  | "database_fetch_failed"
  | "turnstile_env_missing"
  | "turnstile_secret_invalid"
  | "background_jobs_stalled"
  | "sidequest_engine_down"
  | "sidequest_engine_stuck"
  | "github_app_env_missing"
  | "decision_model_unavailable"
  | "ab_check_failed"
  | "ab_check_inconclusive";

export interface SystemAlert {
  id: string;
  severity: SystemAlertSeverity;
  code: SystemAlertCode;
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
  site?: string;
  database?: string;
}

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const TURNSTILE_CACHE_TTL_MS = 5 * 60 * 1000;

type TurnstileSecretCheck = "valid" | "invalid" | "unknown";

let turnstileSecretCache: {
  secret: string;
  result: TurnstileSecretCheck;
  checkedAt: number;
} | null = null;

/**
 * Probe Cloudflare Siteverify with a dummy token. A real secret returns
 * invalid-input-response (or success for test always-pass keys); a bad
 * secret returns invalid-input-secret. Network failures return "unknown"
 * so we do not raise false-positive critical alerts.
 */
async function checkTurnstileSecret(
  secretKey: string,
): Promise<TurnstileSecretCheck> {
  const now = Date.now();
  if (
    turnstileSecretCache &&
    turnstileSecretCache.secret === secretKey &&
    now - turnstileSecretCache.checkedAt < TURNSTILE_CACHE_TTL_MS
  ) {
    return turnstileSecretCache.result;
  }

  let result: TurnstileSecretCheck = "unknown";
  try {
    const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: TURNSTILE_DUMMY_TOKEN,
      }),
    });
    const body = (await res.json()) as { "error-codes"?: string[] };
    const codes = body["error-codes"] ?? [];
    if (
      codes.includes("invalid-input-secret") ||
      codes.includes("missing-input-secret")
    ) {
      result = "invalid";
    } else {
      // Secret accepted; token errors / success are fine for this probe.
      result = "valid";
    }
  } catch {
    result = "unknown";
  }

  turnstileSecretCache = { secret: secretKey, result, checkedAt: now };
  return result;
}

async function collectTurnstileAlerts(): Promise<SystemAlert[]> {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const actionHref = "/private/security/captcha";
  const actionLabel = "Open security";

  const missing: string[] = [];
  if (!siteKey) missing.push("TURNSTILE_SITE_KEY");
  if (!secretKey) missing.push("TURNSTILE_SECRET_KEY");

  if (missing.length > 0) {
    return [
      {
        id: "turnstile_env_missing",
        severity: "critical",
        code: "turnstile_env_missing",
        title: "Turnstile keys not configured",
        message: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. Lead-form bot protection will not work.`,
        actionHref,
        actionLabel,
      },
    ];
  }

  const secretStatus = await checkTurnstileSecret(secretKey);
  if (secretStatus === "invalid") {
    return [
      {
        id: "turnstile_secret_invalid",
        severity: "critical",
        code: "turnstile_secret_invalid",
        title: "Turnstile secret key is invalid",
        message:
          "TURNSTILE_SECRET_KEY was rejected by Cloudflare Siteverify. Check the secret in the Cloudflare Turnstile dashboard and update the env var / deploy secret.",
        actionHref,
        actionLabel,
      },
    ];
  }

  return [];
}

function collectMcpAuthAlerts(isProduction: boolean): SystemAlert[] {
  if (!isProduction) return [];

  const actionHref = "/private/cloud-sync";
  const actionLabel = "Open Cloud Sync";
  const envBucket = process.env.GCS_BUCKET_NAME?.trim() ?? "";
  const alerts: SystemAlert[] = [];

  if (envBucket && !process.env.MCP_TOKEN_ENCRYPTION_KEY?.trim()) {
    alerts.push({
      id: "mcp_auth_key_missing",
      severity: "critical",
      code: "mcp_auth_key_missing",
      title: "MCP OAuth will not survive redeploys",
      message:
        "GCS_BUCKET_NAME is set but MCP_TOKEN_ENCRYPTION_KEY is missing. MCP auth blobs are not written to GCS. See docs/runbooks/mcp-oauth-persistence.md.",
      actionHref,
      actionLabel,
    });
  }

  const sitesBucket = getBucketName();
  if (envBucket && sitesBucket && envBucket !== sitesBucket) {
    alerts.push({
      id: "mcp_bucket_mismatch",
      severity: "critical",
      code: "mcp_bucket_mismatch",
      title: "MCP GCS bucket mismatch",
      message: `GCS_BUCKET_NAME (${envBucket}) does not match sites.yml bucket_name (${sitesBucket}). MCP persistence uses env only.`,
      actionHref,
      actionLabel,
    });
  }

  return alerts;
}

async function collectMcpAuthBlobAlerts(isProduction: boolean): Promise<SystemAlert[]> {
  if (!isProduction || !gcs.available) return [];
  if (!process.env.MCP_TOKEN_ENCRYPTION_KEY?.trim()) return [];

  const storage = gcs.getStorage();
  const bucketName = gcs.getBucketName();
  if (!storage || !bucketName) return [];

  try {
    const keys = ["mcp-auth/clients.enc", "mcp-auth/tokens.enc"];
    const exists = await Promise.all(
      keys.map(async (objectKey) => {
        const [found] = await storage.bucket(bucketName).file(objectKey).exists();
        return found;
      }),
    );
    if (exists.every(Boolean)) return [];

    return [
      {
        id: "mcp_auth_blobs_missing",
        severity: "warning",
        code: "mcp_auth_blobs_missing",
        title: "MCP auth blobs missing in GCS",
        message:
          "mcp-auth/clients.enc or tokens.enc not found. Connect Cursor via OAuth once after enabling persistence, or see docs/runbooks/mcp-oauth-persistence.md.",
        actionHref: "/private/cloud-sync",
        actionLabel: "Open Cloud Sync",
      },
    ];
  } catch {
    return [];
  }
}

function issuesFromCacheOrEvaluate(
  ctx: import("./site-manager").SiteContext,
  dbName: string,
  config: import("./database").DatabaseConfig,
) {
  const cached = ctx.validationCache.getByDatabase(dbName);
  if (cached) {
    return cached.errors;
  }

  const jobStates = getAllJobStates(ctx.contentRoot);
  const { errors } = evaluateDatabaseHealth(
    dbName,
    config,
    ctx.contentRoot,
    jobStates[dbName],
    lastGoodCacheInputs(ctx.database, dbName).cacheInfo,
    ctx.database.countTransformErrors(dbName),
    lastGoodCacheInputs(ctx.database, dbName).staleAgeMs,
  );
  return errors;
}

async function collectGitHubAppAlerts(isProduction: boolean): Promise<SystemAlert[]> {
  if (!isProduction) return [];
  if (process.env.GITHUB_SYNC_ENABLED !== "true") return [];

  const { getGitHubAppEnvStatus } = await import("./github-user-tokens");
  const status = getGitHubAppEnvStatus();
  if (status.complete) return [];

  return [
    {
      id: "github_app_env_missing",
      severity: "critical",
      code: "github_app_env_missing",
      title: "GitHub Connect is not configured",
      message: `Production content commits require GitHub App Connect, but env is incomplete (missing: ${status.missing.join(", ")}). Set GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, and GITHUB_APP_SLUG.`,
      actionHref: "/private/repository-sync",
      actionLabel: "Open repository sync",
    },
  ];
}

export const DECISION_MODEL_ALERT_MESSAGE =
  "Automated fact checks are down. Reviews still work, but agents are told to check all site facts instead of only the relevant ones.";

/** Missing key → critical right away; otherwise critical after repeated failed calls (clears on the next success). */
export async function collectDecisionModelAlerts(): Promise<SystemAlert[]> {
  const { resolveLLMApiKey } = await import("./ai/LLMService");
  const { readDecisionHealth, isDecisionHealthCritical } = await import("./ai/decisions/health");
  const base = {
    id: "decision_model_unavailable",
    severity: "critical" as const,
    code: "decision_model_unavailable" as const,
    title: "Automated fact checks are down",
    actionHref: "/private/settings/ai/llms",
    actionLabel: "Open LLM settings",
  };

  if (!resolveLLMApiKey("OPENROUTER_API_KEY")) {
    return [
      {
        ...base,
        message: `${DECISION_MODEL_ALERT_MESSAGE} Cause: the OpenRouter API key is not configured on the server.`,
      },
    ];
  }

  const failing: Array<{ site: string; failures: number; reason: string | null }> = [];
  for (const ctx of getSiteContextMap().values()) {
    const h = readDecisionHealth(ctx.contentRootName);
    if (isDecisionHealthCritical(h)) {
      failing.push({ site: ctx.contentRootName, failures: h.consecutive_failures, reason: h.last_fail_reason });
    }
  }
  if (!failing.length) return [];
  const worst = failing.reduce((a, b) => (b.failures > a.failures ? b : a));
  return [
    {
      ...base,
      message: `${DECISION_MODEL_ALERT_MESSAGE} Cause: ${worst.failures} failed calls in a row${
        worst.reason ? ` (last: ${worst.reason})` : ""
      }. Use Re-check after fixing.`,
    },
  ];
}

export async function collectSystemAlerts(): Promise<SystemAlert[]> {
  const alerts: SystemAlert[] = [];
  const multiSite = hasMultipleSites();
  const isProduction = process.env.NODE_ENV === "production";

  alerts.push(...(await collectTurnstileAlerts()));
  alerts.push(...collectMcpAuthAlerts(isProduction));
  alerts.push(...(await collectMcpAuthBlobAlerts(isProduction)));
  alerts.push(...(await collectGitHubAppAlerts(isProduction)));
  try {
    alerts.push(...(await collectDecisionModelAlerts()));
  } catch {
    /* non-fatal */
  }

  try {
    const { getEngineStatus } = await import("./jobs/queue");
    const { collectSidequestDiagnostics } = await import("./jobs/sidequest-diagnostics");
    const engine = await getEngineStatus();
    if (engine.status === "stopped") {
      let message: string;
      try {
        const diagnostics = await collectSidequestDiagnostics();
        message = `${diagnostics.summary} Saves still work; use Background pipeline → Check again or Restart Sidequest (platform ops).`;
      } catch {
        const isProd = process.env.NODE_ENV === "production";
        message = isProd
          ? "Index refresh and on-save validation are paused (saves still work). Open Background pipeline for diagnostics, or Restart Sidequest (platform ops)."
          : "Index refresh and on-save validation are paused (saves still work). In a local environment, start Sidequest in another terminal with: npm run sidequest";
      }
      alerts.push({
        id: "sidequest_engine_down",
        severity: "critical",
        code: "sidequest_engine_down",
        title: "Sidequest is not running",
        message,
        actionHref: "/private/background-pipeline",
        actionLabel: "Open pipeline",
      });
    } else {
      try {
        const diagnostics = await collectSidequestDiagnostics();
        if (diagnostics.derivedHealth === "running_stuck") {
          alerts.push({
            id: "sidequest_engine_stuck",
            severity: "warning",
            code: "sidequest_engine_stuck",
            title: "Sidequest may be stuck",
            message: `${diagnostics.summary} Heartbeat is stale — worker PID is alive but may not be processing jobs. Webmaster can restart from Background pipeline.`,
            actionHref: "/private/background-pipeline",
            actionLabel: "Open pipeline",
          });
        }
      } catch {
        /* non-fatal */
      }
    }
  } catch {
    /* non-fatal */
  }

  try {
    const { getOldestUnpublishedAgeMs } = await import("./events/event-store");
    const threshold = Number(process.env.EVENT_STALE_THRESHOLD_MS || 5 * 60 * 1000);
    for (const ctx of getSiteContextMap().values()) {
      const age = getOldestUnpublishedAgeMs(ctx.contentRootName);
      if (age !== null && age > threshold) {
        alerts.push({
          id: `${ctx.contentRootName}:background_jobs_stalled`,
          severity: "warning",
          code: "background_jobs_stalled",
          title: "Background jobs stalled",
          message: `Unpublished events are ${Math.round(age / 1000)}s old — index/validation may be behind.`,
          site: ctx.contentRootName,
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  if (gcs.migrationRequired) {
    alerts.push({
      id: "gcs_migration",
      severity: "warning",
      code: "gcs_migration_required",
      title: "GCS Migration Required",
      message:
        "Bucket uses old flat layout. GCS writes are blocked. Run: npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=<bucket> --execute. Use Re-check after migrating.",
    });
  }

  for (const ctx of getSiteContextMap().values()) {
    const { database, contentRootName } = ctx;
    const sitePrefix = multiSite ? `${contentRootName}:` : "";

    for (const { name, config } of database.list()) {
      const label = config.name || name;
      const actionHref = `/private/databases/${encodeURIComponent(name)}`;
      const siteField = multiSite ? { site: contentRootName } : {};

      const issues = issuesFromCacheOrEvaluate(ctx, name, config);

      for (const issue of issues) {
        if (issue.code === "DB_AUTH_ENV_MISSING") {
          alerts.push({
            id: `${sitePrefix}${name}:auth_env_missing`,
            severity: "critical",
            code: "database_auth_env_missing",
            title: `Database "${label}" — missing API token`,
            message: issue.message,
            actionHref,
            actionLabel: "Open database",
            database: name,
            ...siteField,
          });
        } else if (issue.code === "DB_FETCH_FAILED") {
          const isAuth = isAuthFetchError(issue.message);
          alerts.push({
            id: `${sitePrefix}${name}:${isAuth ? "auth_failed" : "fetch_failed"}`,
            severity: "critical",
            code: isAuth ? "database_auth_failed" : "database_fetch_failed",
            title: isAuth
              ? `Database "${label}" — authentication failed`
              : `Database "${label}" — fetch failed`,
            message: issue.message,
            actionHref,
            actionLabel: "Open database",
            database: name,
            ...siteField,
          });
        }
      }
    }
  }

  try {
    alerts.push(...(await collectAbTestingAlerts()));
  } catch {
    /* non-fatal */
  }

  const severityRank: Record<SystemAlertSeverity, number> = {
    critical: 0,
    warning: 1,
  };

  return alerts.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );
}

/**
 * A/B check alerts per site. Failed (latest conclusive run): critical when a real test
 * has traffic, else warning. Inconclusive (most recent run): always a warning.
 * Both clear on the next passing run.
 */
export async function collectAbTestingAlerts(
  sites: Array<{ contentRoot: string; contentRootName: string }> = Array.from(getSiteContextMap().values()),
): Promise<SystemAlert[]> {
  const { latestConclusiveRun, latestRun } = await import("./ab-testing/state");
  const { describeAbCheckRun } = await import("./ab-testing/check");
  const { listActiveTests } = await import("./ab-testing/active-tests");
  const multiSite = sites.length > 1;
  const out: SystemAlert[] = [];
  for (const site of sites) {
    const prefix = multiSite ? `${site.contentRootName}:` : "";
    const siteField = multiSite ? { site: site.contentRootName } : {};
    const latest = latestRun(site.contentRootName);
    const conclusive = latestConclusiveRun(site.contentRootName);
    if (conclusive?.status === "failed") {
      const running = listActiveTests(site.contentRoot).length;
      out.push({
        id: `${prefix}ab_check_failed`,
        severity: running > 0 ? "critical" : "warning",
        code: "ab_check_failed",
        title: "A/B test check failed",
        message:
          `${describeAbCheckRun(conclusive)}${conclusive.deploy_sha ? ` (deploy ${conclusive.deploy_sha.slice(0, 7)})` : ""}. ` +
          "Running tests continue; starting or raising tests is blocked until a check passes.",
        actionHref: "/private/tracking/ab-testing#ab-health",
        actionLabel: "Open A/B testing",
        ...siteField,
      });
    }
    if (latest?.status === "inconclusive") {
      out.push({
        id: `${prefix}ab_check_inconclusive`,
        severity: "warning",
        code: "ab_check_inconclusive",
        title: "A/B check couldn't run",
        message:
          "The A/B check couldn't run (blocked or timed out). The last real result still applies. " +
          "If this repeats, allow the check in Cloudflare (see the Health card under Tracking → A/B testing).",
        actionHref: "/private/tracking/ab-testing#ab-health",
        actionLabel: "Open A/B testing",
        ...siteField,
      });
    }
  }
  return out;
}

export interface DecisionModelRecheckResult {
  resolved: boolean;
  model?: string;
  message: string;
}

/** Probe the decision model once and record the result for every site (the key is global). */
export async function recheckDecisionModel(contentRoot?: string): Promise<DecisionModelRecheckResult> {
  const { probeDecisionModel } = await import("./ai/decisions");
  const { recordDecisionOutcome } = await import("./ai/decisions/health");
  const probe = await probeDecisionModel({ contentRoot });
  for (const ctx of getSiteContextMap().values()) {
    recordDecisionOutcome(
      ctx.contentRootName,
      probe.ok ? { status: "ok", model: probe.model } : { status: "unavailable", reason: "error", message: probe.error },
    );
  }
  return probe.ok
    ? { resolved: true, model: probe.model, message: `Re-check passed — ${probe.model} answered. The alert has been cleared.` }
    : { resolved: false, model: probe.model, message: `Re-check failed: ${probe.error}` };
}

export interface DatabaseRecheckResult {
  found: boolean;
  resolved: boolean;
  errorCount: number;
  warningCount: number;
  message: string;
}

/**
 * Re-evaluate a single database's health live (bypassing the cached
 * validation result), persist the fresh result to the validation cache,
 * and report whether the previously-reported critical issues are gone.
 */
export async function recheckDatabaseHealth(
  dbName: string,
  site?: string,
): Promise<DatabaseRecheckResult> {
  const matches = [...getSiteContextMap().values()].filter(
    (ctx) =>
      (!site || ctx.contentRootName === site) &&
      ctx.database.list().some((d: { name: string }) => d.name === dbName),
  );

  if (matches.length > 1) {
    return {
      found: false,
      resolved: false,
      errorCount: 0,
      warningCount: 0,
      message: `Database "${dbName}" exists in multiple sites; specify a site to re-check.`,
    };
  }

  for (const ctx of matches) {
    const entry = ctx.database.list().find((d: { name: string }) => d.name === dbName);
    if (!entry) continue;

    const jobStates = getAllJobStates(ctx.contentRoot);
    const { errors, warnings } = evaluateDatabaseHealth(
      dbName,
      entry.config,
      ctx.contentRoot,
      jobStates[dbName],
      lastGoodCacheInputs(ctx.database, dbName).cacheInfo,
      ctx.database.countTransformErrors(dbName),
      lastGoodCacheInputs(ctx.database, dbName).staleAgeMs,
    );

    ctx.validationCache.setByDatabase(dbName, {
      lastRunAt: new Date().toISOString(),
      errors,
      warnings,
    });
    await ctx.validationCache.flush();

    const label = entry.config.name || dbName;
    const resolved = errors.length === 0;
    return {
      found: true,
      resolved,
      errorCount: errors.length,
      warningCount: warnings.length,
      message: resolved
        ? `Re-check passed — no issues found for "${label}". The alert has been cleared.`
        : `Re-check found ${errors.length} issue${errors.length === 1 ? "" : "s"} still present for "${label}".`,
    };
  }

  return {
    found: false,
    resolved: false,
    errorCount: 0,
    warningCount: 0,
    message: `Database "${dbName}" was not found.`,
  };
}
