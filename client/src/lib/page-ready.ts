/**
 * The site's own anonymous visit counts (ads-first pages). Runs only when the server set
 * `window.__4G_PAGE__.fp` (the site has at least one "Optimize for ads" content type).
 *
 * Per page view: an arrival message on open (the visit always counts) and a summary on
 * leave / background (latest wins). Each page view gets a random key kept in memory only;
 * nothing is written to cookies or storage, and no visitor ID exists. The tab's previous
 * page and landing tags live in memory for the life of the document.
 */

import { CLICK_ID_PARAMS } from "@shared/paid-traffic";
import { getCurrentPageVersion, isStaffSession, onTrack } from "./tracking";
import { scrollPercent } from "./section-tracking";

const ARRIVAL_ENDPOINT = "/api/page-ready";
const LINK_ENDPOINT = "/api/page-link";

export type NavCode = "n" | "r" | "b" | "s";

export type LandingTags = {
  q: { s?: string; m?: string; c?: string; i?: string; t?: string; n?: string } | null;
  ck: string | null;
};

const UTM_KEYS: Array<[keyof NonNullable<LandingTags["q"]>, string]> = [
  ["s", "utm_source"],
  ["m", "utm_medium"],
  ["c", "utm_campaign"],
  ["i", "utm_id"],
  ["t", "utm_term"],
  ["n", "utm_content"],
];

/** UTM values and which click-ID parameter is present (never its value). */
export function landingTagsFromSearch(search: string): LandingTags {
  const params = new URLSearchParams(search);
  const q: NonNullable<LandingTags["q"]> = {};
  for (const [key, param] of UTM_KEYS) {
    const v = params.get(param);
    if (v && v.trim()) q[key] = v.trim().slice(0, 200);
  }
  const ck = (CLICK_ID_PARAMS as string[]).find((p) => !!params.get(p)) ?? null;
  return { q: Object.keys(q).length > 0 ? q : null, ck };
}

/** Our own previous path (same host) or the external referrer host. */
export function referrerInfo(referrer: string, host: string): { pp: string | null; rh: string | null } {
  if (!referrer) return { pp: null, rh: null };
  try {
    const u = new URL(referrer);
    if (u.host === host) return { pp: u.pathname || "/", rh: null };
    return { pp: null, rh: u.hostname };
  } catch {
    return { pp: null, rh: null };
  }
}

export function navCodeFromEntryType(type: string | undefined): NavCode {
  if (type === "reload") return "r";
  if (type === "back_forward") return "b";
  return "n";
}

/** Same rule as the GA4 `task_clicks` metric: destination leaves the site. */
export function isTaskDestination(destination: unknown): boolean {
  return typeof destination === "string" && destination !== "" && !destination.startsWith("/") && !destination.startsWith("#");
}

export function shouldCount(opts: { fp: unknown; token: unknown; pathname: string; search: string; staff: boolean }): boolean {
  if (opts.fp !== 1 || typeof opts.token !== "string" || !opts.token) return false;
  if (opts.staff) return false;
  if (opts.pathname === "/private" || opts.pathname.startsWith("/private/") || opts.pathname.startsWith("/preview-frame")) {
    return false;
  }
  const params = new URLSearchParams(opts.search);
  return !(params.get("edit") === "1" || params.get("edit_mode") === "true");
}

type View = {
  key: string;
  path: string;
  nav: NavCode;
  pp: string | null;
  cb: 0 | 1;
  visibleMs: number;
  visibleSince: number | null;
  maxScroll: number;
  interacted: boolean;
  cta: number;
  task: number;
  forms: number;
  videoStarts: number;
  videoCompletes: number;
  formsSeen: WeakSet<Element>;
  flagged: boolean;
};

type State = {
  token: string;
  landing: LandingTags & { rh: string | null };
  view: View | null;
  /** Keys of earlier ads-first page views in this tab (credited on decision page / lead). */
  flaggedKeys: string[];
};

let state: State | null = null;

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function post(url: string, body: unknown): void {
  const json = JSON.stringify(body);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(url, new Blob([json], { type: "application/json" }))) return;
    }
  } catch {
    /* fall through */
  }
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(
    () => {},
  );
}

function visibleNow(v: View): number {
  return v.visibleMs + (v.visibleSince !== null ? Date.now() - v.visibleSince : 0);
}

/** Landing tags ride on every page view of the tab: the server files the view under the visit's source. */
function baseFields(v: View, s: State) {
  return {
    id: v.key,
    u: v.path,
    nt: v.nav,
    ver: getCurrentPageVersion()?.variant ?? null,
    pp: v.pp,
    rh: s.landing.rh,
    cb: v.cb,
    q: s.landing.q,
    ck: s.landing.ck,
    tk: s.token,
  };
}

function sendArrival(v: View, s: State): void {
  const body = {
    m: "a",
    ...baseFields(v, s),
    vis: typeof document !== "undefined" && document.visibilityState === "visible" ? 1 : 0,
  };
  void fetch(ARRIVAL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  })
    .then((r) => (r.ok && r.status !== 204 ? r.json() : null))
    .then((data: { f?: number } | null) => {
      if (data?.f === 1) {
        v.flagged = true;
        if (!s.flaggedKeys.includes(v.key)) s.flaggedKeys.push(v.key);
      }
    })
    .catch(() => {});
}

