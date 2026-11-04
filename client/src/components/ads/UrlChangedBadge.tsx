import { badgeVariants } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AdsPageRow, AdsRowUrlChange } from "./ads-types";
import { formatMoney, moneyTotal } from "./ads-format";

/** Page path (or "an Instant Form") for a URL from an ad's link history. */
export function shortAdUrl(url: string): string {
  if (url === "instant_form") return "an Instant Form";
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}

export function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function changeSentence(c: AdsRowUrlChange): string {
  const moved = `"${c.ad_name || c.ad_id}" moved from ${shortAdUrl(c.from_url)} to ${shortAdUrl(c.to_url)} on ${formatDay(c.date)}.`;
  if (c.inferred) return `${moved} Read from where visitors landed (before link history was saved).`;
  return c.basis === "ga4"
    ? `${moved} Spend that day was split by where visitors landed, so it's approximate.`
    : `${moved} No visits were seen that day, so all of it went to the new page.`;
}

/** Outline badge look for a clickable chip on a paid page row. */
export const CHIP_BUTTON_CLASS = cn(
  badgeVariants({ variant: "outline" }),
  "text-[10px] px-1.5 py-0 text-muted-foreground cursor-pointer hover:text-foreground",
);

/** "URL changed" / "page not confirmed" chip on a paid page row; click explains what it means for this page's spend. */
export function UrlChangedBadge({ row }: { row: Pick<AdsPageRow, "key" | "url_change_days" | "url_changes" | "unconfirmed_page_spend"> }) {
  const days = row.url_change_days ?? 0;
  const unconfirmed = moneyTotal(row.unconfirmed_page_spend) > 0;
  if (days === 0 && !unconfirmed) return null;
  const changes = row.url_changes ?? [];
  const label = days > 0 ? "URL changed" : "page not confirmed";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={CHIP_BUTTON_CLASS} aria-label={`What does "${label}" mean?`} data-testid={`chip-url-changed-${row.key}`}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-xs leading-relaxed text-muted-foreground">
        {days > 0 ? (
          <>
            <p className="text-sm font-medium text-foreground">URL changed</p>
            <p>
              An ad that sends people here switched its link during this date range. On the day it switched, its spend is split between the old
              page and the new one, so this page&apos;s spend and cost numbers are approximate for that day.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">Page not confirmed</p>
            <p>
              Part of this page&apos;s spend comes from older ads we can&apos;t verify. Back then we didn&apos;t save each ad&apos;s link history, and
              those links didn&apos;t carry the ad&apos;s id, so we assume they pointed here because it&apos;s the earliest link we know for them.
            </p>
          </>
        )}
        <p>Visits and leads are still counted from real visits to this page. Only how ad spend is assigned to it is uncertain.</p>
        <div className="space-y-1.5 border-t border-border pt-2" data-testid={`chip-url-changed-details-${row.key}`}>
          {changes.map((c) => (
            <p key={`${c.ad_id}-${c.date}`} className="text-foreground">
              {changeSentence(c)}
            </p>
          ))}
          {days > 0 && changes.length === 0 && <p>Changed on {days} day(s) in this range.</p>}
          {unconfirmed && <p>Spend assumed to go to this page without confirmation: {formatMoney(row.unconfirmed_page_spend)}.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
