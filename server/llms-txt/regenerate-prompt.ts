/**
 * Build CMS inputs + OpenRouter prompt for llms_txt_regenerate (job-only).
 */

import fs from "fs";
import path from "path";
import { contentIndex } from "../content-index";
import { loadResolvedSchemaConfig } from "../schema-org";
import { getVariableManager } from "../variable-manager";
import { listProductRows, readEntryProduct } from "../product/product-io";
import { scanProductContent } from "../product/product-index";
import { getDefaultContentRoot } from "../site-config";

export const LLMS_TEMPLATE_BASENAME = "llms.template.md";
/** On-disk name (stable); code refers to this as the llms.txt prompt. */
export const LLMS_TXT_PROMPT_BASENAME = "llms.regenerate-prompt.md";

/** Job input slots filled at regenerate time (not CMS Variables). */
export const LLMS_PROMPT_INPUT_SLOTS = [
  "company_profile",
  "site_facts",
  "products",
  "pages",
  "previous_llms_txt",
] as const;

export type LlmsPromptInputSlot = (typeof LLMS_PROMPT_INPUT_SLOTS)[number];

export const LLMS_PROMPT_INPUT_SLOT_INFO: Record<LlmsPromptInputSlot, string> = {
  company_profile: "Organization facts from schema.org (name, what it does, regions, languages).",
  site_facts: "Approved site figures from Variables (placement rates, ratings, etc.).",
  products: "Products currently for sale (names, EN/ES URLs, descriptions).",
  pages: "Approved marketing pages with titles, URLs, sections, and locales.",
  previous_llms_txt: "The current llms.template.md body, so wording stays stable when inputs are unchanged.",
};

export const PAGES_DENYLIST = new Set([
  "cookies",
  "privacy-policy",
  "terms-conditions",
  "sample-page",
]);

export const PAGES_CAP = 30;

export type LlmsPageSection =
  | "admissions"
  | "company_learn"
  | "outcomes_or_resources"
  | "company";

export type LlmsPageRow = {
  title: string;
  url: string;
  section: LlmsPageSection;
  meta_description: string;
  slug: string;
  locale: string;
};

export type LlmsTxtInputs = {
  company_profile: string;
  site_facts: string;
  products: string;
  pages: string;
  previous_llms_txt: string;
  pageRows: LlmsPageRow[];
};

function siteBaseUrl(): string {
  return (process.env.SITE_URL || "http://localhost:5000").replace(/\/$/, "");
}

export function llmsTemplatePath(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, LLMS_TEMPLATE_BASENAME);
}

export function readLlmsTemplate(contentRoot?: string): string | null {
  const p = llmsTemplatePath(contentRoot);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

export function llmsTxtPromptPath(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, LLMS_TXT_PROMPT_BASENAME);
}

/** Staff-edited llms.txt job instructions. Null when missing or empty. */
export function readLlmsTxtPrompt(contentRoot?: string): string | null {
  const p = llmsTxtPromptPath(contentRoot);
  if (!fs.existsSync(p)) return null;
  const body = fs.readFileSync(p, "utf-8");
  return body.trim() ? body : null;
}

export function writeLlmsTxtPrompt(body: string, contentRoot?: string): void {
  const p = llmsTxtPromptPath(contentRoot);
  const normalized = body.endsWith("\n") ? body : `${body}\n`;
  fs.writeFileSync(p, normalized, "utf-8");
}

