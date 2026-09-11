/**
 * HeroWorkshop — `workshop` variant.
 * Left: badge, RTE title, date/duration, description, host.
 * Right: countdown + form card (form + Learn-like seats inside).
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { LeadFormData } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UniversalImage } from "@/components/UniversalImage";
import { getIcon } from "@/lib/icons";
import { coerceToText } from "@/lib/variable-manager";
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

/** Solid soft blue behind the title + countdown row (full-bleed). */
const TOP_ROW_BG = "hsl(var(--primary) / 0.09)";

/** Learn-like seats: ~5 per row, load-more then scroll. */
const SEATS_INITIAL = 15;
const SEATS_COLS = 4;
const SEATS_GRID_MAX_H = "11.5rem"; // ~3 rows when expanded
const SEATS_PLACEHOLDER_MIN_H = "5.5rem";
const AVATAR_SIZE = "2.35rem";

const LeadForm = lazy(
  () => import("@/components/lead_form/variants/LeadFormDefault"),
);

function stripTitleForMobile(html: string): string {
  return html
    .replace(/font-size\s*:[^;"]*(;)?/gi, "")
    .replace(/line-height\s*:[^;"]*(;)?/gi, "");
}

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

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  title?: string;
  description?: string;
  starting_at?: string;
  ending_at?: string;
  date_icon?: string;
  duration_label?: string;
  duration_suffix?: string;
  duration_icon?: string;
  host_name?: string;
  host_avatar_url?: string;
  host_bio?: string;
  /** Section label above the host card (e.g. "Host for this event"). */
  host_heading?: string;
  live_now_label?: string;
  capacity?: number | string;
  registered_count?: number | string;
  seats_remaining?: number | string;
  registrant_avatars?:
    | string[]
    | string
    | Array<{ name?: string; avatar_url?: string; url?: string }>;
  /** Cycled when a registrant has no avatar_url (image ids or URLs). */
  fallback_avatars?: string[] | string;
  /** Single Learn-like line above avatars (template can use {{ entry.* }}). */
  seats_copy?: string;
  /** Decorative media (e.g. GIF) behind the countdown strip above the form. */
  countdown_background_image?: string;
  form_card_title?: string;
  form_card_subtitle?: string;
  form_card_disclaimer?: string;
  form?: LeadFormData | null;
  /** Add-to-calendar dropdown card; hidden when items empty. */
  calendar_cta?: {
    text?: string;
    variant?: "primary" | "secondary" | "outline";
    icon?: string;
    items?: Array<{ name?: string; url?: string }>;
  };
}

interface HeroWorkshopProps {
  data: HeroWorkshopData;
}

export default function HeroWorkshop({ data }: HeroWorkshopProps) {
  const locale = pageLocale();

  const titleHtml = typeof data.title === "string" ? data.title : "";
  const badge = coerceToText(data.badge);
  // back_label / back_url kept on data for now; UI link hidden
  const description = coerceToText(data.description);
  const paragraphs = useMemo(
    () => (description ? splitParagraphs(description) : []),
    [description],
  );
  const durationLabel = coerceToText(data.duration_label);
  const durationSuffix = coerceToText(data.duration_suffix);
  const dateIconName = coerceToText(data.date_icon);
  const durationIconName = coerceToText(data.duration_icon);
  const DateIcon = dateIconName ? getIcon(dateIconName) : null;
  const DurationIcon = durationIconName ? getIcon(durationIconName) : null;
  const hostName = coerceToText(data.host_name);
  const hostBio = coerceToText(data.host_bio);
  const hostHeading = coerceToText(data.host_heading);
  const liveNowLabel = coerceToText(data.live_now_label);
  const seatsCopy = coerceToText(data.seats_copy);
  const countdownBg = coerceToText(data.countdown_background_image);

  const startMs = parseIso(data.starting_at);
  const endMs = parseIso(data.ending_at);
  const dateLine =
    data.starting_at && startMs != null
      ? formatEventDate(data.starting_at, locale)
      : "";

  const registered = toNum(data.registered_count);
  const remaining = toNum(data.seats_remaining);
  const capacity = toNum(data.capacity);
  const registrants = normalizeRegistrants(data.registrant_avatars);
  const fallbackAvatars = normalizeStringList(data.fallback_avatars);
  const hasSeatsInfo =
    !!seatsCopy || registered != null || remaining != null || registrants.length > 0;
  const [showAllSeats, setShowAllSeats] = useState(false);
  const visibleRegistrants = showAllSeats
    ? registrants
    : registrants.slice(0, SEATS_INITIAL);
  const canLoadMoreSeats = registrants.length > SEATS_INITIAL && !showAllSeats;
  const loadMoreLabel = pageLocale().startsWith("es") ? "Ver más" : "Load more";

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

  const countdown =
    eventState === "upcoming" && startMs != null
      ? diffParts(startMs - now)
      : null;

  const showCountdownStrip =
    !!countdown || (eventState === "live" && !!liveNowLabel) || !!countdownBg;

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

  return (
    <section className="relative" data-testid="section-hero-workshop">
      {/* Row 1: title block + countdown — solid blue band (full-bleed) */}
      <div className="relative">
        {/* <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[calc(-1*var(--section-pt,0px))] bottom-0 z-0 w-screen -translate-x-1/2"
          style={{ background: TOP_ROW_BG }}
          data-testid="workshop-top-row-bg"
        /> */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-x-16 gap-y-8">
          <div className="space-y-4">
            {badge && (
              <span
                className="inline-block bg-primary text-white px-3 py-1 rounded-full text-xs font-bold tracking-wide"
                data-testid="text-workshop-badge"
              >
                {badge}
              </span>
            )}

            {titleHtml && (
              <h1
                className="font-inter font-extrabold text-foreground [&_em]:text-primary [&_em]:italic"
                data-testid="text-workshop-title"
              >
                <div
                  className="block md:hidden text-[2.25rem] leading-none"
                  dangerouslySetInnerHTML={{ __html: stripTitleForMobile(titleHtml) }}
                />
                <div
                  className="hidden md:block text-[2.75rem] lg:text-[3.5rem] leading-[1.03]"
                  dangerouslySetInnerHTML={{ __html: titleHtml }}
                />
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
          </div>

          {showCountdownStrip ? (
            <div
              className={`relative min-h-[7.5rem] max-h-48 lg:self-end overflow-hidden bg-muted ${
                hasFormCard ? "rounded-t-[16px]" : "rounded-[16px]"
              }`}
              style={{
                border: "1.5px solid hsl(var(--primary) / 0.22)",
                borderBottom: hasFormCard ? "none" : undefined,
                boxShadow: hasFormCard
                  ? undefined
                  : "0 3px 10px hsl(var(--primary) / 0.06), 0 8px 22px hsl(var(--primary) / 0.04)",
              }}
              data-testid="workshop-countdown"
            >
              {countdownBg && (
                <div className="absolute inset-0 z-0">
                  <UniversalImage
                    id={countdownBg}
                    alt=""
                    className="w-full h-full object-cover"
                    fieldContext={{ fieldPath: "countdown_background_image" }}
                  />
                </div>
              )}
              <div className="relative z-10 h-full min-h-[7.5rem] max-h-48 flex items-center justify-center px-6 py-8">
                {eventState === "live" && liveNowLabel && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-sm font-bold text-destructive shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-destructive" aria-hidden />
                    {liveNowLabel}
                  </span>
                )}
                {countdown && (
                  <div
                    className={`flex gap-2 sm:gap-3 font-inter tabular-nums items-center py-10 ${
                      countdownBg ? "text-white drop-shadow-sm" : "text-foreground"
                    }`}
                  >
                    {countdownSlots.map(([label, value], i) => (
                      <div key={label} className="flex items-center gap-2 sm:gap-3">
                        {i > 0 && (
                          <span
                            className={`text-2xl font-bold leading-none -mt-4 ${
                              countdownBg ? "text-white/80" : "text-muted-foreground"
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
                              countdownBg ? "text-white/90" : "text-muted-foreground"
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
          ) : (
            <div className="hidden lg:block" aria-hidden />
          )}
        </div>
      </div>

      {/* Row 2: description/host | form + seats — same column tracks as row 1 */}
      <div className="ps-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-start lg:gap-x-16 gap-y-8 lg:pt-0">
        <div className="min-w-0 space-y-4 lg:pt-10">
          {paragraphs.length > 0 && (
            <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground" data-testid="text-workshop-description">
              {paragraphs.map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </div>
          )}

          {(hostHeading || hostName || hostBio) && (
            <div className="space-y-3" data-testid="workshop-host-section">
              {hostHeading && (
                <p
                  className="font-inter text-lg sm:text-2xl mt-8 font-semibold tracking-tight text-foreground"
                  data-testid="text-workshop-host-heading"
                >
                  {hostHeading}
                </p>
              )}
              {(hostName || hostBio || data.host_avatar_url) && (
                <Card
                  className="w-full rounded-[16px] overflow-hidden bg-card shadow-lg shadow-black/5 border border-border"
                  data-testid="workshop-host"
                >
                  <div className="flex gap-4 items-start p-5">
                    {data.host_avatar_url ? (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shrink-0 bg-muted">
                        <UniversalImage
                          id={String(data.host_avatar_url)}
                          alt={hostName || "Host"}
                          className="w-full h-full object-cover"
                          fieldContext={{ fieldPath: "host_avatar_url" }}
                        />
                      </div>
                    ) : hostName ? (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full shrink-0 bg-muted flex items-center justify-center text-3xl font-bold text-muted-foreground">
                        {hostName.charAt(0)}
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1 pt-0.5">
                      {hostName && (
                        <p
                          className="font-inter text-[19px] sm:text-[22px] font-semibold tracking-tight text-foreground"
                          data-testid="text-workshop-host-name"
                        >
                          {hostName}
                        </p>
                      )}
                      {hostBio && (
                        <p
                          className="text-sm sm:text-[15px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line"
                          data-testid="text-workshop-host-bio"
                        >
                          {hostBio}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 w-full min-w-0 h-fit lg:self-start shrink-0">
          <div
            className={`bg-card h-fit shrink-0 ${
              showCountdownStrip ? "rounded-b-[16px]" : "rounded-[16px]"
            }`}
            style={{
              border: "1.5px solid hsl(var(--primary) / 0.22)",
              borderTop: showCountdownStrip ? "none" : undefined,
              boxShadow:
                "0 3px 10px hsl(var(--primary) / 0.06), 0 8px 22px hsl(var(--primary) / 0.04)",
            }}
            data-testid="workshop-form-card"
          >
              {hasFormCard && (data.form_card_title || data.form_card_subtitle) && (
                <div className="pb-1 px-5 pt-5">
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
                <div className="px-5 pb-3" data-hero-inline-form>
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

              <div
                className={`px-5 ${hasFormCard ? "pt-3 border-t border-border/60" : "pt-5"} pb-5`}
                data-testid="workshop-seats"
                aria-live="polite"
              >
                <div
                  className="flex flex-col gap-3.5 rounded-2xl bg-muted p-4"
                  style={{ minHeight: SEATS_PLACEHOLDER_MIN_H }}
                >
                  {hasSeatsInfo ? (
                    <>
                      {seatsCopy ? (
                        <p
                          className="text-sm font-semibold text-foreground text-center leading-snug"
                          data-testid="text-workshop-seats-copy"
                        >
                          {seatsCopy}
                        </p>
                      ) : null}
                      {registrants.length > 0 ? (
                        <>
                          <div
                            className={
                              showAllSeats
                                ? "overflow-y-auto overscroll-contain pr-0.5"
                                : undefined
                            }
                            style={
                              showAllSeats
                                ? { maxHeight: SEATS_GRID_MAX_H }
                                : undefined
                            }
                          >
                            <TooltipProvider delayDuration={200}>
                              <div
                                className="grid gap-2 justify-items-center"
                                style={{
                                  gridTemplateColumns: `repeat(${SEATS_COLS}, minmax(0, 1fr))`,
                                }}
                                data-testid="workshop-seats-grid"
                              >
                                {visibleRegistrants.map((person, i) => {
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
                                    <Tooltip key={`${person.avatar_url}-${i}-${person.name}`}>
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
                              className="self-start text-sm font-semibold text-primary hover:underline underline-offset-2"
                              onClick={() => setShowAllSeats(true)}
                              data-testid="button-workshop-seats-load-more"
                            >
                              {loadMoreLabel}
                            </button>
                          )}
                        </>
                      ) : (
                        <div
                          className="rounded-md bg-background/50"
                          style={{ minHeight: SEATS_PLACEHOLDER_MIN_H }}
                          aria-hidden
                        />
                      )}
                    </>
                  ) : (
                    <div
                      className="rounded-md bg-background/50"
                      style={{ minHeight: SEATS_PLACEHOLDER_MIN_H }}
                      aria-hidden
                      data-testid="workshop-seats-placeholder"
                    />
                  )}
                </div>
              </div>
          </div>

          {showCalendarCard ? (
            <Card
              className="w-full h-fit shrink-0 rounded-[16px] overflow-hidden bg-card shadow-lg shadow-black/5 border border-border"
              data-testid="workshop-calendar-card"
            >
              <div className="p-5">
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
      </div>
    </section>

  );
}
