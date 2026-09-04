/**
 * Search Console bulk export BigQuery — project/dataset from search_console.bigquery.
 * Credentials: same as GA4 BigQuery — GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME, then ADC.
 */

import {
  DEFAULT_SEARCH_CONSOLE_BIGQUERY,
  getSearchConsoleSettings,
  parseSearchConsoleBigQuerySettings,
  type SearchConsoleBigQuerySettings,
} from "./settings";
import { BigQuery } from "@google-cloud/bigquery";
import {
  createBigQueryClientForProject,
  resolveBigQueryCredentials,
} from "./ecommerce/bigquery-client";
import { child } from "./logger";
import type { GscDayRow } from "./gsc-keep-filter";

const log = child({ module: "gsc-bigquery-client" });

export type GscBigQueryConfigStatus = {
  configured: boolean;
  enabled: boolean;
  settings: SearchConsoleBigQuerySettings;
  credentials_hint: string;
  credentials_source: "gcs_json" | "gcs_key_file" | "adc" | "none";
  warnings: string[];
};

export function getGscBigQuerySettings(contentRoot?: string): SearchConsoleBigQuerySettings {
  return getSearchConsoleSettings(contentRoot).bigquery ?? { ...DEFAULT_SEARCH_CONSOLE_BIGQUERY };
}

export function getGscBigQueryConfigStatus(contentRoot?: string): GscBigQueryConfigStatus {
  const settings = getGscBigQuerySettings(contentRoot);
  const warnings: string[] = [];
  const hasIds = Boolean(settings.project_id && settings.dataset_id);
  if (settings.enabled && !hasIds) {
    warnings.push("BigQuery is enabled but project_id or dataset_id is empty.");
  }
  if (!settings.enabled) {
    warnings.push("Search Console BigQuery is disabled in settings.");
  }
  const creds = resolveBigQueryCredentials();
  if (settings.enabled && hasIds && creds.source === "none") {
    warnings.push(
      "No GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME / GOOGLE_APPLICATION_CREDENTIALS detected — ADC may still work on GCP; Test connection to verify.",
    );
  }
  if (settings.enabled && hasIds) {
    warnings.push(
      "Your app service account needs BigQuery Data Viewer and Job User on the GSC export dataset (read-only). Google's export SA (search-console-data-export@system.gserviceaccount.com) is separate and writes the data.",
    );
  }
  return {
    configured: settings.enabled && hasIds,
    enabled: settings.enabled,
    settings,
    credentials_source: creds.source,
    credentials_hint:
      "Uses the same service account as media and GA4 BigQuery: GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME. The SA needs BigQuery Data Viewer (+ Job User) on the Search Console export dataset.",
    warnings,
  };
}

export type GscBigQueryTestResult = {
  ok: boolean;
  latest_data_date?: string;
  table_count?: number;
  error?: string;
  elapsed_ms: number;
  warnings: string[];
  credentials_source?: string;
};

function fqTable(settings: SearchConsoleBigQuerySettings, table: string): string {
  return `\`${settings.project_id}.${settings.dataset_id}.${table}\``;
}

