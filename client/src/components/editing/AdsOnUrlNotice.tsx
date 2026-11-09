import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, Loader2, Megaphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  adsDataReadAt,
  platformLabel,
  type AdOnUrl,
  type AdsOnUrlSource,
  type UrlRemovalCheck,
} from "@shared/url-removal";

export type AdsNoticeContext = "rename" | "delete" | "unpublish" | "redirect";

type AdLike = Pick<AdOnUrl, "platform" | "campaign_name" | "ad_name" | "matched_by"> & { ad_id?: string; site?: string };

export type AdsNoticeData = {
  live: AdLike[];
  paused: AdLike[];
  checked: boolean;
  sources: AdsOnUrlSource[];
};

function dedupe(ads: AdOnUrl[]): AdOnUrl[] {
  const seen = new Set<string>();
  return ads.filter((a) => {
    const k = `${a.site}:${a.platform}:${a.ad_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge every locale of a check into one notice. */
export function adsNoticeFromCheck(check: UrlRemovalCheck | null): AdsNoticeData | null {
  if (!check) return null;
  const sources = check.locales[0]?.ads.sources ?? [];
  return {
    live: dedupe(check.locales.flatMap((l) => l.ads.live)),
    paused: dedupe(check.locales.flatMap((l) => l.ads.paused)),
    checked: check.ads_checked,
    sources,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function liveCopy(context: AdsNoticeContext, n: number): string {
  const ads = plural(n, "live ad");
  switch (context) {
    case "rename":
      return `${ads} send people to this URL. You can change it, but only with a redirect so those ads keep working.`;
    case "delete":
      return `${ads} send people to this page. Deleting it sends that paid traffic to a missing page. Pick a page to send visitors to, or pause the ads first.`;
    case "unpublish":
      return `${ads} send people to this page. While it's a draft, those visitors will see a missing page.`;
    case "redirect":
      return `${ads} still use this old address. Removing the redirect sends them to a missing page.`;
  }
}

function pausedCopy(context: AdsNoticeContext, n: number): string {
  const ads = plural(n, "paused ad");
  switch (context) {
    case "rename":
      return `${ads} use this URL. If they're turned back on, they'll rely on the redirect.`;
    case "delete":
      return `${ads} use this page. If they're turned back on, they'll land on a missing page unless you send visitors elsewhere.`;
    case "unpublish":
      return `${ads} use this page. If they're turned back on while it's a draft, they'll land on a missing page.`;
    case "redirect":
      return `${ads} use this old address. If they're turned back on, they'll land on a missing page.`;
  }
}

function formatDay(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function AdList({ ads, testId }: { ads: AdLike[]; testId: string }) {
  const [open, setOpen] = useState(false);
  if (ads.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid={`${testId}-toggle`}>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          {open ? "Hide ads" : "Show ads"}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-0.5 text-xs" data-testid={testId}>
          {ads.slice(0, 30).map((a, i) => (
            <li key={`${a.platform}:${a.ad_id ?? i}`} className="min-w-0 truncate">
              <span className="font-medium">{platformLabel(a.platform)}</span>
              {" · "}
              {a.campaign_name || "Unnamed campaign"}
              {a.ad_name ? ` · ${a.ad_name}` : ""}
              {a.matched_by === "visits" ? <span className="text-muted-foreground"> (found by recent visits)</span> : null}
            </li>
          ))}
          {ads.length > 30 ? <li className="text-muted-foreground">…and {ads.length - 30} more</li> : null}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AdsOnUrlNotice({
  context,
  data,
  loading = false,
  error = null,
  onRefresh,
  refreshing = false,
  refreshNote = null,
  testIdPrefix = "ads-on-url",
  className,
}: {
  context: AdsNoticeContext;
  data: AdsNoticeData | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshNote?: string | null;
  testIdPrefix?: string;
  className?: string;
}) {
  if (loading) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)} data-testid={`${testIdPrefix}-loading`}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking ads…
      </p>
    );
  }
  if (error) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} data-testid={`${testIdPrefix}-error`}>
        Couldn't check ads: {error}
      </p>
    );
  }
  if (!data) return null;
  if (!data.checked) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} data-testid={`${testIdPrefix}-unchecked`}>
        Couldn't check ads: ad data hasn't been read for this site yet.
      </p>
    );
  }
  const live = data.live.length;
  const paused = data.paused.length;
  if (live === 0 && paused === 0) return null;

  const readAt = adsDataReadAt(data.sources);
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border p-2.5 text-foreground",
        live > 0 ? "border-destructive/40 bg-destructive/10" : "border-status-away/40 bg-status-away/10",
        className,
      )}
      data-testid={`${testIdPrefix}-notice`}
    >
      {live > 0 && (
        <p className="flex items-start gap-1.5 text-xs" data-testid={`${testIdPrefix}-live`}>
          <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span>{liveCopy(context, live)}</span>
        </p>
      )}
      <AdList ads={data.live} testId={`${testIdPrefix}-live-list`} />
      {paused > 0 && (
        <p className="flex items-start gap-1.5 text-xs" data-testid={`${testIdPrefix}-paused`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-away" aria-hidden />
          <span>{pausedCopy(context, paused)}</span>
        </p>
      )}
      <AdList ads={data.paused} testId={`${testIdPrefix}-paused-list`} />
      <div className="flex flex-wrap items-center gap-2">
        {onRefresh && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid={`${testIdPrefix}-refresh`}
          >
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            Refresh ad data
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Ad data last read {formatDay(readAt)}.</span>
      </div>
      {refreshNote && <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-refresh-note`}>{refreshNote}</p>}
      <details className="text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-1 hover:text-foreground">
          <Info className="h-3 w-3" aria-hidden /> Read more (advanced)
        </summary>
        <div className="mt-1.5 space-y-1.5 pl-4">
          <p>
            An ad counts when its link is this address, or when visitors tagged with that ad landed here in the last 14 days
            (this catches short links, old domains and earlier redirects).
          </p>
          <p>
            <strong>Live</strong> means active and it spent money, or was created, in the last 7 days of ad data. Other active
            ads count as paused.
          </p>
          <p>Redirects keep the ad's tracking tags (gclid, fbclid, UTM), so reporting still works.</p>
          <p>
            Refresh re-reads Meta ads right away. Google ads update with the next daily sync. To stop relying on a redirect,
            change the ad's link in Meta or Google.
          </p>
          {data.sources.length > 0 && (
            <ul className="space-y-0.5">
              {data.sources.map((s) => (
                <li key={`${s.site}:${s.platform}`}>
                  {platformLabel(s.platform)} ({s.site}): setup read {formatDay(s.fetched_at)}
                  {s.spend_until ? `, spend through ${s.spend_until}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
