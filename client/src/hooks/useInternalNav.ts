import { useEffect } from "react";
import { useLocation } from "wouter";
import { usePageSections } from "@/contexts/PageSectionsContext";
import { isDeviceEmbedPreview, notifyDeviceEmbedNavBlocked, shouldAllowDeviceEmbedHref } from "@/lib/preview-devices";
import { scrollToSectionWhenReady } from "@/hooks/useScrollToLocationHashWhenReady";
import { isNonNavigableHref } from "@shared/safe-href";

function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** Replace {qs:paramName} and {qs:paramName|fallback} tokens with values from
 *  the current URL's querystring.
 *  - If the named param is present: use its value.
 *  - If absent and a fallback is provided (e.g. {qs:cohort|bootcamp-2025}): use the fallback.
 *  - If absent and no fallback: strip the entire key=value pair from the URL. */
function resolveQsTokens(str: string): string {
  const hashIdx = str.indexOf("#");
  const hash = hashIdx === -1 ? "" : str.slice(hashIdx);
  const withoutHash = hashIdx === -1 ? str : str.slice(0, hashIdx);

  const qIdx = withoutHash.indexOf("?");
  if (qIdx === -1) return str;

  const urlParams = new URLSearchParams(window.location.search);
  const base = withoutHash.slice(0, qIdx);
  const pairs = withoutHash.slice(qIdx + 1).split("&").filter(Boolean);

  const resolved = pairs
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) return pair;
      const k = pair.slice(0, eqIdx);
      const v = pair.slice(eqIdx + 1);
      const match = v.match(/^\{qs:([^|}\s]+)(?:\|([^}]*))?\}$/);
      if (match) {
        const paramName = match[1];
        const fallback = match[2]; // undefined if no fallback was specified
        const val = urlParams.get(paramName);
        if (val !== null) return `${k}=${encodeURIComponent(val.trim())}`;
        if (fallback !== undefined) return `${k}=${encodeURIComponent(fallback.trim())}`;
        return null; // no value, no fallback → strip pair
      }
      return pair;
    })
    .filter((p): p is string => p !== null);

  const withSearch = resolved.length > 0 ? `${base}?${resolved.join("&")}` : base;
  return `${withSearch}${hash}`;
}

/**
 * Resolve {{ name | resolved_value }} templates (edit-mode preserveTemplate).
 * Unwraps whole-href templates and inline values in query/path.
 */
export function resolveGlobalTemplate(href: string): string {
  if (!href.includes("{{")) return href;
  const exact = href.match(/^\{\{\s*\S+\s*\|\s*([\s\S]+?)\s*\}\}$/);
  if (exact) return exact[1].trim();
  return href.replace(/\{\{\s*\S+\s*\|\s*([\s\S]+?)\s*\}\}/g, (_m, val: string) => val.trim());
}

/**
 * Move `?…` authored after `#` into the search string.
 * `#id?a=1` → `?a=1#id`; `/path#id?a=1` → `/path?a=1#id`.
 */
export function normalizeHashQuery(href: string): string {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return href;

  const before = href.slice(0, hashIdx);
  const afterHash = href.slice(hashIdx + 1);
  const qInHash = afterHash.indexOf("?");
  if (qInHash === -1) return href;

  const id = afterHash.slice(0, qInHash);
  const hashQuery = afterHash.slice(qInHash + 1);
  if (!hashQuery) return id ? `${before}#${id}` : before;

  const qIdx = before.indexOf("?");
  const path = qIdx === -1 ? before : before.slice(0, qIdx);
  const existingSearch = qIdx === -1 ? "" : before.slice(qIdx + 1);
  const merged = mergeSearch(existingSearch ? `?${existingSearch}` : "", hashQuery);
  return id ? `${path}${merged}#${id}` : `${path}${merged}`;
}

function prepareHref(raw: string): string {
  return normalizeHashQuery(resolveQsTokens(resolveGlobalTemplate(raw)));
}

/** For a hash URL like "#pricing?cohort=x", separate the element id from the extra querystring */
function parseHashHref(href: string): { id: string; extraSearch: string } {
  const withoutHash = href.slice(1);
  const qIdx = withoutHash.indexOf("?");
  if (qIdx === -1) return { id: withoutHash, extraSearch: "" };
  return {
    id: withoutHash.slice(0, qIdx),
    extraSearch: withoutHash.slice(qIdx + 1),
  };
}

/** Merge two querystrings — extra params are set on top of existing ones */
function mergeSearch(existing: string, extra: string): string {
  if (!extra) return existing;
  const base = new URLSearchParams(existing.startsWith("?") ? existing.slice(1) : existing);
  const added = new URLSearchParams(extra);
  added.forEach((v, k) => base.set(k, v.trim()));
  const str = base.toString();
  return str ? `?${str}` : "";
}

function dispatchScrollToSection(targetId: string): void {
  window.dispatchEvent(new CustomEvent("scrollToSection", { detail: { targetId } }));
}

