import type { ReactNode } from "react";
import { FlaskConical, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TEST_DEFAULT_VERSION,
  type CompareRow,
  type FindingLink,
  type PageStatsTestView,
  type TestNotice,
  type VersionFacts,
} from "@shared/page-stats";
import type { FunnelStage } from "@shared/funnel";
import { num, pct, seconds, shortDay } from "./format";
import { AdvicePanel, ObjectiveCard, ObjectiveFunnel } from "./ObjectivePanel";
import { EngagementSection, JourneySection, LeadsSection, SectionCard, SourcesSection } from "./PageStatsSections";
import { TestViewContext } from "./test-view-context";

export function versionLabel(v: string): string {
  return v === TEST_DEFAULT_VERSION ? "Default (live page)" : v;
}

export function testRangeText(t: Pick<PageStatsTestView, "test" | "window" | "capped" | "cap_days">): string {
  if (t.capped && t.test.started_at) return `Last ${t.cap_days} days of a test that started ${shortDay(t.test.started_at)}`;
  if (t.test.status === "ended") return `${shortDay(t.window.start)} to ${shortDay(t.window.end)} (test ended)`;
  return t.test.started_at ? `Since the test started on ${shortDay(t.test.started_at)}` : `Since ${shortDay(t.window.start)}`;
}

function splitText(split: Record<string, number>, versions: string[]): string {
  return versions
    .filter((v) => (split[v] ?? 0) > 0)
    .map((v) => `${versionLabel(v)} ${split[v]}%`)
    .join(" / ");
}

function NoticeLine({ notice, onLink }: { notice: TestNotice; onLink: (link: FindingLink) => void }) {
  switch (notice.kind) {
    case "no_ga4_exposure":
      return (
        <p data-testid="test-notice-no-ga4">
          Google Analytics hasn&apos;t reported any visits for this test yet. It usually takes about 2 days. If it stays empty, check the{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => onLink({ kind: "url", href: "/private/tracking/ab-testing#ab-setup", label: "A/B testing setup" })}
          >
            A/B testing setup
          </button>
          . Leads per version still show.
        </p>
      );
    case "first_party_gap":
      return (
        <p data-testid="test-notice-gap">
          Optimize for ads was off from {shortDay(notice.start)} to {shortDay(notice.end)} during this test, so those days have no visits.
        </p>
      );
    case "first_party_started":
      return <p data-testid="test-notice-started">Counting started on {shortDay(notice.day)}, after the test began.</p>;
    case "visits_unavailable":
      return <p data-testid="test-notice-unavailable">Visits couldn&apos;t be read: {notice.message} Leads per version still show.</p>;
  }
}

export function TestViewHeader({ data, onLink }: { data: PageStatsTestView; onLink: (link: FindingLink) => void }) {
  const t = data.test;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-[11px] text-muted-foreground" data-testid="page-stats-test-header">
      <p className="text-xs text-foreground">
        <FlaskConical className="inline h-3.5 w-3.5 mr-1 -mt-0.5 text-muted-foreground" />
        {testRangeText(data)}. Search, ad spend and links can&apos;t be split by version, so they&apos;re hidden.
      </p>
      {t.shared_template && (
        <p data-testid="test-notice-shared-template">
          This test runs on the shared template ({t.shared_template.pages} page{t.shared_template.pages === 1 ? "" : "s"}). Showing this page only.
        </p>
      )}
      {data.notices.map((n, i) => (
        <NoticeLine key={`${n.kind}-${i}`} notice={n} onLink={onLink} />
      ))}
    </div>
  );
}

function cell(row: CompareRow, v: string): string {
  const value = row.values[v] ?? null;
  if (row.format === "rate") return pct(value);
  if (row.format === "seconds") return seconds(value);
  return num(value);
}

