/**
 * Staff explanations for Tracking → Events: what each event means, when it fires and
 * when it doesn't. Keyed by TRACKING_EVENTS so a new event can't ship without one.
 */

import type { TrackingEventName } from "./tracking";

export type TrackingEventDoc = {
  /** What the event means, one plain sentence. */
  summary: string;
  /** Short line for the Trigger column. */
  trigger: string;
  /** Concrete examples of when it fires. */
  fires: string[];
  /** Common confusions: when it does not fire. */
  notFired?: string[];
  fields?: { name: string; meaning: string }[];
  /** Source file / function (Read more). */
  source: string;
};

const PAGE_FIELDS = [
  {
    name: "product / persona / product_persona",
    meaning: "The page's products and personas as short codes, comma-joined (\"all\" or \"none\" when the page covers every product or has no funnel).",
  },
  { name: "content_key", meaning: "The page: content type and slug, e.g. landing:apply." },
];

export const TRACKING_EVENT_DOCS: Record<TrackingEventName, TrackingEventDoc> = {
  page_view: {
    summary: "A visitor loaded a page. Sent by Tag Manager's Google Analytics tag, not by the site's code.",
    trigger: "First load of any page (Tag Manager)",
    fires: [
      "Someone opens /en/apply from a Google search.",
      "Someone reloads the page they're on.",
    ],
    notFired: [
      "Clicking to another page inside the site: that sends website-route-change, which Tag Manager can count as a page view.",
    ],
    fields: PAGE_FIELDS,
    source: "Tag Manager GA4 configuration tag; product / persona come from the page tracking context object pushed before it.",
  },
  experiment_exposure: {
    summary: "The visitor saw a page that is running an A/B test, and this is the version they got.",
    trigger: "Once per page view of a page with an active A/B test",
    fires: [
      "A visitor opens /en/apply while it is being tested and gets version b.",
      "The same visitor comes back days later: same event, same version (versions stick to the visitor).",
      "A visitor gets the live page during a test: variant is default.",
    ],
    notFired: [
      "Pages with no running test.",
      "Staff in edit mode, and force_variant previews.",
    ],
    fields: [
      { name: "experiment_id", meaning: "The test: content type, slug, language and start date, e.g. landing:apply:en@2026-10-01." },
      { name: "variant", meaning: "The version shown: its name, or default for the live page." },
      ...PAGE_FIELDS,
    ],
    source: "client/src/lib/tracking.ts → trackPageVersion, called from usePageVersionExposure (value from the server's _page_version).",
  },
  cta_click: {
    summary: "The visitor clicked a link or button inside a page section.",
    trigger: "Click on a link or button inside a page section",
    fires: [
      "Clicking \"Apply now\" in the hero.",
      "Clicking a card link in a features grid.",
    ],
    notFired: ["Header and footer menu links (they are not page sections).", "Private / staff pages."],
    fields: [
      { name: "section_type / section_index / section_id", meaning: "Which section the click was in." },
      { name: "label", meaning: "The button or link text (first 100 characters)." },
      { name: "destination", meaning: "Where it goes: a path on this site, another host, mailto: / tel:, or #anchor." },
      ...PAGE_FIELDS,
    ],
    source: "client/src/lib/section-tracking.ts → installSectionTracking / ctaClickPayload.",
  },
  video_start: {
    summary: "An uploaded video (a file, not YouTube) started playing.",
    trigger: "Uploaded video starts playing (once per play)",
    fires: ["A visitor presses play on a hero video.", "The visitor rewinds to the start and plays again."],
    notFired: ["YouTube videos: Tag Manager sends those as gtm.video events."],
    fields: [
      { name: "video_url / video_title", meaning: "Which video." },
      { name: "visible", meaning: "Whether the video was on screen." },
      ...PAGE_FIELDS,
    ],
    source: "client/src/components/UniversalVideo.tsx → emitVideoStart.",
  },
  video_progress: {
    summary: "An uploaded video reached 10, 25, 50 or 75% of its length.",
    trigger: "Uploaded video reaches 10 / 25 / 50 / 75%",
    fires: ["A visitor watches half a video: progress 10, 25 and 50."],
    notFired: [
      "Marks skipped by jumping ahead in the video (same as YouTube in Tag Manager).",
      "YouTube videos.",
    ],
    fields: [{ name: "video_percent", meaning: "The mark reached." }, ...PAGE_FIELDS],
    source: "client/src/components/UniversalVideo.tsx → reportFileProgress.",
  },
  video_complete: {
    summary: "An uploaded video played to the end.",
    trigger: "Uploaded video reaches the end",
    fires: ["A visitor watches a testimonial video to the end."],
    notFired: ["YouTube videos."],
    fields: [{ name: "video_duration", meaning: "Length in seconds." }, ...PAGE_FIELDS],
    source: "client/src/components/UniversalVideo.tsx → reportFileProgress.",
  },
  scroll_depth: {
    summary: "The visitor scrolled 25, 50, 75 or 90% down the page.",
    trigger: "Once per page view at 25 / 50 / 75 / 90% scrolled",
    fires: ["A visitor reads to the middle of the page: depth 25 and 50."],
    notFired: ["Scrolling back up (each mark is sent once per page view).", "Private / staff pages."],
    fields: [
      { name: "depth", meaning: "The mark reached." },
      { name: "section_type / section_index", meaning: "The deepest section on screen at that moment." },
      ...PAGE_FIELDS,
    ],
    source: "client/src/lib/section-tracking.ts → installSectionTracking.",
  },
};

