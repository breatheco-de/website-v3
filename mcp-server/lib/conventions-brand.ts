/**
 * Resolve site brand for bootstrap_agent conventions rendering.
 * Inject brand.title + domain when site is known (passed site or sole configured site).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  getMcpSiteConfigs,
  resolveSiteContext,
} from "./content.js";

export type ConventionsBrandMode = "branded" | "generic";

export interface ConventionsBranding {
  mode: ConventionsBrandMode;
  site?: string;
  brand_title?: string;
}

export interface RenderConventionsOpts {
  mode: ConventionsBrandMode;
  brandTitle?: string;
  siteDomain?: string;
}

const TOKEN_BRAND = "{{BRAND_TITLE}}";
const TOKEN_DOMAIN = "{{SITE_DOMAIN}}";

/** Read brand.title.default from a site's variables.yml; null if missing. */
export function readBrandTitleFromVariables(contentPath: string): string | null {
  const varsPath = path.join(contentPath, "variables.yml");
  if (!fs.existsSync(varsPath)) return null;
  try {
    const raw = fs.readFileSync(varsPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const entry = parsed["brand.title"];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const def = (entry as Record<string, unknown>).default;
      if (typeof def === "string" && def.trim()) return def.trim();
    }
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve branding for bootstrap. When site is passed and unknown → ok:false with resolveSiteContext error JSON.
 * Multi-site with no site → generic mode (success). Sole site or matched site → branded.
 */
export function resolveConventionsBranding(site?: string):
  | { ok: true; branding: ConventionsBranding; contentPath?: string }
  | { ok: false; error: string } {
  const normalized = typeof site === "string" ? site.trim() : "";
  const configs = getMcpSiteConfigs();

  if (normalized) {
    const siteResult = resolveSiteContext(normalized);
    if (!siteResult.ok) {
      return { ok: false, error: siteResult.error };
    }
    const brandTitle =
      readBrandTitleFromVariables(siteResult.contentPath) ??
      siteResult.domain;
    return {
      ok: true,
      contentPath: siteResult.contentPath,
      branding: {
        mode: "branded",
        site: siteResult.domain,
        brand_title: brandTitle,
      },
    };
  }

  if (configs.length === 1) {
    const siteResult = resolveSiteContext(undefined);
    if (!siteResult.ok) {
      return {
        ok: true,
        branding: { mode: "generic" },
      };
    }
    const brandTitle =
      readBrandTitleFromVariables(siteResult.contentPath) ??
      siteResult.domain;
    return {
      ok: true,
      contentPath: siteResult.contentPath,
      branding: {
        mode: "branded",
        site: siteResult.domain,
        brand_title: brandTitle,
      },
    };
  }

  return { ok: true, branding: { mode: "generic" } };
}

/**
 * Substitute tokens so agents never see raw {{BRAND_TITLE}} / {{SITE_DOMAIN}}.
 * branded: real values; generic: instructional placeholders.
 */
export function renderConventionsMarkdown(
  template: string,
  opts: RenderConventionsOpts,
): string {
  if (opts.mode === "branded") {
    const brand = (opts.brandTitle ?? "this site").trim() || "this site";
    const domain = (opts.siteDomain ?? "{site}").trim() || "{site}";
    return template
      .split(TOKEN_BRAND)
      .join(brand)
      .split(TOKEN_DOMAIN)
      .join(domain);
  }
  return template
    .split(TOKEN_BRAND)
    .join("this site")
    .split(TOKEN_DOMAIN)
    .join("{site}");
}
