import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { cn } from "@/lib/utils";
import { isClicksVisitsMismatch, type AdsIssue } from "@shared/ads-diagnostics-rules";
import { NO_URL_DESTINATION_KINDS, type AdsPageRow } from "./ads-types";
import { formatMoney, formatNum, formatPct, formatSeconds } from "./ads-format";
import { PlatformTag } from "./PlatformTag";
import { UrlChangedBadge } from "./UrlChangedBadge";
import { conversionColumns, PaidCampaignRows } from "./PaidCampaignRows";

export type PaidPerspective = "traffic" | "conversion" | "engagement" | "integrity";

type Metric = { label: string; value: string; muted?: boolean; testId: string; hint?: ReactNode };

const ORGANIC_RATE_HINT = (
  <>
    <p className="font-medium text-foreground">Organic rate</p>
    <p>Of the visits to this page that did not come from an ad (search, direct, referral, email, unpaid social), the share that sent a lead.</p>
    <p>
      Use it as a baseline for <span className="text-foreground">Conv. rate</span>. If paid converts well below organic, the page works and the ad
      traffic is the weak part — check targeting or whether the ad promises something the page doesn't. If both are low, improve the page first.
    </p>
    <p className="text-muted-foreground">
      Counted per visit from GA4 lead events, so it's close to but not identical to Conv. rate. A person who clicked an ad earlier and returns
      directly counts as organic on that return visit. "—" means no organic visits in this range.
    </p>
  </>
);

function metricsFor(row: AdsPageRow, perspective: PaidPerspective, issues: AdsIssue[]): Metric[] {
  const grey = row.low_sample;
  const metaGrey = row.meta_low_sample;
  switch (perspective) {
    case "traffic":
      return [
        { label: "Spend", value: formatMoney(row.spend), testId: "spend" },
        { label: "Paid visits", value: formatNum(row.paid_visits), testId: "visits" },
        { label: "Cost / visit", value: formatMoney(row.cost_per_visit, { decimals: 2 }), muted: grey, testId: "cpv" },
        {
          label: "Clicks → visits",
          value: isClicksVisitsMismatch(row.clicks_to_visits) ? "Mismatch" : formatPct(row.clicks_to_visits, 0),
          muted: grey,
          testId: "ctv",
        },
        { label: "CTR", value: formatPct(row.ctr), muted: grey, testId: "ctr" },
        { label: "Cost / click", value: formatMoney(row.cpc, { decimals: 2 }), muted: grey, testId: "cpc" },
      ];
    case "conversion":
      return [
        {
          label: "Leads",
          value: row.repeat_submissions > 0 ? `${formatNum(row.unique_leads)} · ${formatNum(row.submissions)} sub.` : formatNum(row.unique_leads),
          testId: "leads",
        },
        { label: "Conv. rate", value: formatPct(row.conversion_rate), muted: grey, testId: "cr" },
        { label: "Cost / lead", value: formatMoney(row.cost_per_lead, { decimals: 2 }), muted: grey, testId: "cpl" },
        ...(conversionColumns(row).meta
          ? [
              { label: "Meta leads", value: formatNum(row.meta_leads), testId: "meta-leads" },
              { label: "Meta conv.", value: formatPct(row.meta_conversion_rate), muted: metaGrey, testId: "meta-cr" },
              { label: "Meta cost / lead", value: formatMoney(row.meta_cost_per_lead, { decimals: 2 }), muted: metaGrey, testId: "meta-cpl" },
            ]
          : []),
        ...(conversionColumns(row).google ? [{ label: "Google leads", value: formatNum(row.google_leads ?? 0), testId: "google-leads" }] : []),
        {
          label: "Organic rate",
          value: formatPct(row.organic?.lead_rate ?? null),
          muted: true,
          testId: "organic-rate",
          hint: ORGANIC_RATE_HINT,
        },
      ];
    case "engagement":
      return [
        { label: "Paid bounce", value: formatPct(row.bounce_rate, 0), muted: grey, testId: "bounce" },
        { label: "Paid engaged time", value: formatSeconds(row.avg_engaged_seconds), muted: grey, testId: "engaged" },
        { label: "Organic bounce", value: formatPct(row.organic?.bounce_rate ?? null, 0), muted: true, testId: "organic-bounce" },
      ];
    case "integrity": {
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.filter((i) => i.severity === "warning").length;
      const unclearShare = row.paid_visits + row.unclear_visits > 0 ? row.unclear_visits / (row.paid_visits + row.unclear_visits) : null;
      return [
        { label: "Errors", value: String(errors), testId: "errors" },
        { label: "Warnings", value: String(warnings), testId: "warnings" },
        { label: "Unclear", value: formatPct(unclearShare, 0), testId: "unclear" },
        { label: "Redirected from", value: row.redirected_from.length ? String(row.redirected_from.length) : "—", testId: "redirects" },
        {
          label: "Visits / page loads",
          value: isClicksVisitsMismatch(row.lpv_to_visits) ? "Mismatch" : formatPct(row.lpv_to_visits, 0),
          muted: grey,
          testId: "lpv-visits",
        },
      ];
    }
  }
}

