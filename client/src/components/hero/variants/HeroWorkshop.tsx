/**
 * HeroWorkshop — `workshop` variant.
 * Left: badge, RTE title, date/duration, description, host.
 * Right: countdown + form card (form + Learn-like seats inside).
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LeadFormData } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UniversalImage } from "@/components/UniversalImage";
import { getIcon } from "@/lib/icons";
import { coerceToText, resolveTemplateFallback } from "@/lib/variable-manager";
import { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from "@/components/ui/hover-card";
import { ResponsiveRichText } from "@/components/ui/responsive-rich-text";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

/** Learn-like seats: fixed (grid + load-more) height; after expand, button gone and grid fills that space. */
const SEATS_VISIBLE_THRESHOLD = 16; // beyond this → clamp the grid+button region
const SEATS_COLS = 4;
/** Shared height for avatar grid + optional load-more row (box does not grow/shrink on expand). */
const SEATS_LIST_REGION_H = "12.1rem";
const SEATS_PLACEHOLDER_MIN_H = "5.5rem";
const AVATAR_SIZE = "2.5rem";

const LeadForm = lazy(
  () => import("@/components/lead_form/variants/LeadFormDefault"),
);

function pageLocale(): string {
  if (typeof document === "undefined") return "en";
  const lang = document.documentElement.lang?.trim();
  if (lang) return lang;
  if (window.location.pathname.startsWith("/es")) return "es";
  return "en";
}

function parseIso(value?: string): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function formatEventDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    const datePart = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
    const timePart = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    }).format(d);
    return `${datePart} - ${timePart}`;
  } catch {
    return d.toISOString();
  }
}

function normalizeStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x || "").trim()).filter(Boolean);
      }
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeRegistrants(raw: unknown): Array<{ name: string; avatar_url: string }> {
  if (!raw) return [];
  if (typeof raw === "string" && raw.trim()) {
    try {
      return normalizeRegistrants(JSON.parse(raw));
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((avatar_url) => ({ name: "", avatar_url }));
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const avatar_url = item.trim();
        return avatar_url ? { name: "", avatar_url } : null;
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const avatar_url = String(o.avatar_url || o.url || o.src || "").trim();
        const name = String(o.name || o.full_name || "").trim();
        if (!avatar_url && !name) return null;
        return { name, avatar_url };
      }
      return null;
    })
    .filter((x): x is { name: string; avatar_url: string } => !!x);
}

type CountdownParts = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function diffParts(ms: number): CountdownParts {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {
    days: pad2(days),
    hours: pad2(hours),
    minutes: pad2(minutes),
    seconds: pad2(seconds),
  };
}

export interface HeroWorkshopData {
  back_label?: string;
  back_url?: string;
  badge?: string;
  /** 1-based day in the series. Shown with series_total when the series has 2 or more sessions. */
  series_index?: string | number;
  series_total?: string | number;
  /** Popover copy on the day badge. Empty hides the popover. */
  series_note?: string;
  title?: string;
  description?: string;
  date?: {
    starting_at_iso?: string;
    ending_at_iso?: string;
    icon?: string;
  };
  duration?: {
    label?: string;
    suffix?: string;
    icon?: string;
  };
  host?: {
    heading?: string;
    name?: string;
    avatar_url?: string;
    bio?: string;
    socials?: Array<{ name?: string; url?: string; icon?: string }>;
  };
  seats?: {
    capacity?: number | string;
    registered_count?: number | string;
    remaining?: number | string;
    registrants?:
      | string[]
      | string
      | Array<{ name?: string; avatar_url?: string; url?: string }>;
    fallback_avatars?: string[] | string;
    copy?: string;
    load_more_label?: string;
  };
  live?: {
    label?: string;
    images?: string[];
  };
  countdown?: {
    background_image?: string;
  };
  form_card_title?: string;
  form_card_subtitle?: string;
  form_card_disclaimer?: string;
  form?: LeadFormData | null;
  /** Add-to-calendar dropdown card; hidden when items empty. */
  calendar_cta?: {
    /** Learn-like prompt above the dropdown button. */
    heading?: string;
    text?: string;
    variant?: "primary" | "secondary" | "outline";
    icon?: string;
    items?: Array<{ name?: string; url?: string }>;
  };
}

