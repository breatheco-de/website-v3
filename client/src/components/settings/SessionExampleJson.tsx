import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createVariableWidgetPlugin,
  type TemplateSpan,
  type VariablePillTooltip,
} from "@/lib/cm-variable-widgets";
import { cn } from "@/lib/utils";

type SessionExampleOpts = {
  paid: boolean;
  database: string | null;
  fillFromIp: boolean;
};

/** Plain English: what this value is + where it comes from. */
const SESSION_FIELD_TIPS: Record<string, VariablePillTooltip> = {
  "session.version": {
    title: "Session schema version",
    body: "Internal version of the session cookie shape. The worker bumps this when the stored format changes so old cookies can be refreshed.",
  },
  "session.initialized": {
    title: "Ready?",
    body: "True after the session worker has finished its first pass (geo, campus, device, and so on).",
  },
  "session.userId": {
    title: "Visitor ID",
    body: "A stable id for this person on your site. It comes from their session cookie when they already have one; otherwise the session worker creates a new one.",
  },
  "session.language": {
    title: "Language",
    body: "Which language the site should use for this visit. It prefers the URL (for example /es/…), then the browser language, then the matched campus’s default language.",
  },
  "session.browserLang": {
    title: "Browser language",
    body: "The visitor’s browser language (first two letters). Comes from navigator.languages / language — used as a fallback when choosing site language and campus.",
  },
  "session.location": {
    title: "Campus",
    body: "The campus we assign to this visitor. It comes from the campus database you pick under Session settings, matched to their IP. It stays empty if you leave the database as None or turn off fill-from-IP. Their raw geo location still fills separately.",
  },
  "session.location.slug": {
    title: "Campus slug",
    body: "The campus id from your locations database (nearest listed campus to the visitor’s IP). Staff can force one with ?location= in the URL when that slug exists in the catalog.",
  },
  "session.location.name": {
    title: "Campus name",
    body: "The friendly name of the matched campus, taken from the same row in the locations database.",
  },
  "session.location.city": {
    title: "Campus city",
    body: "The city on the matched campus row in the database — not the city from the IP lookup.",
  },
  "session.location.country": {
    title: "Campus country",
    body: "The country name on the matched campus row in the database.",
  },
  "session.location.country_code": {
    title: "Campus country code",
    body: "The country code on the matched campus row (for example US or ES).",
  },
  "session.location.region": {
    title: "Campus region",
    body: "The market region on the campus row (for example US & Canada or Latin America). Section visibility and variables can key off this.",
  },
  "session.location.default_language": {
    title: "Campus default language",
    body: "Preferred language on the campus row. Used when the URL and browser do not already pick a language.",
  },
  "session.location.timezone": {
    title: "Campus timezone",
    body: "Timezone on the matched campus row in the database.",
  },
  "session.location.reliable": {
    title: "Reliable match?",
    body: "True when we matched the campus from IP location. False when we only guessed from language — so the next refresh can try a better match.",
  },
  "session.geo": {
    title: "IP location",
    body: "Where the visitor appears to be from, based on their IP. This always fills when the lookup works, even if campus is empty.",
  },
  "session.geo.city": {
    title: "IP city",
    body: "City reported by the IP lookup service.",
  },
  "session.geo.country": {
    title: "IP country",
    body: "Country name reported by the IP lookup service.",
  },
  "session.geo.country_code": {
    title: "IP country code",
    body: "Country code from the IP lookup. We use this first when looking for a campus in that country.",
  },
  "session.geo.region": {
    title: "IP region / state",
    body: "Region or state name from the IP lookup (for example Florida) — not the campus market region.",
  },
  "session.geo.timezone": {
    title: "IP timezone",
    body: "Timezone reported by the IP lookup service.",
  },
  "session.geo.latitude": {
    title: "IP latitude",
    body: "Latitude from the IP lookup. Used to pick the nearest campus.",
  },
  "session.geo.longitude": {
    title: "IP longitude",
    body: "Longitude from the IP lookup. Used to pick the nearest campus.",
  },
  "session.utm": {
    title: "Campaign tags",
    body: "Marketing tags and click ids from the landing URL. Empty on a normal organic visit; present when the URL includes utm_ parameters or ad click ids.",
  },
  "session.utm.utm_source": {
    title: "Campaign source",
    body: "Comes from ?utm_source= on the URL the visitor landed on.",
  },
  "session.utm.utm_medium": {
    title: "Campaign medium",
    body: "Comes from ?utm_medium= on the landing URL.",
  },
  "session.utm.utm_campaign": {
    title: "Campaign name",
    body: "Comes from ?utm_campaign= on the landing URL.",
  },
  "session.utm.utm_content": {
    title: "Campaign content",
    body: "Comes from ?utm_content= on the landing URL (often which ad or link).",
  },
  "session.utm.utm_term": {
    title: "Campaign term",
    body: "Comes from ?utm_term= on the landing URL (often keyword or ad set id in our templates).",
  },
  "session.utm.gclid": {
    title: "Google click id",
    body: "Google Ads click id from the landing URL when present.",
  },
  "session.utm.fbclid": {
    title: "Meta click id",
    body: "Meta/Facebook click id from the landing URL when present.",
  },
  "session.device": {
    title: "Device",
    body: "Device facts parsed from the browser user agent and viewport (phone, tablet, or desktop, OS, browser, screen size).",
  },
  "session.device.deviceCategory": {
    title: "Device category",
    body: "mobile, tablet, or desktop — detected from the user agent.",
  },
  "session.device.osFamily": {
    title: "Operating system",
    body: "OS family from the user agent (for example iOS, Android, Windows, macOS).",
  },
  "session.device.browserFamily": {
    title: "Browser",
    body: "Browser family from the user agent (for example Chrome, Safari, Firefox).",
  },
  "session.device.viewportWidth": {
    title: "Viewport width",
    body: "Browser window width in pixels at session init.",
  },
  "session.device.viewportHeight": {
    title: "Viewport height",
    body: "Browser window height in pixels at session init.",
  },
  "session.landing_page": {
    title: "Landing page path",
    body: "The first page path of this visit (for example /us/coding-bootcamp). It is written once and does not change when they browse further. On the session object the key is landing_page — lead/signup payloads often rename it to landing_url when sending outbound.",
  },
  "session.conversion_page": {
    title: "Conversion page path",
    body: "The path of the latest successful conversion (form submit, signup, and so on). Empty until they convert. On the session object the key is conversion_page — outbound lead/signup payloads often rename it to conversion_url.",
  },
  "session.first_touch": {
    title: "First-touch campaign",
    body: "The first set of campaign tags seen in this browser. Written once and kept even if later visits have different UTMs.",
  },
  "session.first_touch.utm_source": {
    title: "First-touch source",
    body: "utm_source from the first campaign URL this browser ever landed with.",
  },
  "session.first_touch.utm_medium": {
    title: "First-touch medium",
    body: "utm_medium from the first campaign URL this browser ever landed with.",
  },
  "session.first_touch.utm_campaign": {
    title: "First-touch campaign",
    body: "utm_campaign from the first campaign URL this browser ever landed with.",
  },
  "session.paid_landing": {
    title: "Paid landings",
    body: "First and most recent paid landing in this browser (host, path, time, and ad ids when present). Only fills on paid traffic.",
  },
  "session.paid_landing.first": {
    title: "First paid landing",
    body: "Write-once: the first paid landing URL this browser hit.",
  },
  "session.paid_landing.first.host": {
    title: "First paid host",
    body: "Hostname of the first paid landing.",
  },
  "session.paid_landing.first.path": {
    title: "First paid path",
    body: "Pathname of the first paid landing.",
  },
  "session.paid_landing.first.at": {
    title: "First paid at",
    body: "When the first paid landing was recorded.",
  },
  "session.paid_landing.last": {
    title: "Latest paid landing",
    body: "Most recent paid landing in this browser (updates on later paid visits).",
  },
  "session.paid_landing.last.host": {
    title: "Latest paid host",
    body: "Hostname of the latest paid landing.",
  },
  "session.paid_landing.last.path": {
    title: "Latest paid path",
    body: "Pathname of the latest paid landing.",
  },
  "session.paid_landing.last.at": {
    title: "Latest paid at",
    body: "When the latest paid landing was recorded.",
  },
  "session.entry_channel": {
    title: "Entry channel",
    body: "How they arrived: first touch (write-once) and latest non-direct touch. Built from campaign tags and referrer.",
  },
  "session.entry_channel.first": {
    title: "First channel",
    body: "Channel of the first visit in this browser (write-once).",
  },
  "session.entry_channel.first.channel": {
    title: "First channel label",
    body: "How the first visit was classified — for example paid, organic, or direct.",
  },
  "session.entry_channel.first.path": {
    title: "First channel path",
    body: "Pathname of the first visit used for channel attribution.",
  },
  "session.entry_channel.first.at": {
    title: "First channel at",
    body: "When the first channel was recorded.",
  },
  "session.entry_channel.last": {
    title: "Latest channel",
    body: "Most recent non-direct channel touch (updates on later visits with a clearer channel).",
  },
  "session.entry_channel.last.channel": {
    title: "Latest channel label",
    body: "How the latest attributed visit was classified.",
  },
  "session.entry_channel.last.path": {
    title: "Latest channel path",
    body: "Pathname of the latest attributed visit.",
  },
  "session.entry_channel.last.at": {
    title: "Latest channel at",
    body: "When the latest channel was recorded.",
  },
  "session.consent": {
    title: "Consent",
    body: "Visitor consent choices mirrored into the session (geolocation prompt and tracking banner).",
  },
  "session.consent.geolocation": {
    title: "Geolocation consent",
    body: "Whether the visitor allowed precise geolocation when asked. Null until they answer (most flows use IP geo without this).",
  },
  "session.consent.tracking": {
    title: "Tracking consent",
    body: "Tracking banner choice from the 4g_consent cookie: granted, denied, or unset.",
  },
  "session.timestamp": {
    title: "Last updated",
    body: "When this session object was last written (used to decide when geo/campus should refresh).",
  },
};

