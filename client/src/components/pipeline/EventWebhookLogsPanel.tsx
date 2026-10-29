import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  IconAlertTriangle,
  IconBraces,
  IconFilter,
  IconLoader2,
  IconRefresh,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { AGENTS_WEBHOOK_LOGS_HREF } from "@/lib/agents-tab";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import JsonViewer from "@/components/editing/JsonViewer";

type EventWebhookHookRef = {
  id: string;
};

type EventWebhookConfigRef = {
  version: 1;
  subscriptions: Record<string, EventWebhookHookRef[]>;
};

type DeliveryRow = {
  id: number;
  event_type: string;
  hook_id: string;
  event_ids: number[];
  url_host: string;
  status: "success" | "failure" | "skipped";
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
  batch_size: number;
  source: "live" | "test" | "retry";
  created_at: number;
};

export type WebhookLogFilters = {
  type: string;
  hook: string;
  status: "" | "success" | "failure" | "skipped";
  from: string;
  to: string;
  order: "asc" | "desc";
};

const EMPTY_FILTERS: WebhookLogFilters = {
  type: "",
  hook: "",
  status: "",
  from: "",
  to: "",
  order: "desc",
};

type PreviewResponse = {
  delivery: DeliveryRow;
  payload: Record<string, unknown> | null;
  events_found: number;
  events_requested: number;
  hook: {
    id: string;
    enabled: boolean;
    url_host: string;
    debounce_ms: number;
    max_wait_ms: number;
    max_events_per_call: number;
  } | null;
  warnings: string[];
};

function parseLogSearch(search: string): WebhookLogFilters {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const statusRaw = params.get("status")?.trim() ?? "";
  const orderRaw = params.get("order")?.trim().toLowerCase() ?? "";
  return {
    type: params.get("type")?.trim() ?? "",
    hook: params.get("hook")?.trim() ?? "",
    status:
      statusRaw === "success" || statusRaw === "failure" || statusRaw === "skipped"
        ? statusRaw
        : "",
    from: params.get("from")?.trim() ?? "",
    to: params.get("to")?.trim() ?? "",
    order: orderRaw === "asc" ? "asc" : "desc",
  };
}

function serializeLogSearch(filters: WebhookLogFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.hook) params.set("hook", filters.hook);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.order === "asc") params.set("order", "asc");
  const s = params.toString();
  return s ? `?${s}` : "";
}

function activeFilterCount(filters: WebhookLogFilters): number {
  let n = 0;
  if (filters.type) n += 1;
  if (filters.hook) n += 1;
  if (filters.status) n += 1;
  if (filters.from) n += 1;
  if (filters.to) n += 1;
  return n;
}

