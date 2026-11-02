import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { NoticeLine, testRangeText, versionLabel } from "@/components/page-stats/PageStatsTestView";
import { TEST_VIEW_QUERY_KEY } from "@/components/page-stats/test-view-context";
import type { FindingLink, PageStatsTestView } from "@shared/page-stats";
import { CHIP_BUTTON_CLASS } from "./UrlChangedBadge";
import { formatNum, formatPct } from "./ads-format";
import type { AdsPageRow } from "./ads-types";

class NoTestError extends Error {}

function openLink(link: FindingLink): void {
  if (link.kind === "url") window.open(link.href, "_blank", "noopener");
}

async function fetchTestView(path: string): Promise<PageStatsTestView> {
  const params = new URLSearchParams({ path, scope: "url", view: "test" });
  const res = await apiFetch(`/api/analytics/page-stats?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (body?.code === "no_test") throw new NoTestError(body.error ?? "No test recorded.");
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as PageStatsTestView;
}

/** "A/B test" chip on a paid page row with a running test; click shows paid-ad results per version. */
export function AbTestBadge({ row }: { row: AdsPageRow }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [TEST_VIEW_QUERY_KEY, row.path, "ads"],
    queryFn: () => fetchTestView(row.path),
    enabled: open,
    staleTime: 10 * 60 * 1000,
    retry: (count, err) => !(err instanceof NoTestError) && count < 2,
  });
  if (!row.ab_test) return null;

  const data = query.data;
  const anyLow = data ? data.test.versions.some((v) => data.by_version[v]?.paid_summary.low_sample ?? true) : false;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(CHIP_BUTTON_CLASS, "border-primary/40 text-primary")}
          aria-label="A/B test results from paid ads"
          data-testid={`chip-ab-test-${row.key}`}
        >
          A/B Test
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 space-y-3 text-xs leading-relaxed text-muted-foreground">
        <div>
          <p className="text-sm font-medium text-foreground">A/B test: paid ads only</p>
          <p>
            Visits and leads from ads on this page, split by the version each visitor saw. Uses the test&apos;s own dates, not the
            date range above.
          </p>
        </div>

        {query.isLoading ? (
          <div className="flex items-center gap-2" data-testid="ab-test-popover-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading results…
          </div>
        ) : query.error instanceof NoTestError ? (
          <p data-testid="ab-test-popover-empty">No results recorded for this test yet.</p>
        ) : query.error ? (
          <p className="text-destructive" data-testid="ab-test-popover-error">
            Couldn&apos;t load results: {(query.error as Error).message}
          </p>
        ) : data ? (
          <div className="space-y-2" data-testid="ab-test-popover-results">
            <p>{testRangeText(data)}</p>
            <table className="w-full text-left tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide">
                  <th className="py-1 font-normal">Version</th>
                  <th className="py-1 text-right font-normal">Paid visits</th>
                  <th className="py-1 text-right font-normal">Paid leads</th>
                  <th className="py-1 text-right font-normal">Conv. rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.test.versions.map((v) => {
                  const s = data.by_version[v]?.paid_summary;
                  return (
                    <tr key={v} data-testid={`ab-test-row-${v}`}>
                      <td className="py-1 text-foreground">{versionLabel(v)}</td>
                      <td className="py-1 text-right text-foreground">{formatNum(s?.paid_visits ?? 0)}</td>
                      <td className="py-1 text-right text-foreground">{formatNum(s?.paid_leads ?? 0)}</td>
                      <td className={cn("py-1 text-right", s && !s.low_sample ? "text-foreground" : "text-muted-foreground")}>
                        {formatPct(s?.conversion_rate ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {anyLow && (
              <p data-testid="ab-test-popover-low-sample">
                Not enough paid visits to compare yet: each version needs at least {data.min_visits}. Greyed rates can swing a lot.
              </p>
            )}
            <p data-testid="ab-test-popover-source">
              Visits counted by{" "}
              <span className="text-foreground">{data.source === "first_party" ? "the site's own counts" : "Google Analytics"}</span>.
              {data.source === "first_party" && (
                <> The row&apos;s Paid visits come from Google Analytics; its Own paid visits match this source but cover the date range above.</>
              )}
            </p>
            {data.notices.map((n, i) => (
              <NoticeLine key={`${n.kind}-${i}`} notice={n} onLink={openLink} />
            ))}
            {data.test.shared_template && (
              <p>This test runs on a shared template; these numbers are for this page only.</p>
            )}
          </div>
        ) : null}

        <details>
          <summary className="cursor-pointer select-none">Read more (advanced)</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>Paid leads are leads sent on this page by visitors who arrived from an ad, credited to the version they saw.</li>
            <li>
              Visits use the site&apos;s own counts when Optimize for ads was on for any part of the test (even if it is off now),
              otherwise Google Analytics. The paid pages list itself always uses Google Analytics.
            </li>
            <li>
              Same numbers as the Paid visits and Paid leads rows in Page stats → Compare (
              <span className="font-mono">/api/analytics/page-stats?view=test</span>), up to the last {data?.cap_days ?? 90} days of the
              test, cached 10 minutes.
            </li>
          </ul>
        </details>
      </PopoverContent>
    </Popover>
  );
}
