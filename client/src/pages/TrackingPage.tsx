import { useState, useEffect, useRef } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBraces,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleX,
  IconCode,
  IconCopy,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconPlus,
  IconPlugConnected,
  IconRefresh,
  IconServer,
  IconSettingsCog,
  IconShieldLock,
  IconShoppingBag,
  IconTargetArrow,
  IconToggleLeft,
  IconToggleRight,
  IconTrash,
  IconListDetails,
  IconDatabase,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import JsonViewer from "@/components/editing/JsonViewer";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getGtmWebStatus, type GtmWebStatus } from "@/lib/gtm-web";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { TRACKING_EVENTS } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";

interface TagManagerConfig {
  web_container_id: string;
  sgtm_enabled: boolean;
  sgtm_server_url: string;
  sgtm_proxy_path: string;
}

interface IpnDestinationConfig {
  id: string;
  base_url: string;
}

interface IpNormalizationConfig {
  enabled: boolean;
  destinations: IpnDestinationConfig[];
  secret_configured: boolean;
  secret_source: "env" | "none";
}

interface OptimizationConfig {
  tagmanager: TagManagerConfig;
  ip_normalization?: IpNormalizationConfig;
}

const IPN_MOUNT_PATH = "/ipn/";
const IPN_TOKEN_HEADER = "X-IPN-Token";

function generateIpnSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function WebContainerSection() {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const [status, setStatus] = useState<GtmWebStatus>(() => getGtmWebStatus());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data, isLoading } = useQuery<OptimizationConfig>({
    queryKey: ["/api/settings/optimization"],
  });

  const [webContainerId, setWebContainerId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.tagmanager) {
      setWebContainerId(data.tagmanager.web_container_id || "");
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    setStatus(getGtmWebStatus());

    const interval = window.setInterval(() => {
      const next = getGtmWebStatus();
      setStatus(next);
      if (next.scriptLoaded) {
        window.clearInterval(interval);
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/optimization", {
        tagmanager: {
          web_container_id: webContainerId.trim(),
        },
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/optimization"] });
      setDirty(false);
      toast({
        title: "Web container ID saved",
        description: "Reload the page for the new ID to appear in the HTML shell.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to save",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="card-gtm-web-container">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <IconCode className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Web Container</CardTitle>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {status.valid ? (
            <Badge
              variant="outline"
              className="gap-1.5 text-sm px-3 py-1 text-green-700 dark:text-green-400 border-green-500/40 bg-green-500/10"
              data-testid="badge-gtm-web-configured"
            >
              <IconCircleCheck className="h-4 w-4" />
              Correctly Configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1.5 text-sm px-3 py-1 text-destructive border-destructive/40 bg-destructive/10"
              data-testid="badge-gtm-web-error"
            >
              <IconCircleX className="h-4 w-4" />
              Configuration Error
            </Badge>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canMutateMetrics || !dirty || saving || isLoading}
            data-testid="button-save-web-container"
          >
            {saving ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="gtm-web-container-id"
              >
                Tag ID
              </label>
              <Input
                id="gtm-web-container-id"
                placeholder="GTM-XXXXXXX"
                value={webContainerId}
                onChange={(e) => {
                  setWebContainerId(e.target.value);
                  setDirty(true);
                }}
                className="font-mono text-sm max-w-sm"
                data-testid="input-gtm-web-container-id"
              />
              <p className="text-xs text-muted-foreground">
                Active in this page shell:{" "}
                <code className="font-mono" data-testid="text-gtm-web-container-id">
                  {status.containerId || "(not set)"}
                </code>
                {status.containerId &&
                  webContainerId.trim() &&
                  status.containerId !== webContainerId.trim() && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" "}
                      — reload after save to apply
                    </span>
                  )}
              </p>
            </div>

            {!status.valid && status.issues.length > 0 && (
              <div
                className="flex items-start gap-1.5 text-xs text-destructive"
                data-testid="status-gtm-web-issues"
              >
                <IconCircleX className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{status.issues[0]}</span>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                How it works
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Stored in{" "}
                <code className="font-mono text-xs">settings.yml</code> as{" "}
                <code className="font-mono text-xs">
                  optimization.tagmanager.web_container_id
                </code>{" "}
                and injected into the HTML shell on each request (no client API wait). Separate
                from the server-side (sGTM) proxy in the card below. Deferred load timing is
                unchanged.
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
                <li>
                  Early <code className="font-mono text-xs">window.dataLayer</code> init in{" "}
                  <code className="font-mono text-xs">&lt;head&gt;</code> so events queue before
                  GTM loads.
                </li>
                <li>
                  Deferred <code className="font-mono text-xs">gtm.js</code> on first interaction (
                  <code className="font-mono text-xs">pointerdown</code> /{" "}
                  <code className="font-mono text-xs">keydown</code> /{" "}
                  <code className="font-mono text-xs">scroll</code> /{" "}
                  <code className="font-mono text-xs">touchstart</code>) or after a 15s fallback —
                  keeps GTM out of Lighthouse&apos;s main trace.
                </li>
                <li>
                  Noscript iframe in <code className="font-mono text-xs">&lt;body&gt;</code> for
                  browsers with JavaScript disabled.
                </li>
              </ul>
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-gtm-web-script-status"
              >
                Script:{" "}
                {status.scriptLoaded
                  ? "loaded"
                  : "waiting (loads on first interaction or after 15s)"}
              </p>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-gtm-web-advanced"
              >
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                <IconChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showAdvanced && (
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
                  <p>
                    Settings:{" "}
                    <code className="font-mono">
                      settings.yml → optimization.tagmanager.web_container_id
                    </code>
                  </p>
                  <p>
                    HTML placeholder + inject:{" "}
                    <code className="font-mono">client/index.html</code>,{" "}
                    <code className="font-mono">server/gtm-web-inject.ts</code>
                  </p>
                  <p>
                    Status helper: <code className="font-mono">client/src/lib/gtm-web.ts</code>
                  </p>
                  <p>
                    App events push to dataLayer via{" "}
                    <code className="font-mono">client/src/lib/tracking.ts</code>
                  </p>
                  <p>
                    Operator guide:{" "}
                    <code className="font-mono">docs/gtm-analytics-setup.md</code>
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GTMSection() {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const [showInstructions, setShowInstructions] = useState(false);

  const { data, isLoading } = useQuery<OptimizationConfig>({
    queryKey: ["/api/settings/optimization"],
  });

  const [enabled, setEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [proxyPath, setProxyPath] = useState("/sgtm/");
  const [serverUrlDirty, setServerUrlDirty] = useState(false);
  const [proxyPathDirty, setProxyPathDirty] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [savingPath, setSavingPath] = useState(false);
  const skipHydrateRef = useRef(false);

  type TestStatus = "idle" | "testing" | "success" | "error";
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string>("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!data?.tagmanager) return;
    if (skipHydrateRef.current) {
      skipHydrateRef.current = false;
      return;
    }
    setEnabled(data.tagmanager.sgtm_enabled);
    setServerUrl(data.tagmanager.sgtm_server_url || "");
    setProxyPath(data.tagmanager.sgtm_proxy_path || "/sgtm/");
    setServerUrlDirty(false);
    setProxyPathDirty(false);
  }, [data]);

  async function patchTagmanager(partial: Partial<TagManagerConfig>) {
    skipHydrateRef.current = true;
    const res = await apiRequest("PUT", "/api/settings/optimization", {
      tagmanager: partial,
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    queryClient.setQueryData<OptimizationConfig>(["/api/settings/optimization"], (old) =>
      old
        ? { ...old, tagmanager: { ...old.tagmanager, ...result.tagmanager } }
        : { tagmanager: result.tagmanager, ip_normalization: data?.ip_normalization },
    );
    return result;
  }

  async function handleTestConnection() {
    if (!serverUrl.trim()) return;
    setTesting(true);
    setTestStatus("testing");
    setTestReason("");
    try {
      const res = await apiFetch("/api/settings/optimization/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: serverUrl.trim() }),
        credentials: "include",
      });
      const result = await res.json();
      if (result.reachable) {
        setTestStatus("success");
        setTestReason("");
      } else {
        setTestStatus("error");
        setTestReason(result.reason || "Server unreachable.");
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestReason(err.message || "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const computedTransportUrl = `${siteOrigin}${proxyPath}`;

  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    setSavingToggle(true);
    try {
      await patchTagmanager({ sgtm_enabled: next });
      toast({ title: next ? "sGTM proxy enabled" : "sGTM proxy disabled" });
    } catch (err: any) {
      setEnabled(!next);
      toast({ title: "Failed to update", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSavingToggle(false);
    }
  }

  async function saveServerUrl() {
    setSavingUrl(true);
    try {
      await patchTagmanager({ sgtm_server_url: serverUrl.trim() });
      setServerUrlDirty(false);
      toast({ title: "sGTM server URL saved" });
    } catch (err: any) {
      toast({ title: "Failed to save URL", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSavingUrl(false);
    }
  }

  async function saveProxyPath() {
    setSavingPath(true);
    try {
      await patchTagmanager({ sgtm_proxy_path: proxyPath.trim() });
      setProxyPathDirty(false);
      toast({ title: "Proxy path saved" });
    } catch (err: any) {
      toast({ title: "Failed to save path", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSavingPath(false);
    }
  }

  return (
    <div className="space-y-4">
      <WebContainerSection />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconSettingsCog className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Server-Side Tagging</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium">What is server-side tagging?</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Server-side Google Tag Manager (sGTM) runs your analytics tags on the server instead of the browser. This improves data quality by bypassing ad blockers and browser privacy restrictions (ITP/ETP), reduces page load time, and gives you full control over the data sent to third parties.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  When enabled, this server transparently forwards all requests matching the proxy path to your sGTM server (e.g. a Stape.io endpoint), making them appear as first-party requests from your own domain.
                </p>
              </div>

              <div className="pt-2 border-t space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Enable sGTM proxy</p>
                    <p className="text-xs text-muted-foreground">
                      When off, the proxy path returns 404 and has no performance impact. Saves immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleEnabled}
                    disabled={!canMutateMetrics || savingToggle}
                    className="shrink-0 text-muted-foreground disabled:opacity-50"
                    data-testid="toggle-sgtm-enabled"
                    aria-label={enabled ? "Disable sGTM proxy" : "Enable sGTM proxy"}
                  >
                    {savingToggle ? (
                      <IconLoader2 className="h-7 w-7 animate-spin" />
                    ) : enabled ? (
                      <IconToggleRight className="h-8 w-8 text-primary" />
                    ) : (
                      <IconToggleLeft className="h-8 w-8" />
                    )}
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="sgtm-server-url">
                    sGTM Server URL
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="sgtm-server-url"
                      placeholder="https://xxx.stape.net"
                      value={serverUrl}
                      onChange={(e) => {
                        setServerUrl(e.target.value);
                        setServerUrlDirty(true);
                        setTestStatus("idle");
                        setTestReason("");
                      }}
                      className="font-mono text-sm"
                      data-testid="input-sgtm-server-url"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={!canMutateMetrics || !serverUrl.trim() || testing}
                      data-testid="button-test-sgtm-connection"
                      className="shrink-0"
                    >
                      {testing ? (
                        <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <IconPlugConnected className="h-4 w-4 mr-1.5" />
                      )}
                      Test
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveServerUrl}
                      disabled={!canMutateMetrics || !serverUrlDirty || savingUrl}
                      data-testid="button-save-sgtm-server-url"
                      className="shrink-0"
                    >
                      {savingUrl ? (
                        <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                      )}
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The Stape.io or custom sGTM server endpoint (e.g. <code className="font-mono">https://xxx.stape.net</code>).
                  </p>
                  {testStatus === "success" && (
                    <div className="flex items-center gap-1.5 text-xs" data-testid="status-sgtm-connection-success">
                      <IconCircleCheck className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="text-green-700 dark:text-green-400">Server reachable — connection successful.</span>
                    </div>
                  )}
                  {testStatus === "error" && (
                    <div className="flex items-start gap-1.5 text-xs" data-testid="status-sgtm-connection-error">
                      <IconCircleX className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <span className="text-destructive">{testReason}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="sgtm-proxy-path">
                    Proxy path
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="sgtm-proxy-path"
                      placeholder="/sgtm/"
                      value={proxyPath}
                      onChange={(e) => {
                        setProxyPath(e.target.value);
                        setProxyPathDirty(true);
                      }}
                      className="font-mono text-sm"
                      data-testid="input-sgtm-proxy-path"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveProxyPath}
                      disabled={!canMutateMetrics || !proxyPathDirty || savingPath}
                      data-testid="button-save-sgtm-proxy-path"
                      className="shrink-0"
                    >
                      {savingPath ? (
                        <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                      )}
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Local path to mount the proxy at. Must start with <code className="font-mono">/</code>. Default: <code className="font-mono">/sgtm/</code>.
                  </p>
                </div>

                {serverUrl && proxyPath && (
                  <div className="rounded-md border bg-muted px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Computed transport URL</p>
                    <code className="text-xs font-mono break-all" data-testid="text-transport-url">
                      {computedTransportUrl}
                    </code>
                    <p className="text-xs text-muted-foreground">
                      Paste this URL as the transport URL in your GTM web container server transport settings.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer"
          onClick={() => setShowInstructions((v) => !v)}
          data-testid="button-toggle-instructions"
        >
          <div className="flex items-center gap-2">
            <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">How to connect GTM</CardTitle>
          </div>
          {showInstructions ? (
            <IconChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        {showInstructions && (
          <CardContent className="space-y-3 pt-0">
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                <span className="text-foreground font-medium">Create a server-side GTM container</span> in your Google Tag Manager account (Container type: <em>Server</em>).
              </li>
              <li>
                <span className="text-foreground font-medium">Provision an sGTM server</span> — use Stape.io, GCP, or any supported host. Copy the tagging server URL (e.g. <code className="font-mono text-xs">https://xxx.stape.net</code>).
              </li>
              <li>
                <span className="text-foreground font-medium">Configure the proxy above</span> — paste your sGTM server URL, choose a proxy path (default <code className="font-mono text-xs">/sgtm/</code>), enable the proxy (toggle saves immediately), and save URL/path with their Save buttons.
              </li>
              <li>
                <span className="text-foreground font-medium">Set the transport URL in GTM</span> — in your GTM <em>web</em> container, open the Google Tag / GA4 tag settings and set the <strong>Server container URL</strong> (transport URL) to:
                <div className="mt-1.5 rounded-md border bg-muted px-3 py-2">
                  <code className="text-xs font-mono break-all">{computedTransportUrl || `${siteOrigin}/sgtm/`}</code>
                </div>
              </li>
              <li>
                <span className="text-foreground font-medium">Publish both containers</span> — publish your server container first, then republish your web container. Tags will now fire through the first-party proxy.
              </li>
            </ol>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function IpnRecentCallsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const [clearing, setClearing] = useState(false);
  const [expandedAt, setExpandedAt] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    limit: number;
    calls: Array<{
      at: string;
      method: string;
      destinationId: string | null;
      path: string;
      status: number;
      outcome: string;
      targetHost?: string;
      query?: string | null;
      bodyPreview?: string | null;
      headersPreview?: Record<string, string> | null;
      egressIp?: string | null;
      callerIp?: string | null;
    }>;
  }>({
    queryKey: ["/api/settings/optimization/ipn/recent"],
    refetchInterval: open ? 3000 : false,
    enabled: open,
  });

  useEffect(() => {
    if (!open) setExpandedAt(null);
  }, [open]);

  async function handleClear() {
    setClearing(true);
    try {
      await apiRequest("DELETE", "/api/settings/optimization/ipn/recent");
      queryClient.invalidateQueries({ queryKey: ["/api/settings/optimization/ipn/recent"] });
      setExpandedAt(null);
      toast({ title: "Recent calls cleared" });
    } catch (err: any) {
      toast({ title: "Failed to clear", description: err.message || String(err), variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }

  const calls = data?.calls ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        data-testid="dialog-ipn-recent-calls"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Recent calls (test)</DialogTitle>
          <DialogDescription>
            Last {data?.limit ?? 500} calls, persisted on disk. Row format:{" "}
            <code className="font-mono text-[11px]">path · callerIp → host · egressIp</code>. Clear wipes the history
            file. Expand a row for body and headers (secrets show as •••• + last 4 chars).
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleClear}
            disabled={!canMutateMetrics || clearing || calls.length === 0}
            data-testid="button-clear-ipn-recent"
          >
            {clearing ? <IconLoader2 className="h-4 w-4 animate-spin" /> : "Clear"}
          </Button>
        </div>
        {isLoading && calls.length === 0 ? (
          <div className="flex justify-center py-6">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : calls.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4">
            No calls yet. Hit <code className="font-mono">{IPN_MOUNT_PATH}{"{id}/..."}</code> with{" "}
            <code className="font-mono">{IPN_TOKEN_HEADER}</code> to see them here.
          </p>
        ) : (
          <ul
            className="space-y-2 flex-1 min-h-0 overflow-y-auto"
            data-testid="list-ipn-recent-calls"
          >
            {calls.map((call, i) => {
              const rowKey = `${call.at}-${i}`;
              const expanded = expandedAt === rowKey;
              return (
                <li
                  key={rowKey}
                  className="rounded-md border bg-muted/40 text-xs"
                  data-testid={`ipn-recent-call-${i}`}
                >
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 space-y-0.5 hover-elevate"
                    onClick={() => setExpandedAt(expanded ? null : rowKey)}
                    aria-expanded={expanded}
                    data-testid={`button-expand-ipn-call-${i}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {expanded ? (
                        <IconChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-mono text-muted-foreground">
                        {new Date(call.at).toLocaleTimeString()}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                        {call.method}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          call.status >= 200 && call.status < 400
                            ? "text-green-700 dark:text-green-400 border-green-500/40"
                            : "text-destructive border-destructive/40"
                        }`}
                      >
                        {call.status}
                      </Badge>
                      <span className="text-muted-foreground">{call.outcome}</span>
                    </div>
                    <p className="font-mono break-all text-foreground pl-5">
                      {call.destinationId ? `${call.destinationId}${call.path}` : call.path}
                      {call.query ? (
                        <span className="text-muted-foreground">{call.query}</span>
                      ) : null}
                      {call.callerIp ? (
                        <span className="text-muted-foreground"> · {call.callerIp}</span>
                      ) : null}
                      {call.targetHost ? (
                        <span className="text-muted-foreground">
                          {" "}
                          → {call.targetHost}
                          {call.egressIp ? ` · ${call.egressIp}` : ""}
                        </span>
                      ) : call.egressIp ? (
                        <span className="text-muted-foreground"> · {call.egressIp}</span>
                      ) : null}
                    </p>
                  </button>
                  {expanded && (
                    <div className="border-t px-3 py-2 space-y-2" data-testid={`ipn-recent-call-body-${i}`}>
                      {call.headersPreview && Object.keys(call.headersPreview).length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground">Relevant headers</p>
                          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all rounded-md border bg-background p-2 max-h-40 overflow-auto">
                            {Object.entries(call.headersPreview)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join("\n")}
                          </pre>
                        </div>
                      ) : null}
                      {call.query ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {call.method.toUpperCase() === "GET" ? "Query string (GET body)" : "Query string"}
                          </p>
                          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all rounded-md border bg-background p-2 max-h-32 overflow-auto">
                            {call.query}
                          </pre>
                        </div>
                      ) : null}
                      {call.bodyPreview && call.bodyPreview !== call.query ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground">Request body</p>
                          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all rounded-md border bg-background p-2 max-h-48 overflow-auto">
                            {call.bodyPreview}
                          </pre>
                        </div>
                      ) : null}
                      {!call.query &&
                      !call.bodyPreview &&
                      !(call.headersPreview && Object.keys(call.headersPreview).length > 0) ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          No headers, query string, or body captured for this request.
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function destinationsForSave(dests: IpnDestinationConfig[]): IpnDestinationConfig[] {
  return dests
    .map((d) => ({ id: d.id.trim(), base_url: d.base_url.trim() }))
    .filter((d) => d.id.length > 0 && d.base_url.length > 0 && d.base_url !== "https://");
}

function IpNormalizationSection() {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const [showStapeSteps, setShowStapeSteps] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const { data, isLoading } = useQuery<OptimizationConfig>({
    queryKey: ["/api/settings/optimization"],
  });

  const [enabled, setEnabled] = useState(false);
  const [destinations, setDestinations] = useState<IpnDestinationConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<number | null>(null);
  const skipHydrateRef = useRef(false);

  const secretConfigured = data?.ip_normalization?.secret_configured === true;
  const secretSource = data?.ip_normalization?.secret_source ?? "none";

  useEffect(() => {
    if (!data) return;
    if (skipHydrateRef.current) {
      skipHydrateRef.current = false;
      return;
    }
    if (data.ip_normalization) {
      setEnabled(data.ip_normalization.enabled);
      setDestinations(
        Array.isArray(data.ip_normalization.destinations)
          ? data.ip_normalization.destinations.map((d) => ({ id: d.id, base_url: d.base_url }))
          : [],
      );
    } else {
      setEnabled(false);
      setDestinations([]);
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const proxyBase = `${siteOrigin}${IPN_MOUNT_PATH}`;

  async function persist(next: {
    enabled: boolean;
    destinations: IpnDestinationConfig[];
  }) {
    setSaving(true);
    setSaveStatus("saving");
    try {
      const payload = {
        enabled: next.enabled,
        destinations: destinationsForSave(next.destinations),
      };
      const res = await apiRequest("PUT", "/api/settings/optimization", {
        ip_normalization: payload,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      skipHydrateRef.current = true;
      queryClient.setQueryData<OptimizationConfig>(["/api/settings/optimization"], (old) =>
        old
          ? {
              ...old,
              ip_normalization:
                result.ip_normalization ?? {
                  ...payload,
                  secret_configured: secretConfigured,
                  secret_source: secretSource,
                },
            }
          : {
              tagmanager: data!.tagmanager,
              ip_normalization:
                result.ip_normalization ?? {
                  ...payload,
                  secret_configured: secretConfigured,
                  secret_source: secretSource,
                },
            },
      );
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err: any) {
      setSaveStatus("error");
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function schedulePersist(next: {
    enabled: boolean;
    destinations: IpnDestinationConfig[];
  }) {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persist(next);
    }, 600);
  }

  function updateDestination(index: number, patch: Partial<IpnDestinationConfig>) {
    setDestinations((prev) => {
      const next = prev.map((d, i) => (i === index ? { ...d, ...patch } : d));
      schedulePersist({ enabled, destinations: next });
      return next;
    });
  }

  function removeDestination(index: number) {
    setDestinations((prev) => {
      const next = prev.filter((_, i) => i !== index);
      void persist({ enabled, destinations: next });
      return next;
    });
  }

  function addDestination() {
    setDestinations((prev) => [...prev, { id: "", base_url: "https://" }]);
  }

  function toggleEnabled() {
    setEnabled((v) => {
      const next = !v;
      void persist({ enabled: next, destinations });
      return next;
    });
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  async function generateAndCopySecret() {
    const nextSecret = generateIpnSecret();
    try {
      await navigator.clipboard.writeText(nextSecret);
      toast({
        title: "Secret generated and copied",
        description:
          "Paste it as IPN_SECRET on the host (Secret Manager / .env / Replit Secrets), then restart. This UI never saves it.",
      });
    } catch {
      toast({
        title: "Generated but copy failed",
        description: nextSecret,
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Card data-testid="card-ip-normalization">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconShieldLock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">IP Normalization</CardTitle>
          </div>
          <p
            className="text-xs text-muted-foreground min-h-4"
            data-testid="text-ipn-save-status"
            aria-live="polite"
          >
            {saveStatus === "saving" || saving
              ? "Saving…"
              : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                  ? "Save failed"
                  : "Saves automatically"}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <p className="text-sm font-medium">What is IP Normalization?</p>
                <div
                  className="flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-0 rounded-md border bg-muted/50 px-3 py-3"
                  data-testid="diagram-ipn-flow"
                  aria-hidden="true"
                >
                  <div className="flex-1 rounded-md border bg-card px-3 py-2 text-center space-y-0.5">
                    <p className="text-xs font-medium text-foreground">sGTM host</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">Many outbound IPs</p>
                  </div>
                  <div className="flex sm:flex-col items-center justify-center sm:px-2 text-muted-foreground shrink-0">
                    <IconArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                  </div>
                  <div className="flex-1 rounded-md border border-primary/40 bg-card px-3 py-2 text-center space-y-0.5">
                    <p className="text-xs font-medium text-foreground">This site {IPN_MOUNT_PATH}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">One stable IP</p>
                  </div>
                  <div className="flex sm:flex-col items-center justify-center sm:px-2 text-muted-foreground shrink-0">
                    <IconArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                  </div>
                  <div className="flex-1 rounded-md border bg-card px-3 py-2 text-center space-y-0.5">
                    <p className="text-xs font-medium text-foreground">CRM / API</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">Whitelists that one IP</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Some tools (like Brevo) only accept API calls from approved IP addresses. If you are using sGTM, your
                  VPS or hosting server may use many IPs, so allowlisting them is hard. This feature sends those calls
                  through our server first, so they always come from one stable IP you can whitelist.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  In sGTM, point the request at <code className="font-mono text-xs">{IPN_MOUNT_PATH}{"{id}/"}</code>{" "}
                  and include the <code className="font-mono text-xs">{IPN_TOKEN_HEADER}</code> header. We forward the
                  rest of the request to the destination you configure below.
                </p>
              </div>

              <div className="pt-2 border-t space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Enable IP Normalization</p>
                    <p className="text-xs text-muted-foreground">
                      When off, <code className="font-mono">{IPN_MOUNT_PATH}*</code> returns 404.
                      When on without <code className="font-mono">IPN_SECRET</code>, requests fail closed (401).
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowLog(true)}
                      data-testid="button-view-ipn-log"
                    >
                      <IconListDetails className="h-4 w-4 mr-1.5" />
                      View log
                    </Button>
                    <button
                      type="button"
                      onClick={toggleEnabled}
                      disabled={!canMutateMetrics}
                      className="text-muted-foreground disabled:opacity-50"
                      data-testid="toggle-ipn-enabled"
                      aria-label={enabled ? "Disable IP Normalization" : "Enable IP Normalization"}
                    >
                      {enabled ? (
                        <IconToggleRight className="h-8 w-8 text-primary" />
                      ) : (
                        <IconToggleLeft className="h-8 w-8" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Shared secret ({IPN_TOKEN_HEADER})
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {secretConfigured ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                        data-testid="badge-ipn-secret-ok"
                      >
                        <IconCircleCheck className="h-3.5 w-3.5" />
                        IPN_SECRET configured
                        {secretSource === "env" ? " (env)" : ""}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1" data-testid="badge-ipn-secret-missing">
                        <IconCircleX className="h-3.5 w-3.5" />
                        Set IPN_SECRET in environment
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void generateAndCopySecret()}
                      data-testid="button-generate-ipn-secret"
                    >
                      <IconRefresh className="h-4 w-4 mr-1.5" />
                      Generate & copy
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Host env only — never written to <code className="font-mono">settings.yml</code>. Generate a value,
                    paste it as <code className="font-mono">IPN_SECRET</code> (Secret Manager / .env / Replit Secrets),
                    restart the app, and set the same value as a Constant in the GTM <em>server</em> container for{" "}
                    <code className="font-mono">{IPN_TOKEN_HEADER}</code>.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Allowlisted destinations</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addDestination}
                      disabled={!canMutateMetrics}
                      data-testid="button-add-ipn-destination"
                    >
                      <IconPlus className="h-4 w-4 mr-1.5" />
                      Add
                    </Button>
                  </div>
                  {destinations.length === 0 ? (
                    <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4">
                      No destinations yet. Add an opaque id (e.g. <code className="font-mono">crm</code>) and the HTTPS
                      base URL (e.g. <code className="font-mono">https://api.brevo.com</code>). sGTM will call{" "}
                      <code className="font-mono">{IPN_MOUNT_PATH}crm/...</code>.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {destinations.map((dest, index) => (
                        <div
                          key={index}
                          className="rounded-md border bg-muted/40 p-3 space-y-2"
                          data-testid={`ipn-destination-${index}`}
                        >
                          <div className="flex gap-2 items-start">
                            <div className="flex-1 space-y-1">
                              <label className="text-xs text-muted-foreground" htmlFor={`ipn-id-${index}`}>
                                Id
                              </label>
                              <Input
                                id={`ipn-id-${index}`}
                                placeholder="crm"
                                value={dest.id}
                                onChange={(e) => updateDestination(index, { id: e.target.value })}
                                className="font-mono text-sm"
                                data-testid={`input-ipn-destination-id-${index}`}
                              />
                            </div>
                            <div className="flex-[2] space-y-1">
                              <label className="text-xs text-muted-foreground" htmlFor={`ipn-url-${index}`}>
                                Base URL
                              </label>
                              <Input
                                id={`ipn-url-${index}`}
                                placeholder="https://api.example.com"
                                value={dest.base_url}
                                onChange={(e) => updateDestination(index, { base_url: e.target.value })}
                                className="font-mono text-sm"
                                data-testid={`input-ipn-destination-url-${index}`}
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="mt-5 shrink-0 text-muted-foreground"
                              onClick={() => removeDestination(index)}
                              data-testid={`button-remove-ipn-destination-${index}`}
                              aria-label="Remove destination"
                            >
                              <IconTrash className="h-4 w-4" />
                            </Button>
                          </div>
                          {dest.id.trim() && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground shrink-0">Example:</span>
                              <code className="font-mono break-all flex-1" data-testid={`text-ipn-example-${index}`}>
                                {proxyBase}
                                {dest.id.trim()}/v3/...
                              </code>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="shrink-0 h-7 px-2"
                                onClick={() =>
                                  copyText("Example URL", `${proxyBase}${dest.id.trim()}/`)
                                }
                              >
                                <IconCopy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer"
          onClick={() => setShowStapeSteps((v) => !v)}
          data-testid="button-toggle-ipn-stape-steps"
        >
          <div className="flex items-center gap-2">
            <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">How to send the token from Stape / sGTM</CardTitle>
          </div>
          {showStapeSteps ? (
            <IconChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        {showStapeSteps && (
          <CardContent className="space-y-3 pt-0">
            <p className="text-sm text-muted-foreground">
              Configure this in the <span className="text-foreground font-medium">Google Tag Manager server container</span>{" "}
              (<a
                href="https://tagmanager.google.com"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                tagmanager.google.com
              </a>
              — not in the Stape.io hosting dashboard.
            </p>
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                Open GTM → select the <span className="text-foreground font-medium">Server</span> container (not the Web
                container).
              </li>
              <li>
                <span className="text-foreground font-medium">Variables</span> → User-Defined Variables → New → type{" "}
                <span className="text-foreground font-medium">Constant</span> → paste the shared secret → name e.g.{" "}
                <code className="font-mono text-xs">IPN Token</code> → Save.
              </li>
              <li>
                Tags → Stape <span className="text-foreground font-medium">JSON HTTP Request</span> (or equivalent):
                <ul className="mt-1.5 ml-5 list-disc space-y-1">
                  <li>
                    Destination URL:{" "}
                    <code className="font-mono text-xs break-all">
                      {proxyBase}
                      {"{id}/..."}
                    </code>
                  </li>
                  <li>
                    Request Headers: name <code className="font-mono text-xs">{IPN_TOKEN_HEADER}</code>, value{" "}
                    <code className="font-mono text-xs">{"{{IPN Token}}"}</code> (or the secret as a literal)
                  </li>
                </ul>
              </li>
              <li>
                Keep CRM auth headers (e.g. Brevo <code className="font-mono text-xs">api-key</code>) unchanged — they are
                forwarded; <code className="font-mono text-xs">{IPN_TOKEN_HEADER}</code> is only for this proxy.
              </li>
              <li>
                Publish the server container. In Preview, confirm the outbound host is this site (
                <code className="font-mono text-xs">{IPN_MOUNT_PATH}</code>) and the header is present.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              If a vendor CRM template cannot change host/headers, replace that hop with JSON HTTP Request through{" "}
              <code className="font-mono">{IPN_MOUNT_PATH}{"{id}/"}</code>.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="button-toggle-ipn-advanced"
        >
          <div className="flex items-center gap-2">
            <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Read more (advanced)</CardTitle>
          </div>
          {showAdvanced ? (
            <IconChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        {showAdvanced && (
          <CardContent className="space-y-2 pt-0 text-sm text-muted-foreground">
            <ul className="list-disc ml-5 space-y-1">
              <li>
                Middleware: <code className="font-mono text-xs">server/ipn-proxy.ts</code>
              </li>
              <li>
                Destinations / enable: <code className="font-mono text-xs">optimization.ip_normalization</code> in site{" "}
                <code className="font-mono text-xs">settings.yml</code>
              </li>
              <li>
                Shared secret: host env <code className="font-mono text-xs">IPN_SECRET</code> only (never settings.yml)
              </li>
              <li>
                Fixed mount: <code className="font-mono text-xs">{IPN_MOUNT_PATH}</code>
              </li>
              <li>
                Auth header: <code className="font-mono text-xs">{IPN_TOKEN_HEADER}</code>
              </li>
            </ul>
          </CardContent>
        )}
      </Card>

      <IpnRecentCallsDialog open={showLog} onOpenChange={setShowLog} />
    </>
  );
}

const SAMPLE_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface TrackingEvent {
  name: string;
  trigger: string;
  payload: Record<string, unknown>;
}

interface EventGroup {
  title: string;
  description: string;
  events: TrackingEvent[];
}

const GENERAL_EVENT_PAYLOADS: Record<string, Record<string, unknown>> = {
  page_view: {
    event: "page_view",
    user_id: SAMPLE_USER_ID,
    pagePath: "/en/apply",
    pageTitle: "Apply Now – 4Geeks Academy",
  },
  experiment_exposure: {
    event: "experiment_exposure",
    user_id: SAMPLE_USER_ID,
    experiment_id: "hero-variant-test",
    variant: "B",
  },
  cta_click: {
    event: "cta_click",
    user_id: SAMPLE_USER_ID,
    label: "Apply Now",
    section: "hero",
    destination: "/en/apply",
  },
  video_play: {
    event: "video_play",
    user_id: SAMPLE_USER_ID,
    video_id: "dQw4w9WgXcQ",
    title: "Why 4Geeks Academy",
  },
  scroll_depth: {
    event: "scroll_depth",
    user_id: SAMPLE_USER_ID,
    depth: 50,
    page: "/en/apply",
  },
};

interface UsageEntry {
  file: string;
  content_type: string;
  slug: string;
  locale: string;
  section_id: string;
  section_type: string;
  tags?: string[];
  consent?: Record<string, unknown>;
}

function CollapsibleEventGroup({
  group,
  onShowPayload,
}: {
  group: EventGroup;
  onShowPayload: (ev: TrackingEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const tableId = `table-events-${group.title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-card"
            aria-expanded={open}
            data-testid={`button-toggle-${tableId}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {group.title}
                    <Badge variant="secondary" className="font-normal text-xs">
                      {group.events.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
                </div>
                <IconChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 mt-0.5",
                    open && "rotate-180",
                  )}
                />
              </div>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid={tableId}>
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground w-2/5">Event / Push</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Trigger</th>
                    <th className="py-2 text-xs font-medium text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.events.map((ev) => (
                    <tr key={ev.name} className="border-b last:border-0">
                      <td className="py-2 pr-4 align-middle">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {ev.name}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 align-middle text-muted-foreground text-xs">{ev.trigger}</td>
                      <td className="py-2 align-middle text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onShowPayload(ev)}
                              data-testid={`button-show-payload-${ev.name}`}
                            >
                              <IconBraces className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Show payload</TooltipContent>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function EventsSection() {
  const [selectedEvent, setSelectedEvent] = useState<TrackingEvent | null>(null);

  const routeEvents: TrackingEvent[] = [
    {
      name: "website-route-change",
      trigger: "Client-side navigation (not first load)",
      payload: {
        event: "website-route-change",
        pagePath: "/en/apply",
        pageTitle: "Apply Now – 4Geeks Academy",
      },
    },
  ];

  const visitorContextEvents: TrackingEvent[] = [
    {
      name: "visitor context object",
      trigger: "Once on first load, after geo + user ID resolve",
      payload: {
        user_id: SAMPLE_USER_ID,
        visitor_location_city: "Miami",
        visitor_location_country: "United States",
        visitor_location_slug: "miami-usa",
        visitor_language: "en",
        visitor_latitude: 25.7701,
        visitor_longitude: -80.1928,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "bootcamp-2024",
      },
    },
  ];

  const generalEvents: TrackingEvent[] = TRACKING_EVENTS.map((name) => ({
    name,
    trigger: "Various interactions",
    payload: GENERAL_EVENT_PAYLOADS[name] ?? { event: name, user_id: SAMPLE_USER_ID },
  }));

  const groups: EventGroup[] = [
    {
      title: "Route Events",
      description: "Fired by usePageTracking on every client-side navigation.",
      events: routeEvents,
    },
    {
      title: "Visitor Context",
      description: "Pushed to dataLayer once per page load via setVisitorContext, after the background session worker resolves geo location and user ID.",
      events: visitorContextEvents,
    },
    {
      title: "General Events",
      description: "Fired via track for page views, clicks, video plays, and other interactions. Defined in TRACKING_EVENTS.",
      events: generalEvents,
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card data-testid="card-conversions-notice" className="h-full">
            <CardHeader className="pb-3 h-full">
              <div className="flex flex-col gap-3 h-full">
                <div className="flex-1">
                  <CardTitle className="text-base">Conversion Events</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Form conversions are usually for nurturing leads in marketing automations —
                    managed in the Conversions dashboard where you can add, rename, delete, and
                    reassign form entries.
                  </p>
                </div>
                <Link href="/private/store/conversions">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    data-testid="link-go-to-conversions"
                  >
                    <IconTargetArrow className="h-3.5 w-3.5" />
                    Open Conversions dashboard
                  </Button>
                </Link>
              </div>
            </CardHeader>
          </Card>

          <Card data-testid="card-ecommerce-notice" className="h-full">
            <CardHeader className="pb-3 h-full">
              <div className="flex flex-col gap-3 h-full">
                <div className="flex-1">
                  <CardTitle className="text-base">Ecommerce Events</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ideal for optimizing revenue funnels associated to products — product map,
                    purchasable gating, and wired events like view_item and add_to_cart.
                  </p>
                </div>
                <Link href="/private/store/ecommerce">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    data-testid="link-go-to-ecommerce"
                  >
                    <IconShoppingBag className="h-3.5 w-3.5" />
                    Open Ecommerce dashboard
                  </Button>
                </Link>
              </div>
            </CardHeader>
          </Card>
        </div>

        {groups.map((group) => (
          <CollapsibleEventGroup
            key={group.title}
            group={group}
            onShowPayload={setSelectedEvent}
          />
        ))}
      </div>

      <Dialog open={!!selectedEvent} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm font-semibold">
              {selectedEvent?.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Every time <code className="font-mono text-xs">{selectedEvent?.name}</code> happens, the following payload gets sent to Google Tag Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-md" data-testid="text-payload-json">
            <JsonViewer
              value={selectedEvent ? JSON.stringify(selectedEvent.payload, null, 2) : ""}
              className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-x-auto"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


function BigQuerySection() {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const [enabled, setEnabled] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [location, setLocation] = useState("US");
  const [tablePrefix, setTablePrefix] = useState("events_");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [credentialsHint, setCredentialsHint] = useState("");
  const [credentialsSource, setCredentialsSource] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/tracking/bigquery"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/tracking/bigquery");
      if (!res.ok) throw new Error("Failed to load BigQuery settings");
      return res.json() as Promise<{
        configured: boolean;
        enabled: boolean;
        settings: {
          enabled: boolean;
          project_id: string;
          dataset_id: string;
          location: string;
          table_prefix: string;
        };
        credentials_hint: string;
        credentials_source?: string;
        warnings: string[];
      }>;
    },
  });

  useEffect(() => {
    if (!data?.settings || dirty) return;
    setEnabled(data.settings.enabled);
    setProjectId(data.settings.project_id || "");
    setDatasetId(data.settings.dataset_id || "");
    setLocation(data.settings.location || "US");
    setTablePrefix(data.settings.table_prefix || "events_");
    setCredentialsHint(data.credentials_hint || "");
    setCredentialsSource(data.credentials_source || "");
    setWarnings(data.warnings || []);
  }, [data, dirty]);

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/tracking/bigquery", {
        enabled,
        project_id: projectId.trim(),
        dataset_id: datasetId.trim(),
        location: location.trim() || "US",
        table_prefix: tablePrefix.trim() || "events_",
      });
      setDirty(false);
      await refetch();
      toast({ title: "BigQuery settings saved" });
    } catch (err: any) {
      toast({
        title: "Failed to save",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await apiFetch("/api/settings/tracking/bigquery/test", { method: "POST" });
      const body = await res.json();
      const sourceLabel = body.credentials_source
        ? ` · creds: ${body.credentials_source}`
        : "";
      if (!res.ok || !body.ok) {
        toast({
          title: "Connection failed",
          description: `${body.error || `HTTP ${res.status}`}${sourceLabel}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Connection OK",
          description: body.latest_table
            ? `Latest table: ${body.latest_table} (${body.table_count} tables)${sourceLabel}`
            : `Dataset reachable${sourceLabel}`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Connection failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card data-testid="card-bigquery-settings">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2">
          <IconDatabase className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">GA4 BigQuery export</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">What this does</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Point this site at your GA4 BigQuery export so Store journey analytics can load.
                Project and dataset are saved here; Google credentials stay in the server environment.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Enable BigQuery analytics</p>
                <p className="text-xs text-muted-foreground">
                  When off, product journey metrics stay empty without querying GCP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEnabled((v) => !v);
                  setDirty(true);
                }}
                disabled={!canMutateMetrics}
                className="shrink-0 text-muted-foreground disabled:opacity-50"
                data-testid="toggle-bigquery-enabled"
                aria-label={enabled ? "Disable BigQuery" : "Enable BigQuery"}
              >
                {enabled ? (
                  <IconToggleRight className="h-8 w-8 text-primary" />
                ) : (
                  <IconToggleLeft className="h-8 w-8" />
                )}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="bq-project">
                  Project ID
                </label>
                <Input
                  id="bq-project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="my-gcp-project"
                  disabled={!canMutateMetrics}
                  data-testid="input-bq-project"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="bq-dataset">
                  Dataset ID
                </label>
                <Input
                  id="bq-dataset"
                  value={datasetId}
                  onChange={(e) => {
                    setDatasetId(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="analytics_XXXXXX"
                  disabled={!canMutateMetrics}
                  data-testid="input-bq-dataset"
                />
              </div>
            </div>

            {warnings.length > 0 && (
              <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1 list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium text-foreground"
                  data-testid="button-bq-advanced"
                >
                  Read more (advanced)
                  <IconChevronDown
                    className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 text-sm text-muted-foreground">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="bq-location">
                      Location
                    </label>
                    <Input
                      id="bq-location"
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="US"
                      disabled={!canMutateMetrics}
                      data-testid="input-bq-location"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="bq-prefix">
                      Table prefix
                    </label>
                    <Input
                      id="bq-prefix"
                      value={tablePrefix}
                      onChange={(e) => {
                        setTablePrefix(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="events_"
                      disabled={!canMutateMetrics}
                      data-testid="input-bq-prefix"
                    />
                  </div>
                </div>
                <p>{credentialsHint}</p>
                {credentialsSource ? (
                  <p className="text-xs">
                    Active credentials source:{" "}
                    <span className="font-mono text-foreground">{credentialsSource}</span>
                  </p>
                ) : null}
                <p className="font-mono text-xs">
                  settings.yml → tracking.bigquery · GCS_CREDENTIALS_JSON / GCS_KEY_FILENAME (same as media)
                </p>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <Button
                type="button"
                onClick={save}
                disabled={!canMutateMetrics || !dirty || saving}
                data-testid="button-bq-save"
              >
                {saving ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                )}
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={testConnection}
                disabled={testing || !enabled || !projectId.trim() || !datasetId.trim()}
                data-testid="button-bq-test"
              >
                {testing ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <IconPlugConnected className="h-4 w-4 mr-1.5" />
                )}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


export default function TrackingPage() {
  return (
    <MetricsAccessGate>
      <TrackingPageInner />
    </MetricsAccessGate>
  );
}

function TrackingPageInner() {
  const [location] = useLocation();
  const isSgtm = location === "/private/tracking/sgtm";
  const isIpn = location === "/private/tracking/ipn";
  const isBigQuery = location === "/private/tracking/bigquery";
  const isEvents = !isSgtm && !isIpn && !isBigQuery;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-tracking">
                <IconArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <IconChartBar className="h-6 w-6 text-muted-foreground" />
              <div>
                <h1 className="text-xl font-semibold" data-testid="text-tracking-title">Tracking</h1>
                <p className="text-sm text-muted-foreground">Analytics &amp; event configuration</p>
              </div>
            </div>
          </div>

          <div className="flex items-center rounded-md border overflow-hidden" data-testid="toggle-tracking-view">
            <Link href="/private/tracking">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isEvents
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-events"
              >
                <IconChartBar className="h-3.5 w-3.5" />
                Events
              </button>
            </Link>
            <div className="w-px h-6 bg-border" />
            <Link href="/private/tracking/sgtm">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isSgtm
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-sgtm"
              >
                <IconServer className="h-3.5 w-3.5" />
                sGTM
              </button>
            </Link>
            <div className="w-px h-6 bg-border" />
            <Link href="/private/tracking/ipn">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isIpn
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-ipn"
              >
                <IconShieldLock className="h-3.5 w-3.5" />
                IP Normalization
              </button>
            </Link>
            <div className="w-px h-6 bg-border" />
            <Link href="/private/tracking/bigquery">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isBigQuery
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-bigquery"
              >
                <IconDatabase className="h-3.5 w-3.5" />
                BigQuery
              </button>
            </Link>
          </div>
        </div>

        {isSgtm ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Server-Side Tag Manager</h2>
            <GTMSection />
          </div>
        ) : isIpn ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">IP Normalization</h2>
            <div className="space-y-4">
              <IpNormalizationSection />
            </div>
          </div>
        ) : isBigQuery ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">BigQuery</h2>
            <BigQuerySection />
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tracked Events</h2>
            <p className="text-sm text-muted-foreground">
              All events currently fired into <code className="font-mono text-xs">window.dataLayer</code>. This list is auto-generated from the source constants in <code className="font-mono text-xs">@/lib/tracking</code>.
            </p>
            <EventsSection />
          </div>
        )}
      </div>
    </div>
  );
}