/** Verify read access to the GSC bulk export dataset and url impression table. */
export async function testGscBigQueryConnection(
  contentRoot?: string,
): Promise<GscBigQueryTestResult> {
  const started = Date.now();
  const status = getGscBigQueryConfigStatus(contentRoot);
  if (!status.configured) {
    return {
      ok: false,
      error: status.warnings[0] || "Search Console BigQuery is not configured",
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
  const settings = parseSearchConsoleBigQuerySettings(status.settings);
  const client = createBigQueryClientForProject(settings.project_id, settings.location);
  if (!client) {
    return {
      ok: false,
      error: "Could not create BigQuery client (check GCS_CREDENTIALS_JSON / ADC)",
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
  const { project_id, dataset_id, location, url_impression_table, export_log_table } = settings;
  try {
    const dataset = client.dataset(dataset_id, { projectId: project_id });
    const [tables] = await dataset.getTables();
    const tableIds = (tables || []).map((t) => t.id || "").filter(Boolean);
    const urlTable = url_impression_table || "searchdata_url_impression";
    if (!tableIds.includes(urlTable)) {
      return {
        ok: false,
        error: `Table ${urlTable} not found in ${project_id}.${dataset_id}. Enable bulk data export in Search Console first.`,
        table_count: tableIds.length,
        elapsed_ms: Date.now() - started,
        warnings: status.warnings,
        credentials_source: status.credentials_source,
      };
    }

    let latest_data_date: string | undefined;
    const fqUrl = fqTable(settings, urlTable);
    try {
      const [rows] = await client.query({
        query: `SELECT CAST(MAX(data_date) AS STRING) AS latest FROM ${fqUrl} WHERE search_type = 'WEB'`,
        location: location || undefined,
        maximumBytesBilled: "1000000000",
      });
      const row = rows?.[0] as { latest?: string } | undefined;
      if (row?.latest) latest_data_date = row.latest;
    } catch (err) {
      log.warn({ err }, "[GscBigQuery] MAX(data_date) query failed, trying ExportLog");
    }

    if (!latest_data_date && export_log_table && tableIds.includes(export_log_table)) {
      const fqLog = fqTable(settings, export_log_table);
      const [logRows] = await client.query({
        query: `SELECT CAST(MAX(data_date) AS STRING) AS latest FROM ${fqLog}`,
        location: location || undefined,
        maximumBytesBilled: "1000000000",
      });
      const logRow = logRows?.[0] as { latest?: string } | undefined;
      if (logRow?.latest) latest_data_date = logRow.latest;
    }

    return {
      ok: true,
      latest_data_date,
      table_count: tableIds.length,
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "[GscBigQuery] Test connection failed");
    return {
      ok: false,
      error: message,
      elapsed_ms: Date.now() - started,
      warnings: status.warnings,
      credentials_source: status.credentials_source,
    };
  }
}

export async function queryUrlImpressionsForDate(
  date: string,
  contentRoot?: string,
): Promise<GscDayRow[]> {
  const status = getGscBigQueryConfigStatus(contentRoot);
  if (!status.configured) {
    throw new Error(status.warnings[0] || "Search Console BigQuery is not configured");
  }
  const settings = parseSearchConsoleBigQuerySettings(status.settings);
  const client = createBigQueryClientForProject(settings.project_id, settings.location);
  if (!client) {
    throw new Error("Could not create BigQuery client (check GCS_CREDENTIALS_JSON / ADC)");
  }
  const table = settings.url_impression_table || "searchdata_url_impression";
  const fq = fqTable(settings, table);
  const [rows] = await client.query({
    query: `
      SELECT
        COALESCE(query, '') AS query,
        url,
        LOWER(TRIM(COALESCE(country, ''))) AS country,
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions,
        SUM(sum_position) AS sum_position
      FROM ${fq}
      WHERE data_date = @d
        AND search_type = 'WEB'
      GROUP BY query, url, country
    `,
    // Pass a BigQuery DATE value — `types: { d: "DATE" }` with a plain string
    // binds incorrectly and returns zero rows against partitioned GSC tables.
    params: { d: BigQuery.date(date) },
    location: settings.location || undefined,
    maximumBytesBilled: "10000000000",
  });
  return (rows || []).map((r) => {
    const rec = r as Record<string, unknown>;
    const clicks = Number(rec.clicks) || 0;
    const impressions = Number(rec.impressions) || 0;
    const sum_position = Number(rec.sum_position) || 0;
    const countryRaw = typeof rec.country === "string" ? rec.country.trim().toLowerCase() : "";
    return {
      query: typeof rec.query === "string" ? rec.query : "",
      url: typeof rec.url === "string" ? rec.url : "",
      country: countryRaw,
      clicks,
      impressions,
      sum_position,
      ctr: impressions > 0 ? clicks / impressions : 0,
    };
  });
}

export type GscSiteDayTotals = {
  day: string;
  clicks: number;
  impressions: number;
};

/** Site-wide daily clicks/impressions (no keep-filter) for a closed date range. */
export async function querySiteOrganicDailyTotals(
  start: string,
  end: string,
  contentRoot?: string,
): Promise<GscSiteDayTotals[]> {
  const status = getGscBigQueryConfigStatus(contentRoot);
  if (!status.configured) {
    throw new Error(status.warnings[0] || "Search Console BigQuery is not configured");
  }
  const settings = parseSearchConsoleBigQuerySettings(status.settings);
  const client = createBigQueryClientForProject(settings.project_id, settings.location);
  if (!client) {
    throw new Error("Could not create BigQuery client (check GCS_CREDENTIALS_JSON / ADC)");
  }
  const table = settings.url_impression_table || "searchdata_url_impression";
  const fq = fqTable(settings, table);
  const [rows] = await client.query({
    query: `
      SELECT
        CAST(data_date AS STRING) AS day,
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions
      FROM ${fq}
      WHERE data_date BETWEEN @start AND @end
        AND search_type = 'WEB'
      GROUP BY data_date
      ORDER BY data_date
    `,
    params: {
      start: BigQuery.date(start),
      end: BigQuery.date(end),
    },
    location: settings.location || undefined,
    maximumBytesBilled: "5000000000",
  });
  return (rows || []).map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      day: typeof rec.day === "string" ? rec.day : String(rec.day ?? ""),
      clicks: Number(rec.clicks) || 0,
      impressions: Number(rec.impressions) || 0,
    };
  }).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day));
}