function sendSummary(v: View, s: State, nextPath: string | null): void {
  post(ARRIVAL_ENDPOINT, {
    m: "s",
    ...baseFields(v, s),
    ms: Math.round(visibleNow(v)),
    sc: Math.round(v.maxScroll),
    i: v.interacted ? 1 : 0,
    c: v.cta,
    tc: v.task,
    f: v.forms,
    vs: v.videoStarts,
    vc: v.videoCompletes,
    nx: nextPath,
  });
}

function beginView(s: State, path: string, nav: NavCode, pp: string | null, cb: 0 | 1): View {
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  const view: View = {
    key: newKey(),
    path,
    nav,
    pp,
    cb,
    visibleMs: 0,
    visibleSince: visible ? Date.now() : null,
    maxScroll: 0,
    interacted: false,
    cta: 0,
    task: 0,
    forms: 0,
    videoStarts: 0,
    videoCompletes: 0,
    formsSeen: new WeakSet(),
    flagged: false,
  };
  s.view = view;
  sendArrival(view, s);
  return view;
}

function measureScroll(v: View): void {
  const doc = document.documentElement;
  const pct = scrollPercent(window.scrollY, window.innerHeight, doc.scrollHeight);
  if (pct > v.maxScroll) v.maxScroll = pct;
}

/** Start once on the client. Safe to call more than once. */
export function startPageReady(): void {
  if (state || typeof window === "undefined") return;
  const boot = window.__4G_PAGE__;
  if (
    !shouldCount({
      fp: boot?.fp,
      token: boot?.t,
      pathname: window.location.pathname,
      search: window.location.search,
      staff: isStaffSession(),
    })
  ) {
    return;
  }
  const ref = referrerInfo(document.referrer, window.location.host);
  const tags = landingTagsFromSearch(window.location.search);
  const s: State = { token: boot!.t!, landing: { ...tags, rh: ref.rh }, view: null, flaggedKeys: [] };
  state = s;

  const entry = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  beginView(s, window.location.pathname, navCodeFromEntryType(entry?.type), ref.pp, ref.pp ? 1 : 0);

  document.addEventListener("visibilitychange", () => {
    const v = s.view;
    if (!v) return;
    if (document.visibilityState === "hidden") {
      if (v.visibleSince !== null) {
        v.visibleMs += Date.now() - v.visibleSince;
        v.visibleSince = null;
      }
      sendSummary(v, s, null);
    } else if (v.visibleSince === null) {
      v.visibleSince = Date.now();
    }
  });
  window.addEventListener("pagehide", () => {
    if (s.view) sendSummary(s.view, s, null);
  });
  window.addEventListener("pageshow", (e) => {
    // Restored from the back/forward cache: behavior counts, not a new visit.
    if (!(e as PageTransitionEvent).persisted) return;
    beginView(s, window.location.pathname, "b", s.view?.pp ?? null, 0);
  });
  const markInteracted = () => {
    if (s.view) s.view.interacted = true;
  };
  window.addEventListener("pointerdown", markInteracted, { passive: true, capture: true });
  window.addEventListener("keydown", markInteracted, { passive: true, capture: true });
  window.addEventListener(
    "scroll",
    () => {
      if (!s.view) return;
      s.view.interacted = true;
      measureScroll(s.view);
    },
    { passive: true },
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const v = s.view;
      const form = (e.target as Element | null)?.closest?.("form");
      if (!v || !form || v.formsSeen.has(form)) return;
      v.formsSeen.add(form);
      v.forms += 1;
    },
    { capture: true },
  );

  onTrack((name, payload, kind) => {
    const v = s.view;
    if (!v) return;
    if (kind === "conversion") {
      const keys = s.flaggedKeys.slice(-30);
      if (keys.length > 0) post(LINK_ENDPOINT, { r: "l", ids: keys, tk: s.token });
      return;
    }
    if (name === "cta_click") {
      v.cta += 1;
      if (isTaskDestination(payload.destination)) v.task += 1;
    } else if (name === "video_start") {
      v.videoStarts += 1;
    } else if (name === "video_complete") {
      v.videoCompletes += 1;
    }
  });
}

/** In-app route change: close the current page view (with its next page) and open the next one. */
export function notePageRoute(pathname: string): void {
  const s = state;
  if (!s?.view || pathname === s.view.path) return;
  const prev = s.view;
  if (prev.visibleSince !== null) {
    prev.visibleMs += Date.now() - prev.visibleSince;
    prev.visibleSince = null;
  }
  sendSummary(prev, s, pathname);
  const earlier = s.flaggedKeys.slice(-30);
  beginView(s, pathname, "s", prev.path, 0);
  if (earlier.length > 0) post(LINK_ENDPOINT, { r: "d", ids: earlier, u: pathname, tk: s.token });
}

/** Tests only. */
export function resetPageReadyForTests(): void {
  state = null;
}
