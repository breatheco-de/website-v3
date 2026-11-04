import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { LowSampleBadge } from "./LowSampleBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isClicksVisitsMismatch } from "@shared/ads-diagnostics-rules";
import type { AdsCampaignRef, AdsPageRow } from "./ads-types";
import { formatMoney, formatNum, formatPct, moneyTotal, PLATFORM_LABELS } from "./ads-format";
import type { PaidPerspective } from "./PaidPageRow";

/** Meta columns show unless the row is Google-only; the Google leads column shows when Google sent traffic. */
export function conversionColumns(row: Pick<AdsPageRow, "platforms">): { meta: boolean; google: boolean } {
  const google = row.platforms.includes("google");
  return { meta: !(google && !row.platforms.includes("meta")), google };
}

type Cell = { label: string; testId: string; value: ReactNode; muted?: boolean; hint?: ReactNode };

const SPEND_NO_VISITS_HINT = "Spend recorded but no visits seen on this page. Check the ad's link or tracking.";

export function MetaLeadsHint({ metaSplitDays }: { metaSplitDays?: { covered: number; total: number } }) {
  return (
    <>
      <p>
        <span className="font-medium text-foreground">Leads from clicks:</span> people who clicked this campaign&apos;s ad and then sent a form, as
        counted by Meta.
      </p>
      <p>
        <span className="font-medium text-foreground">Saw the ad only:</span> people Meta credits after they only viewed the ad, without clicking —
        that&apos;s why Meta can count more than the site.
      </p>
      {metaSplitDays && metaSplitDays.covered < metaSplitDays.total && (
        <p className="text-muted-foreground">
          Based on {metaSplitDays.covered} of {metaSplitDays.total} days.
        </p>
      )}
    </>
  );
}

function MetaLeadsValue({ c }: { c: AdsCampaignRef }) {
  const click = Math.min(c.pixel_leads_click ?? 0, c.meta_leads);
  const viewOnly = Math.max(0, c.meta_leads - click);
  return (
    <span className="inline-flex items-baseline justify-end gap-1">
      <span>{formatNum(click)}</span>
      {viewOnly > 0 && (
        <span className="text-[10px] text-muted-foreground" data-testid="text-campaign-saw-only">
          +{formatNum(viewOnly)} saw the ad only
        </span>
      )}
    </span>
  );
}

function campaignCells(
  c: AdsCampaignRef,
  row: AdsPageRow,
  perspective: PaidPerspective,
  metaSplitDays?: { covered: number; total: number },
): Cell[] {
  const grey = c.low_sample;
  const ctv = c.clicks > 0 ? c.paid_visits / c.clicks : null;
  const ctvCell: Cell = {
    label: "Clicks → visits",
    testId: "ctv",
    value: isClicksVisitsMismatch(ctv) ? "Mismatch" : formatPct(ctv, 0),
    muted: grey,
  };
  switch (perspective) {
    case "traffic":
      return [
        { label: "Spend", testId: "spend", value: formatMoney(c.spend) },
        { label: "Paid visits", testId: "visits", value: formatNum(c.paid_visits) },
        { label: "Cost / visit", testId: "cpv", value: formatMoney(c.cost_per_visit, { decimals: 2 }), muted: grey },
        ctvCell,
        { label: "CTR", testId: "ctr", value: formatPct(c.ctr), muted: grey },
        { label: "Cost / click", testId: "cpc", value: formatMoney(c.cpc, { decimals: 2 }), muted: grey },
      ];
    case "conversion": {
      const cols = conversionColumns(row);
      return [
        { label: "Leads", testId: "leads", value: formatNum(c.unique_leads) },
        { label: "Conv. rate", testId: "cr", value: formatPct(c.conversion_rate), muted: grey },
        { label: "Cost / lead", testId: "cpl", value: formatMoney(c.cost_per_lead, { decimals: 2 }), muted: grey },
        ...(cols.meta
          ? [
              {
                label: "Meta leads",
                testId: "meta-leads",
                value: <MetaLeadsValue c={c} />,
                hint: <MetaLeadsHint metaSplitDays={metaSplitDays} />,
              },
              { label: "Meta conv.", testId: "meta-cr", value: formatPct(c.meta_conversion_rate), muted: grey },
              { label: "Meta cost / lead", testId: "meta-cpl", value: formatMoney(c.meta_cost_per_lead, { decimals: 2 }), muted: grey },
            ]
          : []),
        ...(cols.google ? [{ label: "Google leads", testId: "google-leads", value: formatNum(c.google_leads) }] : []),
        { label: "Organic rate", testId: "organic-rate", value: "", muted: true },
      ];
    }
    case "engagement":
      return [
        { label: "Paid bounce", testId: "bounce", value: formatPct(c.bounce_rate, 0), muted: grey },
        { label: "Paid engaged time", testId: "engaged", value: "", muted: true },
        { label: "Organic bounce", testId: "organic-bounce", value: "", muted: true },
      ];
    case "integrity":
      return [
        { label: "Spend", testId: "spend", value: formatMoney(c.spend) },
        { label: "Paid visits", testId: "visits", value: formatNum(c.paid_visits) },
        ctvCell,
      ];
  }
}

