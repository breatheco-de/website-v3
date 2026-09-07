import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconCamera,
  IconCheck,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconPencil,
  IconPhoto,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type CredentialSource = "env" | "session" | "none";

export interface EntryPreviewSettingsResponse {
  account_id: string;
  account_id_configured: boolean;
  account_id_source: CredentialSource;
  api_token_configured: boolean;
  api_token_source: CredentialSource;
  capture_secret_configured: boolean;
  capture_secret_source: CredentialSource;
  site_url: string | null;
  site_url_ok: boolean;
  site_url_publicly_reachable: boolean;
  config_error: string | null;
  min_interval_ms: number;
  max_concurrency: number;
  max_retries: number;
  defaults: {
    min_interval_ms: number;
    max_concurrency: number;
    max_retries: number;
  };
}

export interface EntryPreviewQueuePageResponse {
  total: number;
  pending: number;
  active: number;
  completedSession: number;
  failedSession: number;
  page: number;
  pageSize: number;
  totalPages: number;
  jobs: Array<{
    key: string;
    contentType: string;
    slug: string;
    locale: string;
    status: "pending" | "active";
    title: string | null;
    url: string | null;
  }>;
}

const QUEUE_PAGE_SIZE = 10;

function sourceBadge(source: CredentialSource) {
  if (source === "none") return null;
  const label = source === "env" ? "env" : "SESSION_SECRET";
  return (
    <Badge variant="secondary" className="text-[10px] font-normal">
      from {label}
    </Badge>
  );
}

