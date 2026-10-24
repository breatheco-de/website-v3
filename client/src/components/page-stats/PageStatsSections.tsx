import type { ReactNode } from "react";
import { Link } from "wouter";
import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import {
  ExternalLink,
  Link2,
  Megaphone,
  MousePointerClick,
  Route,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { FUNNEL_STAGE_LABEL } from "@/lib/funnel-stage-ui";
import { leadsQueryToSearchParams } from "@shared/leads-query";
import { CAMPAIGN_GOAL_LABELS } from "@shared/page-objectives";
import type {
  LeadBlock,
  LeadsFacts,
  LinksFacts,
  Money,
  ObjectiveBlock,
  OrganicFacts,
  PaidCampaignRow,
  PaidFacts,
  PathRow,
  Section,
  TrafficFacts,
} from "@shared/page-stats";
import {
  channelLabel,
  delta,
  money,
  num,
  pct,
  RELATION_BAR,
  RELATION_LABEL,
  seconds,
  shortDay,
} from "./format";

export function SectionCard({
  title,
  icon: Icon,
  section,
  children,
  testId,
  right,
}: {
  title: string;
  icon: typeof Search;
  section?: Section<unknown>;
  children?: ReactNode;
  testId: string;
  right?: ReactNode;
}) {
  const unavailable = section && (section.status === "not_configured" || section.status === "error" || !section.data);
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {section?.message && (
        <p className={cn("text-xs", section.status === "error" ? "text-status-busy" : "text-muted-foreground")}>{section.message}</p>
      )}
      {!unavailable && children}
    </section>
  );
}

function Delta({ cur, prior, invert = false }: { cur: number | null | undefined; prior: number | null | undefined; invert?: boolean }) {
  const d = delta(cur, prior);
  if (d === null) return null;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={cn("text-[10px] tabular-nums", Math.abs(d) < 0.02 ? "text-muted-foreground" : good ? "text-status-online" : "text-status-busy")}>
      {d > 0 ? "+" : ""}
      {(d * 100).toFixed(0)}%
    </span>
  );
}

function Kpi({ label, value, cur, prior, invert, hint }: { label: string; value: string; cur?: number | null; prior?: number | null; invert?: boolean; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground truncate">
        {value} {cur !== undefined && <Delta cur={cur} prior={prior} invert={invert} />}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}

function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid w-full gap-2 grid-cols-2 sm:grid-cols-4">{children}</div>;
}