/** Rows that are not track() events. */
export const PUSH_DOCS: Record<string, TrackingEventDoc> = {
  "website-route-change": {
    summary: "The visitor moved to another page inside the site (no full reload).",
    trigger: "In-site navigation, once the new page's product and persona are known",
    fires: [
      "Clicking from the home page to /en/apply.",
      "Using the browser back button inside the site.",
    ],
    notFired: ["The first page of a visit (Tag Manager's page_view covers it)."],
    fields: [
      { name: "pagePath / pageTitle", meaning: "The new page." },
      {
        name: "product / persona",
        meaning: "Not on this event: Tag Manager reads them from the page tracking context object pushed just before.",
      },
    ],
    source:
      "client/src/hooks/usePageTracking.ts. Sent on the first of: the new page's values are set, about 2 seconds, the next navigation, or the tab is hidden / closed.",
  },
  "page tracking context object": {
    summary: "Not an event: the page's products, personas and page key, kept in the dataLayer so every event after it carries them.",
    trigger: "Every content page, before its events",
    fires: [
      "First load: written by the server before Tag Manager loads, so the first page_view has it.",
      "Each in-site navigation, before website-route-change.",
    ],
    notFired: [
      "Sites where some product or persona has no tracking key yet (product tracking switches on once every key exists).",
      "Staff edit mode and previews.",
    ],
    fields: [
      { name: "product / persona", meaning: "Short codes, comma-joined. all = every product; none = a content page with no funnel." },
      { name: "product_persona", meaning: "Product:persona code pairs, e.g. aie:cc." },
      { name: "funnel_stage", meaning: "The page's funnel stage." },
      { name: "content_key", meaning: "Content type and slug." },
      { name: "tracking_truncated", meaning: "true when a list was cut at Google Analytics' 100-character limit." },
    ],
    source:
      "client/src/lib/tracking.ts → setPageTrackingContext; server: utils/html-inject.ts → injectPageTrackingDataLayer. Keys a page doesn't have are pushed empty so the previous page's values clear.",
  },
  "visitor context object": {
    summary: "Not an event: who the visitor is (user id, location, language, campaign), kept in the dataLayer.",
    trigger: "Once per load, after location and user id resolve",
    fires: ["Every first page load of a visit."],
    notFired: ["In-site navigation (it is not repeated)."],
    fields: [
      { name: "visitor_location_* / visitor_language", meaning: "Where the visitor is and their language." },
      { name: "utm_*", meaning: "The campaign that brought them." },
    ],
    source: "client/src/lib/tracking.ts → setVisitorContext (called from SessionContext).",
  },
};

export function eventDoc(name: string): TrackingEventDoc | undefined {
  return (TRACKING_EVENT_DOCS as Record<string, TrackingEventDoc>)[name] ?? PUSH_DOCS[name];
}
