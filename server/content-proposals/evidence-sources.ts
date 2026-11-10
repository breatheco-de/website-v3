import { REJECTED_KEY, ROW_STAMP_KEY, isRowRejected, readEvidenceConfig } from "@shared/evidence-kinds";
import { ARCHIVE_KEY } from "@shared/evidence-archive";
import { getSiteContextMap, type SiteContext } from "../site-manager";
import { child } from "../logger";
import { brandTerms, type EvidenceSource } from "./evidence-match";
import { readBrandName } from "./site-brand";

const log = child({ module: "evidence-sources" });

export type EvidenceSourcesSnapshot = {
  sources: EvidenceSource[];
  /** Normalized brand terms never treated as third parties. */
  brand: string[];
  /** Display brand used in Jev questions. */
  brandLabel: string;
};

/** The site plus the site its fallback_content_folder points to (one hop). */
export function evidenceSiteContexts(ctx: SiteContext): SiteContext[] {
  const out = [ctx];
  const fallback = ctx.config.fallbackContentFolder?.trim();
  if (fallback && fallback !== ctx.contentRootName) {
    const parent = [...getSiteContextMap().values()].find((c) => c.contentRootName === fallback);
    if (parent) out.push(parent);
  }
  return out;
}

async function sourcesFor(ctx: SiteContext): Promise<EvidenceSource[]> {
  const out: EvidenceSource[] = [];
  for (const { name, config } of ctx.database.list()) {
    const cfg = readEvidenceConfig(config.evidence);
    if (!cfg) continue;
    try {
      await ctx.database.fetchItems(name);
      const raw = ctx.database.getRawItems(name) ?? [];
      const mapped = ctx.database.getMappedItems(name, { includeRejected: true }) ?? raw;
      // Mapped field names (what staff pick in the dialog) plus the server keys, which only the raw row carries.
      // Paired by stored position over the full list so row refs stay true positions; rejected rows
      // keep their `_rejected` marker and the evidence index skips them.
      const rows = mapped.map((m, i) => {
        const r = raw[i] as Record<string, unknown> | undefined;
        const stamp = r?.[ROW_STAMP_KEY];
        const archive = r?.[ARCHIVE_KEY];
        const rejected = isRowRejected(r) ? r?.[REJECTED_KEY] : undefined;
        return {
          ...m,
          ...(stamp ? { [ROW_STAMP_KEY]: stamp } : {}),
          ...(archive ? { [ARCHIVE_KEY]: archive } : {}),
          ...(rejected ? { [REJECTED_KEY]: rejected } : {}),
        };
      });
      out.push({ site: ctx.contentRootName, domain: ctx.config.domain, database: name, label: config.name || name, config: cfg, rows });
    } catch (err) {
      log.warn({ err, database: name, site: ctx.contentRootName }, "evidence database unavailable");
    }
  }
  return out;
}

export async function loadEvidenceSourcesForSite(ctx: SiteContext): Promise<EvidenceSourcesSnapshot> {
  const contexts = evidenceSiteContexts(ctx);
  const sources = (await Promise.all(contexts.map(sourcesFor))).flat();
  const brandNames = contexts.map((c) => readBrandName(c.contentRoot));
  const domainStems = contexts.map((c) => c.config.domain.split(".").slice(-2, -1)[0] ?? null);
  const brandLabel = brandNames.find(Boolean) ?? ctx.config.domain;
  return { sources, brand: brandTerms([...brandNames, ...domainStems]), brandLabel };
}
