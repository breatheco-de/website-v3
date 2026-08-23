import * as fs from "fs";
import * as path from "path";
import { getDefaultContentRoot } from "./site-config";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { getFolder } from "./content-types";
import { getHomePage, getSupportedLocales, getDefaultLocale } from "./settings";

import yaml from "js-yaml";

const DEFAULT_CONTENT_ROOT = getDefaultContentRoot();

function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

export interface ParsedRoute {
  contentType: string;
  slug: string;
  locale: string;
}

export function parseRoute(
  url: string,
  ci: typeof contentIndex = contentIndex,
): ParsedRoute | null {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const supportedLocales = getSupportedLocales();
  const defaultLocale = getDefaultLocale();
  const localeSegmentMatch = cleanUrl.match(/^\/([a-z]{2,3})\/?$/);
  const isHomepage =
    cleanUrl === "/" ||
    (localeSegmentMatch !== null && supportedLocales.includes(localeSegmentMatch[1]));
  if (isHomepage) {
    const homePage = getHomePage();
    if (!homePage?.type || !homePage?.slug) return null;
    const locale =
      localeSegmentMatch && supportedLocales.includes(localeSegmentMatch[1])
        ? localeSegmentMatch[1]
        : defaultLocale;
    return { contentType: homePage.type, slug: homePage.slug, locale };
  }

  const resolved = ci.resolveUrl(cleanUrl);
  if (resolved && !resolved.fromDatabase) {
    let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
    if (resolved.params?.locale) {
      locale = resolved.params.locale;
    } else if (!cleanUrl.match(/^\/(en|es)\b/)) {
      const commonData = ci.loadCommonData(resolved.contentType, resolved.slug);
      if (commonData?.locale && typeof commonData.locale === "string") {
        locale = commonData.locale;
      }
    }
    return { contentType: resolved.contentType, slug: resolved.slug, locale };
  }

  return null;
}

export function loadRawYaml(
  contentType: string,
  slug: string,
  locale: string,
  ci: typeof contentIndex = contentIndex,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): Record<string, unknown> | null {
  const resolvedSlug = ci.resolveBaseSlug(slug, contentType);
  const folder = getFolder(contentType);
  const contentDir = path.join(contentRoot, folder, resolvedSlug);
  const commonPath = path.join(contentDir, "_common.yml");

  const contentPath = path.join(contentDir, `${locale}.yml`);

  if (!fs.existsSync(contentPath)) return null;

  try {
    let commonData: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      commonData = safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>;
    }

    const contentData = safeYamlLoad(fs.readFileSync(contentPath, "utf-8")) as Record<string, unknown>;
    return deepMerge(commonData, contentData);
  } catch {
    return null;
  }
}