export function CompareTable({ data }: { data: PageStatsTestView }) {
  const versions = data.test.versions;
  const visits = data.compare.find((r) => r.id === "visits");
  const short = versions.filter((v) => (visits?.values[v] ?? 0) < data.min_visits);
  return (
    <SectionCard title="Compare versions" icon={FlaskConical} testId="section-compare">
      <p className="text-[11px] text-muted-foreground">
        {short.length > 0
          ? `Too little data: every version needs at least ${data.min_visits} visits before the higher number is marked (${short.map(versionLabel).join(", ")} ${short.length === 1 ? "is" : "are"} not there yet).`
          : "Numbers can differ by chance; wait for enough visits before deciding. The higher number in each row is marked."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="table-compare">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3 text-left font-medium" />
              {versions.map((v) => (
                <th key={v} className="py-1 px-2 text-right font-medium">
                  {versionLabel(v)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.compare.map((row) => (
              <tr key={row.id} className="border-t border-border/60" data-testid={`compare-row-${row.id}`}>
                <td className="py-1.5 pr-3 text-foreground">
                  {row.label}
                  {row.target !== null && <span className="block text-[10px] text-muted-foreground">Target {pct(row.target)}</span>}
                </td>
                {versions.map((v) => (
                  <td
                    key={v}
                    className={cn("py-1.5 px-2 text-right tabular-nums", row.best === v ? "font-semibold text-foreground" : "text-muted-foreground")}
                    data-testid={`compare-cell-${row.id}-${v}`}
                  >
                    {row.best === v && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-status-online align-middle" aria-label="Higher" />}
                    {cell(row, v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.test.split_changes.length > 0 && (
        <div className="space-y-0.5 text-[11px] text-muted-foreground" data-testid="compare-split-changes">
          {data.test.split_changes.map((c, i) => (
            <p key={`${c.day}-${i}`}>
              Split changed on {shortDay(c.day)}: {splitText(c.from, versions)} → {splitText(c.to, versions)}. Compare percentages, not counts.
            </p>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PaidSummaryCard({ facts }: { facts: VersionFacts }) {
  const p = facts.paid_summary;
  return (
    <SectionCard title="Paid ads (this version)" icon={Megaphone} testId="section-paid-version">
      <div className="grid w-full gap-2 grid-cols-3">
        {[
          { label: "Paid visits", value: num(p.paid_visits) },
          { label: "Paid leads (sent here)", value: num(p.paid_leads) },
          { label: "Paid conversion", value: pct(p.conversion_rate) },
        ].map((k) => (
          <div key={k.label} className="min-w-0 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground truncate">{k.label}</p>
            <p className="text-sm font-semibold tabular-nums text-foreground truncate">{k.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Spend and cost per lead aren&apos;t shown: an ad pays for a click to the page, not to a version.
        {p.low_sample && p.paid_visits > 0 ? " Few paid visits: the rate is rough." : ""}
      </p>
    </SectionCard>
  );
}

export function VersionView({
  data,
  version,
  stage,
  stageControl,
  onLink,
}: {
  data: PageStatsTestView;
  version: string;
  stage: FunnelStage | null;
  stageControl?: ReactNode;
  onLink: (link: FindingLink) => void;
}) {
  const facts = data.by_version[version];
  if (!facts) return null;
  const traffic = facts.traffic;
  const leadsFilter = { experiment: data.test.experiment_id, variant: version };
  const journey = (title: string) => <JourneySection key="journey" section={traffic} title={title} />;
  const sources = <SourcesSection key="sources" section={traffic} />;
  const engagement = <EngagementSection key="engagement" section={traffic} />;
  const leads = <LeadsSection key="leads" section={facts.leads} path={data.path} test={leadsFilter} />;
  const paid = <PaidSummaryCard key="paid" facts={facts} />;
  let sections: ReactNode[];
  switch (stage) {
    case "awareness":
      sections = [journey("Where readers go next"), sources, engagement, paid, leads];
      break;
    case "consideration":
      sections = [journey("Path to a decision"), sources, engagement, leads, paid];
      break;
    case "decision":
      sections = [leads, paid, journey("Where non-converters go"), sources, engagement];
      break;
    case "post-enrollment":
      sections = [engagement, journey("Where students go next"), sources];
      break;
    default:
      sections = [sources, journey("Journey"), leads, paid, engagement];
  }
  const funnelSteps = facts.objective?.funnel.length ?? 0;
  return (
    <TestViewContext.Provider value>
      <div className="space-y-4" data-testid={`page-stats-version-${version}`}>
        {facts.objective && (
          <ObjectiveCard objective={facts.objective} traffic={traffic.data} markers={[]} onSetTarget={() => onLink({ kind: "targets" })} stageControl={stageControl} />
        )}
        <AdvicePanel advice={facts.advice} onLink={onLink} />
        {facts.objective && funnelSteps >= 2 && <ObjectiveFunnel objective={facts.objective} source={data.source} />}
        {sections}
      </div>
    </TestViewContext.Provider>
  );
}