/** Same-page hash: wake deferred sections, then one smooth scroll (or open modal). */
function activateHashTarget(id: string, mergedSearch: string): void {
  history.replaceState(null, "", `${window.location.pathname}${mergedSearch}#${id}`);
  const el = document.getElementById(id);
  if (el?.dataset.sectionType === "modal") {
    dispatchScrollToSection(id);
    // Force hashchange so ModalDefault opens after DeferredSection mounts.
    window.location.hash = id;
    return;
  }
  // Node usually exists on same-page; helper does wake + one smooth scroll.
  // If missing, it waits once (cross-page edge) then still scrolls once.
  scrollToSectionWhenReady(id);
}

/**
 * Apply `?query` or `?query#id` on the current page.
 * Splits `#` before URLSearchParams so it never lands inside a query value.
 */
function applyQueryOnlyHref(href: string): void {
  const withoutLead = href.startsWith("?") ? href.slice(1) : href;
  const hashIdx = withoutLead.indexOf("#");
  const queryPart = hashIdx === -1 ? withoutLead : withoutLead.slice(0, hashIdx);
  const hashId = hashIdx === -1 ? "" : withoutLead.slice(hashIdx + 1).split("?")[0];
  const mergedSearch = mergeSearch(window.location.search, queryPart);

  if (hashId) {
    activateHashTarget(hashId, mergedSearch);
    return;
  }

  history.replaceState(null, "", window.location.pathname + mergedSearch);
}

/** Append callback=<encoded current page URL> plus callback_label_* as top-level params.
 *  Labels come from getCallbackLabels (selection), not the page QS — so stale URL values
 *  cannot override the current program/plan. Labels are also stripped from the encoded callback. */
function withCallbackParam(
  href: string,
  enabled: boolean,
  labels?: { en?: string; es?: string },
): string {
  if (!enabled) return href;
  if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("inline#")) {
    return href;
  }

  const pageParams = new URLSearchParams(window.location.search);
  pageParams.delete("callback_label_en");
  pageParams.delete("callback_label_es");
  const qs = pageParams.toString();
  const callbackUrl =
    window.location.origin +
    window.location.pathname +
    (qs ? `?${qs}` : "") +
    window.location.hash;

  const hashIdx = href.indexOf("#");
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);
  const join = beforeHash.includes("?") ? "&" : "?";
  let out = `${beforeHash}${join}callback=${encodeURIComponent(callbackUrl)}`;
  if (labels?.en) out += `&callback_label_en=${labels.en}`;
  if (labels?.es) out += `&callback_label_es=${labels.es}`;
  return `${out}${hash}`;
}

/** Append every utm_* param from the current page URL to outbound absolute
 *  URLs (http/https), verbatim. Params already present in the href keep their
 *  explicit value — the page value never duplicates or overrides them.
 *  Hash links, relative links, and in-page "?param" links are left untouched. */
