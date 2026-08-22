import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Check, ChevronDown, Cloud, Copy, Info, Loader2, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useSystemAlerts } from "@/hooks/useSystemAlerts";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import {
  gcsStatusDescription,
  gcsStatusLabel,
  inventoryStatusLabel,
  inventoryCategoryDescription,
  useGcsSyncInventory,
  useGcsSyncStatus,
  type GcsConnectionCheck,
  type GcsConnectionTestResponse,
  type GcsKeyProbe,
  type GcsSyncStatusDetail,
  type GcsSyncStatusValue,
  type SyncInventoryStatus,
} from "@/hooks/useGcsSyncStatus";
import SyncArtifactMenu from "@/components/cloud-sync/SyncArtifactMenu";

interface SiteRegistryEntry { 
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
}

function formatInventoryLocalPath(
  localPath: string | null,
  siteFolder: string | null,
  formatSitePath: (filePath: string) => string,
): string {
  if (!localPath) return "—";
  const relative = formatSitePath(localPath);
  if (!siteFolder) return relative;
  const normalized = relative.replace(/^\/+/, "");
  return normalized ? `${siteFolder}/${normalized}` : siteFolder;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CopyableMonoText({
  text,
  testId,
}: {
  text: string | null | undefined;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const display = text ?? "—";
  const canCopy = Boolean(text);

  function handleCopy() {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <button
        type="button"
        onClick={handleCopy}
        disabled={!canCopy}
        className={cn(
          "text-sm font-mono truncate text-left min-w-0 flex-1",
          canCopy && "cursor-pointer hover:text-foreground transition-colors",
          !canCopy && "cursor-default",
        )}
        title={canCopy ? (copied ? "Copied!" : text ?? undefined) : undefined}
        data-testid={testId}
      >
        {display}
      </button>
      {canCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-sm",
            "text-muted-foreground hover:text-foreground transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          title={copied ? "Copied!" : "Copy to clipboard"}
          aria-label="Copy to clipboard"
          data-testid={`${testId}-copy`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

function MetricCardHelp({ testId, children }: { testId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
            "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
          )}
          aria-expanded={open}
          data-testid={`${testId}-toggle`}
        >
          <span>What is this?</span>
          <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-xs text-muted-foreground leading-relaxed pt-1.5" data-testid={testId}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function InlineInfoPopover({
  testId,
  children,
}: {
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center h-4 w-4 rounded-sm shrink-0",
            "text-muted-foreground hover:text-foreground transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="More information"
          data-testid={testId}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm text-muted-foreground space-y-2" side="top" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function statusBadgeVariant(status: GcsSyncStatusValue): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "local_dev":
      return "outline";
    case "syncing":
      return "secondary";
    case "migration_required":
      return "outline";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

function inventoryBadgeVariant(status: SyncInventoryStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "synced":
      return "default";
    case "pending":
      return "secondary";
    case "blocked":
      return "destructive";
    case "missing":
      return "outline";
    default:
      return "outline";
  }
}

function ClickableStatusBadge({
  badge,
  testId,
  title,
  children,
}: {
  badge: React.ReactNode;
  testId?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "cursor-pointer",
          )}
          data-testid={testId}
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" side="left" align="start">
        <p className="font-medium mb-2">{title}</p>
        <div className="text-muted-foreground text-xs leading-relaxed space-y-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function CloudStatusBadge({ status }: { status: GcsSyncStatusDetail }) {
  const value = status.status;
  const badge = (
    <Badge variant={statusBadgeVariant(value)}>
      {gcsStatusLabel(value)}
    </Badge>
  );

  return (
    <ClickableStatusBadge badge={badge} testId="badge-cloud-status" title={gcsStatusLabel(value)}>
      <p>{gcsStatusDescription(value)}</p>

      {value === "error" && status.diagnostics?.checkError && (
        <p className="text-destructive font-mono text-[11px] break-all">{status.diagnostics.checkError}</p>
      )}

      {value === "migration_required" && status.diagnostics && (
        <>
          <p>
            Old layout: {status.diagnostics.hasOldLayout ? "detected" : "not detected"}. New layout:{" "}
            {status.diagnostics.hasNewLayout ? "detected" : "not detected"}.
          </p>
          <p>
            Run{" "}
            <span className="font-mono">
              npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=&lt;bucket&gt; --execute
            </span>
          </p>
        </>
      )}

      {value === "syncing" && (
        <p>
          Pending uploads: {status.pendingUploads}.
          {status.imageQueuePending > 0 && ` Image queue: ${status.imageQueuePending} pending.`}
          {status.imageQueueBusy && " Processing images now."}
        </p>
      )}

      {value === "local_dev" && (
        <>
          <p>
            Running in a non-production environment. GCS may be configured, but bucket sync is not
            enforced in development.
          </p>
          {status.bucketName && (
            <p>
              Bucket configured: <span className="font-mono">{status.bucketName}</span>
            </p>
          )}
        </>
      )}

      {value === "unavailable" && (
        <p>
          Set <span className="font-mono">GCS_BUCKET_NAME</span> or{" "}
          <span className="font-mono">bucket_name</span> in sites.yml, plus GCS credentials (
          <span className="font-mono">GCS_KEY_FILENAME</span> or{" "}
          <span className="font-mono">GCS_CREDENTIALS_JSON</span>).
        </p>
      )}

      {value === "active" && status.bucketName && (
        <p>
          Bucket: <span className="font-mono">{status.bucketName}</span>
        </p>
      )}
    </ClickableStatusBadge>
  );
}

function ConnectionCheckRow({ check }: { check: GcsConnectionCheck }) {
  const Icon =
    check.status === "ok"
      ? Check
      : check.status === "warn"
        ? AlertTriangle
        : check.status === "error"
          ? XCircle
          : Info;

  const iconClass =
    check.status === "ok"
      ? "text-status-online"
      : check.status === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : check.status === "error"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div
      className="flex gap-2.5 py-2 border-b border-border last:border-0"
      data-testid={`connection-check-${check.id}`}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{check.label}</p>
        <p className="text-xs text-muted-foreground">{check.summary}</p>
        {check.detail && (
          <p
            className={cn(
              "text-xs mt-1 break-all",
              check.status === "error" ? "text-destructive font-mono" : "text-muted-foreground",
            )}
          >
            {check.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function ProbeStatusBadge({ probe, testId }: { probe: GcsKeyProbe; testId?: string }) {
  const label =
    probe.status === "found" ? "Found" : probe.status === "legacy" ? "Legacy" : "Missing";
  const badge = (
    <Badge
      variant={
        probe.status === "found" ? "default" : probe.status === "legacy" ? "secondary" : "outline"
      }
      className="text-[10px]"
    >
      {label}
    </Badge>
  );

  if (probe.status === "found") {
    return (
      <ClickableStatusBadge badge={badge} testId={testId ?? "badge-probe-found"} title="Found">
        <p>
          This object exists in GCS at the canonical multisite key. No migration action needed for
          this file.
        </p>
        <p>
          Key: <span className="font-mono break-all">{probe.foundKey ?? probe.expectedKey}</span>
        </p>
      </ClickableStatusBadge>
    );
  }

  if (probe.status === "legacy") {
    return (
      <ClickableStatusBadge badge={badge} testId={testId ?? "badge-probe-legacy"} title="Legacy">
        <p>
          This object exists in GCS but under an older prefix. The app can still read it via legacy
          fallback keys.
        </p>
        <p>
          Found at: <span className="font-mono break-all">{probe.foundKey}</span>
        </p>
        <p>
          Expected: <span className="font-mono break-all">{probe.expectedKey}</span>
        </p>
        <p>
          Run multisite migration to copy to the new layout, then{" "}
          <span className="font-mono">--delete-source</span> to remove legacy copies.
        </p>
      </ClickableStatusBadge>
    );
  }

  return (
    <ClickableStatusBadge badge={badge} testId={testId ?? "badge-probe-missing"} title="Missing">
      <p>
        No object was found at the expected multisite key or any known legacy fallback in the bucket.
      </p>
      <p>
        Expected: <span className="font-mono break-all">{probe.expectedKey}</span>
      </p>
      {probe.legacyKeys.length > 0 && (
        <p>
          Also checked:{" "}
          <span className="font-mono break-all">{probe.legacyKeys.join(", ")}</span>
        </p>
      )}
      <p>
        The file may exist only on this machine, may never have been uploaded to GCS, or may have
        been removed during migration cleanup.
      </p>
    </ClickableStatusBadge>
  );
}

function KeySampleList({ keys, empty = "—" }: { keys: string[]; empty?: string }) {
  if (!keys.length) {
    return <p className="font-mono text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="font-mono text-xs space-y-0.5">
      {keys.map((k) => (
        <li key={k} className="truncate" title={k}>
          {k}
        </li>
      ))}
    </ul>
  );
}

function InventoryStatusBadge({
  status,
  isProduction,
  testId,
}: {
  status: SyncInventoryStatus;
  isProduction?: boolean;
  testId?: string;
}) {
  const badge = (
    <Badge variant={inventoryBadgeVariant(status)} className="text-xs">
      {inventoryStatusLabel(status)}
    </Badge>
  );

  switch (status) {
    case "synced":
      return (
        <ClickableStatusBadge badge={badge} testId={testId ?? "badge-inventory-synced"} title="Synced">
          <p>
            This item was found in Google Cloud Storage. The timestamp reflects the object&apos;s last
            update time in the bucket.
          </p>
        </ClickableStatusBadge>
      );
    case "pending":
      return (
        <ClickableStatusBadge badge={badge} testId={testId ?? "badge-inventory-pending"} title="Pending">
          <p>
            This item is queued for upload from this instance — either a debounced write is in
            progress or an image/job pipeline is still processing.
          </p>
        </ClickableStatusBadge>
      );
    case "blocked":
      return (
        <ClickableStatusBadge badge={badge} testId={testId ?? "badge-inventory-blocked"} title="Blocked">
          <p>
            GCS writes are blocked because the bucket still uses the old flat layout and migration
            has not completed. Local copies may exist but will not upload until migration finishes.
          </p>
        </ClickableStatusBadge>
      );
    case "missing":
      return (
        <ClickableStatusBadge badge={badge} testId={testId ?? "badge-inventory-missing"} title="Missing">
          <p>
            This item was not found locally or in GCS. It may not have been created yet, or the
            path may be misconfigured.
          </p>
        </ClickableStatusBadge>
      );
    case "local_only":
      return (
        <ClickableStatusBadge badge={badge} testId={testId ?? "badge-local-only-info"} title="Local only">
          <p>
            This item exists on this machine&apos;s filesystem but has not been found in Google Cloud
            Storage.
          </p>
          <p>
            {isProduction
              ? "In production, this usually means the file has not been uploaded to the bucket yet."
              : "In local development, this is expected — GCS sync is not compared unless you are in production with GCS configured."}
          </p>
        </ClickableStatusBadge>
      );
    default:
      return badge;
  }
}

function OldLayoutPendingDeletionWarning({
  hasNewLayout,
  testId,
  compact,
}: {
  hasNewLayout: boolean;
  testId?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 flex gap-2.5",
        compact ? "p-2.5" : "p-3",
      )}
      data-testid={testId}
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <div className="text-xs leading-relaxed space-y-1.5">
        <p className="font-medium text-foreground">Legacy objects pending deletion</p>
        <p className="text-muted-foreground">
          Objects under the legacy prefixes (flat{" "}
          <span className="font-mono">media/</span>,{" "}
          <span className="font-mono">sync/{"{site}/"}</span>, etc.) are still present
          {hasNewLayout
            ? " alongside the new multisite keys. "
            : ". "}
          Remove them with{" "}
          <span className="font-mono">scripts/admin/migrate-gcs-multisite.ts --execute --delete-source</span>
          {" "}after confirming the new layout looks correct.
        </p>
        {!compact && (
          <p className="text-muted-foreground">
            Deletion cannot be undone without bucket versioning.
          </p>
        )}
      </div>
    </div>
  );
}

export default function CloudSyncPage() {
  const queryClient = useQueryClient();
  const { data: status, isLoading, isFetching, refetch, dataUpdatedAt: statusUpdatedAt } = useGcsSyncStatus({
    detail: true,
    refetchInterval: 10_000,
  });
  const {
    data: inventory,
    isLoading: inventoryLoading,
    isFetching: inventoryFetching,
    dataUpdatedAt: inventoryUpdatedAt,
  } = useGcsSyncInventory();
  const { data: sites } = useQuery<SiteRegistryEntry[]>({
    queryKey: ["/api/sites"],
    staleTime: 30_000,
  });
  const { recheckGcsMigration, recheckingGcs, recheckMessage } = useSystemAlerts();
  const formatSitePath = useFormatSitePath();
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [showInventoryAdvanced, setShowInventoryAdvanced] = useState(false);
  const [connectionTestOpen, setConnectionTestOpen] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<GcsConnectionTestResponse | null>(null);
  const [connectionTestError, setConnectionTestError] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showConnectionTestAdvanced, setShowConnectionTestAdvanced] = useState(false);

  const inventorySiteFolders = useMemo(() => {
    const folders = new Set<string>();
    for (const row of inventory?.rows ?? []) {
      if (row.siteFolder) folders.add(row.siteFolder);
    }
    return [...folders].sort();
  }, [inventory?.rows]);

  const domainByContentFolder = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of sites ?? []) {
      map.set(site.contentFolder, site.domain);
    }
    return map;
  }, [sites]);

  const filteredInventoryRows = useMemo(() => {
    if (!inventory?.rows) return [];
    if (siteFilter === "all") return inventory.rows;
    if (siteFilter === "platform") return inventory.rows.filter((r) => !r.siteFolder);
    return inventory.rows.filter((r) => r.siteFolder === siteFilter);
  }, [inventory?.rows, siteFilter]);

  const pendingRows = filteredInventoryRows.filter((r) => r.status === "pending");
  const diagnostics = status?.diagnostics;
  const lastRefreshedAt = Math.max(statusUpdatedAt ?? 0, inventoryUpdatedAt ?? 0);
  const isRefreshing = isFetching || inventoryFetching;

  const handleRefresh = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-inventory"] });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionTestError(null);
    try {
      const res = await fetch("/api/admin/gcs-connection-test", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Test failed (${res.status})`);
      }
      setConnectionTestResult(body as GcsConnectionTestResponse);
      setConnectionTestOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-status", "detail"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-inventory"] });
    } catch (err) {
      setConnectionTestResult(null);
      setConnectionTestError(err instanceof Error ? err.message : "Connection test failed");
      setConnectionTestOpen(true);
    } finally {
      setTestingConnection(false);
    }
  };

  const statusForBadge: GcsSyncStatusDetail =
    status ?? {
      available: false,
      bucketName: null,
      status: "unavailable",
      pendingUploads: 0,
      pendingUploadKeys: [],
      imageQueuePending: 0,
      imageQueueBusy: false,
      migrationRequired: false,
      isProduction: false,
    };

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/" className="shrink-0">
            <Button variant="ghost" size="icon" data-testid="button-back-from-cloud-sync">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-cloud-sync-title">
              <Cloud className="h-6 w-6 text-muted-foreground shrink-0" />
              Cloud Sync
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl" data-testid="text-cloud-sync-subtitle">
              Deployment-wide GCS health. Most bucket data syncs per site folder; a few items (e.g. user
              store) are global across all sites.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0 sm:justify-self-end">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing || testingConnection}
              data-testid="button-refresh-cloud-sync"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleTestConnection()}
              disabled={isRefreshing || testingConnection}
              data-testid="button-test-gcs-connection"
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Stethoscope className="h-4 w-4 mr-2" />
              )}
              {testingConnection ? "Testing…" : "Test connection"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-last-refresh">
            {isRefreshing
              ? "Refreshing…"
              : lastRefreshedAt > 0
                ? `Last refreshed ${formatDate(new Date(lastRefreshedAt).toISOString())}`
                : "Not refreshed yet"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <CloudStatusBadge status={statusForBadge} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bucket</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <CopyableMonoText text={status?.bucketName} testId="text-bucket-name" />
              <MetricCardHelp testId="text-bucket-name-help">
                Set <span className="font-mono">bucket_name</span> in the site registry (
                <span className="font-mono">sites.yml</span>, GCS-synced in production), or use{" "}
                <span className="font-mono">GCS_BUCKET_NAME</span> as a bootstrap fallback. Restart the server
                after changing.
              </MetricCardHelp>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-2xl font-bold tabular-nums" data-testid="text-pending-uploads">
                {status?.pendingUploads ?? 0}
              </p>
              <MetricCardHelp testId="text-pending-uploads-help">
                Site files waiting to be saved to the cloud. Changes are grouped together and upload
                after a few seconds. Zero means nothing is waiting. Photos are handled separately in
                Image queue.
              </MetricCardHelp>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Image queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-2xl font-bold tabular-nums" data-testid="text-image-queue-pending">
                {status?.imageQueuePending ?? 0}
              </p>
              <MetricCardHelp testId="text-image-queue-help">
                Photos still waiting to be prepared and saved to the cloud. When you add or change
                images, they show up here until the work is done. Zero means everything is caught up.
              </MetricCardHelp>
              {status?.imageQueueBusy && (
                <p className="text-xs text-muted-foreground">Processing now…</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {status?.migrationRequired && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="pt-6">
            <p className="text-sm text-foreground font-medium">GCS migration required</p>
            <p className="text-sm text-muted-foreground mt-1">
              Bucket uses the old flat layout. GCS writes are blocked until migration completes. Run{" "}
              <span className="font-mono text-xs">
                npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=&lt;bucket&gt; --execute
              </span>
              .
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void recheckGcsMigration()}
                disabled={recheckingGcs}
                data-testid="button-recheck-gcs-migration"
              >
                {recheckingGcs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Re-check migration
              </Button>
              {recheckMessage && (
                <span className="text-xs text-muted-foreground">{recheckMessage}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync inventory</CardTitle>
          <CardDescription className="space-y-2">
            <p>
              Tracks sync state, media, and other shared files between this instance and the GCS bucket.
              Use the status column to spot items that are synced, pending upload, or local-only — click
              &ldquo;Local only&rdquo; for details. Refresh above to re-check after uploads or deployments.
            </p>
            <p>
              Single-file rows (sync state, form registry, validation cache, Search Console inspection,
              runtime issues, sites.yml, and similar) show a ⋮ menu: <span className="font-medium text-foreground">View</span> local
              content, <span className="font-medium text-foreground">Download from GCS</span> (overwrite
              local and reload memory), or <span className="font-medium text-foreground">Upload to GCS</span>{" "}
              (overwrite cloud). Last-write-wins. Upload only works in production with GCS configured.
              Sync state and sync log ask for confirmation because they can affect GitHub sync.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-0 text-xs"
              onClick={() => setShowInventoryAdvanced((v) => !v)}
              data-testid="button-inventory-read-more"
            >
              {showInventoryAdvanced ? "Hide advanced" : "Read more (advanced)"}
            </Button>
            {showInventoryAdvanced && (
              <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                <li>
                  <code>server/gcs-sync-artifacts.ts</code> — registry of View / Download / Upload actions
                </li>
                <li>
                  <code>server/gcs-sync-inventory.ts</code> — inventory rows and <code>artifactKind</code>
                </li>
                <li>
                  <code>client/src/pages/CloudSyncPage.tsx</code> — inventory table + education copy
                </li>
                <li>
                  <code>shared/gcsKeys.ts</code> — canonical local filenames and GCS keys
                </li>
              </ul>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {(inventorySiteFolders.length > 0 || (inventory?.rows.some((r) => !r.siteFolder) ?? false)) && (
            <div className="px-6 py-3 border-b flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">Site</span>
              <ToggleGroup
                type="single"
                value={siteFilter}
                onValueChange={(v) => v && setSiteFilter(v)}
                className="flex-wrap justify-start"
                data-testid="inventory-site-filter"
              >
                <ToggleGroupItem value="all" className="text-xs h-7 px-2.5">
                  All
                </ToggleGroupItem>
                {inventory?.rows.some((r) => !r.siteFolder) && (
                  <ToggleGroupItem value="platform" className="text-xs h-7 px-2.5">
                    Global (All sites)
                  </ToggleGroupItem>
                )}
                {inventorySiteFolders.map((folder) => {
                  const domain = domainByContentFolder.get(folder);
                  return (
                  <ToggleGroupItem
                    key={folder}
                    value={folder}
                    className="text-xs h-7 px-2.5"
                    title={domain ? `${domain} (${folder})` : folder}
                  >
                    <span className="font-mono">{domain ?? folder}</span>
                  </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Local vs Cloud Paths</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    <Loader2 className="h-5 w-5 animate-spin inline-block" />
                  </TableCell>
                </TableRow>
              ) : filteredInventoryRows.length ? (
                filteredInventoryRows.map((row) => {
                  const categoryDescription = inventoryCategoryDescription(row.label);
                  return (
                  <TableRow key={row.id} data-testid={`inventory-row-${row.id}`}>
                    <TableCell>
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-medium text-sm">{row.label}</span>
                          {categoryDescription && (
                            <InlineInfoPopover testId={`info-inventory-${row.id}`}>
                              <p className="font-medium text-foreground">{row.label}</p>
                              <p className="text-xs leading-relaxed">{categoryDescription}</p>
                            </InlineInfoPopover>
                          )}
                        </div>
                        {row.siteFolder && (
                          <Badge variant="outline" className="text-[10px] w-fit font-mono font-normal">
                            {row.siteFolder}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <div
                          className="flex items-baseline gap-1.5 min-w-0"
                          title={row.localPath ?? undefined}
                          data-testid={`inventory-local-path-${row.id}`}
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                            Local
                          </span>
                          <span className="font-mono text-xs truncate">
                            {formatInventoryLocalPath(row.localPath, row.siteFolder, formatSitePath)}
                          </span>
                        </div>
                        <div
                          className="flex items-baseline gap-1.5 min-w-0"
                          title={row.gcsKey}
                          data-testid={`inventory-cloud-path-${row.id}`}
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                            Cloud
                          </span>
                          <span className="font-mono text-xs truncate">{row.gcsKey}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5 items-start">
                        <div className="flex items-center gap-1">
                          <InventoryStatusBadge
                            status={row.status}
                            isProduction={status?.isProduction}
                            testId={`badge-inventory-${row.id}`}
                          />
                          {row.artifactKind && (
                            <SyncArtifactMenu
                              kind={row.artifactKind}
                              siteFolder={row.siteFolder}
                              label={row.label}
                            />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`inventory-last-synced-${row.id}`}>
                          {row.status === "pending" ? (
                            "—"
                          ) : (
                            <>
                              {formatDate(row.lastSyncedAt)}
                              {row.lastSyncedSource && (
                                <span className="ml-1 opacity-70">({row.lastSyncedSource})</span>
                              )}
                            </>
                          )}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No inventory data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pendingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {pendingRows.map((row) => (
                <li key={row.id} className="font-mono text-xs text-muted-foreground truncate">
                  {row.gcsKey}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {diagnostics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bucket architecture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Old layout</p>
                {diagnostics.hasOldLayout ? (
                  <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Detected
                  </p>
                ) : (
                  <p>Not detected</p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">New layout</p>
                <p>{diagnostics.hasNewLayout ? "Detected" : "Not detected"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Media segment</p>
                <p className="font-mono">{diagnostics.mediaSegment}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Environment</p>
                <p>{status?.isProduction ? "Production" : "Development"}</p>
              </div>
            </div>
            {diagnostics.hasOldLayout && (
              <OldLayoutPendingDeletionWarning
                hasNewLayout={diagnostics.hasNewLayout}
                testId="bucket-architecture-old-layout-warning"
                compact
              />
            )}
            {diagnostics.checkError && (
              <p className="text-destructive text-xs">{diagnostics.checkError}</p>
            )}

            {diagnostics.platform && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Platform (multisite)
                </p>
                <p className="text-xs text-muted-foreground">
                  Global configuration and state files shared across all sites (not tied to any single site).
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Sync file</TableHead>
                      <TableHead className="text-xs">Expected key</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[diagnostics.platform.sitesYml, diagnostics.platform.userStore].map((probe) => (
                      <TableRow key={probe.expectedKey}>
                        <TableCell className="text-xs py-2">{probe.label}</TableCell>
                        <TableCell className="font-mono text-xs py-2 max-w-[240px] truncate" title={probe.foundKey ?? probe.expectedKey}>
                          {probe.foundKey ?? probe.expectedKey}
                        </TableCell>
                        <TableCell className="py-2">
                          <ProbeStatusBadge
                            probe={probe}
                            testId={`badge-probe-platform-${probe.label.replace(/\s+/g, "-").toLowerCase()}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {diagnostics.platform.mcpAuthSamples.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <p className="text-muted-foreground text-xs">MCP auth samples</p>
                      <InlineInfoPopover testId="info-mcp-auth-samples">
                        <p className="font-medium text-foreground">MCP auth in GCS</p>
                        <p className="text-xs leading-relaxed">
                          Encrypted files used by the MCP server (Cursor and other integrations) to keep OAuth
                          state across deploys. They use the platform-wide{" "}
                          <span className="font-mono">mcp-auth/</span> prefix — shared across all sites, not
                          stored under a site folder.
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-xs leading-relaxed">
                          <li>
                            <span className="font-mono">clients.enc</span> — registered OAuth clients
                          </li>
                          <li>
                            <span className="font-mono">tokens.enc</span> — issued access tokens
                          </li>
                          <li>
                            <span className="font-mono">bc-cache.enc</span> — cached BreatheCode API credentials
                          </li>
                        </ul>
                        <p className="text-xs leading-relaxed">
                          Contents are AES-256-GCM encrypted. This list is a diagnostic sample of keys found in
                          the bucket — not the decrypted data.
                        </p>
                      </InlineInfoPopover>
                    </div>
                    <KeySampleList keys={diagnostics.platform.mcpAuthSamples} />
                  </div>
                )}
              </div>
            )}

            {diagnostics.sites?.map((site) => (
              <div key={site.siteFolder} className="space-y-2 border-t pt-3">
                <Badge variant="outline" className="text-[10px] font-mono font-normal">
                  {site.siteFolder}
                </Badge>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Sync file</TableHead>
                      <TableHead className="text-xs">Expected key</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {site.syncFiles.map((probe) => (
                      <TableRow key={probe.expectedKey}>
                        <TableCell className="text-xs py-2">{probe.label}</TableCell>
                        <TableCell className="font-mono text-xs py-2 max-w-[240px] truncate" title={probe.expectedKey}>
                          {probe.expectedKey}
                        </TableCell>
                        <TableCell className="py-2">
                          <ProbeStatusBadge probe={probe} testId={`badge-probe-${site.siteFolder}-${probe.label}`} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Media samples</p>
                    <KeySampleList keys={site.mediaSamples} empty="No media objects" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Conversation samples</p>
                    <KeySampleList keys={site.conversationSamples} empty="No snapshots" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Lighthouse samples</p>
                    <KeySampleList keys={site.lighthouseSamples} empty="No reports" />
                  </div>
                </div>
                {site.legacySyncSamples.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Legacy sync prefix still has {site.legacySyncSamples.length} object(s) under{" "}
                    <span className="font-mono">sync/{site.siteFolder}/</span>
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Related tools</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/private/media-gallery">
            <Button variant="outline" size="sm" data-testid="link-media-gallery">
              Media Gallery
            </Button>
          </Link>
          <Link href="/private/repository-sync">
            <Button variant="outline" size="sm" data-testid="link-repository-sync">
              Repository Sync
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Dialog open={connectionTestOpen} onOpenChange={setConnectionTestOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-gcs-connection-test">
          <DialogHeader>
            <DialogTitle>GCS connection test</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-1">
              <span className="font-medium text-foreground">Refresh</span> reloads cached status and
              inventory tables.{" "}
              <span className="font-medium text-foreground">Test connection</span> actively probes GCS
              credentials, bucket API, architecture, and platform objects.
            </DialogDescription>
          </DialogHeader>

          {connectionTestError ? (
            <p className="text-sm text-destructive">{connectionTestError}</p>
          ) : connectionTestResult ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Tested {formatDate(connectionTestResult.testedAt)} — overall{" "}
                <span
                  className={cn(
                    "font-medium",
                    connectionTestResult.overall === "ok" && "text-status-online",
                    connectionTestResult.overall === "warn" && "text-amber-600 dark:text-amber-400",
                    connectionTestResult.overall === "error" && "text-destructive",
                  )}
                >
                  {connectionTestResult.overall}
                </span>
              </p>
              <div className="rounded-md border border-border px-3">
                {connectionTestResult.checks.map((check) => (
                  <ConnectionCheckRow key={check.id} check={check} />
                ))}
              </div>
            </div>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-0 text-xs"
            onClick={() => setShowConnectionTestAdvanced((v) => !v)}
            data-testid="button-connection-test-read-more"
          >
            {showConnectionTestAdvanced ? "Hide advanced" : "Read more (advanced)"}
          </Button>
          {showConnectionTestAdvanced && (
            <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
              <li>
                <code>server/gcs-connection-test.ts</code> — probe runner
              </li>
              <li>
                <code>server/gcs.ts</code> — <code>checkArchitecture()</code>
              </li>
              <li>
                <code>client/src/pages/CloudSyncPage.tsx</code> — status badge + test UI
              </li>
            </ul>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConnectionTestOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                handleRefresh();
                setConnectionTestOpen(false);
              }}
              data-testid="button-connection-test-refresh"
            >
              Refresh page data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