export function absolutizePath(pathname: string, baseUrl = siteBaseUrl()): string {
  if (!pathname) return baseUrl;
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const pathPart = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${pathPart}`;
}

/** Map page slug → llms section bucket for the prompt. */
export function pageSectionForSlug(slug: string): LlmsPageSection {
  const s = slug.toLowerCase();
  if (
    /financial|financ|contact|faq|dates|tuition|payment|scholarship|apply|admissions?/.test(s)
  ) {
    return "admissions";
  }
  if (/academy|partners?|awards?|about|team|teachers|mentors/.test(s)) {
    return "company_learn";
  }
  if (/blog|press|testimonial|graduate|outcome|career|success|resource|guide/.test(s)) {
    return "outcomes_or_resources";
  }
  return "company";
}

function parsePriority(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null;
  const raw = meta.priority;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isNoindex(meta: Record<string, unknown> | undefined): boolean {
  const robots = typeof meta?.robots === "string" ? meta.robots : "";
  return robots.toLowerCase().includes("noindex");
}

export function buildCompanyProfileInput(contentRoot?: string): string {
  const config = loadResolvedSchemaConfig(contentRoot, "en");
  const org = config.organization ?? config;
  return JSON.stringify(org, null, 2);
}

export function buildSiteFactsInput(contentRoot?: string): string {
  const vm = getVariableManager(contentRoot);
  const defs = vm.getDefinitions();
  const rows: Array<{
    name: string;
    token: string;
    description?: string;
    value: string;
    unit?: string;
    region?: string;
    products?: string[];
  }> = [];

  for (const [name, def] of Object.entries(defs)) {
    if (def.source !== "internal") continue;
    const { text } = vm.resolveString(`{{ ${name} }}`, { locale: "en" });
    const regions = def.by_region ? Object.keys(def.by_region) : undefined;
    rows.push({
      name,
      token: `{{ ${name} }}`,
      ...(def.description ? { description: def.description } : {}),
      value: text.includes("{{") ? String(def.default ?? "") : text,
      ...(def.unit ? { unit: def.unit } : {}),
      ...(regions?.length ? { region: regions.join(", ") } : {}),
      ...(def.products?.length ? { products: def.products } : {}),
    });
  }

  return JSON.stringify(rows, null, 2);
}

export function buildProductsInput(contentRoot?: string): string {
  // Sidequest worker has no web boot scan — ensure the product index is warm.
  scanProductContent(contentRoot);
  const base = siteBaseUrl();
  const rows = listProductRows({
    contentRoot,
    includePaused: false,
    includeRemoved: false,
  }).filter((r) => r.actively_selling && r.purchasable);

  const out = rows.map((row) => {
    const snap = readEntryProduct(row.content_type, row.content_slug, contentRoot);
    const urlsAbs: Record<string, string> = {};
    for (const [loc, href] of Object.entries(row.urls || {})) {
      urlsAbs[loc] = absolutizePath(href, base);
    }
    return {
      name: row.name,
      content_slug: row.content_slug,
      urls: urlsAbs,
      description: snap?.description,
      offer: snap?.offer
        ? {
            one_liner: snap.offer.one_liner,
            who_its_for: snap.offer.who_its_for,
            who_its_not_for: snap.offer.who_its_not_for,
            outcomes: snap.offer.outcomes,
            differentiators: snap.offer.differentiators,
          }
        : undefined,
      personas: (snap?.personas ?? []).map((p) => ({
        id: p.id,
        role: p.role,
        label: p.label,
      })),
    };
  });

  return JSON.stringify(out, null, 2);
}

export function buildPagesInput(_contentRoot?: string): { json: string; rows: LlmsPageRow[] } {
  const base = siteBaseUrl();
  const ci = contentIndex;
  const entries = ci.findByType("page");
  const rows: LlmsPageRow[] = [];

  for (const entry of entries) {
    if (PAGES_DENYLIST.has(entry.slug)) continue;
    const locales = entry.locales?.length ? entry.locales : ["en"];
    for (const locale of locales) {
      if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) continue;
      const merged = ci.loadMergedContent("page", entry.slug, locale);
      if (!merged?.data || merged.error) continue;
      const data = merged.data as Record<string, unknown>;
      const meta = (data.meta as Record<string, unknown> | undefined) || undefined;
      const priority = parsePriority(meta);
      if (priority === null || priority < 0.8) continue;
      if (isNoindex(meta)) continue;

      const alts = ci.getAlternateUrls(entry.slug, "page") ?? {};
      const pathForLocale = alts[locale] || alts.en || Object.values(alts)[0];
      if (!pathForLocale) continue;

      const title =
        (typeof data.title === "string" && data.title.trim()) ||
        (typeof meta?.page_title === "string" && String(meta.page_title).trim()) ||
        entry.title ||
        entry.slug;
      const metaDescription =
        typeof meta?.description === "string" ? meta.description.trim() : "";

      rows.push({
        title,
        url: absolutizePath(pathForLocale, base),
        section: pageSectionForSlug(entry.slug),
        meta_description: metaDescription,
        slug: entry.slug,
        locale,
      });

      if (rows.length >= PAGES_CAP) break;
    }
    if (rows.length >= PAGES_CAP) break;
  }

  rows.sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title));
  return { json: JSON.stringify(rows, null, 2), rows };
}

export function buildLlmsTxtInputs(contentRoot?: string): LlmsTxtInputs {
  const pages = buildPagesInput(contentRoot);
  return {
    company_profile: buildCompanyProfileInput(contentRoot),
    site_facts: buildSiteFactsInput(contentRoot),
    products: buildProductsInput(contentRoot),
    pages: pages.json,
    previous_llms_txt: readLlmsTemplate(contentRoot) ?? "",
    pageRows: pages.rows,
  };
}

export function fillLlmsTxtPrompt(
  promptTemplate: string,
  vars: {
    company_profile: string;
    site_facts: string;
    products: string;
    pages: string;
    previous_llms_txt: string;
  },
): string {
  return promptTemplate
    .replaceAll("{{company_profile}}", vars.company_profile)
    .replaceAll("{{site_facts}}", vars.site_facts)
    .replaceAll("{{products}}", vars.products)
    .replaceAll("{{pages}}", vars.pages)
    .replaceAll("{{previous_llms_txt}}", vars.previous_llms_txt);
}
