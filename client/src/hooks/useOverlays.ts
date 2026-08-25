import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export interface OverlayButton {
  label: string;
  variant: "default" | "secondary" | "outline" | "ghost" | "destructive";
  href: string;
}

export interface OverlayContent {
  title: string;
  body: string;
  buttons?: OverlayButton[];
  image_id?: string;
}

export interface OverlayTrigger {
  event: "page_load" | "time_delay" | "scroll_depth" | "exit_intent";
  delay?: number;
}

export interface OverlayGeoTargeting {
  countries?: string[];
  regions?: string[];
  cities?: string[];
  exclude_countries?: string[];
}

export interface OverlayTargeting {
  pages: "all" | string[];
  exclude_pages?: string[];
  geo?: OverlayGeoTargeting;
}

export interface Overlay {
  id: string;
  enabled: boolean;
  trigger: OverlayTrigger;
  targeting: OverlayTargeting;
  frequency: "once" | "session" | "always";
  component: "modal" | "top_banner" | "slide_in";
  /**
   * When false, visitors cannot dismiss via X / backdrop / Escape —
   * only action buttons. Default true (omit or true = soft-dismiss).
   */
  dismissible?: boolean;
  content: OverlayContent;
}

export {
  overlayHasLabeledButton,
  isOverlayDismissible,
  overlayBlockingSaveError,
  validateOverlaysConfig,
} from "@shared/overlays";

export interface OverlayConfig {
  overlays: Overlay[];
}

interface GeoData {
  status?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
}

const GEO_CACHE_KEY = "__overlay_geo__";
const SEEN_PREFIX = "__overlay_seen_";
const SESSION_PREFIX = "__overlay_sess_";

/** Clears the overlay runtime geo cache (sessionStorage). */
export function clearOverlayGeoCache(): void {
  try {
    sessionStorage.removeItem(GEO_CACHE_KEY);
  } catch {
    // ignore storage errors
  }
}

async function fetchGeo(): Promise<GeoData | null> {
  try {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY);
    if (cached) return JSON.parse(cached) as GeoData;
  } catch {
    // ignore parse errors
  }
  try {
    const res = await fetch("/api/geo");
    if (!res.ok) return null;
    const data: GeoData = await res.json();
    try {
      sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
    return data;
  } catch {
    return null;
  }
}

function isRegexPattern(p: string): boolean {
  return p.startsWith("^") || p.includes(".*") || p.includes("(") || p.includes("[");
}

export function pathnameMatchesEntry(pathname: string, entry: string): boolean {
  if (isRegexPattern(entry)) {
    try {
      return new RegExp(entry).test(pathname);
    } catch {
      return false;
    }
  }
  // "/" is only the homepage — bare startsWith("/") would match every path
  if (entry === "/") {
    return pathname === "/";
  }
  return pathname === entry || pathname.startsWith(entry + "/");
}

/** Empty include + any excludes ⇒ all pages minus excludes (exceptions-only targeting). */
export function matchesPage(targeting: OverlayTargeting, pathname: string): boolean {
  const excludePages = targeting.exclude_pages;
  const hasExcludes = Array.isArray(excludePages) && excludePages.length > 0;

  let included = false;
  if (targeting.pages === "all") {
    included = true;
  } else if (!Array.isArray(targeting.pages)) {
    included = true;
  } else if (targeting.pages.length === 0) {
    // Specific-pages mode with no includes: only fire if excludes alone define the set
    included = hasExcludes;
  } else {
    included = targeting.pages.some((p) => pathnameMatchesEntry(pathname, p));
  }
  if (!included) return false;

  if (hasExcludes) {
    if (excludePages!.some((p) => pathnameMatchesEntry(pathname, p))) {
      return false;
    }
  }
  return true;
}

function matchesGeo(targeting: OverlayTargeting, geo: GeoData | null): boolean {
  const g = targeting.geo;
  if (!g) return true;

  // Fail-open: if geo lookup failed, treat as no geo filter
  if (!geo || geo.status === "fail") return true;

  if (g.exclude_countries && g.exclude_countries.length > 0) {
    if (geo.countryCode && g.exclude_countries.includes(geo.countryCode)) {
      return false;
    }
  }

  if (g.countries && g.countries.length > 0) {
    if (!geo.countryCode || !g.countries.includes(geo.countryCode)) {
      return false;
    }
  }

  if (g.regions && g.regions.length > 0) {
    if (!geo.regionName || !g.regions.includes(geo.regionName)) {
      return false;
    }
  }

  if (g.cities && g.cities.length > 0) {
    if (!geo.city || !g.cities.includes(geo.city)) {
      return false;
    }
  }

  return true;
}

