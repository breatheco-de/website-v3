import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ExternalLink, Info, Target, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGE_ICON,
  FUNNEL_STAGE_ICON_TONE,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
} from "@/lib/funnel-stage-ui";
import type {
  ChangeMarker,
  ChannelRow,
  Finding,
  FindingLink,
  ObjectiveBlock,
  ObjectiveDriver,
  ObjectiveFunnelStep,
  PageAdvice,
  TrafficFacts,
  TrafficSource,
} from "@shared/page-stats";
import { biggestFunnelDrop, PAGE_STATS_MIN_SESSIONS, PAGE_STATS_WINDOW_DAYS } from "@shared/page-stats";
import { OBJECTIVE_FUNNEL_STEP, type FunnelStepId } from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";
import { channelLabel, delta, money, num, pct, shortDay, targetSourceLabel, TONE_BORDER, TONE_TEXT } from "./format";
import { useTestView } from "./test-view-context";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  on_track: { label: "On track", className: "border-status-online/40 text-status-online" },
  behind: { label: "Behind", className: "border-status-busy/40 text-status-busy" },
  too_little_data: { label: "Too little data", className: "border-border text-muted-foreground" },
  no_target: { label: "No target", className: "border-border text-muted-foreground" },
  no_spend: { label: "No ad spend", className: "border-border text-muted-foreground" },
};