function PathBars({ rows, total, emptyText }: { rows: PathRow[]; total: number; emptyText: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-1">
      {rows.slice(0, 8).map((r) => (
        <div key={r.path} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono text-[11px] text-foreground" title={r.path}>
              {r.path}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{num(r.sessions)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className={cn("h-1.5 rounded-full", RELATION_BAR[r.relation])}
              style={{ width: `${Math.max(2, total > 0 ? (r.sessions / total) * 100 : 0)}%` }}
              title={`${RELATION_LABEL[r.relation]}${r.stage ? ` · ${FUNNEL_STAGE_LABEL[r.stage]}` : ""}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function JourneySection({ section, title }: { section: Section<TrafficFacts>; title: string }) {
  const t = section.data;
  const total = t?.current.sessions ?? 0;
  const next = t?.next_pages ?? [];
  const share = (rel: string) => (total > 0 ? next.filter((r) => r.relation === rel).reduce((s, r) => s + r.sessions, 0) / total : 0);
  return (
    <SectionCard title={title} icon={Route} section={section} testId="section-journey">
      {t && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["forward", "same", "back", "exit"] as const).map((rel) => (
              <Badge key={rel} variant="outline" className="text-[10px] font-normal gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", RELATION_BAR[rel])} />
                {RELATION_LABEL[rel]} {pct(share(rel), 0)}
              </Badge>
            ))}
            <Badge variant="outline" className="text-[10px] font-normal">
              Lead later in the visit {pct(total > 0 ? t.current.lead_later / total : null, 0)}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">Came from</p>
              <PathBars rows={t.previous_pages} total={total} emptyText="No previous pages recorded." />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">Went next</p>
              <PathBars rows={t.next_pages} total={total} emptyText="No next pages recorded." />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            "(entrance)" = the visit started here. Colors compare the next page's funnel stage with this page's.
          </p>
        </>
      )}
    </SectionCard>
  );
}

export function SourcesSection({ section }: { section: Section<TrafficFacts> }) {
  const t = section.data;
  const total = t?.current.sessions ?? 0;
  return (
    <SectionCard title="Where visitors come from" icon={Users} section={section} testId="section-sources">
      {t && (
        <>
          <KpiGrid>
            <Kpi label="Sessions" value={num(total)} cur={total} prior={t.prior.sessions} />
            <Kpi label="Entrances" value={num(t.current.entrances)} cur={t.current.entrances} prior={t.prior.entrances} />
            <Kpi label="Engaged" value={pct(total ? t.current.engaged_sessions / total : null, 0)} />
            <Kpi label="Returning visitors" value={pct(total ? t.current.returning_sessions / total : null, 0)} />
          </KpiGrid>
          <div className="space-y-1">
            {t.channels.map((c) => (
              <div key={c.channel} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
                <span className="truncate text-foreground">{channelLabel(c.channel)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {num(c.sessions)} <Delta cur={c.sessions} prior={c.prior_sessions} />
                </span>
                <span className="tabular-nums text-muted-foreground min-w-[9rem] text-right">
                  {pct(c.sessions ? c.reached_decision / c.sessions : null, 0)} reach decision
                </span>
              </div>
            ))}
          </div>
          {t.referrers.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Top external referrers</p>
              <div className="flex flex-wrap gap-1.5">
                {t.referrers.slice(0, 10).map((r) => (
                  <Badge key={r.host} variant="secondary" className="text-[10px] font-normal">
                    {r.host} · {num(r.sessions)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {t.campaigns.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Campaign tags (UTM)</p>
              {t.campaigns.slice(0, 6).map((c) => (
                <div key={`${c.source}|${c.medium}|${c.campaign}`} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                  <span className="truncate text-muted-foreground" title={`${c.source} / ${c.medium} / ${c.campaign}`}>
                    {c.source || "(none)"} / {c.medium || "(none)"} · <span className="text-foreground">{c.campaign || "(no campaign)"}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {num(c.sessions)} · {num(c.lead_later)} leads later
                  </span>
                </div>
              ))}
            </div>
          )}
          {t.devices.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Devices: {t.devices.map((d) => `${d.device} ${pct(total ? d.sessions / total : null, 0)}`).join(" · ")}
              {t.countries.length > 0 && ` · Top countries: ${t.countries.slice(0, 4).map((c) => c.country).join(", ")}`}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

function leadsHref(filter: "conversion_path" | "landing_path", path: string): string {
  const qs = leadsQueryToSearchParams({ filters: { [filter]: path } }).toString();
  return `/private/store/leads?${qs}`;
}

function Breakdown({ title, rows, label = (k: string) => k }: { title: string; rows: LeadBlock["by_form"]; label?: (k: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.slice(0, 4).map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-foreground">{label(r.key)}</span>
          <span className="tabular-nums text-muted-foreground">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function LeadBlockView({
  title,
  description,
  block,
  href,
  testId,
}: {
  title: string;
  description: string;
  block: LeadBlock;
  href: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
        <Link href={href} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0">
          View leads
        </Link>
      </div>
      <p className="text-xl font-semibold tabular-nums text-foreground">
        {block.count} <Delta cur={block.count} prior={block.prior_count} />
      </p>
      <p className="text-[10px] text-muted-foreground">
        {block.paid_count} from paid ads · before {block.prior_count}
      </p>
      <Breakdown title="Form" rows={block.by_form} />
      <Breakdown title="Channel" rows={block.by_channel} label={channelLabel} />
      <Breakdown title="Campaign" rows={block.by_campaign} />
      <Breakdown title="Page version" rows={block.by_version} />
    </div>
  );
}

export function LeadsSection({ section, path }: { section: Section<LeadsFacts>; path: string }) {
  const l = section.data;
  return (
    <SectionCard title="Leads" icon={MousePointerClick} section={section} testId="section-leads">
      {l && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <LeadBlockView
              title="Converted on this page"
              description="The form was submitted here."
              block={l.converted_here}
              href={leadsHref("conversion_path", path)}
              testId="leads-converted-here"
            />
            <LeadBlockView
              title="Started their visit here"
              description="The visit began here; the form may be elsewhere."
              block={l.started_here}
              href={leadsHref("landing_path", path)}
              testId="leads-started-here"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {l.both > 0 ? `${l.both} lead${l.both === 1 ? "" : "s"} started and converted here (counted in both). ` : ""}
            Not counted: {l.excluded_test} test, {l.excluded_repeat} repeat.
            {l.collecting_since ? ` Lead records start ${shortDay(l.collecting_since)}.` : ""}
          </p>
        </>
      )}
    </SectionCard>
  );
}

export function SearchSection({ section }: { section: Section<OrganicFacts> }) {
  const o = section.data;
  return (
    <SectionCard
      title="Organic search"
      icon={Search}
      section={section}
      testId="section-search"
      right={o?.index ? (
        <Badge variant="outline" className={cn("text-[10px]", o.index.indexed ? "text-status-online border-status-online/40" : "text-status-busy border-status-busy/40")}>
          {o.index.indexed ? "Indexed" : o.index.coverage ?? "Not indexed"}
        </Badge>
      ) : null}
    >
      {o && (
        <>
          <KpiGrid>
            <Kpi label="Clicks" value={num(o.current.clicks)} cur={o.current.clicks} prior={o.prior.clicks} />
            <Kpi label="Impressions" value={num(o.current.impressions)} cur={o.current.impressions} prior={o.prior.impressions} />
            <Kpi label="Avg position" value={o.current.position ? o.current.position.toFixed(1) : "—"} cur={o.current.position || null} prior={o.prior.position || null} invert />
            <Kpi label="CTR" value={pct(o.current.ctr)} hint={o.expected_ctr !== null ? `~${pct(o.expected_ctr, 0)} expected` : undefined} />
          </KpiGrid>
          {o.target_keyword && (
            <p className="text-xs text-muted-foreground">
              Target keyword: <span className="text-foreground">{o.target_keyword}</span>
              {" · "}
              {o.target_keyword_rank !== null ? `position ${o.target_keyword_rank.toFixed(1)}` : "not in the top searches for this page"}
            </p>
          )}
          {o.keywords.length > 0 && (
            <div className="space-y-0.5">
              <div className="grid grid-cols-[1fr_3rem_4rem_3.5rem] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Search</span>
                <span className="text-right">Clicks</span>
                <span className="text-right">Impr.</span>
                <span className="text-right">Pos.</span>
              </div>
              {o.keywords.slice(0, 10).map((k) => (
                <div key={k.query} className="grid grid-cols-[1fr_3rem_4rem_3.5rem] gap-2 text-xs tabular-nums">
                  <span className="truncate text-foreground" title={k.query}>
                    {k.query}
                  </span>
                  <span className="text-right text-muted-foreground">{k.clicks}</span>
                  <span className="text-right text-muted-foreground">{num(k.impressions)}</span>
                  <span className="text-right text-muted-foreground">{k.position.toFixed(1)}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Source: {o.keywords_source === "bigquery" ? "Search Console export (all searches)" : "Search Console cache (main searches)"}
              </p>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function primaryCurrency(m: Money): string | null {
  const top = Object.entries(m).sort(([, a], [, b]) => b - a)[0];
  return top ? top[0] : null;
}

const FIT_COLOR: Record<PaidCampaignRow["fit"], string> = {
  fit: "hsl(var(--chart-1))",
  soft: "hsl(var(--chart-3))",
  mismatch: "hsl(var(--destructive))",
  unknown: "hsl(var(--muted-foreground))",
};

const FIT_LABEL: Record<PaidCampaignRow["fit"], string> = {
  fit: "Fits this page",
  soft: "Partly fits",
  mismatch: "Goal mismatch",
  unknown: "Goal unknown",
};

const CAMPAIGN_CHART_CONFIG = { campaign: { label: "Campaign", color: "hsl(var(--chart-1))" } } satisfies ChartConfig;

function CampaignsChart({ campaigns, objective }: { campaigns: PaidCampaignRow[]; objective: ObjectiveBlock | null }) {
  const allSpend = campaigns.reduce<Money>((acc, c) => {
    for (const [k, v] of Object.entries(c.spend)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const cur = primaryCurrency(allSpend);
  if (!cur) return null;
  const byLead = objective?.stage === "decision";
  const points = campaigns
    .filter((c) => !c.untagged && (c.spend[cur] ?? 0) > 0)
    .map((c) => ({
      name: c.campaign_name,
      spend: c.spend[cur] ?? 0,
      cost: byLead ? c.cost_per_lead[cur] ?? null : c.cost_per_visit[cur] ?? null,
      size: byLead ? c.unique_leads : c.paid_visits,
      fit: c.fit,
      goal: c.goal,
    }))
    .filter((p) => p.cost !== null) as Array<{ name: string; spend: number; cost: number; size: number; fit: PaidCampaignRow["fit"]; goal: PaidCampaignRow["goal"] }>;
  if (points.length === 0) return null;
  const target = objective?.cost?.target?.[cur] ?? null;
  return (
    <div className="space-y-1" data-testid="chart-paid-campaigns">
      <p className="text-xs font-medium text-foreground">
        Campaigns: spend vs {byLead ? "cost per lead" : "cost per visit"} ({cur})
      </p>
      <ChartContainer config={CAMPAIGN_CHART_CONFIG} className="h-48 w-full aspect-auto">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis type="number" dataKey="spend" name="Spend" tickLine={false} axisLine={false} fontSize={10} />
          <YAxis type="number" dataKey="cost" name="Cost" tickLine={false} axisLine={false} fontSize={10} width={40} />
          <ZAxis type="number" dataKey="size" range={[40, 400]} />
          {target !== null && <ReferenceLine y={target} stroke="hsl(var(--foreground))" strokeDasharray="4 4" label={{ value: "target", fontSize: 10, position: "right" }} />}
          <ChartTooltip
            cursor={false}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-md space-y-0.5">
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="text-muted-foreground">
                    {money({ [cur]: p.spend })} spend · {money({ [cur]: p.cost })} per {byLead ? "lead" : "visit"} · {p.size} {byLead ? "leads" : "visits"}
                  </p>
                  <p className="text-muted-foreground">{CAMPAIGN_GOAL_LABELS[p.goal]} · {FIT_LABEL[p.fit]}</p>
                </div>
              );
            }}
          />
          <Scatter data={points}>
            {points.map((p) => (
              <Cell key={p.name} fill={FIT_COLOR[p.fit]} fillOpacity={0.75} />
            ))}
          </Scatter>
        </ScatterChart>
      </ChartContainer>
      <p className="text-[10px] text-muted-foreground">Dot size = {byLead ? "leads" : "visits"}. Red dots: the campaign's goal doesn't match this page's job.</p>
    </div>
  );
}

export function PaidSection({
  section,
  objective,
  onOpenAds,
}: {
  section: Section<PaidFacts>;
  objective: ObjectiveBlock | null;
  onOpenAds: (platform: "meta" | "google" | null) => void;
}) {
  const p = section.data;
  const platformLeads = p ? p.meta_leads + p.google_leads : 0;
  return (
    <SectionCard title="Paid ads (Meta + Google)" icon={Megaphone} section={section} testId="section-paid">
      {p && (
        <>
          <KpiGrid>
            <Kpi label="Spend" value={money(p.spend)} />
            <Kpi label="Cost per lead" value={money(p.cost_per_lead)} hint={`before ${money(p.prior_cost_per_lead)}`} />
            <Kpi label="Paid visits" value={num(p.paid_visits)} hint={p.bounce_rate !== null ? `${pct(p.bounce_rate, 0)} bounce` : undefined} />
            <Kpi label="Leads (your records)" value={num(p.unique_leads)} cur={p.unique_leads} prior={p.prior_unique_leads} />
            <Kpi label="CTR" value={pct(p.ctr)} hint={`${num(p.clicks)} clicks`} />
            <Kpi label="Clicks → visits" value={pct(p.clicks_to_visits, 0)} />
            <Kpi label="Platform-reported leads" value={num(platformLeads)} hint={p.meta_leads > 0 ? `${num(p.meta_leads - p.meta_click_leads)} Meta view-only` : undefined} />
            <Kpi
              label="Organic on this page"
              value={p.organic ? pct(p.organic.lead_rate) : "—"}
              hint={p.organic ? `lead rate · ${pct(p.organic.bounce_rate, 0)} bounce` : undefined}
            />
          </KpiGrid>
          {p.low_sample && (
            <p className="text-[11px] text-muted-foreground">Fewer than {p.min_paid_visits_for_rates} paid visits: rates are rough.</p>
          )}
          <CampaignsChart campaigns={p.campaigns} objective={objective} />
          {p.campaigns.length > 0 && (
            <div className="space-y-1">
              {p.campaigns.slice(0, 8).map((c) => (
                <div key={`${c.platform}|${c.campaign_id ?? c.campaign_name}`} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate text-foreground" title={c.campaign_name}>
                      {c.campaign_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.platform ?? "untagged"} · {CAMPAIGN_GOAL_LABELS[c.goal]}
                      {c.fit !== "unknown" && (
                        <span className={cn(c.fit === "mismatch" ? "text-status-busy" : c.fit === "soft" ? "text-status-away" : "text-status-online")}>
                          {" "}
                          · {FIT_LABEL[c.fit]}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tabular-nums text-right text-muted-foreground">
                    {money(c.spend)}
                    <span className="block text-[10px]">
                      {c.unique_leads} leads · {num(c.paid_visits)} visits
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {p.issues.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Ad tracking issues on this page</p>
              {p.issues.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onOpenAds(i.platform === "google" ? "google" : i.platform === "meta" ? "meta" : null)}
                  className="flex w-full items-center justify-between gap-2 text-left text-xs hover:underline"
                >
                  <span className={cn(i.severity === "error" ? "text-status-busy" : "text-status-away")}>{i.title}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
          {p.url_changes.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Ad URL changes: {p.url_changes.map((u) => `${shortDay(u.date)} ${u.ad_name}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

export function EngagementSection({ section }: { section: Section<TrafficFacts> }) {
  const t = section.data;
  const total = t?.current.sessions ?? 0;
  return (
    <SectionCard title="What visitors do on the page" icon={MousePointerClick} section={section} testId="section-engagement">
      {t && (
        <>
          <KpiGrid>
            <Kpi label="Median time on page" value={seconds(t.current.median_engaged_seconds)} cur={t.current.median_engaged_seconds} prior={t.prior.median_engaged_seconds} />
            <Kpi label="Median visit length" value={seconds(t.current.median_session_seconds)} />
            <Kpi label="Clicked a CTA" value={pct(total ? t.current.cta_sessions / total : null, 0)} />
            <Kpi label="Videos" value={`${num(t.current.video_starts)} plays`} hint={`${num(t.current.video_completes)} completed`} />
          </KpiGrid>
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">CTA clicks by section</p>
            {t.cta.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t.tracking_since.cta_click
                  ? `Collecting since ${shortDay(t.tracking_since.cta_click)}; no clicks on this page yet.`
                  : "Collecting starts with this release; numbers appear once GA4 exports the first clicks (about 1–2 days)."}
              </p>
            ) : (
              t.cta.slice(0, 8).map((c, i) => (
                <div key={`${c.section_type}-${c.section_index}-${c.label}-${i}`} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                  <span className="truncate text-foreground" title={c.destination}>
                    <span className="text-muted-foreground">
                      #{c.section_index ?? "?"} {c.section_type}
                    </span>{" "}
                    · {c.label || "(no label)"}
                    {c.destination ? <span className="text-muted-foreground"> → {c.destination}</span> : null}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{c.clicks}</span>
                </div>
              ))
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">How far down visitors scroll</p>
            {t.scroll.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t.tracking_since.scroll_depth ? `Collecting since ${shortDay(t.tracking_since.scroll_depth)}.` : "Collecting starts with this release."}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {t.scroll.map((s) => (
                  <div key={s.depth} className="text-center">
                    <div className="h-12 rounded-sm bg-muted flex items-end">
                      <div className="w-full rounded-sm bg-primary/60" style={{ height: `${total ? Math.min(100, (s.sessions / total) * 100) : 0}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {s.depth}% · {pct(total ? s.sessions / total : null, 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

export function LinksSection({ section }: { section: Section<LinksFacts> }) {
  const l = section.data;
  return (
    <SectionCard title="Internal links" icon={Link2} section={section} testId="section-links">
      {l && (
        <>
          <p className="text-xs text-muted-foreground">
            {l.inbound_count} page{l.inbound_count === 1 ? "" : "s"} link here · this page links to {l.outbound.length}
          </p>
          {l.outbound.length > 0 && (
            <div className="space-y-0.5">
              {l.outbound.slice(0, 10).map((o) => (
                <div key={o.path} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs">
                  <span className="truncate font-mono text-[11px] text-foreground" title={o.path}>
                    {o.path}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{o.stage ? FUNNEL_STAGE_LABEL[o.stage] : "no stage"}</span>
                  <span className={cn("tabular-nums min-w-[4rem] text-right", o.sessions === 0 ? "text-status-away" : "text-muted-foreground")}>
                    {o.sessions === 0 ? "no clicks" : `${o.sessions} next`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}