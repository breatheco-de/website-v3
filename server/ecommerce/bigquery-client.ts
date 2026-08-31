/**
 * BigQuery client for GA4 export — project/dataset from tracking.bigquery; creds via ADC.
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

export type BigQueryConfigStatus = {
  configured: boolean;
  enabled: boolean;
  settings: TrackingBigQuerySettings;
  credentials_hint: string;
  warnings: string[];
};

export function getBigQuerySettings(contentRoot?: string): TrackingBigQuerySettings {
  return getTrackingSettings(contentRoot).bigquery ?? { ...DEFAULT_TRACKING_BIGQUERY };
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
  const hasAdc =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(process.env.GCLOUD_PROJECT) ||
    Boolean(process.env.GOOGLE_CLOUD_PROJECT);
  if (settings.enabled && hasIds && !hasAdc) {
    warnings.push(
      "No GOOGLE_APPLICATION_CREDENTIALS / GCLOUD_PROJECT detected — ADC may still work on GCP; Test connection to verify.",
    );
  }
  return {
    configured: settings.enabled && hasIds,
    enabled: settings.enabled,
    settings,
    credentials_hint:
      "Use Application Default Credentials or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path. Do not store secrets in settings.yml.",
    warnings,
  };
}

export function getBigQueryClient(contentRoot?: string): BigQuery | null {
  const status = getBigQueryConfigStatus(contentRoot);
  if (!status.configured) return null;
  const { project_id, location } = status.settings;
  const key = `${project_id}|${location}`;
  if (cached?.key === key) return cached.client;
  try {
    const client = new BigQuery({
      projectId: project_id,
      location: location || undefined,
    });
    cached = { key, client };
    return client;
  } catch (err) {
    log.error({ err }, "[BigQuery] Failed to create client");
    return null;
  }
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
    };
  }
  const client = getBigQueryClient(contentRoot);
  if (!client) {
    return {
      ok: false,
      error: "Could not create BigQuery client (check ADC credentials)",
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
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
      };
    }
    // Smoke query: count rows for latest full day table (limit cost)
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
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "[BigQuery] Test connection failed");
    return {
      ok: false,
      error: message,
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
    };
  }
}