function HowOgCaptureWorksPopover() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="How OG capture works"
          data-testid="button-og-how-it-works"
        >
          <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] max-h-[min(28rem,70vh)] overflow-y-auto space-y-2 text-sm text-muted-foreground"
      >
        <p className="font-medium text-foreground">How OG capture works</p>
        <p>
          Server-side Open Graph images are captured with Cloudflare Browser Run against a signed Entry Preview
          frame. Credentials come from the{" "}
          <strong className="text-foreground font-medium">host environment only</strong> — this UI never stores
          them in <code className="font-mono text-xs">settings.yml</code> (which syncs to GitHub). Set{" "}
          <code className="font-mono text-xs">CLOUDFLARE_ACCOUNT_ID</code>,{" "}
          <code className="font-mono text-xs">CLOUDFLARE_API_TOKEN</code>, and optionally{" "}
          <code className="font-mono text-xs">ENTRY_PREVIEW_CAPTURE_SECRET</code> on the host, then restart.
          Capture signing falls back to <code className="font-mono text-xs">SESSION_SECRET</code> when the
          dedicated secret is unset.
        </p>
        <p>
          Queue and generate previews per content type under Content Type manage → Entry Preview.{" "}
          <code className="font-mono text-xs">SITE_URL</code> must be a public URL (env only). Rate pacing
          (interval, concurrency, 429 retries) is configured below and stored in{" "}
          <code className="font-mono text-xs">settings.yml</code> under{" "}
          <code className="font-mono text-xs">entry_preview</code> — never put API secrets in that block.
        </p>
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="button-og-read-more"
        >
          {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {showAdvanced && (
          <ul className="list-disc pl-5 text-xs font-mono space-y-1">
            <li>server/cloudflare-browser.ts</li>
            <li>server/entry-preview-capture-auth.ts</li>
            <li>server/entry-preview-capture-queue.ts</li>
            <li>server/settings.ts (entry_preview rate fields)</li>
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CaptureQueueCard({ enabled }: { enabled: boolean }) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = useQuery<EntryPreviewQueuePageResponse>({
    queryKey: ["/api/settings/entry-preview/queue", page, QUEUE_PAGE_SIZE],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/settings/entry-preview/queue?page=${page}&pageSize=${QUEUE_PAGE_SIZE}`,
      );
      return res.json();
    },
    enabled,
    refetchInterval: (query) => {
      const total = query.state.data?.total ?? 0;
      return total > 0 ? 2_000 : false;
    },
  });

  useEffect(() => {
    if (!data) return;
    if (page > data.totalPages) setPage(data.totalPages);
  }, [data, page]);

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <Card data-testid="card-og-capture-queue">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm">Capture queue</CardTitle>
            <p className="text-xs text-muted-foreground" data-testid="text-og-queue-total">
              {isLoading ? "Loading…" : `${total} upcoming`}
              {data && data.active > 0 ? (
                <span>
                  {" "}
                  · {data.active} active · {data.pending} waiting
                </span>
              ) : null}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="button-og-queue-refresh"
          >
            {isFetching ? (
              <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <IconRefresh className="h-4 w-4 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <IconLoader2 className="h-4 w-4 animate-spin mr-2" />
            Loading queue…
          </div>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-og-queue-empty">
            No captures queued. Queue jobs from a content type&apos;s Entry Preview panel. This list is
            in-memory and clears when the server restarts.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-og-queue">
              {(data?.jobs ?? []).map((job) => (
                <li key={job.key} className="px-3 py-2.5 space-y-0.5" data-testid={`og-queue-job-${job.key}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate min-w-0">
                      {job.title || job.slug}
                    </p>
                    <Badge
                      variant={job.status === "active" ? "default" : "secondary"}
                      className="shrink-0 text-[10px] font-normal"
                    >
                      {job.status === "active" ? "Active" : "Waiting"}
                    </Badge>
                  </div>
                  {job.url ? (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground font-mono break-all underline-offset-2 hover:underline hover:text-foreground"
                    >
                      {job.url}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground font-mono">
                      {job.contentType}/{job.slug} · {job.locale}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <Pagination className="justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setPage((p) => Math.max(1, p - 1));
                      }}
                      className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
                      data-testid="button-og-queue-prev"
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-2 text-xs text-muted-foreground tabular-nums">
                      Page {page} / {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setPage((p) => Math.min(totalPages, p + 1));
                      }}
                      className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}
                      data-testid="button-og-queue-next"
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function OgImageTab() {
  const { toast } = useToast();
  const { hasCapability, isValidated } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");

  const { data, isLoading } = useQuery<EntryPreviewSettingsResponse>({
    queryKey: ["/api/settings/entry-preview"],
    enabled: isValidated === true,
  });

  const [testingCapture, setTestingCapture] = useState(false);
  const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
  const [testCaptureUrl, setTestCaptureUrl] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  const [minIntervalMs, setMinIntervalMs] = useState(10_000);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [maxRetries, setMaxRetries] = useState(5);
  const [rateDirty, setRateDirty] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [rateEditing, setRateEditing] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMinIntervalMs(data.min_interval_ms);
    setMaxConcurrency(data.max_concurrency);
    setMaxRetries(data.max_retries);
    setRateDirty(false);
  }, [data]);

  useEffect(() => {
    return () => {
      if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
    };
  }, [testPreviewUrl]);

  function clearTestPreview() {
    setTestPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTestCaptureUrl(null);
  }

  function cancelRateEdit() {
    if (!data) return;
    setMinIntervalMs(data.min_interval_ms);
    setMaxConcurrency(data.max_concurrency);
    setMaxRetries(data.max_retries);
    setRateDirty(false);
    setRateEditing(false);
  }

  async function handleSaveRate() {
    setSavingRate(true);
    try {
      await apiRequest("PUT", "/api/settings/entry-preview", {
        min_interval_ms: minIntervalMs,
        max_concurrency: maxConcurrency,
        max_retries: maxRetries,
      });
      setRateDirty(false);
      setRateEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/entry-preview"] });
      toast({
        title: "Rate settings saved",
        description: "Stored in settings.yml → entry_preview (queued for content sync).",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save rate settings";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSavingRate(false);
    }
  }

  async function handleTestScreenshot(target: "home" | "example" = "home") {
    setTestingCapture(true);
    clearTestPreview();
    try {
      const res = await fetch(
        `/api/settings/entry-preview/test-screenshot?target=${encodeURIComponent(target)}`,
        {
          method: "POST",
          credentials: "include",
          headers: getSessionHeaders(),
        },
      );
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          if (contentType.includes("application/json")) {
            const json = await res.json();
            message = json?.error || message;
          } else {
            message = (await res.text()) || message;
          }
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      if (!contentType.includes("image/")) {
        throw new Error("Unexpected non-image response from test capture");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setTestPreviewUrl(objectUrl);
      setTestCaptureUrl(res.headers.get("X-Screenshot-Url"));
      toast({
        title: target === "example" ? "API test capture ready" : "Test capture ready",
        description: "Preview only — nothing was saved.",
      });
    } catch (err: any) {
      toast({
        title: "Test capture failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setTestingCapture(false);
    }
  }

  if (isLoading || !data) {
    return (
      <Card data-testid="tab-panel-og-image">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconPhoto className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">OG Image</CardTitle>
          <HowOgCaptureWorksPopover />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
            Loading…
          </div>
        </CardContent>
      </Card>
    );
  }

  const ready = !data.config_error;
  const defaults = data.defaults;

  return (
    <Card data-testid="tab-panel-og-image">
      <CardHeader className="pb-4 space-y-1">
        <div className="flex flex-row items-center gap-2">
          <IconPhoto className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">OG Image</CardTitle>
          <HowOgCaptureWorksPopover />
        </div>
        <p className="text-sm text-muted-foreground">
          Cloudflare Browser Run credentials, capture readiness, and rate limits for Open Graph screenshots.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card data-testid="card-og-rate-limits">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Browser rate limits</CardTitle>
              {rateEditing ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelRateEdit}
                    disabled={savingRate}
                    data-testid="button-og-cancel-rate"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveRate()}
                    disabled={!canEdit || !rateDirty || savingRate}
                    data-testid="button-og-save-rate"
                  >
                    {savingRate ? (
                      <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                    )}
                    {savingRate ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Edit browser rate limits"
                  onClick={() => setRateEditing(true)}
                  data-testid="button-og-edit-rate"
                >
                  <IconPencil className="h-4 w-4 text-muted-foreground" />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {rateEditing ? (
              <>
                <p className="text-muted-foreground">
                  Cloudflare Browser Rendering REST is rate-limited (error{" "}
                  <code className="font-mono text-xs">2001</code> / HTTP 429). Workers Free is about{" "}
                  <strong className="text-foreground font-medium">6 requests per minute</strong> — keep the
                  interval near 10000&nbsp;ms and concurrency at 1. On Workers Paid you can lower the interval
                  (e.g. 300) and raise concurrency (e.g. 2). Changes apply to the next capture start; in-flight
                  jobs keep their current attempt.
                </p>
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="og-min-interval">Min interval (ms)</Label>
                    <Input
                      id="og-min-interval"
                      type="number"
                      min={0}
                      max={120000}
                      step={100}
                      value={minIntervalMs}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setMinIntervalMs(Number(e.target.value));
                        setRateDirty(true);
                      }}
                      data-testid="input-og-min-interval"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Default {defaults.min_interval_ms}. Space between /screenshot API starts.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="og-max-concurrency">Max concurrency</Label>
                    <Input
                      id="og-max-concurrency"
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      value={maxConcurrency}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setMaxConcurrency(Number(e.target.value));
                        setRateDirty(true);
                      }}
                      data-testid="input-og-max-concurrency"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Default {defaults.max_concurrency}. In-flight queue jobs per site (1–8).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="og-max-retries">Max 429 retries</Label>
                    <Input
                      id="og-max-retries"
                      type="number"
                      min={1}
                      max={20}
                      step={1}
                      value={maxRetries}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setMaxRetries(Number(e.target.value));
                        setRateDirty(true);
                      }}
                      data-testid="input-og-max-retries"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Default {defaults.max_retries}. Honors Retry-After when present.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <dl className="grid gap-2 sm:grid-cols-3 text-sm" data-testid="og-rate-limits-summary">
                <div>
                  <dt className="text-xs text-muted-foreground">Min interval</dt>
                  <dd className="font-medium tabular-nums">{minIntervalMs} ms</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Max concurrency</dt>
                  <dd className="font-medium tabular-nums">{maxConcurrency}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Max 429 retries</dt>
                  <dd className="font-medium tabular-nums">{maxRetries}</dd>
                </div>
              </dl>
            )}
            {!canEdit && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <IconInfoCircle className="h-3.5 w-3.5" />
                You need the seo_settings capability to change rate limits.
              </p>
            )}
          </CardContent>
        </Card>

        <Collapsible open={statusOpen} onOpenChange={setStatusOpen}>
          <Card data-testid="card-og-status">
            <CardHeader className={cn("pb-3", data.config_error ? "space-y-2" : undefined)}>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Capture status</CardTitle>
                {ready ? (
                  <Badge className="gap-1" data-testid="badge-og-ready">
                    <IconCheck className="h-3 w-3" />
                    Ready
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1" data-testid="badge-og-not-ready">
                    <IconAlertCircle className="h-3 w-3" />
                    Not ready
                  </Badge>
                )}
              </div>
              {data.config_error ? (
                <p className="text-sm text-destructive" data-testid="text-og-config-error">
                  {data.config_error}
                </p>
              ) : null}
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-3 text-sm pt-0">
                {!data.config_error ? (
                  <p className="text-muted-foreground">Cloudflare credentials and public SITE_URL look good.</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Credentials come from the host environment only — this page shows whether they are present; you
                  cannot set or clear them here.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1.5">
                  <li className="flex items-center gap-2 flex-wrap">
                    <span>
                      Account ID{" "}
                      <code className="font-mono text-[10px]">CLOUDFLARE_ACCOUNT_ID</code>:{" "}
                      {data.account_id_configured ? "configured" : "missing"}
                    </span>
                    {sourceBadge(data.account_id_source)}
                    {data.account_id ? (
                      <code className="font-mono text-[11px] text-foreground/80">{data.account_id}</code>
                    ) : null}
                  </li>
                  <li className="flex items-center gap-2 flex-wrap">
                    <span>
                      API token{" "}
                      <code className="font-mono text-[10px]">CLOUDFLARE_API_TOKEN</code>:{" "}
                      {data.api_token_configured ? "configured" : "missing"}
                    </span>
                    {sourceBadge(data.api_token_source)}
                  </li>
                  <li className="flex items-center gap-2 flex-wrap">
                    <span>
                      Capture secret{" "}
                      <code className="font-mono text-[10px]">ENTRY_PREVIEW_CAPTURE_SECRET</code>
                      {" "}(or SESSION_SECRET):{" "}
                      {data.capture_secret_configured ? "configured" : "missing"}
                    </span>
                    {sourceBadge(data.capture_secret_source)}
                  </li>
                  <li className="flex items-center gap-2 flex-wrap">
                    <span>
                      Public site URL <code className="font-mono text-[10px]">SITE_URL</code>:{" "}
                      {data.site_url ? (
                        <span className="font-mono text-foreground/80 break-all">{data.site_url}</span>
                      ) : (
                        <span className="text-destructive">not set</span>
                      )}
                    </span>
                    {data.site_url && !data.site_url_publicly_reachable && (
                      <span className="text-destructive">(not publicly reachable)</span>
                    )}
                  </li>
                </ul>

                <div className="pt-1 space-y-2 border-t border-border/60">
                  <p className="text-xs text-muted-foreground">
                    Run a throwaway Browser Run shot of the home page to verify Cloudflare can reach{" "}
                    <code className="font-mono">SITE_URL</code>. The image is shown here only — it is not written to
                    YAML, media, or the entry-preview queue. Usually finishes in under ~25s; quick tunnels (
                    <code className="font-mono">*.trycloudflare.com</code>) often time out from Browser Rendering.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!ready || !canEdit || testingCapture}
                      onClick={() => void handleTestScreenshot("home")}
                      data-testid="button-og-test-screenshot"
                    >
                      {testingCapture ? (
                        <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <IconCamera className="h-4 w-4 mr-1.5" />
                      )}
                      {testingCapture ? "Capturing… (~25s max)" : "Test home screenshot"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!ready || !canEdit || testingCapture}
                      onClick={() => void handleTestScreenshot("example")}
                      data-testid="button-og-test-api-only"
                    >
                      Verify API only
                    </Button>
                    {testPreviewUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={clearTestPreview}
                        data-testid="button-og-clear-test-screenshot"
                      >
                        <IconX className="h-4 w-4 mr-1.5" />
                        Clear preview
                      </Button>
                    )}
                  </div>
                  {!canEdit && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <IconInfoCircle className="h-3.5 w-3.5" />
                      You need the seo_settings capability to run the test screenshot.
                    </p>
                  )}
                  {testPreviewUrl && (
                    <div className="space-y-1.5" data-testid="og-test-screenshot-preview">
                      {testCaptureUrl && (
                        <p className="text-[11px] font-mono text-muted-foreground break-all">{testCaptureUrl}</p>
                      )}
                      <img
                        src={testPreviewUrl}
                        alt="Throwaway home page Browser Run capture"
                        className="w-full rounded-md border border-border bg-black"
                      />
                      <p className="text-[11px] text-muted-foreground">Discarded after you leave or clear — not saved.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
            <CardFooter className="justify-end pt-0">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="button-og-status-toggle"
                  aria-expanded={statusOpen}
                >
                  {statusOpen ? "Hide details" : "More details"}
                </Button>
              </CollapsibleTrigger>
            </CardFooter>
          </Card>
        </Collapsible>
      </div>

      <CaptureQueueCard enabled={isValidated === true} />

      <p className="text-xs text-muted-foreground">
        After credentials are ready, generate images from a content type&apos;s Entry Preview panel (e.g.{" "}
        <Link href="/private/type/blog" className="underline underline-offset-2">
          /private/type/blog
        </Link>
        ).
      </p>
      </CardContent>
    </Card>
  );
}
