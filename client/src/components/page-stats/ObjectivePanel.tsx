import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ExternalLink, Target, TrendingDown } from "lucide-react";
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
  ObjectiveFunnelStep,
  PageAdvice,
  TrafficFacts,
} from "@shared/page-stats";
import { biggestFunnelDrop } from "@shared/page-stats";
import { OBJECTIVE_FUNNEL_STEP, type FunnelStepId } from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";
import { channelLabel, money, num, pct, shortDay, targetSourceLabel, TONE_BORDER, TONE_TEXT } from "./format";

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
      <PopoverContent align="end" className="w-64 p-3 text-xs text-foreground" data-testid="popover-objective-status-detail">
        {detail}
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

function Sparkline({ series, markers }: { series: TrafficFacts["series"]; markers: ChangeMarker[] }) {
  if (series.length < 2) return null;
  const w = 280;
  const h = 44;
  const max = Math.max(1, ...series.map((p) => Math.max(p.sessions, p.prior_sessions)));
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 4) - 2;
  const line = (key: "sessions" | "prior_sessions") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const markerDays = new Set(markers.map((m) => m.day));
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11" role="img" aria-label="Sessions per day, current vs previous 28 days">
        <path d={line("prior_sessions")} className="stroke-muted-foreground/50" fill="none" strokeWidth={1.25} strokeDasharray="3 3" />
        <path d={line("sessions")} className="stroke-primary" fill="none" strokeWidth={1.75} />
        {series.map((p, i) =>
          markerDays.has(p.day) ? (
            <g key={p.day}>
              <line x1={x(i)} x2={x(i)} y1={0} y2={h} className="stroke-chart-4/70" strokeWidth={1} />
              <title>{`Content changed on ${shortDay(p.day)}`}</title>
            </g>
          ) : null,
        )}
      </svg>
      <p className="text-[10px] text-muted-foreground">
        Sessions per day · dashed: previous 28 days{markerDays.size > 0 ? " · vertical lines: content changes" : ""}
      </p>
    </div>
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
        {rows.map((c) => {
          const rate = c.sessions > 0 ? (isDecision ? c.lead_later : c.engaged) / c.sessions : null;
          const better = rate !== null && c.benchmark_rate !== null ? rate >= c.benchmark_rate : null;
          return (
            <div key={c.channel} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
              <span className="truncate text-foreground">{channelLabel(c.channel)}</span>
              <span className="tabular-nums text-muted-foreground">{num(c.sessions)} sessions</span>
              <span className="tabular-nums text-right min-w-[8rem]">
                <span className={cn(better === null ? "text-foreground" : better ? "text-status-online" : "text-status-busy")}>{pct(rate)}</span>
                <span className="text-muted-foreground"> vs {c.benchmark_rate === null ? "—" : pct(c.benchmark_rate)}</span>
              </span>
            </div>
          );
        })}
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
            {num(p.numerator)} of {num(p.denominator)} sessions · before {pct(p.prior_value)}
          </span>
          <span className="flex items-center gap-1">
            Target {pct(p.target)} ({targetSourceLabel(p.target_source)})
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
              Target {money(o.cost.target)} ({targetSourceLabel(o.cost.target_source)}) · before {money(o.cost.prior_value)}
            </p>
          )}
        </div>
      )}

      {traffic && <Sparkline series={traffic.series} markers={markers} />}

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
                <span className="tabular-nums text-muted-foreground">
                  {num(d.contribution)} · {pct(d.rate)}
                  {d.cost ? ` · ${money(d.cost)}` : ""}
                </span>
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

export function ObjectiveFunnel({ objective }: { objective: ObjectiveBlock }) {
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
                <span className="truncate text-foreground">{s.label}</span>
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
          {hasTarget && <span className="text-muted-foreground"> · target {pct(p.target)} ({targetSourceLabel(p.target_source)})</span>}
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
