import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconCamera,
  IconCheck,
  IconCircleCheck,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ChevronDown } from "lucide-react";

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

function sourceBadge(source: CredentialSource) {
  if (source === "none") return null;
  const label = source === "env" ? "env" : "SESSION_SECRET";
  return (
    <Badge variant="secondary" className="text-[10px] font-normal">
      from {label}
    </Badge>
  );
}

function configuredBadge(ok: boolean, okLabel: string, missingLabel: string, testId: string) {
  return ok ? (
    <Badge
      variant="secondary"
      className="gap-1 border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
      data-testid={testId}
    >
      <IconCircleCheck className="h-3.5 w-3.5" />
      {okLabel}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1" data-testid={testId}>
      <IconAlertCircle className="h-3.5 w-3.5" />
      {missingLabel}
    </Badge>
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

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testingCapture, setTestingCapture] = useState(false);
  const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
  const [testCaptureUrl, setTestCaptureUrl] = useState<string | null>(null);

  const [minIntervalMs, setMinIntervalMs] = useState(10_000);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [maxRetries, setMaxRetries] = useState(5);
  const [rateDirty, setRateDirty] = useState(false);
  const [savingRate, setSavingRate] = useState(false);

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

  async function handleSaveRate() {
    setSavingRate(true);
    try {
      await apiRequest("PUT", "/api/settings/entry-preview", {
        min_interval_ms: minIntervalMs,
        max_concurrency: maxConcurrency,
        max_retries: maxRetries,
      });
      setRateDirty(false);
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
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const ready = !data.config_error;
  const defaults = data.defaults;

  return (
    <div className="space-y-4" data-testid="tab-panel-og-image">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How OG capture works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Server-side Open Graph images are captured with Cloudflare Browser Run against a signed Entry Preview
            frame. Credentials come from the <strong className="text-foreground font-medium">host environment
            only</strong> — this UI never stores them in{" "}
            <code className="font-mono text-xs">settings.yml</code> (which syncs to GitHub). Set{" "}
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
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-og-read-more">
                Read more (advanced)
                <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1 text-xs font-mono">
              <p>server/cloudflare-browser.ts</p>
              <p>server/entry-preview-capture-auth.ts</p>
              <p>server/entry-preview-capture-queue.ts</p>
              <p>server/settings.ts (entry_preview rate fields)</p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <Card data-testid="card-og-rate-limits">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Browser rate limits</CardTitle>
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
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Cloudflare Browser Rendering REST is rate-limited (error{" "}
            <code className="font-mono text-xs">2001</code> / HTTP 429). Workers Free is about{" "}
            <strong className="text-foreground font-medium">6 requests per minute</strong> — keep the interval near
            10000&nbsp;ms and concurrency at 1. On Workers Paid you can lower the interval (e.g. 300) and raise
            concurrency (e.g. 2). Changes apply to the next capture start; in-flight jobs keep their current attempt.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
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
          {!canEdit && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <IconInfoCircle className="h-3.5 w-3.5" />
              You need the seo_settings capability to change rate limits.
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-og-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Capture status</CardTitle>
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
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data.config_error ? (
            <p className="text-destructive" data-testid="text-og-config-error">
              {data.config_error}
            </p>
          ) : (
            <p className="text-muted-foreground">Cloudflare credentials and public SITE_URL look good.</p>
          )}
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-center gap-2 flex-wrap">
              Account ID: {data.account_id_configured ? "configured" : "missing"}{" "}
              {sourceBadge(data.account_id_source)}
              {data.account_id ? (
                <code className="font-mono text-[11px] text-foreground/80">{data.account_id}</code>
              ) : null}
            </li>
            <li className="flex items-center gap-2">
              API token: {data.api_token_configured ? "configured" : "missing"}{" "}
              {sourceBadge(data.api_token_source)}
            </li>
            <li className="flex items-center gap-2">
              Capture secret: {data.capture_secret_configured ? "configured" : "missing"}{" "}
              {sourceBadge(data.capture_secret_source)}
            </li>
            <li>
              SITE_URL:{" "}
              {data.site_url ? (
                <span className="font-mono">{data.site_url}</span>
              ) : (
                <span className="text-destructive">not set</span>
              )}
              {data.site_url && !data.site_url_publicly_reachable && (
                <span className="text-destructive ml-1">(not publicly reachable)</span>
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
            {testPreviewUrl && (
              <div className="space-y-1.5" data-testid="og-test-screenshot-preview">
                {testCaptureUrl && (
                  <p className="text-[11px] font-mono text-muted-foreground break-all">{testCaptureUrl}</p>
                )}
                <img
                  src={testPreviewUrl}
                  alt="Throwaway home page Browser Run capture"
                  className="w-full max-w-xl rounded-md border border-border bg-black"
                />
                <p className="text-[11px] text-muted-foreground">Discarded after you leave or clear — not saved.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Environment credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Values are read from the host environment. This page only shows whether they are present — you cannot
            set or clear them here.
          </p>
          <div className="flex flex-wrap gap-2">
            {configuredBadge(
              data.account_id_configured,
              "CLOUDFLARE_ACCOUNT_ID configured",
              "Set CLOUDFLARE_ACCOUNT_ID in environment",
              "badge-cf-account-id",
            )}
            {configuredBadge(
              data.api_token_configured,
              "CLOUDFLARE_API_TOKEN configured",
              "Set CLOUDFLARE_API_TOKEN in environment",
              "badge-cf-api-token",
            )}
            {configuredBadge(
              data.capture_secret_configured,
              data.capture_secret_source === "session"
                ? "Capture secret via SESSION_SECRET"
                : "ENTRY_PREVIEW_CAPTURE_SECRET configured",
              "Set ENTRY_PREVIEW_CAPTURE_SECRET or SESSION_SECRET",
              "badge-capture-secret",
            )}
          </div>
          <dl className="grid gap-2 text-sm">
            <div className="flex flex-col sm:flex-row sm:gap-3">
              <dt className="text-muted-foreground sm:w-40 shrink-0">Account ID env</dt>
              <dd className="font-mono text-xs sm:text-sm">CLOUDFLARE_ACCOUNT_ID</dd>
            </div>
            <div className="flex flex-col sm:flex-row sm:gap-3">
              <dt className="text-muted-foreground sm:w-40 shrink-0">API token env</dt>
              <dd className="font-mono text-xs sm:text-sm">CLOUDFLARE_API_TOKEN</dd>
            </div>
            <div className="flex flex-col sm:flex-row sm:gap-3">
              <dt className="text-muted-foreground sm:w-40 shrink-0">Capture secret env</dt>
              <dd className="font-mono text-xs sm:text-sm">
                ENTRY_PREVIEW_CAPTURE_SECRET (optional; else SESSION_SECRET)
              </dd>
            </div>
            <div className="flex flex-col sm:flex-row sm:gap-3">
              <dt className="text-muted-foreground sm:w-40 shrink-0">Public site URL</dt>
              <dd className="font-mono text-xs sm:text-sm">SITE_URL</dd>
            </div>
          </dl>
          {!canEdit && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <IconInfoCircle className="h-3.5 w-3.5" />
              You need the seo_settings capability to run the test screenshot.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        After credentials are ready, generate images from a content type&apos;s Entry Preview panel (e.g.{" "}
        <Link href="/private/type/blog" className="underline underline-offset-2">
          /private/type/blog
        </Link>
        ).
      </p>
    </div>
  );
}
