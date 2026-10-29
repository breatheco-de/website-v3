import type { SeoMeta } from "@/components/DebugBubble/types";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import {
  buildMetaSaveOperations,
  liveSnippetClearBlocked,
  withExplicitIndexRobots,
  type MetaSaveOperation,
} from "@/lib/buildMetaSaveOperations";

export const VISIBILITY_META_KEYS = [
  "robots",
  "priority",
  "change_frequency",
] as const;

export type VisibilityKey = (typeof VISIBILITY_META_KEYS)[number];

export type LocaleVisibilityRow = {
  locale: string;
  robots: string;
  priority: string;
  change_frequency: string;
  inherited_robots: string;
};

export type LocaleVisibilityResponse = {
  supported: boolean;
  locales: LocaleVisibilityRow[];
  current_inherited_robots: string;
};

/** Other live languages of an entry with their current crawl settings. */
export async function fetchLocaleVisibility(opts: {
  contentType: string;
  slug: string;
  locale: string;
}): Promise<LocaleVisibilityResponse> {
  const headers = await authHeaders();
  const params = new URLSearchParams({ locale: opts.locale });
  const res = await fetch(
    `/api/seo-preview/${encodeURIComponent(opts.contentType)}/${encodeURIComponent(opts.slug)}/locale-visibility?${params}`,
    { headers },
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to load other languages");
  }
  return (await res.json()) as LocaleVisibilityResponse;
}

export const OPTIONAL_META_KEYS = ["canonical_url", "og_image"] as const;

export const SNIPPET_META_KEYS = ["page_title", "description"] as const;

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getDebugToken();
  if (token) headers["X-Debug-Token"] = token;
  return headers;
}

export async function postMetaPatch(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: MetaSaveOperation[];
  variant?: string;
}): Promise<void> {
  if (opts.operations.length === 0) return;
  const headers = await authHeaders();
  const author = await resolveAuthorName();
  const body: Record<string, unknown> = {
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    author: author || undefined,
    operations: opts.operations,
  };
  if (opts.variant) body.variant = opts.variant;
  const res = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to save meta");
  }
}

export async function saveLandingLocations(opts: {
  slug: string;
  locations: string[];
}): Promise<void> {
  const headers = await authHeaders();
  const author = await resolveAuthorName();
  const res = await fetch("/api/content/update-locations", {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentType: "landing",
      slug: opts.slug,
      locations: opts.locations,
      author: author || undefined,
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to save locations");
  }
}

function opsForDirtyKeys(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Iterable<string>;
  },
): MetaSaveOperation[] {
  return buildMetaSaveOperations({
    ...input,
    dirtyKeys: new Set(input.dirtyKeys),
  });
}

export function buildVisibilityOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...VISIBILITY_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export function buildOptionalMetaOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...OPTIONAL_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export function buildSnippetOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...SNIPPET_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export type MetaSaveContext = {
  context: "live" | "variant";
  seoMeta: SeoMeta;
  dirtyKeys: Set<string>;
  displayMeta?: Record<string, unknown>;
  liveMeta?: Record<string, unknown>;
  metaOverrides?: string[];
};

export async function saveVisibilitySettings(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
    /** Page-wide robots under this locale (live only); see withExplicitIndexRobots. */
    inheritedRobots?: string;
  },
): Promise<void> {
  const built = buildVisibilityOperations(ctx);
  const operations =
    ctx.context === "live" ? withExplicitIndexRobots(built, ctx.inheritedRobots) : built;
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}

export type VisibilityLocaleTarget = { locale: string; inherited_robots?: string };

/** Copy chosen visibility fields to other live languages (one patch each, keeps going on failure). */
export async function saveVisibilityToLocales(opts: {
  contentType: string;
  slug: string;
  seoMeta: SeoMeta;
  copyKeys: readonly VisibilityKey[];
  targets: readonly VisibilityLocaleTarget[];
}): Promise<{ saved: string[]; failed: string[] }> {
  const saved: string[] = [];
  const failed: string[] = [];
  if (opts.copyKeys.length === 0) return { saved, failed };
  for (const target of opts.targets) {
    const operations = withExplicitIndexRobots(
      buildMetaSaveOperations({
        context: "live",
        seoMeta: opts.seoMeta,
        dirtyKeys: new Set(opts.copyKeys),
      }),
      target.inherited_robots,
    );
    try {
      await postMetaPatch({
        contentType: opts.contentType,
        slug: opts.slug,
        locale: target.locale,
        operations,
      });
      saved.push(target.locale);
    } catch {
      failed.push(target.locale);
    }
  }
  return { saved, failed };
}

export async function saveOptionalMetaFields(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
    keys: readonly string[];
  },
): Promise<void> {
  const operations = buildOptionalMetaOperations({
    ...ctx,
    dirtyKeys: new Set([...ctx.dirtyKeys].filter((k) => ctx.keys.includes(k))),
  });
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}

export async function saveSnippetMeta(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  },
): Promise<void> {
  if (ctx.context === "live" && liveSnippetClearBlocked(ctx.seoMeta, ctx.dirtyKeys)) {
    throw new Error(
      "Title and description cannot be cleared on a live locale. Enter a value or cancel.",
    );
  }
  const operations = buildSnippetOperations(ctx);
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}