function StatusBadge({ status, detail }: { status: string; detail?: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.no_target!;
  const badge = (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-medium", s.className, detail && "cursor-pointer hover:text-foreground")}
      data-testid={`badge-objective-status-${status}`}
    >
      {s.label}
    </Badge>
  );
  if (!detail) return badge;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${s.label}: details`}>
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[10003] w-64 p-3 text-xs text-foreground" data-testid="popover-objective-status-detail">
        {detail}
      </PopoverContent>
    </Popover>
  );
}

const RATE_NUMERATOR: Record<ObjectiveBlock["primary"]["id"], string> = {
  moved_forward_rate: "sessions that went on to a later-stage page",
  reached_decision_rate: "sessions that reached a decision page",
  task_click_rate: "sessions that clicked the page's main task",
  conversion_rate: "leads from the page",
};

/** "similar pages" as a popover trigger that spells out how the benchmark target is computed. */
function TargetSource({ objective, kind }: { objective: ObjectiveBlock; kind: "rate" | "cost" }) {
  const source = kind === "rate" ? objective.primary.target_source : objective.cost?.target_source ?? "none";
  const label = targetSourceLabel(source);
  if (source !== "benchmark") return <>{label}</>;
  const stage = FUNNEL_STAGE_LABEL[objective.stage];
  const pages = (kind === "rate" ? objective.primary.benchmark_pages : objective.cost?.benchmark_pages) ?? 0;
  const pageCount = pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}` : "those pages";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          data-testid={`button-target-source-${kind}`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[10003] w-80 space-y-2 p-3 text-xs text-foreground" data-testid={`popover-target-source-${kind}`}>
        <p className="font-medium">What “similar pages” means</p>
        {kind === "rate" ? (
          <>
            <p>
              The other pages on this site whose funnel stage is <span className="font-medium">{stage}</span>, like this one. This page
              itself is left out.
            </p>
            <p>
              For each of them with at least {PAGE_STATS_MIN_SESSIONS} sessions in the last {PAGE_STATS_WINDOW_DAYS} days, we take its{" "}
              {objective.primary.label.toLowerCase()} rate ({RATE_NUMERATOR[objective.primary.id]} ÷ sessions). The target is the middle
              value (median) of {pageCount}: half of them do better, half do worse.
            </p>
          </>
        ) : (
          <>
            <p>
              The other <span className="font-medium">{stage}</span> pages on this site that ran ads in the last {PAGE_STATS_WINDOW_DAYS}{" "}
              days with enough paid visits to count. This page itself is left out.
            </p>
            <p>
              The target is the middle value (median) of their {objective.cost?.label.toLowerCase()} across {pageCount}, per currency.
            </p>
          </>
        )}
        <p className="text-muted-foreground">
          It needs at least 3 such pages; with fewer, the target falls back to this page's own previous {PAGE_STATS_WINDOW_DAYS} days. Set
          your own target to replace it for every {stage} page.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** "Previous was X%" as a popover trigger that explains the comparison window and what 0% / — mean. */
function PriorRateInfo({ objective }: { objective: ObjectiveBlock }) {
  const p = objective.primary;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-foreground"
          data-testid="button-objective-prior"
        >
          Previous was {pct(p.prior_value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[10003] w-80 space-y-2 p-3 text-xs text-foreground" data-testid="popover-objective-prior">
        <p className="font-medium">Previous {PAGE_STATS_WINDOW_DAYS} days</p>
        <p>
          The same {p.label.toLowerCase()} ({RATE_NUMERATOR[p.id]} ÷ sessions), measured over the {PAGE_STATS_WINDOW_DAYS} days just before the
          current window. Compare it with the big number above to see whether the page is improving.
        </p>
        {p.prior_value === null ? (
          <p>
            <span className="font-medium">—</span> means the page had no sessions in that period, so there is nothing to compare.
          </p>
        ) : p.prior_value === 0 ? (
          <p>
            <span className="font-medium tabular-nums">0.0%</span> means the page had visits then, but none of them got there. Usually the
            action wasn't on the page or wasn't tracked yet, the page changed since (vertical lines on the chart below), or there were too few
            visits to read much into it.
          </p>
        ) : null}
        {p.target_source === "previous_period" && (
          <p className="text-muted-foreground">
            No target is set and there are too few similar pages to compare with, so this previous value is also the target.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function objectiveSentence(o: ObjectiveBlock): string {
  const stage = FUNNEL_STAGE_LABEL[o.stage];
  if (o.stage === "decision" && o.cost?.target && o.cost.target_source === "settings") {
    return `This is a ${stage} page. Its job: get leads at or below ${money(o.cost.target)} each.`;
  }
  return `This is a ${stage} page. Its job: ${o.job.charAt(0).toLowerCase()}${o.job.slice(1)}`;
}

/** Bar scaled so the target sits at a fixed point; value fill can pass it. */
function ProgressToTarget({ value, target, lowerIsBetter = false }: { value: number | null; target: number | null; lowerIsBetter?: boolean }) {
  if (value === null) return <div className="h-2 rounded-full bg-muted" />;
  const max = Math.max(value, target ?? 0) * 1.25 || 1;
  const fill = Math.min(100, (value / max) * 100);
  const marker = target !== null ? Math.min(100, (target / max) * 100) : null;
  const good = target === null ? null : lowerIsBetter ? value <= target : value >= target;
  return (
    <div className="relative h-2 rounded-full bg-muted" aria-hidden>
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          good === null ? "bg-primary/60" : good ? "bg-status-online/70" : "bg-status-busy/70",
        )}
        style={{ width: `${fill}%` }}
      />
      {marker !== null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground/80" style={{ left: `${marker}%` }} />}
    </div>
  );
}

function priorDayOf(day: string, offsetDays: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function Sparkline({
  series,
  markers,
  gaps = [],
}: {
  series: TrafficFacts["series"];
  markers: ChangeMarker[];
  /** Days when the site's own counting was off (shaded). */
  gaps?: Array<{ start: string; end: string }>;
}) {
  const [hover, setHover] = useState<{ i: number; left: number; width: number } | null>(null);
  const testView = useTestView();
  if (series.length < 2) return null;
  const w = 280;
  const h = 44;
  const last = series.length - 1;
  const max = Math.max(1, ...series.map((p) => Math.max(p.sessions, p.prior_sessions)));
  const x = (i: number) => (i / last) * w;
  const y = (v: number) => h - (v / max) * (h - 4) - 2;
  const line = (key: "sessions" | "prior_sessions") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const markerDays = new Set(markers.map((m) => m.day));

  const hoverAt = (svg: SVGSVGElement, i: number) => {
    const ctm = svg.getScreenCTM();
    const box = svg.getBoundingClientRect();
    if (!ctm) return;
    setHover({ i, left: ctm.a * x(i) + ctm.e - box.left, width: box.width });
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgX = (e.clientX - ctm.e) / ctm.a;
    hoverAt(svg, Math.max(0, Math.min(last, Math.round((svgX / w) * last))));
  };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    hoverAt(e.currentTarget, Math.max(0, Math.min(last, (hover?.i ?? (step > 0 ? -1 : series.length)) + step)));
  };

  const point = hover ? series[hover.i]! : null;
  const change = point && !testView ? delta(point.sessions, point.prior_sessions) : null;
  const tooltipAlign = !hover ? "" : hover.left < 70 ? "left-0" : hover.left > hover.width - 70 ? "right-0" : "-translate-x-1/2";

  return (
    <div className="space-y-1">
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-11 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          role="img"
          aria-label={
            testView
              ? "Sessions per day since the test started. Use left and right arrows to read each day."
              : "Sessions per day, current vs previous 28 days. Use left and right arrows to read each day."
          }
          tabIndex={0}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
          data-testid="sparkline-sessions"
        >
          <rect x={0} y={0} width={w} height={h} fill="transparent" />
          {series.map((p, i) =>
            gaps.some((g) => p.day >= g.start && p.day <= g.end) ? (
              <rect
                key={`gap-${p.day}`}
                x={Math.max(0, x(i) - w / last / 2)}
                y={0}
                width={w / last}
                height={h}
                className="fill-muted pointer-events-none"
              />
            ) : null,
          )}
          {!testView && (
            <path d={line("prior_sessions")} className="stroke-muted-foreground/50 pointer-events-none" fill="none" strokeWidth={1.25} strokeDasharray="3 3" />
          )}
          <path d={line("sessions")} className="stroke-primary pointer-events-none" fill="none" strokeWidth={1.75} />
          {series.map((p, i) =>
            markerDays.has(p.day) ? (
              <line key={p.day} x1={x(i)} x2={x(i)} y1={0} y2={h} className="stroke-chart-4/70 pointer-events-none" strokeWidth={1} />
            ) : null,
          )}
          {hover && point && (
            <g className="pointer-events-none">
              <line x1={x(hover.i)} x2={x(hover.i)} y1={0} y2={h} className="stroke-foreground/40" strokeWidth={1} />
              {!testView && <circle cx={x(hover.i)} cy={y(point.prior_sessions)} r={2.5} className="fill-muted-foreground stroke-card" strokeWidth={1} />}
              <circle cx={x(hover.i)} cy={y(point.sessions)} r={3} className="fill-primary stroke-card" strokeWidth={1} />
            </g>
          )}
        </svg>
        {hover && point && (
          <div
            className={cn(
              "pointer-events-none absolute bottom-full mb-1.5 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md",
              tooltipAlign,
            )}
            style={tooltipAlign === "-translate-x-1/2" ? { left: hover.left } : undefined}
            aria-live="polite"
            data-testid="sparkline-tooltip"
          >
            <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-0.5">
              <span className="h-0.5 w-3 rounded-full bg-primary" />
              <span className="text-foreground">{shortDay(point.day)}</span>
              <span className="tabular-nums text-right font-medium text-foreground">{num(point.sessions)} sessions</span>
              {!testView && (
                <>
                  <span className="h-0 w-3 border-t border-dashed border-muted-foreground" />
                  <span className="text-muted-foreground">{shortDay(priorDayOf(point.day, series.length))}</span>
                  <span className="tabular-nums text-right text-muted-foreground">{num(point.prior_sessions)} sessions</span>
                </>
              )}
            </div>
            {(change !== null || markerDays.has(point.day)) && (
              <p className="mt-1 border-t border-border/60 pt-1 text-muted-foreground">
                {change !== null && (
                  <span className={cn("tabular-nums", change >= 0 ? "text-status-online" : "text-status-busy")}>
                    {change >= 0 ? "+" : ""}
                    {pct(change, 0)} vs previous 28 days
                  </span>
                )}
                {change !== null && markerDays.has(point.day) && " · "}
                {markerDays.has(point.day) && <span className="text-chart-4">Content changed</span>}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="text-center text-[10px] text-muted-foreground">
        Sessions per day · dashed: previous 28 days{markerDays.size > 0 ? " · vertical lines: content changes" : ""}
        {gaps.length > 0 ? " · shaded: own counting was off" : ""}
      </p>
    </div>
  );
}

const DRIVER_OUTCOME: Record<ObjectiveBlock["primary"]["id"], string> = {
  moved_forward_rate: "went on to a later-stage page",
  reached_decision_rate: "went on to reach a decision page",
  task_click_rate: "clicked the page's main task",
  conversion_rate: "became a lead later in the same visit",
};

function DriverInfo({ driver, objective }: { driver: ObjectiveDriver; objective: ObjectiveBlock }) {
  const d = driver;
  const p = objective.primary;
  const isCampaign = d.kind === "campaign";
  const comparison = d.rate !== null && p.value !== null ? (d.rate >= p.value ? "above" : "below") : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums text-muted-foreground rounded-sm hover:text-foreground hover:underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${d.label}: what these numbers mean`}
          data-testid={`button-driver-${d.kind}-${d.label}`}
        >
          {num(d.contribution)} · {pct(d.rate)}
          {d.cost ? ` · ${money(d.cost)}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[10003] w-80 space-y-2 p-3 text-xs text-foreground" data-testid={`popover-driver-${d.kind}-${d.label}`}>
        <p className="font-medium">
          {d.label}
          {isCampaign ? " (ad campaign)" : " visits"}
        </p>
        <p>
          <span className="font-medium tabular-nums">{num(d.contribution)}</span>{" "}
          {isCampaign
            ? `leads came from this campaign in the last ${PAGE_STATS_WINDOW_DAYS} days.`
            : `${d.label} sessions on this page ${DRIVER_OUTCOME[p.id]} in the last ${PAGE_STATS_WINDOW_DAYS} days.`}
        </p>
        <p>
          <span className="font-medium tabular-nums">{pct(d.rate)}</span>{" "}
          {isCampaign
            ? "of the campaign's paid visits to this page became a lead."
            : `of all ${d.label} sessions on this page did that.`}
          {comparison && (
            <>
              {" "}
              That is {comparison} the page's overall {p.label.toLowerCase()} of {pct(p.value)}.
            </>
          )}
        </p>
        {d.cost && (
          <p>
            <span className="font-medium tabular-nums">{money(d.cost)}</span>{" "}
            {isCampaign ? "is what each lead from this campaign cost in ad spend." : `is the ${objective.cost?.label.toLowerCase() ?? "cost"} from ad spend.`}
          </p>
        )}
        <p className="text-muted-foreground">
          These are the sources that brought the most {isCampaign ? "leads" : "sessions that reached the objective"}, biggest first.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ChannelRateInfo({ channel, stage }: { channel: ChannelRow; stage: ObjectiveBlock["stage"] }) {
  const c = channel;
  const isDecision = stage === "decision";
  const outcome = isDecision ? c.lead_later : c.engaged;
  const rate = c.sessions > 0 ? outcome / c.sessions : null;
  const better = rate !== null && c.benchmark_rate !== null ? rate >= c.benchmark_rate : null;
  const label = channelLabel(c.channel);
  const stageLabel = FUNNEL_STAGE_LABEL[stage].toLowerCase();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums text-right min-w-[8rem] rounded-sm hover:underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${label}: what these numbers mean`}
          data-testid={`button-channel-rate-${c.channel}`}
        >
          <span className={cn(better === null ? "text-foreground" : better ? "text-status-online" : "text-status-busy")}>{pct(rate)}</span>
          <span className="text-muted-foreground"> vs {c.benchmark_rate === null ? "—" : pct(c.benchmark_rate)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[10003] w-80 space-y-2 p-3 text-xs text-foreground" data-testid={`popover-channel-rate-${c.channel}`}>
        <p className="font-medium">{label} visits to this page</p>
        <p>
          <span className="font-medium tabular-nums">{pct(rate)}</span> is this page's {isDecision ? "lead rate" : "engaged rate"}:{" "}
          {num(outcome)} of {num(c.sessions)} {label} sessions in the last {PAGE_STATS_WINDOW_DAYS} days{" "}
          {isDecision ? "became a lead later in the same visit" : "stayed more than 10 seconds, viewed a second page, or converted"}.
        </p>
        {c.benchmark_rate === null ? (
          <p>
            <span className="font-medium">—</span> means there is no comparison yet: similar pages don't have enough {label} sessions to
            compare against.
          </p>
        ) : (
          <p>
            <span className="font-medium tabular-nums">{pct(c.benchmark_rate)}</span> is the typical {isDecision ? "conversion" : "engaged"}{" "}
            rate for {label} visits on {stageLabel} pages of the same type on this site.
          </p>
        )}
        {better !== null && (
          <p className={better ? "text-status-online" : "text-status-busy"}>
            {better ? `This page does as well as or better than usual for ${label} visits.` : `This page does worse than usual for ${label} visits.`}
          </p>
        )}
        <p className="text-muted-foreground">
          The comparison is refreshed nightly from the last 90 days and includes this page. When those pages have too few {label} sessions, it
          uses {label} visits across all pages instead.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ChannelRows({ channels, stage }: { channels: ChannelRow[]; stage: ObjectiveBlock["stage"] }) {
  const rows = channels.filter((c) => c.sessions > 0).slice(0, 6);
  if (rows.length === 0) return null;
  const isDecision = stage === "decision";
  return (
    <div className="space-y-1.5" data-testid="objective-by-channel">
      <p className="text-xs font-medium text-foreground">By channel</p>
      <p className="text-[11px] text-muted-foreground">
        {isDecision ? "Lead rate" : "Engaged rate"} compared with this channel on other {FUNNEL_STAGE_LABEL[stage].toLowerCase()} pages.
      </p>
      <div className="space-y-1">
        {rows.map((c) => (
          <div key={c.channel} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
            <span className="truncate text-foreground">{channelLabel(c.channel)}</span>
            <span className="tabular-nums text-muted-foreground">{num(c.sessions)} sessions</span>
            <ChannelRateInfo channel={c} stage={stage} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ObjectiveCard({
  objective,
  traffic,
  markers,
  onSetTarget,
  statusDetail,
  stageControl,
}: {
  objective: ObjectiveBlock;
  traffic: TrafficFacts | null;
  markers: ChangeMarker[];
  onSetTarget: () => void;
  /** Shown in a popover when the primary status badge is clicked. */
  statusDetail?: string;
  stageControl?: ReactNode;
}) {
  const o = objective;
  const testView = useTestView();
  const taper = FUNNEL_STAGE_TAPER[o.stage];
  const Icon = FUNNEL_STAGE_ICON[o.stage];
  const p = o.primary;
  return (
    <section className={cn("rounded-lg border p-4 space-y-4", FUNNEL_STAGE_TONE[taper])} data-testid="card-page-objective">
      <div className="flex items-start gap-3">
        <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", FUNNEL_STAGE_ICON_TONE[taper])} />
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Main objective</p>
            {stageControl}
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug" data-testid="text-objective-sentence">
            {objectiveSentence(o)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{p.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground" data-testid="text-objective-value">
              {pct(p.value)}
            </p>
          </div>
          <StatusBadge status={p.status} detail={statusDetail} />
        </div>
        <ProgressToTarget value={p.value} target={p.target} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {num(p.numerator)} of {num(p.denominator)} sessions
            {!testView && (
              <>
                {" "}
                · <PriorRateInfo objective={o} />
              </>
            )}
          </span>
          <span className="flex items-center gap-1">
            Target {pct(p.target)} (<TargetSource objective={o} kind="rate" />)
            {p.target_source !== "settings" && (
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onSetTarget} data-testid="button-objective-set-target">
                Set target
              </button>
            )}
          </span>
        </div>
      </div>

      {o.cost && (
        <div className="space-y-2 border-t border-border/60 pt-3" data-testid="objective-cost">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{o.cost.label} (ads only)</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{money(o.cost.value)}</p>
            </div>
            <StatusBadge status={o.cost.status} />
          </div>
          {o.cost.status !== "no_spend" && (
            <p className="text-[11px] text-muted-foreground">
              Target {money(o.cost.target)} (<TargetSource objective={o} kind="cost" />) · before {money(o.cost.prior_value)}
            </p>
          )}
        </div>
      )}

      {traffic && <Sparkline series={traffic.series} markers={markers} gaps={traffic.first_party?.gaps} />}

      {(o.drivers.length > 0 || o.dragging) && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">What drives it</p>
          <div className="space-y-1">
            {o.drivers.map((d) => (
              <div key={`${d.kind}-${d.label}`} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                <span className="truncate text-foreground">
                  {d.label}
                  {d.kind === "campaign" && <span className="text-muted-foreground"> · campaign</span>}
                </span>
                <DriverInfo driver={d} objective={o} />
              </div>
            ))}
            {o.dragging && (
              <div className="flex items-center gap-1.5 text-xs text-status-busy" data-testid="objective-dragging">
                <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Dragging it down: {o.dragging.label} ({pct(o.dragging.rate)}
                  {o.dragging.cost ? `, ${money(o.dragging.cost)} spent` : ""})
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {traffic && <ChannelRows channels={traffic.channels} stage={o.stage} />}
    </section>
  );
}

type BarSegment = { key: "paid" | "organic" | "other"; value: number };

const SEGMENT_FILL: Record<BarSegment["key"], string> = {
  paid: "bg-chart-1",
  organic: "bg-chart-2",
  other: "bg-muted-foreground/40",
};

const SEGMENT_LABEL: Record<BarSegment["key"], string> = { paid: "Paid", organic: "Organic", other: "Other sources" };

function barSegments(s: ObjectiveFunnelStep): BarSegment[] | null {
  if (s.paid === null && s.organic === null) return null;
  const paid = s.paid ?? 0;
  const organic = s.organic ?? 0;
  const other = Math.max(0, (s.total ?? 0) - paid - organic);
  return [
    { key: "paid" as const, value: paid },
    { key: "organic" as const, value: organic },
    { key: "other" as const, value: other },
  ].filter((seg) => seg.value > 0);
}

function FunnelBar({ step, width, capped }: { step: ObjectiveFunnelStep; width: number; capped: boolean }) {
  const segments = barSegments(step);
  const sum = segments?.reduce((t, seg) => t + seg.value, 0) ?? 0;
  return (
    <div className="h-3 rounded-sm bg-muted">
      <div className={cn("flex h-3 overflow-hidden rounded-sm", capped && "opacity-40")} style={{ width: `${width}%` }}>
        {segments && sum > 0 ? (
          segments.map((seg) => <div key={seg.key} className={cn("h-full", SEGMENT_FILL[seg.key])} style={{ width: `${(seg.value / sum) * 100}%` }} />)
        ) : (
          <div className="h-full w-full bg-primary/60" />
        )}
      </div>
    </div>
  );
}

function FunnelConnector({ step, prev, biggest }: { step: ObjectiveFunnelStep; prev: ObjectiveFunnelStep; biggest: boolean }) {
  if (prev.total === null || prev.total <= 0 || step.total === null) return null;
  let body: ReactNode;
  if (prev.id === "impressions") {
    body = <span className="tabular-nums">{pct(step.total / prev.total)} clicked (click-through rate)</span>;
  } else if (step.loss_from_previous === null) {
    body = <span>Higher than the step above: this step also counts other sources</span>;
  } else if (step.loss_from_previous === 0) {
    body = <span>No drop-off</span>;
  } else {
    body = (
      <span className={cn("tabular-nums", biggest && "font-medium text-status-busy")}>
        {num(prev.total - step.total)} dropped off ({pct(step.loss_from_previous, 0)})
      </span>
    );
  }

  return (
    <div className="pl-[8rem] space-y-0.5 text-[11px] text-muted-foreground" data-testid={`funnel-loss-${step.id}`}>
      <div className="flex items-center gap-1.5">
        <ArrowDown className={cn("h-3 w-3 shrink-0", biggest && "text-status-busy")} />
        {body}
        {biggest && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium border-status-busy/40 text-status-busy">
            Biggest drop
          </Badge>
        )}
      </div>
      {biggest && step.loss_cause && <p className="pl-[1.125rem] text-foreground/80">Usually means: {step.loss_cause}</p>}
    </div>
  );
}

function stepMeaning(id: FunnelStepId, stage: FunnelStage): string {
  switch (id) {
    case "impressions":
      return "Times this page showed up in one of your ads or in a Google search result.";
    case "clicks":
      return "Clicks on those ads or search results that pointed to this page.";
    case "visits":
      return "Visits that viewed this page, from any source: ads, search, direct, email, social or links.";
    case "engaged":
      return "Visits that stayed more than 10 seconds, viewed a second page, or converted (Google Analytics' definition).";
    case "moved_forward":
      return "Visits whose next page was a page from a later funnel stage.";
    case "reached_decision":
      return "Visits that went on to reach a decision-stage page in the same visit.";
    case "form_or_cta":
      return "Visits that clicked a call to action, started a form, or later became a lead.";
    case "lead":
      return stage === "decision"
        ? "Leads that submitted a form on this page."
        : "Leads whose first visit was this page, wherever they finally converted.";
    case "task_click":
      return "Visits that clicked through to one of the tools or tasks linked from this page.";
  }
}

function stepSource(id: FunnelStepId, stage: FunnelStage, source: TrafficSource = "ga4"): string[] {
  const own = source === "first_party";
  const ga = own
    ? "Counted by this site, anonymously and without cookies, so visitors who decline cookies count too. Logged-in staff and suspected low-quality visits are left out."
    : "From Google Analytics (BigQuery export), so visitors who decline cookies or block tracking are not counted.";
  if (own && id === "visits") {
    return [
      "Page views of this page counted by this site, from any source. Reloads and back-button returns are not new visits.",
      "Paid and organic are split by where the visit started (campaign tags, ad click IDs, referrer).",
      ga,
    ];
  }
  if (own && id === "engaged") {
    return ["Visits that stayed more than 10 seconds in view, clicked a call to action, started a form, or went to another page.", ga];
  }
  if (own && (id === "moved_forward" || id === "reached_decision")) {
    return [
      id === "moved_forward"
        ? "Visits whose next page in the same tab belongs to a later funnel stage, using each page's stage in the content."
        : "Visits that opened a decision-stage page later in the same tab.",
      ga,
    ];
  }
  switch (id) {
    case "impressions":
      return [
        "Ads: impressions reported by Google Ads and Meta for ads whose destination URL is this page.",
        "Search: impressions reported by Google Search Console for this page's URLs.",
        "Both are counted by Google and Meta, not by this site.",
      ];
    case "clicks":
      return [
        "Ads: clicks reported by Google Ads and link clicks reported by Meta, for ads whose destination URL is this page.",
        "Search: clicks reported by Google Search Console for this page's URLs.",
        "Counted by Google and Meta, so a click still counts when the person leaves before the page loads, declines cookies or lands on a redirected URL. That is why clicks can be much higher than visits.",
      ];
    case "visits":
      return [
        "Sessions with at least one page view of this page, from any source.",
        "Paid and organic are split by the session's first traffic source.",
        ga,
      ];
    case "engaged":
      return ["Visits that Google Analytics marks as engaged: more than 10 seconds, a second page view, or a conversion.", ga];
    case "moved_forward":
      return ["Visits whose next page in the same session belongs to a later funnel stage, using each page's stage in the content.", ga];
    case "reached_decision":
      return ["Visits that viewed a decision-stage page later in the same session.", ga];
    case "form_or_cta":
      return [
        "Visits that clicked a tracked call to action on this page, started a form on this page, or fired a lead event later in the session.",
        ga,
      ];
    case "lead":
      return [
        stage === "decision"
          ? "Form submissions saved by this site that were submitted on this page."
          : "Form submissions saved by this site whose visit started on this page, wherever the form was.",
        "Test and repeat submissions are excluded. These come from the site's lead records, not Google Analytics, so they can be higher than the steps above.",
      ];
    case "task_click":
      return ["Visits that clicked a call to action on this page that leads to an external tool or site.", ga];
  }
}

function StepSourceInfo({ step, stage, source }: { step: ObjectiveFunnelStep; stage: FunnelStage; source: TrafficSource }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`How ${step.label.toLowerCase()} is measured`}
          data-testid={`button-funnel-source-${step.id}`}
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[10003] w-72 space-y-1.5 p-3 text-xs" data-testid={`popover-funnel-source-${step.id}`}>
        <p className="font-medium text-foreground">Where {step.label.toLowerCase()} comes from</p>
        {stepSource(step.id, stage, source).map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function FunnelStepExplainer({ steps, index, stage, goalId }: { steps: ObjectiveFunnelStep[]; index: number | null; stage: FunnelStage; goalId: FunnelStepId }) {
  const s = index === null ? null : steps[index];
  if (!s || index === null) {
    return <p className="text-muted-foreground">Point at a step to see what it counts and what its drop-off means.</p>;
  }
  const prev = index > 0 ? steps[index - 1]! : null;
  const segments = barSegments(s);
  let relation: string | null = null;
  if (!prev) {
    relation = "This is where the funnel starts.";
  } else if (prev.total && s.total !== null) {
    if (prev.id === "impressions") {
      relation = `${pct(s.total / prev.total)} of impressions turned into a click (the click-through rate).`;
    } else if (s.loss_from_previous === null) {
      relation =
        s.id === "visits"
          ? "Higher than clicks because visits also come from direct, email, social and links, not only from ads and search."
          : `Higher than ${prev.label.toLowerCase()}: the two steps come from different data, so they don't line up one to one.`;
    } else {
      relation = `${num(s.total)} of ${num(prev.total)} ${prev.label.toLowerCase()} made it here (${pct(1 - s.loss_from_previous, 0)}), so ${num(prev.total - s.total)} dropped off.`;
    }
  }
  const showCause = !!s.loss_cause && !!s.loss_from_previous && s.loss_from_previous > 0;
  return (
    <div className="space-y-1" data-testid={`funnel-explain-${s.id}`}>
      <p className="font-medium text-foreground">
        {s.label} <span className="tabular-nums">· {num(s.total)}</span>
        {s.id === goalId && <span className="font-normal text-muted-foreground"> · this page's objective</span>}
      </p>
      <p className="text-muted-foreground">{stepMeaning(s.id, stage)}</p>
      {relation && <p className="text-foreground/90">{relation}</p>}
      {segments && segments.length > 0 && (
        <p className="tabular-nums text-muted-foreground">{segments.map((seg) => `${SEGMENT_LABEL[seg.key]} ${num(seg.value)}`).join(" · ")}</p>
      )}
      {showCause && <p className="text-muted-foreground">A big drop here usually means: {s.loss_cause}</p>}
    </div>
  );
}

export function ObjectiveFunnel({ objective, source = "ga4" }: { objective: ObjectiveBlock; source?: TrafficSource }) {
  const [active, setActive] = useState<number | null>(null);
  const steps = objective.funnel;
  if (steps.length < 2) return null;
  const visits = steps.find((s) => s.id === "visits");
  const scale = visits?.total ? visits.total : Math.max(1, ...steps.map((s) => s.total ?? 0));
  const biggest = biggestFunnelDrop(steps);
  const anyCapped = steps.some((s) => (s.total ?? 0) > scale);
  const anySplit = steps.some((s) => s.paid !== null || s.organic !== null);

  const p = objective.primary;
  const goal = steps.find((s) => s.id === OBJECTIVE_FUNNEL_STEP[p.id]);
  const goalRate = visits?.total && goal?.total !== null && goal?.total !== undefined ? goal.total / visits.total : null;
  const hasTarget = p.target !== null && p.target_source !== "none";

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="card-objective-funnel">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">From first impression to the objective</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">How many people reached each step in the last 28 days, and where they dropped off.</p>
      </div>
      <div
        className="space-y-0.5"
        onMouseLeave={() => setActive(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null);
        }}
      >
        {steps.map((s, i) => {
          const total = s.total ?? 0;
          const width = total > 0 ? Math.max(1.5, Math.min(100, (total / scale) * 100)) : 0;
          return (
            <div
              key={s.id}
              tabIndex={0}
              aria-label={`${s.label}: ${num(s.total)}`}
              className={cn(
                "-mx-2 space-y-1.5 rounded-md px-2 py-1 outline-none transition-[opacity,background-color] duration-150 cursor-default",
                active === i && "bg-muted/60",
                active !== null && active !== i && "opacity-30",
              )}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              data-testid={`funnel-step-${s.id}`}
            >
              {i > 0 && <FunnelConnector step={s} prev={steps[i - 1]!} biggest={i === biggest} />}
              <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-foreground">{s.label}</span>
                  <StepSourceInfo step={s} stage={objective.stage} source={source} />
                </span>
                <FunnelBar step={s} width={width} capped={total > scale} />
                <span className="tabular-nums text-foreground min-w-[3.5rem] text-right">{num(s.total)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-[6.5rem] rounded-md border border-border/60 bg-muted/30 p-3 text-xs" aria-live="polite">
        <FunnelStepExplainer steps={steps} index={active} stage={objective.stage} goalId={OBJECTIVE_FUNNEL_STEP[p.id]} />
      </div>

      {goal && goalRate !== null && (
        <p className="border-t border-border/60 pt-3 text-xs text-foreground" data-testid="funnel-goal-summary">
          <span
            className={cn(
              "font-semibold tabular-nums",
              hasTarget && (goalRate >= p.target! ? "text-status-online" : "text-status-busy"),
            )}
          >
            {pct(goalRate)}
          </span>{" "}
          of visits reached <span className="font-medium">{goal.label.toLowerCase()}</span>
          {hasTarget && (
            <span className="text-muted-foreground">
              {" "}
              · target {pct(p.target)} (<TargetSource objective={objective} kind="rate" />)
            </span>
          )}
        </p>
      )}

      {(anySplit || anyCapped) && (
        <div className="space-y-1 text-[10px] text-muted-foreground">
          {anySplit && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {(["paid", "organic", "other"] as const).map((key) => (
                <span key={key} className="flex items-center gap-1">
                  <span className={cn("h-2 w-2 rounded-sm", SEGMENT_FILL[key])} />
                  {SEGMENT_LABEL[key]}
                </span>
              ))}
            </div>
          )}
          {anyCapped && <p>Bars are scaled to visits. Faded bars are larger than visits and cut off; the number shows the real count.</p>}
        </div>
      )}
    </section>
  );
}

function linkLabel(link: FindingLink): string {
  switch (link.kind) {
    case "seo_modal":
      return "Open SEO";
    case "funnel_tab":
      return "Open Funnel tab";
    case "leads":
      return "Open leads";
    case "ads_diagnostics":
      return "Open Ads diagnostics";
    case "targets":
      return "Set targets";
    case "url":
      return link.label;
  }
}

export function AdvicePanel({
  advice,
  onLink,
  hideVerdict = false,
}: {
  advice: PageAdvice;
  onLink: (link: FindingLink) => void;
  hideVerdict?: boolean;
}) {
  if (hideVerdict && advice.findings.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="page-stats-advice">
      {!hideVerdict && (
        <div className={cn("rounded-lg border px-3 py-2 text-sm", TONE_BORDER[advice.verdict.tone])} data-testid="text-page-stats-verdict">
          <span className={cn("font-medium", TONE_TEXT[advice.verdict.tone])}>{advice.verdict.text}</span>
        </div>
      )}
      {advice.findings.map((f: Finding) => (
        <div key={f.id} className={cn("rounded-lg border p-3 space-y-1.5", TONE_BORDER[f.tone])} data-testid={`finding-${f.id.split(":")[0]}`}>
          <p className={cn("text-sm font-medium", TONE_TEXT[f.tone] === "text-muted-foreground" ? "text-foreground" : TONE_TEXT[f.tone])}>{f.title}</p>
          <p className="text-xs text-muted-foreground">{f.evidence}</p>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-foreground flex items-start gap-1">
              <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-px text-muted-foreground" />
              {f.action}
            </p>
            {f.link && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs gap-1"
                onClick={() => onLink(f.link!)}
                data-testid={`button-finding-link-${f.id.split(":")[0]}`}
              >
                {linkLabel(f.link)}
                {f.link.kind === "url" && <ExternalLink className="h-3 w-3" />}
              </Button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
