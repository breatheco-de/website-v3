import { useEffect } from "react";
import { useLocation } from "wouter";
import { usePageSections } from "@/contexts/PageSectionsContext";
import { isDeviceEmbedPreview, notifyDeviceEmbedNavBlocked, shouldAllowDeviceEmbedHref } from "@/lib/preview-devices";
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
  const qIdx = str.indexOf("?");
  if (qIdx === -1) return str;

  const urlParams = new URLSearchParams(window.location.search);
  const base = str.slice(0, qIdx);
  const pairs = str.slice(qIdx + 1).split("&").filter(Boolean);

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
        if (val !== null) return `${k}=${encodeURIComponent(val)}`;
        if (fallback !== undefined) return `${k}=${encodeURIComponent(fallback)}`;
        return null; // no value, no fallback → strip pair
      }
      return pair;
    })
    .filter((p): p is string => p !== null);

  return resolved.length > 0 ? `${base}?${resolved.join("&")}` : base;
}

/** Resolve {{ global.var | resolved_value }} template variables that are
 *  preserved in edit mode (preserveTemplate: true). The server keeps the full
 *  `{{ global.foo | actual_url }}` string so the inline editor can display it;
 *  here we extract the resolved value after the pipe so that clicks navigate
 *  to the correct destination instead of the raw template string. */
function resolveGlobalTemplate(href: string): string {
  const match = href.match(/^\{\{\s*\S+\s*\|\s*([\s\S]+?)\s*\}\}$/);
  return match ? match[1].trim() : href;
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
  added.forEach((v, k) => base.set(k, v));
  const str = base.toString();
  return str ? `?${str}` : "";
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

  const join = href.includes("?") ? "&" : "?";
  let out = `${href}${join}callback=${encodeURIComponent(callbackUrl)}`;
  if (labels?.en) out += `&callback_label_en=${labels.en}`;
  if (labels?.es) out += `&callback_label_es=${labels.es}`;
  return out;
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
      const resolved = withUtmParams(resolveQsTokens(resolveGlobalTemplate(raw)));
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
        resolveQsTokens(resolveGlobalTemplate(rawHref)),
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
      const el = document.getElementById(id);
      if (el) {
        if (el.dataset.sectionType === "modal") {
          window.location.hash = id;
        } else {
          window.dispatchEvent(new CustomEvent("scrollToSection", { detail: { targetId: id } }));
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              const mergedSearch = mergeSearch(window.location.search, extraSearch);
              history.replaceState(null, "", `${window.location.pathname}${mergedSearch}#${id}`);
            });
          });
        }
      }
      onNavigate?.();
      return;
    }

    if (href.startsWith("?")) {
      e.preventDefault();
      const mergedSearch = mergeSearch(window.location.search, href.slice(1));
      history.replaceState(null, "", window.location.pathname + mergedSearch);
      onNavigate?.();
      return;
    }

    if (isInternalHref(href)) {
      e.preventDefault();
      setLocation(href);
      window.scrollTo(0, 0);
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

    const resolved = withUtmParams(resolveQsTokens(resolveGlobalTemplate(url)));

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
      const el = document.getElementById(id);
      if (el) {
        if (el.dataset.sectionType === "modal") {
          window.location.hash = id;
        } else {
          window.dispatchEvent(new CustomEvent("scrollToSection", { detail: { targetId: id } }));
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              const mergedSearch = mergeSearch(window.location.search, extraSearch);
              history.replaceState(null, "", `${window.location.pathname}${mergedSearch}#${id}`);
            });
          });
        }
      }
      onNavigate?.();
      return null;
    }

    if (resolved.startsWith("?")) {
      const mergedSearch = mergeSearch(window.location.search, resolved.slice(1));
      history.replaceState(null, "", window.location.pathname + mergedSearch);
      onNavigate?.();
      return null;
    }

    if (isInternalHref(resolved)) {
      setLocation(resolved);
      window.scrollTo(0, 0);
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
    if (!appendCallback && !rawHref.includes("{qs:")) return;
    const href = withUtmParams(
      withCallbackParam(
        resolveQsTokens(rawHref),
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
