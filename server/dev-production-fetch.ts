/**
 * Dev-only helpers for Node → live-site staff HTTP (not GCS pulls).
 * Never forwards the local GitHub staff session — only in-memory paste or
 * PRODUCTION_STAFF_TOKEN.
 */

import { getSiteContextMap } from "./site-manager";

export const PRODUCTION_STAFF_TOKEN_ENV = "PRODUCTION_STAFF_TOKEN" as const;
export const PRODUCTION_STAFF_TOKEN_REQUIRED = "production_staff_token_required" as const;

export type ProductionStaffTokenRequiredPayload = {
  code: typeof PRODUCTION_STAFF_TOKEN_REQUIRED;
  productionOrigin: string;
  envVar: typeof PRODUCTION_STAFF_TOKEN_ENV;
  error: string;
};

/** Process-local paste; cleared on production 401 or restart. */
let memoryToken: string | null = null;

export function getProductionStaffToken(): string | null {
  const mem = memoryToken?.trim();
  if (mem) return mem;
  const fromEnv = process.env.PRODUCTION_STAFF_TOKEN?.trim();
  return fromEnv || null;
}

/** Prefer in-memory over env (memory is checked first in getProductionStaffToken). */
export function setProductionStaffToken(token: string): void {
  const trimmed = token.trim();
  memoryToken = trimmed || null;
}

export function clearProductionStaffToken(): void {
  memoryToken = null;
}

/** Test helper — reset memory between cases. */
export function resetProductionStaffTokenForTests(): void {
  memoryToken = null;
}

/** Resolve https origin for the production host serving this content folder. */
export function resolveProductionOrigin(site: string): string | null {
  const fromEnv = process.env.PRODUCTION_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  for (const ctx of getSiteContextMap().values()) {
    if (
      ctx.contentRootName === site ||
      ctx.config.contentFolder === site ||
      ctx.contentRoot.endsWith(`/${site}`)
    ) {
      return `https://${ctx.config.domain}`;
    }
  }
  return null;
}

export function productionStaffTokenRequiredPayload(
  productionOrigin: string,
  message?: string,
): ProductionStaffTokenRequiredPayload {
  return {
    code: PRODUCTION_STAFF_TOKEN_REQUIRED,
    productionOrigin,
    envVar: PRODUCTION_STAFF_TOKEN_ENV,
    error:
      message ??
      "A production staff token is required. Paste one from a logged-in production tab, or set PRODUCTION_STAFF_TOKEN in .env.",
  };
}

export type FetchProductionAdminOk = {
  ok: true;
  response: Response;
};

export type FetchProductionAdminFail =
  | {
      ok: false;
      kind: "token_required";
      payload: ProductionStaffTokenRequiredPayload;
    }
  | {
      ok: false;
      kind: "network";
      error: string;
      productionOrigin: string;
    }
  | {
      ok: false;
      kind: "http";
      status: number;
      body: string;
      productionOrigin: string;
      response: Response;
    };

export type FetchProductionAdminResult = FetchProductionAdminOk | FetchProductionAdminFail;

/**
 * fetch() to a production admin URL with the resolved production staff token.
 * On missing token or HTTP 401: clears in-memory token and returns token_required.
 */
export async function fetchProductionAdmin(
  url: string | URL,
  init: RequestInit | undefined,
  productionOrigin: string,
): Promise<FetchProductionAdminResult> {
  const token = getProductionStaffToken();
  if (!token) {
    return {
      ok: false,
      kind: "token_required",
      payload: productionStaffTokenRequiredPayload(productionOrigin),
    };
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Token ${token}`);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...init,
      headers,
    });
  } catch (err) {
    return {
      ok: false,
      kind: "network",
      productionOrigin,
      error:
        err instanceof Error
          ? `Could not reach production (${err.message})`
          : "Could not reach production.",
    };
  }

  if (response.status === 401) {
    clearProductionStaffToken();
    return {
      ok: false,
      kind: "token_required",
      payload: productionStaffTokenRequiredPayload(
        productionOrigin,
        "Production rejected the staff token. Paste a fresh token from a logged-in production tab.",
      ),
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      kind: "http",
      status: response.status,
      body,
      productionOrigin,
      response,
    };
  }

  return { ok: true, response };
}