function CellView({ cell }: { cell: Cell }) {
  return (
    <div className="min-w-[72px] text-right" data-testid={`campaign-metric-${cell.testId}`}>
      <p className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {cell.label}
        {cell.hint && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded text-muted-foreground hover:text-foreground"
                aria-label={`What is ${cell.label}?`}
                data-testid={`button-campaign-hint-${cell.testId}`}
              >
                <Info className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2 text-xs normal-case tracking-normal" align="end">
              {cell.hint}
            </PopoverContent>
          </Popover>
        )}
      </p>
      <p className={cn("text-sm tabular-nums", cell.muted ? "text-muted-foreground" : "text-foreground")}>{cell.value}</p>
    </div>
  );
}

export function UntaggedExplainer({ c }: { c: AdsCampaignRef }) {
  return (
    <>
      <p>
        These paid visits or leads arrived without a campaign id in the link, so we can&apos;t say which campaign they came from. Spend is never put
        here.
      </p>
      {c.tag_texts && c.tag_texts.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-foreground">Campaign tags seen</p>
          <ul className="space-y-0.5" data-testid="list-untagged-tags">
            {c.tag_texts.map((t) => (
              <li key={t.text} className="flex justify-between gap-2">
                <span className="truncate font-mono">{t.text}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatNum(t.visits)} visits</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted-foreground">They also appear as separate rows under By campaign.</p>
    </>
  );
}

function UntaggedInfo({ c }: { c: AdsCampaignRef }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded text-muted-foreground hover:text-foreground"
          aria-label="What are visits without campaign tag?"
          data-testid="button-untagged-info"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs" align="start" data-testid="popover-untagged">
        <UntaggedExplainer c={c} />
      </PopoverContent>
    </Popover>
  );
}

function SpendNoVisitsWarning() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded text-destructive hover:opacity-80"
          aria-label="Spend but no visits"
          data-testid="button-campaign-spend-no-visits"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs" align="start">
        {SPEND_NO_VISITS_HINT}
      </PopoverContent>
    </Popover>
  );
}

function CampaignRow({
  c,
  row,
  perspective,
  metaSplitDays,
  minVisitsForRates,
}: {
  c: AdsCampaignRef;
  row: AdsPageRow;
  perspective: PaidPerspective;
  metaSplitDays?: { covered: number; total: number };
  minVisitsForRates?: number;
}) {
  const spendNoVisits = !c.untagged && moneyTotal(c.spend) > 0 && c.paid_visits === 0;
  const key = c.untagged ? "untagged" : `${c.platform ?? ""}-${c.campaign_id ?? c.campaign_name}`;
  return (
    <div
      className={cn("flex flex-col gap-2 border-t border-border/60 py-2 pl-6 md:flex-row md:items-center", c.untagged && "opacity-80")}
      data-testid={`campaign-row-${key}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {c.platform && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{PLATFORM_LABELS[c.platform] ?? c.platform}</span>}
        <span className={cn("truncate text-xs", c.untagged ? "italic text-muted-foreground" : "text-foreground")} title={c.campaign_name}>
          {c.campaign_name || "(no campaign name)"}
        </span>
        {c.untagged && <UntaggedInfo c={c} />}
        {spendNoVisits && <SpendNoVisitsWarning />}
        {!c.untagged && c.low_sample && !spendNoVisits && <LowSampleBadge subject="campaign" minVisits={minVisitsForRates} testId={`chip-low-sample-${key}`} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 md:pr-[76px]">
        {campaignCells(c, row, perspective, metaSplitDays).map((cell) => (
          <CellView key={cell.testId} cell={cell} />
        ))}
      </div>
    </div>
  );
}

export function PaidCampaignRows({
  row,
  perspective,
  metaSplitDays,
  minVisitsForRates,
}: {
  row: AdsPageRow;
  perspective: PaidPerspective;
  metaSplitDays?: { covered: number; total: number };
  minVisitsForRates?: number;
}) {
  const tagged = row.campaigns.filter((c) => !c.untagged);
  const comparable = row.comparable_campaigns ?? tagged.filter((c) => !c.low_sample).length;
  if (row.campaigns.length === 0) return null;
  return (
    <div data-testid="paid-row-campaigns">
      <p className="pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Campaigns</p>
      {tagged.length > 1 && (
        <p className="pb-1 text-xs text-muted-foreground" data-testid="text-comparable-campaigns">
          {comparable} of {tagged.length} campaigns have enough data to compare.
        </p>
      )}
      {row.campaigns.map((c) => (
        <CampaignRow
          key={c.untagged ? "untagged" : `${c.platform ?? ""}|${c.campaign_id ?? c.campaign_name}`}
          c={c}
          row={row}
          perspective={perspective}
          metaSplitDays={metaSplitDays}
          minVisitsForRates={minVisitsForRates}
        />
      ))}
    </div>
  );
}