function withUtmParams(href: string): string {
  if (!href || !/^https?:\/\//i.test(href)) return href;

  const utms: Array<[string, string]> = [];
  new URLSearchParams(window.location.search).forEach((v, k) => {
    if (k.toLowerCase().startsWith("utm_")) utms.push([k, v]);
  });
  if (utms.length === 0) return href;

  const hashIdx = href.indexOf("#");
  const base = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);

  const qIdx = base.indexOf("?");
  const existing = new URLSearchParams(qIdx === -1 ? "" : base.slice(qIdx + 1));

  const additions = utms
    .filter(([k]) => !existing.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (additions.length === 0) return href;

  const join = qIdx === -1 ? "?" : "&";
  return `${base}${join}${additions.join("&")}${hash}`;
}

export type CallbackLabels = { en?: string; es?: string };

export type UseInternalNavOptions = {
  onNavigate?: () => void;
  /** When true, outbound links get callback= plus optional callback_label_en/es. */
  appendCallback?: boolean;
  /** Source of truth for labels on CTA click (e.g. current program/plan). Not read from the URL. */
  getCallbackLabels?: () => CallbackLabels;
};

/** Module-level flag so we only register the global middle-click listener once */
let _globalMiddleClickInstalled = false;

export function useInternalNav(
  optionsOrOnNavigate?: (() => void) | UseInternalNavOptions,
) {
  const options: UseInternalNavOptions =
    typeof optionsOrOnNavigate === "function"
      ? { onNavigate: optionsOrOnNavigate }
      : optionsOrOnNavigate ?? {};
  const { onNavigate, appendCallback = false, getCallbackLabels } = options;

  const [, setLocation] = useLocation();
  const pageSections = usePageSections();

  /** Register a global auxclick listener once that intercepts middle-clicks
   *  (button 1) on anchors that contain {qs:} tokens. auxclick is the correct
   *  event for "open in new tab" — mousedown fires too early and the browser
   *  may capture the href before our setTimeout restores it. */
  useEffect(() => {
    if (_globalMiddleClickInstalled) return;
    _globalMiddleClickInstalled = true;
    document.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button !== 1) return;
      const anchor = (e.target as Element)?.closest("a");
      if (!anchor) return;
      const raw = anchor.getAttribute("href");
      if (!raw) return;
      if (isDeviceEmbedPreview()) {
        if (!shouldAllowDeviceEmbedHref(raw)) e.preventDefault();
        return;
      }
      const resolved = withUtmParams(prepareHref(raw));
      if (resolved === raw) return;
      e.preventDefault();
      window.open(resolved, "_blank", "noopener,noreferrer");
    });
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.altKey || e.button !== 0) return;

    const anchor = e.currentTarget;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return;
    if (isNonNavigableHref(rawHref)) {
      e.preventDefault();
      return;
    }

    const href = withUtmParams(
      withCallbackParam(
        prepareHref(rawHref),
        appendCallback,
        appendCallback ? getCallbackLabels?.() : undefined,
      ),
    );

    if (isDeviceEmbedPreview() && !shouldAllowDeviceEmbedHref(href)) {
      e.preventDefault();
      notifyDeviceEmbedNavBlocked();
      return;
    }

    // Ctrl/Cmd/Shift+click: resolve {qs:}/callback then open in new tab (browser would use raw href).
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      if (href === rawHref || href.startsWith("#") || href.startsWith("?")) return;
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      onNavigate?.();
      return;
    }

    if (href === "#top") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      onNavigate?.();
      return;
    }

    if (href === "#bottom") {
      e.preventDefault();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      onNavigate?.();
      return;
    }

    if (href.startsWith("#")) {
      e.preventDefault();
      const { id, extraSearch } = parseHashHref(href);
      activateHashTarget(id, mergeSearch(window.location.search, extraSearch));
      onNavigate?.();
      return;
    }

    if (href.startsWith("?")) {
      e.preventDefault();
      applyQueryOnlyHref(href);
      onNavigate?.();
      return;
    }

    if (isInternalHref(href)) {
      e.preventDefault();
      const hashIdx = href.indexOf("#");
      const hashId = hashIdx === -1 ? "" : href.slice(hashIdx + 1).split("?")[0];
      setLocation(href);
      // Destination pages run useScrollToLocationHashWhenReady; avoid wiping that with top scroll.
      if (!hashId) {
        window.scrollTo(0, 0);
      }
      onNavigate?.();
    } else if (href !== rawHref) {
      // External URL had {qs:} tokens and/or callback — browser would use the raw href.
      e.preventDefault();
      window.open(href, anchor.target || "_blank");
      onNavigate?.();
    }
  };

  /**
   * Programmatic navigation. For `inline#sectionId` URLs, returns the section
   * data from the page context (to render inline) instead of navigating.
   * For all other URL types, handles navigation as a side effect and returns null.
   */
  const navigate = (url: string): Record<string, unknown> | null => {
    if (!url || isNonNavigableHref(url)) return null;

    const resolved = withUtmParams(prepareHref(url));

    if (isDeviceEmbedPreview() && !shouldAllowDeviceEmbedHref(resolved)) {
      notifyDeviceEmbedNavBlocked();
      return null;
    }

    if (resolved.startsWith("inline#")) {
      const sectionId = resolved.slice(7);
      return pageSections[sectionId] ?? null;
    }

    if (resolved === "#top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      onNavigate?.();
      return null;
    }

    if (resolved === "#bottom") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      onNavigate?.();
      return null;
    }

    if (resolved.startsWith("#")) {
      const { id, extraSearch } = parseHashHref(resolved);
      activateHashTarget(id, mergeSearch(window.location.search, extraSearch));
      onNavigate?.();
      return null;
    }

    if (resolved.startsWith("?")) {
      applyQueryOnlyHref(resolved);
      onNavigate?.();
      return null;
    }

    if (isInternalHref(resolved)) {
      const hashIdx = resolved.indexOf("#");
      const hashId = hashIdx === -1 ? "" : resolved.slice(hashIdx + 1).split("?")[0];
      setLocation(resolved);
      if (!hashId) {
        window.scrollTo(0, 0);
      }
      onNavigate?.();
      return null;
    }

    window.open(resolved, "_blank", "noopener,noreferrer");
    return null;
  };

  /** Intercept middle-click (button 1) on anchors that contain {qs:} tokens
   *  (or when appendCallback is on). Swap href temporarily so auxclick sees
   *  the resolved URL, then restore. */
  const handleMouseDown = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 1) return; // only middle-click
    if (isDeviceEmbedPreview()) return;
    const anchor = e.currentTarget;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return;
    if (!appendCallback && !rawHref.includes("{qs:") && !rawHref.includes("{{")) return;
    const href = withUtmParams(
      withCallbackParam(
        prepareHref(rawHref),
        appendCallback,
        appendCallback ? getCallbackLabels?.() : undefined,
      ),
    );
    if (href === rawHref) return; // nothing changed, let browser handle it
    anchor.setAttribute("href", href);
    setTimeout(() => anchor.setAttribute("href", rawHref), 0);
  };

  const handler = handleClick as typeof handleClick & {
    navigate: typeof navigate;
    onMouseDown: typeof handleMouseDown;
  };
  handler.navigate = navigate;
  handler.onMouseDown = handleMouseDown;
  return handler;
}
