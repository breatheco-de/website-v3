import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconServer,
  IconLoader2,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconReload,
  IconPower,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useHardRestart } from "@/hooks/useHardRestart";
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

interface ServerStatus {
  status: string;
  bootId: string;
  bootTime: number;
  uptime: number;
  env: string;
  nodeVersion: string;
  pid: number;
  lastSoftReloadAt: string | null;
  lastSoftReloadId: string | null;
  restartAvailable: boolean;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
}

interface SoftReloadStep {
  step: string;
  ok: boolean;
  error?: string;
}

interface SoftReloadResult {
  success: boolean;
  steps: SoftReloadStep[];
  reloadedAt?: string;
  reloadId?: string;
  error?: string;
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s % 60}s`);
  return parts.join(" ");
}

function StatusRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-foreground text-right break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function ServerTab() {
  const {
    data: status,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<ServerStatus>({
    queryKey: ["/api/admin/server/status"],
    refetchInterval: 15000,
  });

  const [reloadRunning, setReloadRunning] = useState(false);
  const [reloadResult, setReloadResult] = useState<SoftReloadResult | null>(null);

  const { phase, message, start, reset } = useHardRestart();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runSoftReload() {
    setReloadRunning(true);
    setReloadResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/server/soft-reload");
      const result = (await res.json()) as SoftReloadResult;
      setReloadResult(result);
      // Refresh the status card so "last soft reload" updates.
      refetch();
    } catch (err: any) {
      setReloadResult({
        success: false,
        steps: [],
        error: err?.message || String(err),
      });
    } finally {
      setReloadRunning(false);
    }
  }

  const restartInProgress = phase === "restarting";

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconServer className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Server Status</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Refresh status"
            data-testid="button-refresh-server-status"
          >
            <IconRefresh className={`h-4 w-4 text-muted-foreground ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !status ? (
            <div className="flex items-center gap-2 text-sm text-destructive py-4" data-testid="text-server-status-error">
              <IconAlertCircle className="h-4 w-4" />
              Server is not responding.
            </div>
          ) : (
            <div className="rounded-md border px-3 py-1" data-testid="card-server-status">
              <div className="flex items-center justify-between gap-4 py-2 border-b">
                <span className="text-xs text-muted-foreground">Status</span>
                <Badge variant="secondary" className="gap-1 text-green-600">
                  <IconCheck className="h-3 w-3" /> Up
                </Badge>
              </div>
              <StatusRow label="Uptime" value={formatUptime(status.uptime)} />
              <StatusRow label="Environment" value={status.env} mono />
              <StatusRow label="Node" value={status.nodeVersion} mono />
              <StatusRow label="Boot ID" value={status.bootId} mono />
              <StatusRow label="Memory (RSS)" value={`${status.memory.rssMb} MB`} />
              <StatusRow
                label="Last soft reload"
                value={status.lastSoftReloadAt ? new Date(status.lastSoftReloadAt).toLocaleString() : "—"}
              />
              <p className="text-xs text-muted-foreground pt-3 border-t">
                Deploy status: GitHub → Actions → <strong>Deploy to VPS</strong> (job log for the
                commit). A new Boot ID and low uptime here confirm a successful restart after deploy.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Soft reload */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconReload className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Soft Reload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Re-hydrates all derived in-memory state (site config, content indexes, ecommerce data, image registry,
            validation caches) without killing the process. Zero downtime — the site keeps serving traffic. Use this to
            fix stale or wrong data.
          </p>
          <Button
            size="sm"
            onClick={runSoftReload}
            disabled={reloadRunning}
            data-testid="button-soft-reload"
          >
            {reloadRunning ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconReload className="h-4 w-4 mr-1.5" />
            )}
            Soft reload
          </Button>

          {reloadResult && (
            <div className="space-y-2" data-testid="result-soft-reload">
              <div className="flex items-center gap-2 text-sm">
                {reloadResult.success ? (
                  <>
                    <IconCheck className="h-4 w-4 text-green-500" />
                    <span className="text-foreground">Reload completed successfully.</span>
                  </>
                ) : (
                  <>
                    <IconAlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">Reload completed with errors.</span>
                  </>
                )}
              </div>
              {reloadResult.error && (
                <pre className="text-xs font-mono rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-2 whitespace-pre-wrap">
                  {reloadResult.error}
                </pre>
              )}
              {reloadResult.steps.length > 0 && (
                <div className="rounded-md border divide-y">
                  {reloadResult.steps.map((s) => (
                    <div key={s.step} className="flex items-start gap-2 px-3 py-2" data-testid={`reload-step-${s.step}`}>
                      {s.ok ? (
                        <IconCheck className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <IconAlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">{s.step}</p>
                        {s.error && <p className="text-xs text-destructive font-mono break-all">{s.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hard restart */}
      <Card className="border-destructive/30">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconPower className="h-5 w-5 text-destructive" />
          <CardTitle className="text-base">Hard Restart</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Gracefully exits the process so the platform relaunches it. Fixes problems that live in the process itself
            (memory leaks, wedged connections, stale code). Carries <span className="text-foreground">brief downtime</span>{" "}
            and a small boot-failure risk — use only when a soft reload isn't enough.
          </p>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={restartInProgress || (status && !status.restartAvailable) || false}
            data-testid="button-hard-restart"
          >
            {restartInProgress ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconPower className="h-4 w-4 mr-1.5" />
            )}
            Hard restart
          </Button>

          {status && !status.restartAvailable && (
            <p className="text-xs text-muted-foreground">Restart is currently unavailable on this server.</p>
          )}

          {phase !== "idle" && (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                phase === "online"
                  ? "border-green-500/30 bg-green-500/5 text-foreground"
                  : phase === "failed"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-border bg-muted/40 text-foreground"
              }`}
              data-testid="status-hard-restart"
            >
              {phase === "restarting" && <IconLoader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />}
              {phase === "online" && <IconCheck className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
              {phase === "failed" && <IconAlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <div className="flex-1">
                <p>{message}</p>
                {phase === "online" && (
                  <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={reset} data-testid="button-restart-dismiss">
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hard restart the server?</AlertDialogTitle>
            <AlertDialogDescription>
              This gracefully exits and relaunches the process. The site will be briefly unavailable while it comes back
              online. If it does not recover, you will need to roll back or redeploy from the platform. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-hard-restart">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => start()}
              data-testid="button-confirm-hard-restart"
            >
              Restart server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
