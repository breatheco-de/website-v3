/**
 * Full-page preview data for /private/page-preview: every section of an
 * entry (live or a draft/variant, one locale) or of an ad-hoc page demo,
 * resolved like public delivery (dynamic entries, template vars) so the
 * render review measures what visitors would see. Header/footer are not
 * included — the review is about the page body.
 */
import type { ContentIndex } from "../content-index";
import { deliveredFingerprint } from "./fingerprint";
import type { PagePreviewSource } from "../entry-preview-capture-auth";
import { readPageDemo } from "../component-section-demos";
import { loadEntryForDelivery } from "../entry-delivery";
import { resolveDynamicEntries } from "../dynamic-entries";
import { applyComponentImageSizes } from "../component-registry";
import { resolveAllTemplateVars } from "../resolve-template-vars";
import { layoutInfoForEntry } from "../layout-owner";

export interface PagePreviewData {
  source: PagePreviewSource["source"];
  locale: string;
  sections: Array<Record<string, unknown>>;
  /** Structural fingerprint of the stored (unresolved) sections. */
  fingerprint: string;
  layout_owner?: string;
  title?: string;
  singleEntry?: Record<string, unknown>;
}

export async function loadPagePreviewData(
  ci: ContentIndex,
  p: PagePreviewSource,
): Promise<{ ok: true; data: PagePreviewData } | { ok: false; status: number; error: string }> {
  if (p.source === "demo") {
    const demo = readPageDemo(p.hash);
    if (!demo) return { ok: false, status: 404, error: "Page demo not found (it may have expired after a redeploy)" };
    const sections = (await resolveDynamicEntries(demo.sections, demo.locale, {
      contentRoot: ci.contentRoot,
      contentIndex: ci,
    })) as Array<Record<string, unknown>>;
    applyComponentImageSizes(sections);
    const resolved = resolveAllTemplateVars(
      { sections },
      { contentRoot: ci.contentRoot, context: { locale: demo.locale } },
    ) as { sections: Array<Record<string, unknown>> };
    return {
      ok: true,
      data: {
        source: "demo",
        locale: demo.locale,
        sections: resolved.sections,
        fingerprint: deliveredFingerprint(demo.sections),
        ...(demo.title ? { title: demo.title } : {}),
      },
    };
  }

  const delivered = await loadEntryForDelivery(ci, p.contentType, p.slug, p.locale, {
    ...(p.variant ? { entryVariant: p.variant } : {}),
  });
  if (!delivered) {
    return {
      ok: false,
      status: 404,
      error: `No ${p.variant ? `variant "${p.variant}"` : "live page"} for ${p.contentType}/${p.slug} in ${p.locale}`,
    };
  }
  const pageData = delivered.data;
  const stored = Array.isArray(pageData.sections) ? (pageData.sections as Array<Record<string, unknown>>) : [];
  const fingerprint = deliveredFingerprint(stored);
  const singleEntry = delivered.singleEntry;
  const sections = (await resolveDynamicEntries(stored, p.locale, {
    contentRoot: ci.contentRoot,
    contentIndex: ci,
    singleEntry,
  })) as Array<Record<string, unknown>>;
  applyComponentImageSizes(sections);
  const resolved = resolveAllTemplateVars(
    { ...pageData, sections },
    {
      ...(singleEntry && Object.keys(singleEntry).length > 0 ? { singleEntry } : {}),
      contentType: p.contentType,
      contentRoot: ci.contentRoot,
      context: { locale: p.locale },
    },
  ) as { sections: Array<Record<string, unknown>>; meta?: { page_title?: unknown } };
  const layout = layoutInfoForEntry(p.contentType, p.slug, ci.contentRoot);
  return {
    ok: true,
    data: {
      source: "entry",
      locale: p.locale,
      sections: resolved.sections ?? [],
      fingerprint,
      layout_owner: layout.layout_owner,
      ...(typeof resolved.meta?.page_title === "string" ? { title: resolved.meta.page_title } : {}),
      ...(singleEntry ? { singleEntry } : {}),
    },
  };
}

/** Parse /api/page-preview query params into a source (null when incomplete). */
export function pagePreviewSourceFromQuery(q: Record<string, unknown>): PagePreviewSource | null {
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string).trim() : "");
  if (s("source") === "demo") {
    const hash = s("hash");
    return /^[a-f0-9]{32}$/.test(hash) ? { source: "demo", hash } : null;
  }
  const contentType = s("content_type");
  const slug = s("slug");
  if (!contentType || !slug) return null;
  return {
    source: "entry",
    contentType,
    slug,
    locale: s("locale") || "en",
    ...(s("variant") ? { variant: s("variant") } : {}),
  };
}