export function PaidPageRow({
  row,
  perspective,
  issues = [],
  coveredDays,
  metaSplitDays,
  askRejectPct,
  primaryHost,
}: {
  row: AdsPageRow;
  perspective: PaidPerspective;
  issues?: AdsIssue[];
  coveredDays?: { covered: number; total: number };
  metaSplitDays?: { covered: number; total: number };
  askRejectPct?: number | null;
  primaryHost?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasVersions = !!row.versions && row.versions.length > 0;
  const canExpand = row.campaigns.length > 0 || hasVersions;
  const metrics = metricsFor(row, perspective, issues);
  const showHost = row.host && primaryHost && row.host !== primaryHost;
  const clickLeads = row.pixel_leads_click ?? 0;
  const viewOnlyLeads = Math.max(0, row.meta_leads - clickLeads);
  const showMetaBlock = row.platforms.includes("meta") || row.meta_leads > 0 || row.impressions > 0 || row.landing_page_views > 0;

  return (
    <div className="border-b border-border last:border-b-0" data-testid={`paid-page-row-${row.key}`}>
      <div className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {row.locale && <LocaleFlag locale={row.locale} className="w-3.5 h-2.5 rounded-sm shrink-0" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground" title={row.title}>
                {row.title}
              </span>
              {row.content_type && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {row.content_type}
                </Badge>
              )}
              {row.kind !== "entry" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {row.kind_label}
                </Badge>
              )}
              {row.low_sample && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground" data-testid="chip-low-sample">
                  not enough data
                </Badge>
              )}
              <UrlChangedBadge row={row} />
              {row.platforms.map((p) => (
                <PlatformTag key={p} platform={p} row={row} />
              ))}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {showHost ? `${row.host}` : ""}
              {row.path}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {metrics.map((m) => (
            <div key={m.testId} className="min-w-[72px] text-right" data-testid={`metric-${m.testId}`}>
              <p className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.label}
                {m.hint && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded text-muted-foreground hover:text-foreground"
                        aria-label={`What is ${m.label}?`}
                        data-testid={`button-metric-hint-${m.testId}`}
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 space-y-2 text-xs normal-case tracking-normal" align="end">
                      {m.hint}
                    </PopoverContent>
                  </Popover>
                )}
              </p>
              <p className={cn("text-sm tabular-nums", m.muted ? "text-muted-foreground" : "text-foreground")}>{m.value}</p>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Details" data-testid="button-paid-row-details">
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-2 text-xs" align="end">
                {row.campaigns.length > 0 && <p className="text-muted-foreground">Expand the row to see how this page splits across campaigns.</p>}
                {showMetaBlock && (
                  <div data-testid="paid-row-meta-block">
                    <p className="font-medium text-foreground mb-1">Meta's own count</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      <li className="flex justify-between gap-2">
                        <span>Impressions</span>
                        <span className="tabular-nums text-foreground">{formatNum(row.impressions)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>CPM</span>
                        <span className="tabular-nums text-foreground">{formatMoney(row.cpm, { decimals: 2 })}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Link clicks</span>
                        <span className="tabular-nums text-foreground">{formatNum(row.clicks)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Landing page views</span>
                        <span className="tabular-nums text-foreground">{formatNum(row.landing_page_views)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Landing rate</span>
                        <span className="tabular-nums text-foreground">{formatPct(row.landing_rate)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Leads from clicks</span>
                        <span className="tabular-nums text-foreground">{formatNum(clickLeads)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Saw the ad only</span>
                        <span className="tabular-nums text-foreground">{formatNum(viewOnlyLeads)}</span>
                      </li>
                      {row.instant_form_leads > 0 && (
                        <li className="flex justify-between gap-2">
                          <span>Instant Form leads</span>
                          <span className="tabular-nums text-foreground">{formatNum(row.instant_form_leads)}</span>
                        </li>
                      )}
                    </ul>
                    {row.clicks > 0 && row.landing_page_views === 0 && (
                      <p className="mt-1.5 text-muted-foreground">
                        Meta saw clicks but no page loads, so the Meta Pixel may be missing on this page.
                      </p>
                    )}
                    {metaSplitDays && metaSplitDays.covered < metaSplitDays.total && (
                      <p className="mt-1.5 text-muted-foreground">
                        Click vs saw-the-ad-only based on {metaSplitDays.covered} of {metaSplitDays.total} days.
                      </p>
                    )}
                  </div>
                )}
                {row.platforms.length > 1 && (
                  <p data-testid="paid-row-mixed-platforms">
                    Site visits and leads may include other platforms (for example Google). Meta columns count Meta ads only.
                  </p>
                )}
                <p>
                  Started here: {row.started_here} · Form sent here: {row.closed_here}
                </p>
                {row.unassigned_visits > 0 && (
                  <p>{formatNum(row.unassigned_visits)} paid visit(s) here had no ad tags, so they aren't counted under the selected account or currency.</p>
                )}
                {row.last_visit_organic > 0 && (
                  <p>{row.last_visit_organic} lead(s) came back later without a new ad click; still credited here.</p>
                )}
                {row.repeat_submissions > 0 && (
                  <p>
                    {row.repeat_submissions} repeat submission(s) from the same browser within 24h — shown, not counted as leads.
                  </p>
                )}
                {coveredDays && coveredDays.covered < coveredDays.total && (
                  <p>
                    Site leads based on {coveredDays.covered} of {coveredDays.total} days.
                  </p>
                )}
                {askRejectPct != null && askRejectPct > 0 && <p>Includes estimates; {askRejectPct}% rejected tracking in ask regions.</p>}
                {row.redirected_from.length > 0 && <p>Also counts visits to: {row.redirected_from.join(", ")}</p>}
                <p className="text-muted-foreground">Seen in this browser — cross-device journeys are not joined.</p>
              </PopoverContent>
            </Popover>
            {row.url && !NO_URL_DESTINATION_KINDS.has(row.kind) && (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Open page"
                data-testid="link-paid-row-open"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={expanded ? "Hide campaigns" : "Show campaigns"}
                aria-expanded={expanded}
                data-testid="button-paid-row-expand"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="bg-muted/30 px-3 pb-2" data-testid="paid-row-expanded">
          <PaidCampaignRows row={row} perspective={perspective} metaSplitDays={metaSplitDays} />
          {hasVersions && (
            <div data-testid="paid-row-versions">
              <p className="pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Versions</p>
              {row.versions!.map((v) => (
                <div key={v.variant} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-foreground">{v.variant}</span>
                  <span className={cn("tabular-nums", v.low_sample ? "text-muted-foreground" : "text-foreground")}>
                    {formatNum(v.paid_visits)} paid visits · {formatNum(v.unique_leads)} leads · {formatPct(v.conversion_rate)}
                    {(v.organic_visits ?? 0) > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatNum(v.organic_visits ?? 0)} organic visits · {formatNum(v.organic_leads ?? 0)} organic leads
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
