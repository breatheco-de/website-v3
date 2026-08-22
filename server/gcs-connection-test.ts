import type { GcsArchitectureDiagnostics, GcsPlatformArchitecture } from "./gcs";
import { gcs } from "./gcs";
import { aggregateImageQueuePending } from "./gcs-sync-inventory";
import { isImageQueueBusy } from "./image-queue-worker";

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

  const checks = [configCheck, bucketAccessCheck, architectureCheck, platformCheck, imageQueueCheck];

  return {
    testedAt: new Date().toISOString(),
    overall: computeOverall(checks),
    checks,
  };
}
