import { useEffect } from "react";
import { toOgLocale } from "@shared/locale";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveTemplateString } from "@/lib/variable-manager";

export interface PageMeta {
  page_title?: string;
  description?: string;
  robots?: string;
  og_image?: string;
  canonical_url?: string;
  pagination_prev?: string;
  pagination_next?: string;
  priority?: number;
  change_frequency?: string;
  redirects?: string[];
  alternates?: Record<string, string>;
}

function resolveMetaString(
  raw: string | undefined,
  definitions: ReturnType<typeof useVariableDefinitions>["data"],
  context: ReturnType<typeof useVariableContext>,
): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  if (!raw.includes("{{")) return raw;
  if (!definitions) return undefined;
  const { text } = resolveTemplateString(raw, definitions, context);
  if (text.includes("{{")) return undefined;
  return text;
}

export function usePageMeta(meta: PageMeta | undefined, locale?: string) {
  const { data: definitions } = useVariableDefinitions();
  const varContext = useVariableContext();
  const ctxLocation = varContext.location;
  const ctxRegion = varContext.region;
  const ctxLocale = varContext.locale;

  useEffect(() => {
    if (!meta) return;

    const originalTitle = document.title;
    const addedElements: Element[] = [];
    const modifiedElements: Map<Element, string> = new Map();

    const resolveCtx = { location: ctxLocation, region: ctxRegion, locale: ctxLocale };
    const pageTitle = resolveMetaString(meta.page_title, definitions, resolveCtx);
    const description = resolveMetaString(meta.description, definitions, resolveCtx);

    const setMeta = (name: string, content: string, isProperty = false) => {
      const attr = isProperty ? "property" : "name";
      let element = document.querySelector(`meta[${attr}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attr, name);
        document.head.appendChild(element);
        addedElements.push(element);
      } else {
        modifiedElements.set(element, element.getAttribute("content") || "");
      }
      element.setAttribute("content", content);
    };

    if (pageTitle) {
      document.title = pageTitle;
      setMeta("og:title", pageTitle, true);
      setMeta("twitter:title", pageTitle);
    }

    if (description) {
      setMeta("description", description);
      setMeta("og:description", description, true);
      setMeta("twitter:description", description);
    }

    if (meta.robots) {
      setMeta("robots", meta.robots);
    }

    if (meta.og_image) {
      setMeta("og:image", meta.og_image, true);
      setMeta("twitter:image", meta.og_image);
    }

    if (locale) {
      setMeta("og:locale", toOgLocale(locale), true);
      document.documentElement.lang = locale;
    }

    let originalCanonical: string | null = null;
    let addedCanonical = false;
    let canonicalWasClientCreated = false;

    if (meta.canonical_url) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        link.setAttribute("data-pagemeta", "true");
        document.head.appendChild(link);
        addedCanonical = true;
        canonicalWasClientCreated = true;
      } else {
        canonicalWasClientCreated = link.hasAttribute("data-pagemeta");
        originalCanonical = link.href;
        if (!canonicalWasClientCreated) {
          link.setAttribute("data-pagemeta", "updating");
        }
      }
      link.href = meta.canonical_url;
    }

    const addedHreflangLinks: HTMLLinkElement[] = [];
    if (meta.alternates && Object.keys(meta.alternates).length > 0) {
      document.querySelectorAll('link[rel="alternate"][data-pagemeta]').forEach(el => el.remove());
      for (const [lang, href] of Object.entries(meta.alternates)) {
        const link = document.createElement("link");
        link.rel = "alternate";
        link.hreflang = lang;
        link.href = href;
        link.setAttribute("data-pagemeta", "true");
        document.head.appendChild(link);
        addedHreflangLinks.push(link);
      }
    }

    const addedPaginationLinks: HTMLLinkElement[] = [];
    document.querySelectorAll('link[data-pagemeta-pagination]').forEach(el => el.remove());

    if (meta.pagination_prev) {
      const link = document.createElement("link");
      link.rel = "prev";
      link.href = meta.pagination_prev;
      link.setAttribute("data-pagemeta-pagination", "true");
      document.head.appendChild(link);
      addedPaginationLinks.push(link);
    }

    if (meta.pagination_next) {
      const link = document.createElement("link");
      link.rel = "next";
      link.href = meta.pagination_next;
      link.setAttribute("data-pagemeta-pagination", "true");
      document.head.appendChild(link);
      addedPaginationLinks.push(link);
    }

    return () => {
      document.title = originalTitle;

      addedElements.forEach((el) => el.remove());
      addedHreflangLinks.forEach((el) => el.remove());
      addedPaginationLinks.forEach((el) => el.remove());

      modifiedElements.forEach((originalValue, element) => {
        if (originalValue) {
          element.setAttribute("content", originalValue);
        } else {
          element.removeAttribute("content");
        }
      });

      const canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (addedCanonical) {
        if (canonicalLink) canonicalLink.remove();
      } else if (originalCanonical !== null && canonicalLink) {
        canonicalLink.href = originalCanonical;
        if (!canonicalWasClientCreated) {
          canonicalLink.removeAttribute("data-pagemeta");
        }
      }
    };
  }, [meta, locale, definitions, ctxLocation, ctxRegion, ctxLocale]);
}