function tipForSpan(span: TemplateSpan): VariablePillTooltip {
  return (
    SESSION_FIELD_TIPS[span.name] ?? {
      title: span.name.replace(/^session\./, ""),
      body: "Filled by the session worker from the browser, the URL, IP lookup, or the campus catalog.",
    }
  );
}

function t(path: string): string {
  return `{{ ${path} }}`;
}

/** Auth-style preview JSON: values are {{ session.* }} tokens rendered as CM pills. */
export function buildSessionPreviewJson(opts: SessionExampleOpts): string {
  const locationOn = !!(opts.database && opts.fillFromIp);

  const obj: Record<string, unknown> = {
    version: t("session.version"),
    initialized: t("session.initialized"),
    userId: t("session.userId"),
    language: t("session.language"),
    browserLang: t("session.browserLang"),
    location: locationOn
      ? {
          slug: t("session.location.slug"),
          name: t("session.location.name"),
          city: t("session.location.city"),
          country: t("session.location.country"),
          country_code: t("session.location.country_code"),
          region: t("session.location.region"),
          default_language: t("session.location.default_language"),
          timezone: t("session.location.timezone"),
          reliable: t("session.location.reliable"),
        }
      : null,
    geo: {
      city: t("session.geo.city"),
      country: t("session.geo.country"),
      country_code: t("session.geo.country_code"),
      region: t("session.geo.region"),
      timezone: t("session.geo.timezone"),
      latitude: t("session.geo.latitude"),
      longitude: t("session.geo.longitude"),
    },
    utm: opts.paid
      ? {
          utm_source: t("session.utm.utm_source"),
          utm_medium: t("session.utm.utm_medium"),
          utm_campaign: t("session.utm.utm_campaign"),
          utm_content: t("session.utm.utm_content"),
          utm_term: t("session.utm.utm_term"),
          gclid: t("session.utm.gclid"),
          fbclid: t("session.utm.fbclid"),
        }
      : {},
    device: {
      deviceCategory: t("session.device.deviceCategory"),
      osFamily: t("session.device.osFamily"),
      browserFamily: t("session.device.browserFamily"),
      viewportWidth: t("session.device.viewportWidth"),
      viewportHeight: t("session.device.viewportHeight"),
    },
    landing_page: t("session.landing_page"),
    conversion_page: t("session.conversion_page"),
    first_touch: opts.paid
      ? {
          utm_source: t("session.first_touch.utm_source"),
          utm_medium: t("session.first_touch.utm_medium"),
          utm_campaign: t("session.first_touch.utm_campaign"),
        }
      : {},
    paid_landing: opts.paid
      ? {
          first: {
            host: t("session.paid_landing.first.host"),
            path: t("session.paid_landing.first.path"),
            at: t("session.paid_landing.first.at"),
          },
          last: {
            host: t("session.paid_landing.last.host"),
            path: t("session.paid_landing.last.path"),
            at: t("session.paid_landing.last.at"),
          },
        }
      : {},
    entry_channel: {
      first: {
        channel: t("session.entry_channel.first.channel"),
        path: t("session.entry_channel.first.path"),
        at: t("session.entry_channel.first.at"),
      },
      last: {
        channel: t("session.entry_channel.last.channel"),
        path: t("session.entry_channel.last.path"),
        at: t("session.entry_channel.last.at"),
      },
    },
    consent: {
      geolocation: t("session.consent.geolocation"),
      tracking: t("session.consent.tracking"),
    },
    timestamp: t("session.timestamp"),
  };

  return JSON.stringify(obj, null, 2);
}

export function SessionExampleJson({
  paid,
  database,
  fillFromIp,
  className,
}: SessionExampleOpts & { className?: string }) {
  const value = useMemo(
    () => buildSessionPreviewJson({ paid, database, fillFromIp }),
    [paid, database, fillFromIp],
  );

  const extensions = useMemo(
    () => [
      jsonLang(),
      ...createVariableWidgetPlugin({
        readOnly: true,
        tooltipTrigger: "click",
        getTooltip: tipForSpan,
      }),
    ],
    [],
  );

  return (
    <div
      className={cn(
        "min-w-0 w-full max-w-full overflow-hidden rounded-md border border-input",
        className,
      )}
      data-testid="session-example-json"
    >
      <CodeMirror
        value={value}
        height="420px"
        width="100%"
        editable={false}
        extensions={extensions}
        theme={oneDark}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
        }}
        className="min-w-0 max-w-full text-xs [&_.cm-editor]:max-w-full [&_.cm-editor]:rounded-md [&_.cm-scroller]:overflow-x-auto [&_.cm-content]:whitespace-pre"
      />
    </div>
  );
}
