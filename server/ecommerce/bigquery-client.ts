/**
 * BigQuery client for GA4 export — project/dataset from tracking.bigquery.
 * Credentials: same as GCS — GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME, then ADC.
 */

import { BigQuery } from "@google-cloud/bigquery";
import {
  DEFAULT_TRACKING_BIGQUERY,
  getTrackingSettings,
  type TrackingBigQuerySettings,
} from "../settings";
import { child } from "../logger";

const log = child({ module: "bigquery-client" });

let cached: { key: string; client: BigQuery } | null = null;

function buildBigQueryClient(projectId: string, location?: string): BigQuery | null {
  const creds = resolveBigQueryCredentials();
  const key = `${projectId}|${location || ""}|${creds.source}`;
  if (cached?.key === key) return cached.client;
  try {
    const opts: {
      projectId: string;
      location?: string;
      credentials?: Record<string, unknown>;
      keyFilename?: string;
    } = {
      projectId,
      location: location || undefined,
    };
    if (creds.source === "gcs_json") {
      opts.credentials = creds.credentials;
    } else if (creds.source === "gcs_key_file") {
      opts.keyFilename = creds.keyFilename;
    }
    const client = new BigQuery(opts);
    cached = { key, client };
    return client;
  } catch (err) {
    log.error({ err }, "[BigQuery] Failed to create client");
    return null;
  }
}

/** Create a BigQuery client for an arbitrary GCP project (shared credentials). */
export function createBigQueryClientForProject(
  projectId: string,
  location?: string,
): BigQuery | null {
  if (!projectId.trim()) return null;
  return buildBigQueryClient(projectId.trim(), location);
}

export type BigQueryConfigStatus = {
  configured: boolean;
  enabled: boolean;
  settings: TrackingBigQuerySettings;
  credentials_hint: string;
  credentials_source: "gcs_json" | "gcs_key_file" | "adc" | "none";
  warnings: string[];
};

export function getBigQuerySettings(contentRoot?: string): TrackingBigQuerySettings {
  return getTrackingSettings(contentRoot).bigquery ?? { ...DEFAULT_TRACKING_BIGQUERY };
}

type ResolvedGcsCreds =
  | { source: "gcs_json"; credentials: Record<string, unknown> }
  | { source: "gcs_key_file"; keyFilename: string }
  | { source: "adc" }
  | { source: "none" };

/** Prefer GCS_* env (same SA as media / Search Console), then ADC. */
export function resolveBigQueryCredentials(): ResolvedGcsCreds {
  const jsonRaw = (process.env.GCS_CREDENTIALS_JSON || "").trim();
  if (jsonRaw) {
    try {
      const credentials = JSON.parse(jsonRaw) as Record<string, unknown>;
      return { source: "gcs_json", credentials };
    } catch {
      log.error("Failed to parse GCS_CREDENTIALS_JSON for BigQuery");
    }
  }
  const keyFile = (process.env.GCS_KEY_FILENAME || "").trim();
  if (keyFile) {
    return { source: "gcs_key_file", keyFilename: keyFile };
  }
  const hasAdc =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(process.env.GCLOUD_PROJECT) ||
    Boolean(process.env.GOOGLE_CLOUD_PROJECT);
  if (hasAdc) return { source: "adc" };
  // On GCP runtimes ADC may still work with no env — report adc-ish as none for warnings only
  return { source: "none" };
}

export function getBigQueryConfigStatus(contentRoot?: string): BigQueryConfigStatus {
  const settings = getBigQuerySettings(contentRoot);
  const warnings: string[] = [];
  const hasIds = Boolean(settings.project_id && settings.dataset_id);
  if (settings.enabled && !hasIds) {
    warnings.push("BigQuery is enabled but project_id or dataset_id is empty.");
  }
  if (!settings.enabled) {
    warnings.push("BigQuery is disabled in tracking settings.");
  }
  const creds = resolveBigQueryCredentials();
  if (settings.enabled && hasIds && creds.source === "none") {
    warnings.push(
      "No GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME / GOOGLE_APPLICATION_CREDENTIALS detected — ADC may still work on GCP; Test connection to verify.",
    );
  }
  return {
    configured: settings.enabled && hasIds,
    enabled: settings.enabled,
    settings,
    credentials_source: creds.source,
    credentials_hint:
      "Uses the same service account as media: GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME. Falls back to Application Default Credentials. Do not store secrets in settings.yml. The SA needs BigQuery Data Viewer (+ Job User) on the GA4 export dataset.",
    warnings,
  };
}

export function getBigQueryClient(contentRoot?: string): BigQuery | null {
  const status = getBigQueryConfigStatus(contentRoot);
  if (!status.configured) return null;
  const { project_id, location } = status.settings;
  return buildBigQueryClient(project_id, location || undefined);
}

export function fqEventsWildcard(settings: TrackingBigQuerySettings): string {
  const prefix = settings.table_prefix || "events_";
  return `\`${settings.project_id}.${settings.dataset_id}.${prefix}*\``;
}

export type BigQueryTestResult = {
  ok: boolean;
  latest_table?: string;
  table_count?: number;
  error?: string;
  elapsed_ms: number;
  warnings: string[];
  credentials_source?: string;
};

/** Cheap connectivity check: list recent events_* tables in the configured dataset. */
export async function testBigQueryConnection(
  contentRoot?: string,
): Promise<BigQueryTestResult> {
  const started = Date.now();
  const status = getBigQueryConfigStatus(contentRoot);
  if (!status.configured) {
    return {
      ok: false,
      error: status.warnings[0] || "BigQuery is not configured",
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
  const client = getBigQueryClient(contentRoot);
  if (!client) {
    return {
      ok: false,
      error: "Could not create BigQuery client (check GCS_CREDENTIALS_JSON / ADC)",
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
  const { project_id, dataset_id, table_prefix, location } = status.settings;
  try {
    const [tables] = await client.dataset(dataset_id, { projectId: project_id }).getTables();
    const prefix = table_prefix || "events_";
    const eventTables = (tables || [])
      .map((t) => t.id || "")
      .filter((id) => id.startsWith(prefix) && !id.includes("intraday"))
      .sort();
    const latest = eventTables[eventTables.length - 1];
    if (!latest) {
      return {
        ok: false,
        error: `No tables matching ${prefix}* (excluding intraday) in ${project_id}.${dataset_id}`,
        table_count: 0,
        elapsed_ms: Date.now() - started,
        warnings: status.warnings,
        credentials_source: status.credentials_source,
      };
    }
    const fq = `\`${project_id}.${dataset_id}.${latest}\``;
    await client.query({
      query: `SELECT COUNT(*) AS c FROM ${fq} LIMIT 1`,
      location: location || undefined,
      maximumBytesBilled: "100000000",
    });
    return {
      ok: true,
      latest_table: latest,
      table_count: eventTables.length,
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "[BigQuery] Test connection failed");
    return {
      ok: false,
      error: message,
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
}

/** Test helper */
export function clearBigQueryClientCache(): void {
  cached = null;
}
