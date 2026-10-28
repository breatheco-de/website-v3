import { Fragment, useState } from "react";
import { Copy, ExternalLink, FileJson, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { AdsPullProductionButton } from "@/components/ads/AdsPullProductionButton";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { LeadDetailsDialog } from "@/components/leads/LeadDetailsDialog";
import { useToast } from "@/hooks/use-toast";
import type { LeadsListResponse, LeadsListRow, LeadsShow } from "@shared/leads-query";
import { isTrafficChannel, TRAFFIC_CHANNEL_LABELS } from "@shared/traffic-channel";

const NO_CONTACT_NOTE = "Names, emails and phone numbers are not saved here on purpose; they go straight to the CRM.";

const TEST_REASON_LABELS: Record<string, { short: string; title: string }> = {
  staff_session: { short: "Test · staff", title: "Sent while logged in as staff" },
  email_pattern: { short: "Test · email", title: "Email matches a test pattern (Settings → Ads)" },
};

function localTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function channelLabel(channel: string | null): string {
  if (!channel) return "—";
  return isTrafficChannel(channel) ? TRAFFIC_CHANNEL_LABELS[channel] : channel;
}

function utmEntries(row: LeadsListRow): [string, string | null][] {
  return [
    ["utm_source", row.utm_source],
    ["utm_medium", row.utm_medium],
    ["utm_campaign", row.utm_campaign],
    ["utm_content", row.utm_content],
    ["utm_term", row.utm_term],
  ];
}

function pageUrl(row: LeadsListRow): string | null {
  if (!row.conversion_path) return null;
  const host = row.host;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return typeof window === "undefined" ? row.conversion_path : `${window.location.origin}${row.conversion_path}`;
  }
  return `https://${host}${row.conversion_path}`;
}

function sourceMedium(source: string | null, medium: string | null): string {
  if (!source && !medium) return "Direct / untagged";
  return `${source ?? "(none)"} / ${medium ?? "(none)"}`;
}