interface HeroWorkshopProps {
  data: HeroWorkshopData;
}

const SERIES_DAY_GREEN = "#25BF6C";

/** Day label for a series. Hidden unless the series has at least two sessions. */
function seriesDayBadge(index: unknown, total: unknown, locale: string): { label: string } | null {
  const day = Number(index);
  const count = Number(total);
  if (!Number.isFinite(day) || !Number.isFinite(count) || count < 2 || day < 1) return null;
  const es = locale.toLowerCase().startsWith("es");
  const label = es ? `Día ${Math.floor(day)}` : `Day ${Math.floor(day)}`;
  return { label };
}

function SeriesDayBadge({ label, note, testId }: { label: string; note?: string; testId: string }) {
  const text = (note ?? "").trim();
  const className =
    "inline-flex items-center rounded-full px-2.5 py-[5.5px] text-xs font-bold leading-none text-white";
  if (!text) {
    return (
      <span className={className} style={{ backgroundColor: SERIES_DAY_GREEN }} data-testid={testId}>
        {label}
      </span>
    );
  }
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button type="button" className={className} style={{ backgroundColor: SERIES_DAY_GREEN }} data-testid={testId}>
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent side="top" collisionPadding={12} className="z-50 w-72 text-center text-sm">
          {text}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

export default function HeroWorkshop({ data }: HeroWorkshopProps) {
  const locale = pageLocale();

  const titleHtml = typeof data.title === "string" ? data.title : "";
  const badge = coerceToText(data.badge);
  const seriesDay = seriesDayBadge(data.series_index, data.series_total, locale);
  const seriesNote = coerceToText(data.series_note);
  // back_label / back_url kept on data for now; UI link hidden
  const description = coerceToText(data.description);
  const durationLabel = coerceToText(data.duration?.label);
  const durationSuffix = coerceToText(data.duration?.suffix);
  const dateIconName = coerceToText(data.date?.icon);
  const durationIconName = coerceToText(data.duration?.icon);
  const DateIcon = dateIconName ? getIcon(dateIconName) : null;
  const DurationIcon = durationIconName ? getIcon(durationIconName) : null;
  const hostName = coerceToText(data.host?.name);
  const hostBio = coerceToText(data.host?.bio);
  const hostHeading = coerceToText(data.host?.heading);
  const hostAvatarUrl = coerceToText(data.host?.avatar_url);
  const hostSocials = (data.host?.socials || [])
    .map((it) => ({
      name: coerceToText(it?.name),
      url: coerceToText(it?.url),
      icon: coerceToText(it?.icon),
    }))
    .filter((it) => !!it.url);
  const liveNowLabel = coerceToText(data.live?.label);
  const liveImages = useMemo(
    () => normalizeStringList(data.live?.images),
    [data.live?.images],
  );
  const liveImagesKey = liveImages.join("|");
  const [liveImageIndex, setLiveImageIndex] = useState(0);
  // Learn parity: cycle live.images every 5s while the event is live.
  useEffect(() => {
    setLiveImageIndex(0);
  }, [liveImagesKey]);
  const seatsCopy = coerceToText(data.seats?.copy);
  const loadMoreLabel = coerceToText(data.seats?.load_more_label);
  const countdownBg = coerceToText(data.countdown?.background_image);

  // Edit mode preserveTemplate wraps entry fields as "{{ entry.x | value }}";
  // strip to the fallback ISO so Date.parse / live strip work like read mode.
  const startingAtIso = resolveTemplateFallback(
    coerceToText(data.date?.starting_at_iso),
  );
  const endingAtIso = resolveTemplateFallback(
    coerceToText(data.date?.ending_at_iso),
  );
  const startMs = parseIso(startingAtIso || undefined);
  const endMs = parseIso(endingAtIso || undefined);
  const dateLine =
    startingAtIso && startMs != null
      ? formatEventDate(startingAtIso, locale)
      : "";

  const registrants = normalizeRegistrants(data.seats?.registrants);
  const fallbackAvatars = normalizeStringList(data.seats?.fallback_avatars);
  // Learn parity: hide the whole seats card when there are no checkins.
  const hasSeatsInfo = registrants.length > 0;
  const [showAllSeats, setShowAllSeats] = useState(false);
  const seatsOverflow =
    registrants.length > SEATS_VISIBLE_THRESHOLD && !!loadMoreLabel;
  const canLoadMoreSeats = seatsOverflow && !showAllSeats;

  const calendarHeading = coerceToText(data.calendar_cta?.heading);
  const calendarCtaLabel = coerceToText(data.calendar_cta?.text);
  const calendarItems = (data.calendar_cta?.items || [])
    .map((it) => ({
      name: coerceToText(it?.name),
      url: coerceToText(it?.url),
    }))
    .filter((it) => !!it.name && !!it.url);
  const showCalendarCard = calendarItems.length > 0 && !!calendarCtaLabel;
  const CalendarCtaIcon = data.calendar_cta?.icon
    ? getIcon(coerceToText(data.calendar_cta.icon))
    : null;
  const calendarBtnVariant =
    data.calendar_cta?.variant === "outline"
      ? "outline"
      : data.calendar_cta?.variant === "secondary"
        ? "secondary"
        : "default";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startMs]);

  let eventState: "upcoming" | "live" | "ended" | "none" = "none";
  if (startMs != null) {
    if (endMs != null && now >= endMs) eventState = "ended";
    else if (now >= startMs) eventState = "live";
    else eventState = "upcoming";
  }

  useEffect(() => {
    if (eventState !== "live" || liveImages.length <= 1) return;
    const id = window.setInterval(() => {
      setLiveImageIndex((i) => (i + 1) % liveImages.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [eventState, liveImages.length, liveImagesKey]);

  const liveImage =
    eventState === "live"
      ? liveImages[liveImageIndex % Math.max(liveImages.length, 1)] ||
        liveImages[0] ||
        ""
      : "";

  const countdown =
    eventState === "upcoming" && startMs != null
      ? diffParts(startMs - now)
      : null;

  // Live: cycle `live.images` every 5s. Empty → no media, no countdown fallback.
  const stripBg = eventState === "live" ? liveImage : countdownBg;
  const showCountdownStrip =
    !!countdown ||
    (eventState === "live" && !!liveImage) ||
    (eventState === "upcoming" && !!countdownBg);

  const form = data.form ?? undefined;
  const hasFormCard =
    !!coerceToText(data.form_card_title) ||
    !!coerceToText(data.form_card_subtitle) ||
    !!form ||
    !!coerceToText(data.form_card_disclaimer);

  const countdownSlots = countdown
    ? ([
        ...(Number(countdown.days) > 0
          ? ([["days", countdown.days]] as const)
          : []),
        ["hrs", countdown.hours],
        ["min", countdown.minutes],
        ["seg", countdown.seconds],
      ] as const)
    : [];

  const showTitleBlock =
    !!badge ||
    !!seriesDay ||
    !!(eventState === "live" && liveNowLabel) ||
    !!titleHtml ||
    !!dateLine ||
    !!durationLabel;
  const showHostSection = !!(hostHeading || hostName || hostBio);
  const showAside =
    showCountdownStrip || hasFormCard || hasSeatsInfo || showCalendarCard;

  return (
    <section className="relative" data-testid="section-hero-workshop">
      {/*
        Two columns from md (768px). Arbitrary Tailwind grid-cols are unreliable
        here — same forced-CSS pattern as SplitCardsDefault.
        Mobile order: title → aside (form/seats/calendar) → description → host.
      */}
      <style>{`
        @media (min-width: 768px) {
          [data-workshop-cols] {
            grid-template-columns: minmax(0, 1fr) minmax(0, 23rem) !important;
            column-gap: 4rem !important;
            align-items: start !important;
          }
          [data-workshop-aside] {
            grid-column: 2 !important;
            grid-row: 1 / span 3 !important;
          }
          [data-workshop-title],
          [data-workshop-desc],
          [data-workshop-host] {
            grid-column: 1 !important;
          }
        }
        @keyframes workshop-live-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(64, 166, 250, 0.28),
              0 3px 10px hsl(var(--primary) / 0.05), 0 8px 22px hsl(var(--primary) / 0.03);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(64, 166, 250, 0),
              0 3px 10px hsl(var(--primary) / 0.05), 0 8px 22px hsl(var(--primary) / 0.03);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(64, 166, 250, 0),
              0 3px 10px hsl(var(--primary) / 0.05), 0 8px 22px hsl(var(--primary) / 0.03);
          }
        }
        .workshop-live-pulse {
          animation: workshop-live-pulse 3s ease-out infinite;
        }
        @keyframes workshop-live-dot {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.5), 0 0 0 0 rgba(255, 82, 182, 0.5);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 8px rgba(255, 82, 82, 0), 0 0 0 14px rgba(255, 82, 182, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(255, 82, 82, 0), 0 0 0 0 rgba(255, 82, 182, 0);
          }
        }
        .workshop-live-dot {
          background: rgba(255, 82, 82, 1);
          animation: workshop-live-dot 1.5s ease-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .workshop-live-pulse,
          .workshop-live-dot {
            animation: none;
          }
        }
      `}</style>
      <div
        className="relative z-10 grid grid-cols-1 gap-y-8"
        data-workshop-cols
      >
        {showTitleBlock ? (
          <div className="order-1 min-w-0 space-y-4 md:order-none" data-workshop-title>
            {(badge || (eventState === "live" && liveNowLabel)) && (
              <div
                className="flex flex-wrap items-center gap-2"
                data-testid="workshop-badge-row"
              >
                {badge ? (
                  <span
                    className="inline-block bg-primary text-white px-3 py-1 rounded-full text-xs font-bold tracking-wide"
                    data-testid="text-workshop-badge"
                  >
                    {badge}
                  </span>
                ) : null}
                {eventState === "live" && liveNowLabel ? (
                  <span
                    className="inline-flex items-center gap-2.5 rounded-[18px] bg-[#FFBEBE] text-[#CD0000] px-2.5 py-1 text-xs font-bold leading-none"
                    data-testid="text-workshop-live-label"
                  >
                    <span
                      className="workshop-live-dot w-2 h-2 rounded-full shrink-0"
                      aria-hidden
                    />
                    {liveNowLabel}
                  </span>
                ) : null}
              </div>
            )}

            {titleHtml && (
              <h1
                className="font-inter font-extrabold text-foreground [&_em]:text-primary [&_em]:italic text-[2.25rem] leading-none md:text-[2.75rem] lg:text-[3.5rem] md:leading-[1.03]"
                data-testid="text-workshop-title"
              >
                <ResponsiveRichText html={titleHtml} />
              </h1>
            )}

            {(dateLine || durationLabel) && (
              <div
                className="flex flex-col items-start gap-2.5 text-base text-muted-foreground font-medium"
                data-testid="text-workshop-datetime"
              >
                {dateLine && (
                  <div className="inline-flex items-center gap-2" data-testid="text-workshop-date">
                    {DateIcon && (
                      <DateIcon className="w-5 h-5 shrink-0 text-primary" aria-hidden />
                    )}
                    <span>{dateLine}</span>
                  </div>
                )}
                {durationLabel && (
                  <span
                    className="inline-flex items-center gap-1.5 bg-primary/5 text-foreground px-3.5 py-1 rounded-full text-sm font-medium tracking-wide"
                    data-testid="text-workshop-duration"
                  >
                    {DurationIcon && (
                      <DurationIcon className="w-4 h-4 shrink-0 text-primary" aria-hidden />
                    )}
                    {durationLabel}
                    {durationSuffix ? ` ${durationSuffix}` : ""}
                  </span>
                )}
              </div>
            )}
            {seriesDay ? (
              <SeriesDayBadge
                label={seriesDay.label}
                note={seriesNote}
                testId="text-workshop-series-day"
              />
            ) : null}
          </div>
        ) : null}

        {showAside ? (
          <div
            className="order-2 flex flex-col gap-4 w-full min-w-0 h-fit shrink-0 md:order-none md:self-start"
            data-workshop-aside
          >
          {(showCountdownStrip || hasFormCard) ? (
            <div
              className={`overflow-hidden rounded-[16px] bg-card ${
                eventState === "live" ? "workshop-live-pulse" : ""
              }`}
              style={{
                border:
                  eventState === "live"
                    ? "1.6px solid hsl(var(--primary) / 0.18)"
                    : "1px solid hsl(var(--border))",
                boxShadow:
                  eventState === "live"
                    ? undefined
                    : "0 3px 10px hsl(var(--primary) / 0.06), 0 8px 22px hsl(var(--primary) / 0.04)",
              }}
              data-testid="workshop-form-stack"
            >
              {showCountdownStrip ? (
                eventState === "live" ? (
                  <div
                    className="relative overflow-hidden bg-muted"
                    data-testid="workshop-countdown"
                  >
                    {stripBg ? (
                      <UniversalImage
                        id={stripBg}
                        alt=""
                        loading="eager"
                        className="block w-full leading-none"
                        style={{
                          width: "100%",
                          height: "auto",
                          objectFit: "contain",
                          objectPosition: "center center",
                        }}
                        fieldContext={{ fieldPath: "live.images" }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div
                    className="relative min-h-[7.5rem] max-h-48 overflow-hidden bg-muted"
                    data-testid="workshop-countdown"
                  >
                    {stripBg && (
                      <div className="absolute inset-0 z-0">
                        <UniversalImage
                          id={stripBg}
                          alt=""
                          className="w-full h-full object-cover"
                          fieldContext={{ fieldPath: "countdown.background_image" }}
                        />
                      </div>
                    )}
                    <div className="relative z-10 h-full min-h-[7.5rem] max-h-48 flex items-center justify-center px-6 py-8">
                      {countdown && (
                        <div
                          className={`flex gap-2 sm:gap-3 font-inter tabular-nums items-center py-6 ${
                            stripBg ? "text-white drop-shadow-sm" : "text-foreground"
                          }`}
                        >
                          {countdownSlots.map(([label, value], i) => (
                            <div key={label} className="flex items-center gap-2 sm:gap-3">
                              {i > 0 && (
                                <span
                                  className={`text-2xl font-bold leading-none -mt-4 ${
                                    stripBg ? "text-white/80" : "text-muted-foreground"
                                  }`}
                                  aria-hidden
                                >
                                  :
                                </span>
                              )}
                              <div
                                className="flex flex-col items-center min-w-[2.75rem]"
                                data-testid={`countdown-${label}`}
                              >
                                <span className="text-[2rem] sm:text-[2.5rem] font-extrabold leading-none">
                                  {value}
                                </span>
                                <span
                                  className={`text-[10px] uppercase tracking-wider mt-1 font-bold ${
                                    stripBg ? "text-white/90" : "text-muted-foreground"
                                  }`}
                                >
                                  {label}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              ) : null}

              {hasFormCard ? (
                <div data-testid="workshop-form-card">
                  {(data.form_card_title || data.form_card_subtitle) && (
                    <div className="pb-1 px-5 pt-5 text-center">
                      {data.form_card_title && (
                        <p className="font-inter text-[19px] font-semibold tracking-tight text-foreground">
                          {data.form_card_title}
                        </p>
                      )}
                      {data.form_card_subtitle && (
                        <p className="text-[12.5px] text-muted-foreground leading-snug mt-1">
                          {data.form_card_subtitle}
                        </p>
                      )}
                    </div>
                  )}
                  {form && (
                    <div className="px-5 py-3" data-hero-inline-form>
                      <Suspense
                        fallback={
                          <div className="min-h-24 flex items-center justify-center text-muted-foreground text-sm">
                            Loading...
                          </div>
                        }
                      >
                        <LeadForm data={form} />
                      </Suspense>
                    </div>
                  )}
                  {data.form_card_disclaimer && (
                    <p className="text-[11px] text-muted-foreground/60 pb-3 px-5 font-medium text-center">
                      {data.form_card_disclaimer}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {hasSeatsInfo ? (
            <Card
              className="w-full h-fit shrink-0 rounded-[16px] overflow-hidden bg-card shadow-lg shadow-black/5 border border-border"
              data-testid="workshop-seats-card"
            >
              <div className="p-5" data-testid="workshop-seats" aria-live="polite">
                <div
                  className="flex flex-col gap-3.5 rounded-2xl bg-muted p-4"
                  style={{ minHeight: SEATS_PLACEHOLDER_MIN_H }}
                >
                  {seatsCopy ? (
                    <p
                      className="text-xs mb-3 font-medium text-foreground text-center leading-snug"
                      data-testid="text-workshop-seats-copy"
                    >
                      {seatsCopy}
                    </p>
                  ) : null}
                  <div
                    className={
                      seatsOverflow ? "flex min-h-0 flex-col" : undefined
                    }
                    style={
                      seatsOverflow
                        ? { height: SEATS_LIST_REGION_H }
                        : undefined
                    }
                    data-testid="workshop-seats-viewport"
                  >
                    <div
                      className={
                        seatsOverflow
                          ? `min-h-0 flex-1 ${
                              showAllSeats
                                ? "overflow-y-auto overscroll-contain pr-0.5"
                                : "overflow-hidden"
                            }`
                          : undefined
                      }
                    >
                      <TooltipProvider delayDuration={200}>
                        <div
                          className="grid gap-x-2 gap-y-4 justify-items-center"
                          style={{
                            gridTemplateColumns: `repeat(${SEATS_COLS}, minmax(0, 1fr))`,
                          }}
                          data-testid="workshop-seats-grid"
                        >
                          {registrants.map((person, i) => {
                            const label = person.name || `Participant ${i + 1}`;
                            const resolvedAvatar =
                              person.avatar_url ||
                              (fallbackAvatars.length
                                ? fallbackAvatars[i % fallbackAvatars.length]
                                : "");
                            const avatar = (
                              <div
                                className="rounded-full overflow-hidden bg-background border border-border/80"
                                style={{
                                  width: AVATAR_SIZE,
                                  height: AVATAR_SIZE,
                                }}
                              >
                                {resolvedAvatar ? (
                                  <UniversalImage
                                    id={resolvedAvatar}
                                    alt={label}
                                    className="w-full h-full object-cover"
                                    fieldContext={{
                                      arrayPath: person.avatar_url
                                        ? "registrant_avatars"
                                        : "fallback_avatars",
                                      index: i,
                                      srcField: person.avatar_url
                                        ? "avatar_url"
                                        : "",
                                    }}
                                  />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground">
                                    {(person.name || "?").charAt(0)}
                                  </span>
                                )}
                              </div>
                            );
                            if (!person.name) {
                              return (
                                <div key={`${person.avatar_url}-${i}`}>
                                  {avatar}
                                </div>
                              );
                            }
                            return (
                              <Tooltip
                                key={`${person.avatar_url}-${i}-${person.name}`}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={label}
                                  >
                                    {avatar}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[14rem]">
                                  {person.name}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </TooltipProvider>
                    </div>
                    {canLoadMoreSeats && (
                      <button
                        type="button"
                        className="mt-2 shrink-0 self-start text-sm font-semibold text-primary hover:underline underline-offset-2"
                        onClick={() => setShowAllSeats(true)}
                        data-testid="button-workshop-seats-load-more"
                      >
                        {loadMoreLabel}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {showCalendarCard ? (
            <Card
              className="w-full h-fit shrink-0 rounded-[16px] overflow-hidden bg-card shadow-lg shadow-black/5 border border-border"
              data-testid="workshop-calendar-card"
            >
              <div className="p-5 space-y-3">
                {calendarHeading ? (
                  <p
                    className="text-sm font-semibold text-foreground text-center leading-snug"
                    data-testid="text-workshop-calendar-heading"
                  >
                    {calendarHeading}
                  </p>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={calendarBtnVariant}
                      className="w-full"
                      data-testid="button-workshop-calendar-cta"
                    >
                      {CalendarCtaIcon ? (
                        <CalendarCtaIcon className="h-4 w-4" aria-hidden />
                      ) : null}
                      <span>{calendarCtaLabel}</span>
                      <ChevronDown className="h-4 w-4 opacity-80" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    className="min-w-[var(--radix-dropdown-menu-trigger-width)] w-[var(--radix-dropdown-menu-trigger-width)]"
                  >
                    {calendarItems.map((item) => (
                      <DropdownMenuItem key={`${item.name}-${item.url}`} asChild>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`link-workshop-calendar-${item.name}`}
                        >
                          {item.name}
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ) : null}
          </div>
        ) : null}

        {description ? (
          <div
            className="order-3 min-w-0 text-[15px] leading-relaxed text-foreground/70 md:order-none md:pt-0 prose prose-sm max-w-none prose-p:my-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-foreground/70 prose-headings:text-base prose-headings:font-semibold prose-hr:my-4 prose-a:text-primary prose-strong:text-foreground"
            data-workshop-desc
            data-testid="text-workshop-description"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
          </div>
        ) : null}

        {showHostSection ? (
          <div
            className="order-4 min-w-0 space-y-3 md:order-none"
            data-workshop-host
            data-testid="workshop-host-section"
          >
            {hostHeading && (
              <p
                className="font-inter text-lg sm:text-2xl mt-2 md:mt-8 font-semibold tracking-tight text-foreground"
                data-testid="text-workshop-host-heading"
              >
                {hostHeading}
              </p>
            )}
            {(hostName || hostBio || hostAvatarUrl || hostSocials.length > 0) && (
              <Card
                className="w-full rounded-[16px] overflow-hidden bg-card shadow-lg shadow-black/5 border border-border"
                data-testid="workshop-host"
              >
                <div className="flex gap-4 items-center p-5">
                  {hostAvatarUrl ? (
                    <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full overflow-hidden shrink-0 bg-muted">
                      <UniversalImage
                        id={hostAvatarUrl}
                        alt={hostName || "Host"}
                        className="w-full h-full object-cover"
                        fieldContext={{ fieldPath: "host.avatar_url" }}
                      />
                    </div>
                  ) : hostName ? (
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full shrink-0 bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground">
                      {hostName.charAt(0)}
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    {hostName && (
                      <p
                        className="font-inter text-[19px] sm:text-[21.5px] font-semibold tracking-tight text-foreground"
                        data-testid="text-workshop-host-name"
                      >
                        {hostName}
                      </p>
                    )}
                    {hostBio && (
                      <p
                        className="text-xs sm:text-[14px] text-muted-foreground mt-0.2 leading-snug whitespace-pre-line"
                        data-testid="text-workshop-host-bio"
                      >
                        {hostBio}
                      </p>
                    )}
                    {hostSocials.length > 0 && (
                      <div
                        className="flex flex-wrap items-center gap-2.5 mt-2"
                        data-testid="workshop-host-socials"
                      >
                        {hostSocials.map((social, i) => {
                          const SocialIcon = social.icon
                            ? getIcon(social.icon)
                            : null;
                          const label = social.name || social.url;
                          return (
                            <a
                              key={`${social.url}-${i}`}
                              href={social.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={label}
                              aria-label={label}
                              className="inline-flex text-primary hover:opacity-80 transition-opacity"
                              data-testid={`link-workshop-host-social-${social.name || i}`}
                            >
                              {SocialIcon ? (
                                <SocialIcon className="h-5 w-5" aria-hidden />
                              ) : (
                                <span className="text-xs font-semibold underline">
                                  {label}
                                </span>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </section>

  );
}