function toDatetimeLocalValue(iso: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string {
  if (!local.trim()) return "";
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function buildDeliveriesQuery(filters: WebhookLogFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.hook) params.set("hook", filters.hook);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("order", filters.order);
  if (!filters.from && !filters.to) params.set("hours", "48");
  return params.toString();
}

function knownHookIds(config: EventWebhookConfigRef): string[] {
  const ids = new Set<string>();
  for (const hooks of Object.values(config.subscriptions ?? {})) {
    for (const h of hooks ?? []) {
      if (h?.id) ids.add(h.id);
    }
  }
  return [...ids].sort();
}

export function EventWebhookLogsPanel({
  config,
  allowlist,
}: {
  config: EventWebhookConfigRef;
  allowlist: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const filters = useMemo(() => parseLogSearch(searchString), [searchString]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<WebhookLogFilters>(filters);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedFailures, setSelectedFailures] = useState<Set<number>>(new Set());
  const [retryConfirm, setRetryConfirm] = useState<number[] | null>(null);
  const [detailDeliveryId, setDetailDeliveryId] = useState<number | null>(null);
  const [previewAdvanced, setPreviewAdvanced] = useState(false);

  useEffect(() => {
    setSelectedFailures(new Set());
  }, [
    filters.type,
    filters.hook,
    filters.status,
    filters.from,
    filters.to,
    filters.order,
  ]);

  useEffect(() => {
    if (filterOpen) {
      setDraft(filters);
      setRangeError(null);
    }
  }, [filterOpen, filters]);

  const writeFilters = (next: WebhookLogFilters) => {
    const qs = serializeLogSearch(next);
    setLocation(`${AGENTS_WEBHOOK_LOGS_HREF}${qs}`);
  };

  const deliveriesQuery = useQuery({
    queryKey: ["/api/admin/event-webhooks/deliveries", filters],
    queryFn: async () => {
      const qs = buildDeliveriesQuery(filters);
      const res = await apiFetch(`/api/admin/event-webhooks/deliveries?${qs}`);
      if (!res.ok) throw new Error("Failed to load deliveries");
      return res.json() as Promise<{ deliveries: DeliveryRow[] }>;
    },
    refetchInterval: () => (document.hidden ? false : 15_000),
  });

  const previewQuery = useQuery({
    queryKey: ["/api/admin/event-webhooks/deliveries/preview", detailDeliveryId],
    enabled: detailDeliveryId != null,
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/event-webhooks/deliveries/${detailDeliveryId}/preview`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to load preview");
      }
      return res.json() as Promise<PreviewResponse>;
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (deliveryIds: number[]) => {
      const res = await apiRequestWithAuth("POST", "/api/admin/event-webhooks/deliveries/retry", {
        deliveryIds,
      });
      return res.json() as Promise<{
        retried: number;
        skipped: number;
        results: Array<{ delivery_id: number; ok: boolean; reason?: string }>;
      }>;
    },
    onSuccess: (data) => {
      setSelectedFailures(new Set());
      setRetryConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks/deliveries"] });
      if (data.skipped > 0) {
        const skipReasons = data.results
          .filter((r) => !r.ok && r.reason)
          .slice(0, 3)
          .map((r) => r.reason);
        toast({
          title: "Retry finished",
          description: `Retried ${data.retried}, skipped ${data.skipped}${
            skipReasons.length ? `: ${skipReasons.join("; ")}` : "."
          }`,
        });
      } else {
        toast({
          title: "Retry queued",
          description:
            data.retried === 1
              ? "1 delivery queued for retry."
              : `${data.retried} deliveries queued for retry.`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const deliveries = deliveriesQuery.data?.deliveries ?? [];
  const failureIds = deliveries.filter((d) => d.status === "failure").map((d) => d.id);
  const filterCount = activeFilterCount(filters);
  const hookOptions = useMemo(() => {
    const fromConfig = knownHookIds(config);
    const fromRows = deliveries.map((d) => d.hook_id);
    return [...new Set([...fromConfig, ...fromRows])].sort();
  }, [config, deliveries]);

  const applyDraft = () => {
    const fromMs = draft.from ? Date.parse(draft.from) : NaN;
    const toMs = draft.to ? Date.parse(draft.to) : NaN;
    if (
      Number.isFinite(fromMs) &&
      Number.isFinite(toMs) &&
      fromMs > toMs
    ) {
      setRangeError("Start must be before end.");
      return;
    }
    setRangeError(null);
    writeFilters({ ...draft, order: filters.order });
    setFilterOpen(false);
  };

  const toggleOrder = () => {
    writeFilters({
      ...filters,
      order: filters.order === "asc" ? "desc" : "asc",
    });
  };

  const hasActiveFilters = filterCount > 0;

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Delivery log (48 hours)</h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilterOpen(true)}
              data-testid="button-webhook-log-filters"
            >
              <IconFilter className="h-3.5 w-3.5 mr-1.5" />
              Filter
              {filterCount > 0 ? (
                <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1 justify-center">
                  {filterCount}
                </Badge>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void deliveriesQuery.refetch();
              }}
            >
              <IconRefresh className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedFailures.size === 0 || retryMutation.isPending}
              onClick={() => setRetryConfirm([...selectedFailures])}
              data-testid="button-retry-selected-webhooks"
            >
              Retry selected ({selectedFailures.size})
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Retry / Retry selected work on failures only. Older than 48 hours is dropped.
        </p>
        {deliveriesQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading deliveries…</p>
        ) : deliveries.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-webhook-deliveries-empty"
          >
            {hasActiveFilters
              ? "No deliveries match these filters."
              : "No webhook calls in the last 48 hours."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 w-8">
                    <Checkbox
                      checked={
                        failureIds.length > 0 &&
                        failureIds.every((id) => selectedFailures.has(id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedFailures(new Set(failureIds));
                        else setSelectedFailures(new Set());
                      }}
                      aria-label="Select all failures"
                    />
                  </th>
                  <th className="p-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      onClick={toggleOrder}
                      data-testid="button-webhook-log-sort-time"
                      aria-label={
                        filters.order === "asc"
                          ? "Sort newest first"
                          : "Sort oldest first"
                      }
                    >
                      Time
                      {filters.order === "asc" ? (
                        <IconSortAscending className="h-3.5 w-3.5" />
                      ) : (
                        <IconSortDescending className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="p-2">Hook</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Host</th>
                  <th className="p-2" />
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const isFailure = d.status === "failure";
                  return (
                    <tr key={d.id} className="border-t border-border">
                      <td className="p-2 align-top">
                        {isFailure ? (
                          <Checkbox
                            checked={selectedFailures.has(d.id)}
                            onCheckedChange={(checked) => {
                              setSelectedFailures((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(d.id);
                                else next.delete(d.id);
                                return next;
                              });
                            }}
                            aria-label={`Select delivery ${d.id}`}
                          />
                        ) : null}
                      </td>
                      <td className="p-2 align-top whitespace-nowrap">
                        <div>{new Date(d.created_at).toLocaleString()}</div>
                        <span
                          className={cn(
                            d.status === "success"
                              ? "text-status-online"
                              : d.status === "skipped"
                                ? "text-status-away"
                                : "text-destructive",
                          )}
                        >
                          {d.status}
                          {d.http_status != null ? ` ${d.http_status}` : ""}
                        </span>
                        {d.error ? (
                          <p
                            className="text-muted-foreground max-w-[12rem] truncate"
                            title={d.error}
                          >
                            {d.error}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-2 align-top">
                        <div className="font-mono">{d.event_type}</div>
                        <div className="text-muted-foreground">{d.hook_id}</div>
                      </td>
                      <td className="p-2 align-top">{d.source}</td>
                      <td className="p-2 align-top truncate max-w-[8rem]">
                        {d.url_host || "—"}
                      </td>
                      <td className="p-2 align-top">
                        {isFailure ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            disabled={retryMutation.isPending}
                            onClick={() => setRetryConfirm([d.id])}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </td>
                      <td className="p-2 align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          aria-label="View delivery details"
                          data-testid={`button-webhook-delivery-payload-${d.id}`}
                          onClick={() => {
                            setPreviewAdvanced(false);
                            setDetailDeliveryId(d.id);
                          }}
                        >
                          <IconBraces className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="sm:max-w-md bg-background text-foreground">
          <DialogHeader>
            <DialogTitle>Filter deliveries</DialogTitle>
            <DialogDescription>
              Choose filters, then Apply to update the list URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={draft.type || "__any__"}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, type: v === "__any__" ? "" : v }))
                }
              >
                <SelectTrigger data-testid="select-webhook-log-filter-type">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {allowlist.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Hook</Label>
              <Select
                value={draft.hook || "__any__"}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, hook: v === "__any__" ? "" : v }))
                }
              >
                <SelectTrigger data-testid="select-webhook-log-filter-hook">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {hookOptions.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={draft.status || "__any__"}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    status:
                      v === "success" || v === "failure" || v === "skipped" ? v : "",
                  }))
                }
              >
                <SelectTrigger data-testid="select-webhook-log-filter-status">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  <SelectItem value="success">success</SelectItem>
                  <SelectItem value="failure">failure</SelectItem>
                  <SelectItem value="skipped">skipped</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-log-from">Start</Label>
                <Input
                  id="webhook-log-from"
                  type="datetime-local"
                  value={toDatetimeLocalValue(draft.from)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      from: fromDatetimeLocalValue(e.target.value),
                    }))
                  }
                  data-testid="input-webhook-log-filter-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhook-log-to">End</Label>
                <Input
                  id="webhook-log-to"
                  type="datetime-local"
                  value={toDatetimeLocalValue(draft.to)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      to: fromDatetimeLocalValue(e.target.value),
                    }))
                  }
                  data-testid="input-webhook-log-filter-to"
                />
              </div>
            </div>
            {rangeError ? (
              <p className="text-xs text-destructive" data-testid="text-webhook-log-range-error">
                {rangeError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft({ ...EMPTY_FILTERS, order: filters.order });
                setRangeError(null);
              }}
            >
              Clear
            </Button>
            <Button type="button" variant="outline" onClick={() => setFilterOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={applyDraft} data-testid="button-webhook-log-filter-apply">
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={retryConfirm != null}
        onOpenChange={(open) => {
          if (!open) setRetryConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(retryConfirm?.length ?? 0) === 1
                ? "Retry this failed delivery?"
                : `Retry ${retryConfirm?.length ?? 0} failed deliveries?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                We will rebuild each payload from its event IDs and POST again to the current hook
                URL. Each attempt adds a new log row (retry). Waiting event buffers are not
                changed. Deliveries whose events are gone or whose hook is missing/disabled are
                skipped.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={retryMutation.isPending}
              onClick={() => {
                if (retryConfirm?.length) retryMutation.mutate(retryConfirm);
              }}
              data-testid="button-confirm-webhook-retry"
            >
              Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={detailDeliveryId != null}
        onOpenChange={(open) => {
          if (!open) setDetailDeliveryId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg bg-background text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delivery details</DialogTitle>
            <DialogDescription>
              Recreated from event IDs — not the exact bytes sent.
            </DialogDescription>
          </DialogHeader>
          {previewQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center text-sm">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : previewQuery.isError ? (
            <p className="text-sm text-destructive">
              {previewQuery.error instanceof Error
                ? previewQuery.error.message
                : "Failed to load preview"}
            </p>
          ) : previewQuery.data ? (
            <div className="space-y-3">
              <Alert>
                <IconAlertTriangle className="h-4 w-4" />
                <AlertTitle>What to trust</AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  <p>
                    Trust event IDs and slim event fields if those events still exist. Do not trust
                    the exact <code className="font-mono">triggered_at</code> (set at preview
                    time), the original full URL or headers (only host was logged), or throttle
                    settings if the hook config changed since send.
                  </p>
                </AlertDescription>
              </Alert>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Time</dt>
                <dd>{new Date(previewQuery.data.delivery.created_at).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-mono">{previewQuery.data.delivery.event_type}</dd>
                <dt className="text-muted-foreground">Hook</dt>
                <dd>{previewQuery.data.delivery.hook_id}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  {previewQuery.data.delivery.status}
                  {previewQuery.data.delivery.http_status != null
                    ? ` ${previewQuery.data.delivery.http_status}`
                    : ""}
                </dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd>{previewQuery.data.delivery.source}</dd>
                <dt className="text-muted-foreground">Host</dt>
                <dd>{previewQuery.data.delivery.url_host || "—"}</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>
                  {previewQuery.data.delivery.duration_ms != null
                    ? `${previewQuery.data.delivery.duration_ms} ms`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Event IDs</dt>
                <dd className="font-mono break-all">
                  {previewQuery.data.delivery.event_ids.join(", ") || "—"}
                </dd>
                {previewQuery.data.delivery.error ? (
                  <>
                    <dt className="text-muted-foreground">Error</dt>
                    <dd className="text-destructive break-words">
                      {previewQuery.data.delivery.error}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="space-y-1">
                <p className="text-xs font-medium">Payload</p>
                {previewQuery.data.payload ? (
                  <div className="overflow-hidden rounded-md border border-border max-h-64">
                    <JsonViewer
                      value={JSON.stringify(previewQuery.data.payload, null, 2)}
                      className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-auto [&_.cm-editor]:!max-h-64 [&_.cm-editor]:!text-xs"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Cannot recreate the payload — the underlying events are no longer available (
                    {previewQuery.data.events_found} of {previewQuery.data.events_requested}{" "}
                    found).
                  </p>
                )}
                {previewQuery.data.warnings.includes("events_partial") ? (
                  <p className="text-xs text-amber-500">
                    Only {previewQuery.data.events_found} of{" "}
                    {previewQuery.data.events_requested} events were found; body is incomplete.
                  </p>
                ) : null}
              </div>
              <Collapsible open={previewAdvanced} onOpenChange={setPreviewAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
                    {previewAdvanced ? "Hide advanced" : "Read more (advanced)"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="text-xs text-muted-foreground space-y-1 pt-1">
                  <p>
                    Preview loads the delivery row, reloads events by{" "}
                    <code className="font-mono">event_ids</code>, and runs the same slim body
                    builder used at send time. Delivery rows are kept about 48 hours; underlying
                    events may be pruned after about 7 days.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