export function LeadsTable({
  data,
  loading,
  show,
  hasFilters,
  onClearFilters,
  onPage,
  onDownloaded,
}: {
  data?: LeadsListResponse;
  loading: boolean;
  show: LeadsShow;
  hasFilters: boolean;
  onClearFilters: () => void;
  onPage: (page: number) => void;
  onDownloaded: () => void;
}) {
  const { toast } = useToast();
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Lead ID copied", description: "Search for it in the CRM to find this person." });
    } catch {
      toast({ title: "Could not copy", description: id, variant: "destructive" });
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Page URL copied" });
    } catch {
      toast({ title: "Could not copy", description: url, variant: "destructive" });
    }
  };

  const from = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.page_size) : 0;

  return (
    <Card data-testid="card-leads-table">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Leads, newest first</CardTitle>
        </div>
        {data && data.total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-leads-range">
            {from.toLocaleString()}–{to.toLocaleString()} of {data.total.toLocaleString()}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loading || !data ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data.total === 0 ? (
          hasFilters ? (
            <div className="py-8 text-center space-y-3" data-testid="empty-leads-filtered">
              <p className="text-sm text-muted-foreground">
                {show === "test" ? "No test leads match these filters in this range." : "No leads match these filters in this range."}
              </p>
              <Button size="sm" variant="outline" onClick={onClearFilters} data-testid="button-leads-clear-filters-empty">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3" data-testid="empty-leads">
              <p className="text-sm text-muted-foreground">
                {show === "test" ? "No test leads in this range." : "No leads recorded in this range yet."}
              </p>
              <p className="text-xs text-muted-foreground">{NO_CONTACT_NOTE}</p>
              {import.meta.env.DEV && (
                <div className="flex flex-col items-center gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    On your machine this page only shows leads submitted locally. Download production&apos;s leads to see real numbers.
                  </p>
                  <AdsPullProductionButton variant="button" testIdPrefix="leads" onDone={onDownloaded} />
                </div>
              )}
            </div>
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px whitespace-nowrap">When</TableHead>
                    <TableHead>Form / page</TableHead>
                    <TableHead>Source &amp; UTMs</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.submission_id} data-testid={`row-lead-${r.submission_id}`}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          title={`${r.submission_id} (click to copy)`}
                          aria-label="Copy lead ID"
                          onClick={() => void copyId(r.submission_id)}
                          data-testid={`text-lead-id-${r.submission_id}`}
                        >
                          ID: {r.submission_id.length > 8 ? `${r.submission_id.slice(0, 8)}…` : r.submission_id}
                          <Copy className="h-2.5 w-2.5" />
                        </button>
                        <div className="flex items-center gap-1.5">
                          {localTime(r.created_at)}
                          {r.is_test === 1 && (
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-[10px]"
                              title={TEST_REASON_LABELS[r.test_reason ?? ""]?.title ?? r.test_reason ?? undefined}
                              data-testid={`badge-lead-test-${r.submission_id}`}
                            >
                              {TEST_REASON_LABELS[r.test_reason ?? ""]?.short ?? "Test"}
                            </Badge>
                          )}
                          {r.is_repeat === 1 && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              Repeat
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="text-xs">{r.form ?? "—"}</div>
                        <div className="mt-1 flex items-center gap-1.5 min-w-0">
                          {r.locale && (
                            <span className="shrink-0" title={r.locale.toUpperCase()}>
                              <LocaleFlag locale={r.locale} className="h-2.5 w-3.5 rounded-sm" />
                            </span>
                          )}
                          <span
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={r.conversion_path ?? undefined}
                          >
                            {r.conversion_path ?? "—"}
                          </span>
                          {(() => {
                            const url = pageUrl(r);
                            if (!url) return null;
                            return (
                              <span className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                  title="Copy page URL"
                                  aria-label="Copy page URL"
                                  onClick={() => void copyUrl(url)}
                                  data-testid={`button-copy-lead-url-${r.submission_id}`}
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                  title="Open page in a new tab"
                                  aria-label="Open page in a new tab"
                                  data-testid={`link-visit-lead-url-${r.submission_id}`}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </span>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px] text-xs">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="whitespace-nowrap text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                              title="Show all UTM parameters"
                              data-testid={`button-lead-utms-${r.submission_id}`}
                            >
                              {sourceMedium(r.utm_source, r.utm_medium)}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-80 p-3">
                            <p className="mb-2 text-xs font-medium">UTM parameters</p>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                              {utmEntries(r).map(([key, value]) => (
                                <Fragment key={key}>
                                  <dt className="font-mono text-muted-foreground">{key}</dt>
                                  <dd className="break-all font-mono">
                                    {value ?? <span className="italic text-muted-foreground">empty</span>}
                                  </dd>
                                </Fragment>
                              ))}
                            </dl>
                          </PopoverContent>
                        </Popover>
                        {r.channel && (
                          <div
                            className="mt-1 whitespace-nowrap"
                            title={
                              r.channel === "paid" && r.last_organic_channel && isTrafficChannel(r.last_organic_channel)
                                ? `Latest non-paid visit: ${TRAFFIC_CHANNEL_LABELS[r.last_organic_channel]}`
                                : undefined
                            }
                            data-testid={`text-lead-channel-${r.submission_id}`}
                          >
                            <span className="text-muted-foreground">Channel: </span>
                            {channelLabel(r.channel)}
                          </div>
                        )}
                        {r.utm_campaign && (
                          <div className="mt-1 truncate" title={r.utm_campaign}>
                            <span className="text-muted-foreground">Campaign: </span>
                            {r.utm_campaign}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="View lead details"
                          title="View lead details"
                          onClick={() => setDetailsId(r.submission_id)}
                          data-testid={`button-lead-details-${r.submission_id}`}
                        >
                          <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.total_pages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Page {data.page} of {data.total_pages}
                </p>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={data.page <= 1}
                        className={data.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (data.page > 1) onPage(data.page - 1);
                        }}
                        data-testid="button-leads-prev"
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={data.page >= data.total_pages}
                        className={data.page >= data.total_pages ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (data.page < data.total_pages) onPage(data.page + 1);
                        }}
                        data-testid="button-leads-next"
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
        <LeadDetailsDialog leadId={detailsId} onClose={() => setDetailsId(null)} />
      </CardContent>
    </Card>
  );
}
