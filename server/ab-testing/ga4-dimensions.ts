/**
 * GA4 event-scoped custom dimensions for page tests (`experiment_id`, `variant`),
 * checked and created through the Google Analytics Admin API with the BigQuery
 * service account (same credentials as media / BigQuery).
 */

import { GoogleAuth } from "google-auth-library";
import { getBigQuerySettings, resolveBigQueryCredentials } from "../ecommerce/bigquery-client";

export const AB_GA4_DIMENSIONS = [
  { parameterName: "experiment_id", displayName: "Experiment ID", description: "Page test id (contentType:slug:locale@start)" },
  { parameterName: "variant", displayName: "Variant", description: "Page test version: a variant slug or default" },
] as const;

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const SCOPE_READ = "https://www.googleapis.com/auth/analytics.readonly";
const SCOPE_EDIT = "https://www.googleapis.com/auth/analytics.edit";

export type Ga4DimensionsStep = "configure_bigquery" | "enable_admin_api" | "grant_access" | "credentials";

export interface Ga4DimensionsStatus {
  ok: boolean;
  property_id: string | null;
  service_account: string | null;
  existing: string[];
  missing: string[];
  created?: string[];
  error?: string;
  step?: Ga4DimensionsStep;
  /** Plain-English fix when something blocks the check. */
  fix?: string;
}

/** GA4 property id: explicit override, else parsed from the export dataset `analytics_<id>`. */
export function resolveGa4PropertyId(settings: { dataset_id?: string; ga4_property_id?: string }): string | null {
  const explicit = settings.ga4_property_id?.trim();
  if (explicit && /^\d+$/.test(explicit)) return explicit;
  const m = /^analytics_(\d+)$/.exec(settings.dataset_id?.trim() ?? "");
  return m ? m[1] : null;
}

function serviceAccountEmail(): string | null {
  const creds = resolveBigQueryCredentials();
  if (creds.source === "gcs_json") {
    const email = creds.credentials.client_email;
    return typeof email === "string" ? email : null;
  }
  return null;
}

function buildAuth(scope: string): GoogleAuth {
  const creds = resolveBigQueryCredentials();
  if (creds.source === "gcs_json") return new GoogleAuth({ credentials: creds.credentials as never, scopes: [scope] });
  if (creds.source === "gcs_key_file") return new GoogleAuth({ keyFilename: creds.keyFilename, scopes: [scope] });
  return new GoogleAuth({ scopes: [scope] });
}

export type AdminRequest = (
  scope: string,
  url: string,
  init?: { method?: string; body?: unknown },
) => Promise<{ status: number; data: unknown }>;

const defaultRequest: AdminRequest = async (scope, url, init) => {
  const client = await buildAuth(scope).getClient();
  try {
    const res = await client.request({
      url,
      method: (init?.method as "GET" | "POST" | undefined) ?? "GET",
      data: init?.body,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    return { status: e.response?.status ?? 500, data: e.response?.data ?? { error: { message: e.message } } };
  }
};

function explainError(status: number, data: unknown, propertyId: string, email: string | null): Pick<Ga4DimensionsStatus, "error" | "step" | "fix"> {
  const message =
    (data as { error?: { message?: string } } | null)?.error?.message ?? `Google Analytics Admin API returned HTTP ${status}`;
  const who = email ?? "the service account";
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(message)) {
    return {
      error: message,
      step: "enable_admin_api",
      fix: "Enable the Google Analytics Admin API in the Google Cloud project of the service account, then try again.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      error: message,
      step: "grant_access",
      fix: `In Google Analytics → Admin → Property access management (property ${propertyId}), add ${who} as Editor. Viewer is enough to check; Editor is needed to create.`,
    };
  }
  return { error: message, step: "credentials", fix: "Check the service account credentials, then try again." };
}

interface Ctx {
  propertyId: string;
  email: string | null;
}

function context(contentRoot?: string): Ctx | Ga4DimensionsStatus {
  const settings = getBigQuerySettings(contentRoot);
  const propertyId = resolveGa4PropertyId(settings);
  const email = serviceAccountEmail();
  if (!propertyId) {
    return {
      ok: false,
      property_id: null,
      service_account: email,
      existing: [],
      missing: AB_GA4_DIMENSIONS.map((d) => d.parameterName),
      step: "configure_bigquery",
      error: "No GA4 property found.",
      fix: "Connect the GA4 BigQuery export in Tracking → GA4 (dataset analytics_<property id>), or set tracking.bigquery.ga4_property_id.",
    };
  }
  return { propertyId, email };
}

async function listExisting(ctx: Ctx, request: AdminRequest): Promise<{ names: string[] } | Ga4DimensionsStatus> {
  const names: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const url = `${ADMIN_BASE}/properties/${ctx.propertyId}/customDimensions?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await request(SCOPE_READ, url);
    if (res.status >= 300) {
      return {
        ok: false,
        property_id: ctx.propertyId,
        service_account: ctx.email,
        existing: [],
        missing: AB_GA4_DIMENSIONS.map((d) => d.parameterName),
        ...explainError(res.status, res.data, ctx.propertyId, ctx.email),
      };
    }
    const data = res.data as { customDimensions?: Array<{ parameterName?: string; scope?: string }>; nextPageToken?: string };
    for (const d of data.customDimensions ?? []) {
      if (d.parameterName && (d.scope ?? "EVENT") === "EVENT") names.push(d.parameterName);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { names };
}

/** Which of the page-test dimensions already exist (needs Viewer). */
export async function checkGa4Dimensions(contentRoot?: string, request: AdminRequest = defaultRequest): Promise<Ga4DimensionsStatus> {
  const ctx = context(contentRoot);
  if ("ok" in ctx) return ctx;
  const listed = await listExisting(ctx, request);
  if ("ok" in listed) return listed;
  const wanted = AB_GA4_DIMENSIONS.map((d) => d.parameterName as string);
  const existing = wanted.filter((n) => listed.names.includes(n));
  const missing = wanted.filter((n) => !listed.names.includes(n));
  return { ok: missing.length === 0, property_id: ctx.propertyId, service_account: ctx.email, existing, missing };
}

/** Create missing dimensions; existing ones are skipped (needs Editor). */
export async function createGa4Dimensions(contentRoot?: string, request: AdminRequest = defaultRequest): Promise<Ga4DimensionsStatus> {
  const status = await checkGa4Dimensions(contentRoot, request);
  if (!status.property_id || status.step) return status;
  const created: string[] = [];
  for (const dim of AB_GA4_DIMENSIONS) {
    if (!status.missing.includes(dim.parameterName)) continue;
    const res = await request(SCOPE_EDIT, `${ADMIN_BASE}/properties/${status.property_id}/customDimensions`, {
      method: "POST",
      body: { parameterName: dim.parameterName, displayName: dim.displayName, description: dim.description, scope: "EVENT" },
    });
    if (res.status >= 300) {
      return {
        ...status,
        ok: false,
        created,
        missing: status.missing.filter((m) => !created.includes(m)),
        existing: [...status.existing, ...created],
        ...explainError(res.status, res.data, status.property_id, status.service_account),
      };
    }
    created.push(dim.parameterName);
  }
  return {
    ...status,
    ok: true,
    created,
    existing: [...status.existing, ...created],
    missing: [],
  };
}