function hasBeenSeen(overlay: Overlay): boolean {
  if (overlay.frequency === "always") return false;
  try {
    if (overlay.frequency === "once") {
      return !!localStorage.getItem(SEEN_PREFIX + overlay.id);
    }
    if (overlay.frequency === "session") {
      return !!sessionStorage.getItem(SESSION_PREFIX + overlay.id);
    }
  } catch {
    // ignore storage errors
  }
  return false;
}

export function markOverlaySeen(overlay: Overlay): void {
  if (overlay.frequency === "always") return;
  try {
    if (overlay.frequency === "once") {
      localStorage.setItem(SEEN_PREFIX + overlay.id, "1");
    } else if (overlay.frequency === "session") {
      sessionStorage.setItem(SESSION_PREFIX + overlay.id, "1");
    }
  } catch {
    // ignore storage errors
  }
}

export function isPrivateStaffPath(pathname: string): boolean {
  return pathname === "/private" || pathname.startsWith("/private/");
}

export function useOverlays() {
  const [activeOverlay, setActiveOverlay] = useState<Overlay | null>(null);
  const [location] = useLocation();

  useEffect(() => {
    let cancelled = false;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let scrollHandler: (() => void) | null = null;
    let mouseMoveHandler: ((e: MouseEvent) => void) | null = null;

    async function evaluate() {
      const pathname = window.location.pathname;
      // Never fire marketing overlays on staff /private routes (incl. preview).
      if (isPrivateStaffPath(pathname)) {
        setActiveOverlay(null);
        return;
      }

      // Fetch overlays config
      let config: OverlayConfig;
      try {
        const res = await fetch("/api/overlays");
        if (!res.ok) return;
        config = await res.json();
      } catch {
        return;
      }
      if (cancelled) return;

      const enabled = (config.overlays || []).filter((o) => o.enabled);
      if (enabled.length === 0) return;

      // Fetch geo (non-blocking — fail-open)
      const geo = await fetchGeo();
      if (cancelled) return;

      const candidates = enabled.filter(
        (o) =>
          matchesPage(o.targeting, pathname) &&
          matchesGeo(o.targeting, geo) &&
          !hasBeenSeen(o)
      );

      if (candidates.length === 0) return;

      for (const overlay of candidates) {
        const trigger = overlay.trigger;

        if (trigger.event === "page_load" || trigger.event === "time_delay") {
          const delay = trigger.delay ?? 0;
          const t = setTimeout(() => {
            if (!cancelled) setActiveOverlay(overlay);
          }, delay);
          timers.push(t);
          break; // only fire first matching overlay
        }

        if (trigger.event === "scroll_depth") {
          const threshold = trigger.delay ?? 50; // delay field repurposed as % for scroll_depth
          const handler = () => {
            const scrolled =
              (window.scrollY /
                (document.documentElement.scrollHeight - window.innerHeight)) *
              100;
            if (scrolled >= threshold && !cancelled) {
              setActiveOverlay(overlay);
              if (scrollHandler) {
                window.removeEventListener("scroll", scrollHandler);
                scrollHandler = null;
              }
            }
          };
          scrollHandler = handler;
          window.addEventListener("scroll", handler, { passive: true });
          break;
        }

        if (trigger.event === "exit_intent") {
          const handler = (e: MouseEvent) => {
            if (e.clientY <= 10 && !cancelled) {
              setActiveOverlay(overlay);
              if (mouseMoveHandler) {
                document.removeEventListener("mousemove", mouseMoveHandler);
                mouseMoveHandler = null;
              }
            }
          };
          mouseMoveHandler = handler;
          document.addEventListener("mousemove", handler);
          break;
        }
      }
    }

    evaluate();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
      if (mouseMoveHandler)
        document.removeEventListener("mousemove", mouseMoveHandler);
    };
  }, [location]);

  return { activeOverlay, setActiveOverlay };
}
