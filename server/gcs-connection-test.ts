import type { GcsArchitectureDiagnostics, GcsPlatformArchitecture } from "./gcs";
import { gcs } from "./gcs";
import { aggregateImageQueuePending } from "./gcs-sync-inventory";
import { isImageQueueBusy } from "./image-queue-worker";
import { getBucketName } from "./site-config";

const MCP_AUTH_PREFIX = "mcp-auth/";

export type ConnectionCheckStatus = "ok" | "warn" | "error" | "skipped";

export interface ConnectionCheck {
  id: string;
  label: string;
  status: ConnectionCheckStatus;
  summary: string;
  detail?: string;
  durationMs: number;
}

export type GcsConnectionTestOverall = "ok" | "warn" | "error";

export interface GcsConnectionTestResponse {
  testedAt: string;
  overall: GcsConnectionTestOverall;
  checks: ConnectionCheck[];
}

function computeOverall(checks: ConnectionCheck[]): GcsConnectionTestOverall {
  if (checks.some((c) => c.status === "error")) return "error";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

function skippedCheck(id: string, label: string, reason: string): ConnectionCheck {
  return {
    id,
    label,
    status: "skipped",
    summary: reason,
    durationMs: 0,
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

async function checkGcsConfig(): Promise<ConnectionCheck> {
  const start = Date.now();
  const bucketName = gcs.getBucketName();
  const available = gcs.available;

  if (!available) {
    return {
      id: "gcs_config",
      label: "GCS configuration",
      status: "error",
      summary: "GCS client is not initialized.",
      detail:
        "Set GCS_BUCKET_NAME (or bucket_name in sites.yml) and GCS credentials (GCS_KEY_FILENAME or GCS_CREDENTIALS_JSON). Restart the server after changing.",
      durationMs: Date.now() - start,
    };
  }

  if (!bucketName) {
    return {
      id: "gcs_config",
      label: "GCS configuration",
      status: "error",
      summary: "No bucket name configured.",
      detail: "Set bucket_name in sites.yml or GCS_BUCKET_NAME as a bootstrap fallback.",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "gcs_config",
    label: "GCS configuration",
    status: "ok",
    summary: `Client initialized; bucket ${bucketName}.`,
    durationMs: Date.now() - start,
  };
}

async function checkBucketAccess(configOk: boolean): Promise<ConnectionCheck> {
  if (!configOk) {
    return skippedCheck("gcs_bucket_access", "Bucket access", "Skipped — GCS configuration check failed.");
  }

  const start = Date.now();
  const storage = gcs.getStorage();
  const bucketName = gcs.getBucketName();

  if (!storage || !bucketName) {
    return skippedCheck("gcs_bucket_access", "Bucket access", "Skipped — GCS not ready.");
  }

  try {
    await storage.bucket(bucketName).getMetadata();
    return {
      id: "gcs_bucket_access",
      label: "Bucket access",
      status: "ok",
      summary: "Can read bucket metadata.",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "gcs_bucket_access",
      label: "Bucket access",
      status: "error",
      summary: "Cannot access the bucket.",
      detail: message,
      durationMs: Date.now() - start,
    };
  }
}

function checkArchitecture(diagnostics: GcsArchitectureDiagnostics, durationMs: number): ConnectionCheck {
  if (diagnostics.checkError) {
    return {
      id: "gcs_architecture",
      label: "Bucket architecture",
      status: "error",
      summary: "Architecture check failed.",
      detail: diagnostics.checkError,
      durationMs,
    };
  }

  const layoutDetail = `Old layout: ${diagnostics.hasOldLayout ? "detected" : "not detected"}. New layout: ${diagnostics.hasNewLayout ? "detected" : "not detected"}.`;

  if (diagnostics.migrationRequired) {
    return {
      id: "gcs_architecture",
      label: "Bucket architecture",
      status: "warn",
      summary: "Migration required — old flat layout without new per-site layout.",
      detail: `${layoutDetail} Run npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=<bucket> --execute`,
      durationMs,
    };
  }

  return {
    id: "gcs_architecture",
    label: "Bucket architecture",
    status: "ok",
    summary: "Bucket layout check passed.",
    detail: layoutDetail,
    durationMs,
  };
}

function checkPlatformArtifacts(
  platform: GcsPlatformArchitecture | undefined,
  isProduction: boolean,
  skipped: boolean,
): ConnectionCheck {
  if (skipped) {
    return skippedCheck(
      "gcs_platform_artifacts",
      "Platform artifacts",
      "Skipped — architecture check did not complete.",
    );
  }

  if (!platform) {
    return {
      id: "gcs_platform_artifacts",
      label: "Platform artifacts",
      status: "warn",
      summary: "Platform probes unavailable.",
      durationMs: 0,
    };
  }

  const sitesStatus = platform.sitesYml.status;
  const userStatus = platform.userStore.status;
  const detail = `sites.yml: ${sitesStatus}. user store: ${userStatus}.`;
  const anyMissing = sitesStatus === "missing" || userStatus === "missing";

  if (anyMissing && isProduction) {
    return {
      id: "gcs_platform_artifacts",
      label: "Platform artifacts",
      status: "warn",
      summary: "One or more platform objects are missing in the bucket.",
      detail,
      durationMs: 0,
    };
  }

  if (anyMissing) {
    return {
      id: "gcs_platform_artifacts",
      label: "Platform artifacts",
      status: "ok",
      summary: "Platform objects not in bucket (expected in local development).",
      detail,
      durationMs: 0,
    };
  }

  return {
    id: "gcs_platform_artifacts",
    label: "Platform artifacts",
    status: "ok",
    summary: "Platform objects found in the bucket.",
    detail,
    durationMs: 0,
  };
}

function checkImageQueue(): ConnectionCheck {
  const start = Date.now();
  const pending = aggregateImageQueuePending();
  const busy = isImageQueueBusy();
  const status: ConnectionCheckStatus = busy && pending > 0 ? "warn" : "ok";

  return {
    id: "image_queue",
    label: "Image queue",
    status,
    summary: busy
      ? `Processing — ${pending} pending.`
      : pending > 0
        ? `${pending} image(s) queued.`
        : "Idle — no pending images.",
    durationMs: Date.now() - start,
  };
}

function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

function checkMcpAuthConfig(isProduction: boolean): ConnectionCheck {
  const start = Date.now();
  const envBucket = process.env.GCS_BUCKET_NAME?.trim() ?? "";
  if (!envBucket) {
    return skippedCheck(
      "mcp_auth_config",
      "MCP auth encryption",
      "Skipped — GCS_BUCKET_NAME not set (MCP GCS persistence disabled).",
    );
  }

  const key = process.env.MCP_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!key) {
    return {
      id: "mcp_auth_config",
      label: "MCP auth encryption",
      status: isProduction ? "error" : "warn",
      summary: "MCP_TOKEN_ENCRYPTION_KEY is not set.",
      detail:
        "Generate with openssl rand -hex 32 and set in release .env. Without it, MCP OAuth state is not persisted to GCS across redeploys.",
      durationMs: Date.now() - start,
    };
  }

  if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
    return {
      id: "mcp_auth_config",
      label: "MCP auth encryption",
      status: "error",
      summary: "MCP_TOKEN_ENCRYPTION_KEY must be a 64-character hex string.",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "mcp_auth_config",
    label: "MCP auth encryption",
    status: "ok",
    summary: "Encryption key configured for mcp-auth/ blobs.",
    durationMs: Date.now() - start,
  };
}

function checkMcpBucketParity(): ConnectionCheck {
  const start = Date.now();
  const envBucket = process.env.GCS_BUCKET_NAME?.trim() ?? "";
  const sitesBucket = getBucketName();

  if (!envBucket) {
    return skippedCheck(
      "mcp_bucket_parity",
      "MCP bucket parity",
      "Skipped — GCS_BUCKET_NAME not set.",
    );
  }

  if (!sitesBucket) {
    return {
      id: "mcp_bucket_parity",
      label: "MCP bucket parity",
      status: "ok",
      summary: "sites.yml has no bucket_name; using GCS_BUCKET_NAME only.",
      durationMs: Date.now() - start,
    };
  }

  if (envBucket !== sitesBucket) {
    return {
      id: "mcp_bucket_parity",
      label: "MCP bucket parity",
      status: "error",
      summary: `GCS_BUCKET_NAME (${envBucket}) != sites.yml bucket_name (${sitesBucket}).`,
      detail: "MCP reads GCS_BUCKET_NAME from env only. Align both values.",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "mcp_bucket_parity",
    label: "MCP bucket parity",
    status: "ok",
    summary: "GCS_BUCKET_NAME matches sites.yml bucket_name.",
    durationMs: Date.now() - start,
  };
}

async function checkMcpAuthBlobs(
  configOk: boolean,
  isProduction: boolean,
): Promise<ConnectionCheck> {
  if (!configOk) {
    return skippedCheck(
      "mcp_auth_blobs",
      "MCP auth blobs",
      "Skipped — GCS configuration check failed.",
    );
  }

  const key = process.env.MCP_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!key) {
    return skippedCheck(
      "mcp_auth_blobs",
      "MCP auth blobs",
      "Skipped — MCP_TOKEN_ENCRYPTION_KEY not set.",
    );
  }

  const start = Date.now();
  const storage = gcs.getStorage();
  const bucketName = gcs.getBucketName();
  if (!storage || !bucketName) {
    return skippedCheck("mcp_auth_blobs", "MCP auth blobs", "Skipped — GCS not ready.");
  }

  const required = [`${MCP_AUTH_PREFIX}clients.enc`, `${MCP_AUTH_PREFIX}tokens.enc`];
  try {
    const exists = await Promise.all(
      required.map(async (objectKey) => {
        const [found] = await storage.bucket(bucketName).file(objectKey).exists();
        return found;
      }),
    );
    const missing = required.filter((_, i) => !exists[i]);
    if (missing.length === 0) {
      return {
        id: "mcp_auth_blobs",
        label: "MCP auth blobs",
        status: "ok",
        summary: "clients.enc and tokens.enc found in bucket.",
        durationMs: Date.now() - start,
      };
    }

    return {
      id: "mcp_auth_blobs",
      label: "MCP auth blobs",
      status: isProduction ? "warn" : "ok",
      summary: "MCP auth blobs not in bucket yet.",
      detail: `Missing: ${missing.join(", ")}. Complete OAuth once after enabling persistence.`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "mcp_auth_blobs",
      label: "MCP auth blobs",
      status: "error",
      summary: "Could not probe mcp-auth/ objects.",
      detail: message,
      durationMs: Date.now() - start,
    };
  }
}

async function checkGitHubContentApi(): Promise<ConnectionCheck> {
  const start = Date.now();
  const token = process.env.GITHUB_TOKEN?.trim() ?? "";
  const repoUrl = process.env.GITHUB_REPO_URL?.trim() ?? "";

  if (!token || !repoUrl) {
    return skippedCheck(
      "github_content_api",
      "GitHub content API",
      "Skipped — GITHUB_TOKEN or GITHUB_REPO_URL not set.",
    );
  }

  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) {
    return {
      id: "github_content_api",
      label: "GitHub content API",
      status: "error",
      summary: "Invalid GITHUB_REPO_URL.",
      detail: repoUrl,
      durationMs: Date.now() - start,
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.ok) {
      return {
        id: "github_content_api",
        label: "GitHub content API",
        status: "ok",
        summary: `Can reach ${parsed.owner}/${parsed.repo}.`,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: "github_content_api",
      label: "GitHub content API",
      status: "error",
      summary: `GitHub API returned HTTP ${res.status}.`,
      detail: "Check GITHUB_TOKEN permissions and repo URL.",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "github_content_api",
      label: "GitHub content API",
      status: "error",
      summary: "GitHub API request failed.",
      detail: message,
      durationMs: Date.now() - start,
    };
  }
}

export async function runGcsConnectionTest(): Promise<GcsConnectionTestResponse> {
  const configCheck = await checkGcsConfig();
  const configOk = configCheck.status === "ok";
  const isProduction = process.env.NODE_ENV === "production";

  const [bucketAccessCheck, archTimed, imageQueueCheck] = await Promise.all([
    checkBucketAccess(configOk),
    configOk ? timed(() => gcs.checkArchitecture()) : Promise.resolve(null),
    Promise.resolve(checkImageQueue()),
  ]);

  let architectureCheck: ConnectionCheck;
  let platformCheck: ConnectionCheck;

  if (configOk && archTimed) {
    architectureCheck = checkArchitecture(archTimed.result, archTimed.durationMs);
    platformCheck = checkPlatformArtifacts(
      archTimed.result.platform,
      isProduction,
      !!archTimed.result.checkError && !archTimed.result.platform,
    );
  } else {
    architectureCheck = skippedCheck(
      "gcs_architecture",
      "Bucket architecture",
      "Skipped — GCS configuration check failed.",
    );
    platformCheck = skippedCheck(
      "gcs_platform_artifacts",
      "Platform artifacts",
      "Skipped — GCS configuration check failed.",
    );
  }

  const checks = [
    configCheck,
    bucketAccessCheck,
    architectureCheck,
    platformCheck,
    imageQueueCheck,
    checkMcpAuthConfig(isProduction),
    checkMcpBucketParity(),
    await checkMcpAuthBlobs(configOk, isProduction),
    await checkGitHubContentApi(),
  ];

  return {
    testedAt: new Date().toISOString(),
    overall: computeOverall(checks),
    checks,
  };
}
