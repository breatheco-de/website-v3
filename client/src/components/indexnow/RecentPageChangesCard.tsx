import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { IconHistory, IconLoader2, IconPlayerPause } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { HeldRemovalsNotice } from "@/components/indexnow/HeldRemovalsNotice";
import {
  INDEXNOW_STATUS_KEY,
  PUBLIC_URL_CHANGES_KEY,
  changeKindLabel,
  fetchIndexNowStatus,
  fetchPublicUrlChanges,
  relativeTime,
  urlPath,
} from "@/lib/indexnow";

function Kpi({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function RecentPageChangesCard() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");
  const { data: status } = useQuery({ queryKey: INDEXNOW_STATUS_KEY, queryFn: fetchIndexNowStatus, refetchInterval: 60_000 });
  const { data, isLoading } = useQuery({
    queryKey: [PUBLIC_URL_CHANGES_KEY, "recent"],
    queryFn: () => fetchPublicUrlChanges({ limit: 20 }),
    refetchInterval: 60_000,
  });

  const sending = Boolean(status?.enabled && status.live);

  return (
    <Card data-testid="card-recent-page-changes">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <IconHistory className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-sm font-semibold">Recent page changes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Pages whose content changed recently, and whether search engines were notified.
        </p>

        {status?.held ? <HeldRemovalsNotice removedCount={status.held.removedCount} canEdit={canEdit} /> : null}
        {status?.paused ? (
          <p className="flex items-center gap-2 text-xs text-foreground" data-testid="text-page-changes-paused">
            <IconPlayerPause className="h-3.5 w-3.5 text-muted-foreground" />
            Paused: this site is hidden from search engines.
          </p>
        ) : null}
        {status && !status.enabled ? (
          <p className="text-xs text-muted-foreground" data-testid="text-page-changes-indexnow-off">
            IndexNow is off, so Bing is not notified.{" "}
            <Link href="/private/settings/seo/indexnow" className="underline underline-offset-2 hover:text-foreground">
              SEO/GEO → IndexNow
            </Link>
          </p>
        ) : null}

        {isLoading || !data ? (
          <div className="flex items-center text-xs text-muted-foreground">
            <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading changes…
          </div>
        ) : (
          <>
            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              <Kpi label="Changes this week" value={data.summary.changesThisWeek} testId="kpi-page-changes-week" />
              <Kpi
                label="Sent to IndexNow"
                value={sending ? data.summary.sentThisWeek : "—"}
                testId="kpi-page-changes-sent"
              />
              <Kpi label="Waiting" value={sending ? data.summary.waiting : "—"} testId="kpi-page-changes-waiting" />
            </div>

            {data.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-page-changes-empty">
                No changes yet. Changes appear after the first publish or edit following setup.
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="list-page-changes">
                {data.changes.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-xs">
                    <Badge variant="outline" className="w-20 shrink-0 justify-center">
                      {changeKindLabel(c.kind)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={c.url}>
                      {c.kind === "moved" && c.previousUrl ? `${urlPath(c.previousUrl)} → ${urlPath(c.url)}` : urlPath(c.url)}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{relativeTime(c.detectedAt)}</span>
                    {sending ? (
                      <span
                        className={c.sent ? "w-16 shrink-0 text-right text-chart-3" : "w-16 shrink-0 text-right text-muted-foreground"}
                      >
                        {c.sent ? "Sent" : "Waiting"}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
