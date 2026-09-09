/**
 * Dev-only: replace local content proposals with a snapshot from production.
 * Never uploads. Draft YAML files are not pulled — only SQLite proposal rows.
 */

import {
  exportAllProposals,
  replaceProposalsFromSnapshot,
  type ProposalRecord,
} from "./service";
import {
  fetchProductionAdmin,
  resolveProductionOrigin,
  type ProductionStaffTokenRequiredPayload,
} from "../dev-production-fetch";

export { resolveProductionOrigin } from "../dev-production-fetch";

export type PullProductionProposalsResult = {
  success: boolean;
  pulled: boolean;
  productionOrigin: string;
  imported: number;
  reason?: string;
} & Partial<ProductionStaffTokenRequiredPayload>;

function parseProposalsPayload(body: unknown): ProposalRecord[] {
  if (!body || typeof body !== "object") return [];
  const proposals = (body as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return [];
  return proposals.filter(
    (p): p is ProposalRecord =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as ProposalRecord).id === "string" &&
      typeof (p as ProposalRecord).title === "string" &&
      typeof (p as ProposalRecord).status === "string" &&
      Array.isArray((p as ProposalRecord).entries),
  );
}

async function fetchProductionProposals(productionOrigin: string): Promise<{
  proposals: ProposalRecord[];
  reason?: string;
  tokenRequired?: ProductionStaffTokenRequiredPayload;
}> {
  const url = new URL("/api/admin/proposals/export", productionOrigin);
  const result = await fetchProductionAdmin(url, { method: "GET" }, productionOrigin);

  if (!result.ok) {
    if (result.kind === "token_required") {
      return { proposals: [], tokenRequired: result.payload, reason: result.payload.error };
    }
    if (result.kind === "network") {
      return { proposals: [], reason: result.error };
    }
    return {
      proposals: [],
      reason: `Production returned HTTP ${result.status}${
        result.body ? `: ${result.body.slice(0, 200)}` : ""
      }`,
    };
  }

  return { proposals: parseProposalsPayload(await result.response.json()) };
}

export async function pullProductionProposals(
  site: string,
  productionOriginOverride?: string,
): Promise<PullProductionProposalsResult> {
  const productionOrigin =
    productionOriginOverride?.replace(/\/$/, "") || resolveProductionOrigin(site);

  if (!productionOrigin) {
    return {
      success: false,
      pulled: false,
      productionOrigin: "",
      imported: 0,
      reason:
        "Could not resolve production URL for this site. Set PRODUCTION_SITE_URL or configure the site domain in sites.yml.",
    };
  }

  const { proposals, reason, tokenRequired } = await fetchProductionProposals(productionOrigin);

  if (tokenRequired) {
    return {
      success: false,
      pulled: false,
      productionOrigin,
      imported: 0,
      reason: tokenRequired.error,
      ...tokenRequired,
    };
  }

  if (reason && proposals.length === 0) {
    return {
      success: false,
      pulled: false,
      productionOrigin,
      imported: 0,
      reason,
    };
  }

  const imported = replaceProposalsFromSnapshot(site, proposals);
  return {
    success: true,
    pulled: true,
    productionOrigin,
    imported,
  };
}

/** Re-export for tests / local verification. */
export { exportAllProposals, replaceProposalsFromSnapshot };
