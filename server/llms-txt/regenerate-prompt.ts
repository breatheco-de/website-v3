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

export const LLMS_TXT_REGENERATE_PROMPT = `You write the llms.txt file for 4geeks.com. AI assistants read this file to
understand 4Geeks Academy and find its most important pages.

You only write. You do not decide what is true. Use ONLY the data in the
inputs below. If something is not in the inputs, leave it out.

## Inputs

<company_profile>
{{company_profile}}
</company_profile>
Fixed company facts: name, what it does, accreditation, regions, languages.

<site_facts>
{{site_facts}}
</site_facts>
Approved figures. Each one has: name, token (e.g. {{ global.xxx }}), description,
value, unit, region, products.
Use site_facts for outcome-style figures (placement rate, salary increase, ratings,
ratios). Prefer writing the token field in the template so values stay dynamic
(e.g. {{ global.global_job_placement_rate }}% with the unit). Do not invent tokens.
Do NOT use site_facts price_* (or any tuition/payment amounts) in the blockquote,
Key facts, or page link notes. Do NOT infer which programs exist from price variable
names, descriptions, or a fact's products[] field. site_facts are not a product
catalog — product detail belongs in ## Programs.

<products>
{{products}}
</products>
Products currently for sale. Each one has: name, EN and ES URLs, description,
audience / offer fields, personas.
THIS is the only source for which programs/products are offered and their names.
If this list is empty, leave "## Programs" with no links — do not invent programs.

<pages>
{{pages}}
</pages>
Approved pages. Each one has: title, URL, section, meta description, locale (en/es).
section values (server-chosen; do not invent pages):
- admissions → "## Admissions, cost and support" (EN locale rows only)
- company_learn → "## How students learn" (EN locale rows only)
- outcomes_or_resources → "## Outcomes and proof" or "## Learning resources"
  (EN locale rows only; prefer Learning resources when title/meta is a guide,
  blog hub, or resource)
- company → "## Optional" (EN locale rows only)
All ES locale page rows go under "## En español" (not under the EN section H2s).
Prefer company / admissions / outcomes framing when wording link notes.
Never invent URLs; never drop or add pages outside this input.
Write each link note by paraphrasing title + meta description (: one sentence ≤ ~20 words).
Do not copy prices or dollar amounts from meta into link notes.

<previous_version>
{{previous_llms_txt}}
</previous_version>
The current published file. Keep its wording wherever the inputs did not
change, so the file stays stable from one run to the next.

## Output format

Return only the file content, in this exact structure:

# 4Geeks Academy

> One paragraph, 2 to 3 sentences: what 4Geeks is, who it trains, and up to
> 3 non-price figures from site_facts (prefer tokens).

Key facts:
- 4 to 8 bullets. High-level only: what 4Geeks offers in broad terms (e.g. career
  programs and flexible AI paths), a few non-price figures from site_facts
  (tokens), mentorship/career support if in the inputs, and that prices vary by
  country (send readers to the product page — no dollar amounts).
- Do NOT name or describe specific products here (no per-product audience,
  duration, or feature bullets). That detail belongs under ## Programs.

## Programs
## Outcomes and proof
## Admissions, cost and support
## How students learn
## Learning resources
## En español
## Optional

Each link goes on one line: - [Title](URL): description
- Description: one sentence, 20 words or fewer.
- ## Programs: one EN link per product from <products> (do not put ES product
  URLs here — side-by-side EN/ES looks like two different products).
- ## En español: Spanish descriptions. Include each product's ES URL (when
  present) and every pages row with locale es. Do not duplicate EN URLs here.
- EN page rows: place under the H2 matching their section (above).
- Use the section each EN page has in the input. Do not move EN pages between
  sections.

## Rules

- Program / product names and "what we offer" come ONLY from <products>, never
  from site_facts variable names (price_fullstack, cybersecurity, etc.).
- Never write a tuition, monthly payment, or dollar amount in the blockquote,
  Key facts, or page notes. Price talk only as "prices vary by country" unless
  a product note truly needs a figure that appears on that product's own data.
- Non-price figures (placement, salary increase, ratings): only from site_facts;
  prefer the token field over baking the literal value.
- Never add a URL that is not in products or pages.
- Never describe a product with a feature, audience or duration that is not
  in its data.
- Use plain, factual sentences. No marketing language, no superlatives, no
  em-dashes.
- English everywhere except "## En español".
- The whole file must be under 5 KB.
`;

export function fillLlmsTxtPrompt(vars: {
  company_profile: string;
  site_facts: string;
  products: string;
  pages: string;
  previous_llms_txt: string;
}): string {
  return LLMS_TXT_REGENERATE_PROMPT
    .replace("{{company_profile}}", vars.company_profile)
    .replace("{{site_facts}}", vars.site_facts)
    .replace("{{products}}", vars.products)
    .replace("{{pages}}", vars.pages)
    .replace("{{previous_llms_txt}}", vars.previous_llms_txt);
}
