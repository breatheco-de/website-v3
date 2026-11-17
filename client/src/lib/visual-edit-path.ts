import { saveEditModeScrollPosition } from "@/lib/editModeScroll";
import { normalizeLocale } from "@/lib/locale";

/** Public content pages and `/private/preview/*` can use Edit/Read + device chrome. Admin `/private/*` cannot. */
export function isVisualEditPath(pathname: string): boolean {
  const isPrivate =
    pathname === "/private" || pathname.startsWith("/private/");
  if (!isPrivate) return true;
  return isPrivatePreviewPath(pathname);
}

export function isPrivatePreviewPath(pathname: string): boolean {
  return pathname === "/private/preview" || pathname.startsWith("/private/preview/");
}

/** Staff preview URL for a public content page. Returns null when already on `/private/preview`. */
export function buildPrivatePreviewHref(opts: {
  contentType: string;
  slug: string;
  pathname: string;
  search?: string;
  fallbackLocale?: string;
}): string | null {
  if (isPrivatePreviewPath(opts.pathname)) return null;

  const pathSeg = opts.pathname.split("/").filter(Boolean)[0];
  const hasPathLocale = !!pathSeg && /^[a-z]{2}$/.test(pathSeg);
  const params = new URLSearchParams(opts.search ?? "");
  const locale = normalizeLocale(
    hasPathLocale ? pathSeg : params.get("locale") || opts.fallbackLocale || "en",
  );
  const variant = params.get("variant") || params.get("force_variant");

  const qs = new URLSearchParams();
  qs.set("locale", locale);
  if (variant) qs.set("variant", variant);
  const location = params.get("location");
  if (location) qs.set("location", location);
  const previewMode = params.get("preview_mode");
  if (previewMode) qs.set("preview_mode", previewMode);
  return `/private/preview/${opts.contentType}/${opts.slug}?${qs.toString()}`;
}

/**
 * Turn on edit mode and, when type+slug are known, open `/private/preview/...`.
 * Stays on the current URL when type/slug cannot be inferred or the page is already preview.
 */
export function enterVisualEditMode(opts: {
  enableEditMode: () => void;
  navigate: (href: string) => void;
  pathname: string;
  search?: string;
  contentType?: string | null;
  slug?: string | null;
  fallbackLocale?: string;
}): { navigated: boolean; href: string | null } {
  opts.enableEditMode();

  const contentType = opts.contentType?.trim() || "";
  const slug = opts.slug?.trim() || "";
  if (!contentType || !slug) {
    return { navigated: false, href: null };
  }

  const href = buildPrivatePreviewHref({
    contentType,
    slug,
    pathname: opts.pathname,
    search: opts.search,
    fallbackLocale: opts.fallbackLocale,
  });
  if (!href) {
    return { navigated: false, href: null };
  }

  saveEditModeScrollPosition();
  opts.navigate(href);
  return { navigated: true, href };
}
