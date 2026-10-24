/**
 * Section-level engagement events for public pages:
 * - `cta_click`: clicks on links / buttons inside a rendered section (`.section-wrapper[data-section-type]`).
 * - `scroll_depth`: once per page view at 25 / 50 / 75 / 90 % with the deepest section reached.
 * Both go through `track()` → dataLayer → GTM → GA4 (BigQuery export), like video events.
 */

import { track } from "./tracking";

export const SCROLL_DEPTH_THRESHOLDS = [25, 50, 75, 90] as const;
export const CTA_LABEL_MAX = 100;

const CONTROL_SELECTOR = "a[href], button, [role='button']";
const SECTION_SELECTOR = ".section-wrapper[data-section-type]";

/** Minimal element surface used by the payload builders (real DOM elements satisfy it). */
export interface ElementLike {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
  textContent: string | null;
  id?: string;
}

export function isTrackablePath(pathname: string): boolean {
  return !(pathname === "/private" || pathname.startsWith("/private/"));
}

/** Path for same-origin links, host+path for external, scheme for mailto/tel, `#id` for anchors. */
export function ctaDestination(href: string | null, origin: string): string | undefined {
  const raw = (href || "").trim();
  if (!raw) return undefined;
  if (raw.startsWith("#")) return raw.slice(0, 120);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return `${scheme}:`;
  try {
    const u = new URL(raw, origin);
    if (u.origin === origin) return (u.pathname.replace(/\/+$/, "") || "/") + (u.hash ? u.hash : "");
    return `${u.host}${u.pathname.replace(/\/+$/, "")}`.slice(0, 200);
  } catch {
    return undefined;
  }
}

function cleanLabel(el: ElementLike): string {
  const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, CTA_LABEL_MAX);
}

/** `cta_click` payload for a click target, or null when the click is not on a control inside a section. */
export function ctaClickPayload(
  target: ElementLike | null,
  page: { pathname: string; origin: string },
): Record<string, string | number> | null {
  const control = target?.closest(CONTROL_SELECTOR) ?? null;
  if (!control) return null;
  const section = control.closest(SECTION_SELECTOR);
  if (!section) return null;
  const sectionType = section.getAttribute("data-section-type") || "";
  if (!sectionType) return null;
  const index = Number(section.getAttribute("data-section-index"));
  const payload: Record<string, string | number> = {
    section_type: sectionType,
    page_path: page.pathname,
    label: cleanLabel(control),
  };
  if (Number.isFinite(index)) payload.section_index = index;
  const sectionId = section.id || section.getAttribute("id");
  if (sectionId) payload.section_id = sectionId;
  const destination = ctaDestination(control.getAttribute("href"), page.origin);
  if (destination) payload.destination = destination;
  return payload;
}

/** Thresholds newly crossed when scroll reaches `percent`, given those already sent. */
export function crossedThresholds(sent: ReadonlySet<number>, percent: number): number[] {
  return SCROLL_DEPTH_THRESHOLDS.filter((t) => percent >= t && !sent.has(t));
}

export function scrollPercent(scrollTop: number, viewportHeight: number, docHeight: number): number {
  if (docHeight <= 0) return 0;
  if (docHeight <= viewportHeight) return 100;
  return Math.min(100, Math.max(0, ((scrollTop + viewportHeight) / docHeight) * 100));
}

function deepestSection(viewportBottom: number): { type: string; index: number } | null {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR));
  let deepest: { type: string; index: number } | null = null;
  for (const el of sections) {
    const top = el.getBoundingClientRect().top + window.scrollY;
    if (top > viewportBottom) break;
    const index = Number(el.dataset.sectionIndex);
    deepest = { type: el.dataset.sectionType || "", index: Number.isFinite(index) ? index : -1 };
  }
  return deepest;
}

/**
 * Attach click + scroll listeners for one page view. Returns a cleanup function.
 * Call again on route change so scroll thresholds reset per page.
 */
export function installSectionTracking(pathname: string): () => void {
  if (typeof window === "undefined" || !isTrackablePath(pathname)) return () => {};

  const onClick = (event: MouseEvent) => {
    const payload = ctaClickPayload(event.target as unknown as ElementLike, {
      pathname: window.location.pathname,
      origin: window.location.origin,
    });
    if (payload) track("cta_click", payload);
  };

  const sent = new Set<number>();
  let frame = 0;
  const measure = () => {
    frame = 0;
    const doc = document.documentElement;
    const percent = scrollPercent(window.scrollY, window.innerHeight, doc.scrollHeight);
    const crossed = crossedThresholds(sent, percent);
    if (crossed.length === 0) return;
    const deepest = deepestSection(window.scrollY + window.innerHeight);
    for (const depth of crossed) {
      sent.add(depth);
      track("scroll_depth", {
        depth,
        page: window.location.pathname,
        ...(deepest ? { section_type: deepest.type, section_index: deepest.index } : {}),
      });
    }
  };
  const onScroll = () => {
    if (!frame) frame = window.requestAnimationFrame(measure);
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    window.removeEventListener("scroll", onScroll);
    if (frame) window.cancelAnimationFrame(frame);
  };
}
