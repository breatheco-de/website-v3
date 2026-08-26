import { useState } from "react";
import { IconLoader2, IconRefresh, IconRotateClockwise } from "@tabler/icons-react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import {
  useSidequestDiagnostics,
  useSidequestLogs,
  useSidequestRestart,
  type SidequestDerivedHealth,
} from "@/hooks/useSidequestDiagnostics";

const HEALTH_LABEL: Record<SidequestDerivedHealth, string> = {
  stopped: "Stopped",
  running: "Running",
  running_idle: "Running (idle)",
  running_stuck: "Running (stuck?)",
};

type SidequestDiagnosticsPanelProps = {
  site?: string;
  compact?: boolean;
  onRecheck?: () => void;
  rechecking?: boolean;
  recheckMessage?: string | null;
};

export function SidequestDiagnosticsPanel({
  site,
  compact = false,
  onRecheck,
  rechecking = false,
  recheckMessage,
}: SidequestDiagnosticsPanelProps) {
  const { roles } = useDebugAuth();
  const canRestart = roles.includes("webmaster");
  const { data, isLoading, refetch, isFetching } = useSidequestDiagnostics(site);
  const [logsOpen, setLogsOpen] = useState(false);
  const { data: logs, refetch: refetchLogs, isFetching: logsFetching } = useSidequestLogs(logsOpen);
  const { phase, message, start, reset } = useSidequestRestart(site);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const health = data?.derivedHealth ?? "stopped";
  const showActions = health === "stopped" || health === "running_stuck";

  return (
    <div className={cn("space-y-2", compact && "text-xs")} data-testid="sidequest-diagnostics-panel">
      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1">
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          Loading diagnostics…
        </p>
      ) : data ? (
        <>
          <p className="text-muted-foreground leading-relaxed">{data.summary}</p>
          <dl className={cn("grid gap-1 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
            <div className="flex gap-2">
              <dt className="shrink-0">Health:</dt>
              <dd className={health === "running_stuck" ? "text-amber-400" : health === "stopped" ? "text-red-400" : "text-emerald-400"}>
                {HEALTH_LABEL[health]}
              </dd>
            </div>
            {data.heartbeat.payload?.currentJob ? (
              <div className="flex gap-2">
                <dt className="shrink-0">Current job:</dt>
                <dd>{data.heartbeat.payload.currentJob}</dd>
              </div>
            ) : null}
            {data.restart.mechanism === "systemd-flag" && !data.restart.pathUnitDetected ? (
              <div className="text-amber-400/90 col-span-full">
                Restart flag works only when website-sidequest-restart.path is enabled on the VPS (see docs/vps.md).
              </div>
            ) : null}
          </dl>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {onRecheck ? (
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7", compact && "text-[11px]")}
            onClick={onRecheck}
            disabled={rechecking}
            data-testid="button-recheck-sidequest"
          >
            {rechecking ? (
              <>
                <IconLoader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Checking…
              </>
            ) : (
              "Check again"
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7", compact && "text-[11px]")}
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="button-refresh-sidequest-diagnostics"
          >
            {isFetching ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconRefresh className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        {showActions && canRestart ? (
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7", compact && "text-[11px]")}
            onClick={() => setConfirmOpen(true)}
            disabled={phase === "restarting"}
            data-testid="button-restart-sidequest"
          >
            {phase === "restarting" ? (
              <>
                <IconLoader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Restarting…
              </>
            ) : (
              <>
                <IconRotateClockwise className="h-3.5 w-3.5 mr-1" />
                Restart Sidequest
              </>
            )}
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7", compact && "text-[11px]")}
          onClick={() => {
            setLogsOpen(true);
            void refetchLogs();
          }}
          data-testid="button-sidequest-logs"
        >
          {logsFetching ? "Loading logs…" : "View logs"}
        </Button>
      </div>

      {recheckMessage ? (
        <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{recheckMessage}</p>
      ) : null}

      {phase !== "idle" ? (
        <p
          className={cn(
            compact ? "text-[11px]" : "text-xs",
            phase === "failed" ? "text-destructive" : phase === "online" ? "text-emerald-400" : "text-muted-foreground",
          )}
          data-testid="sidequest-restart-status"
        >
          {message}
          {phase === "online" ? (
            <Button variant="ghost" size="sm" className="ml-2 h-6 px-2" onClick={reset}>
              Dismiss
            </Button>
          ) : null}
        </p>
      ) : null}

      {logsOpen ? (
        <div className="rounded-md border border-border bg-muted/30 p-2 max-h-48 overflow-y-auto">
          {logs?.hint && logs.lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">{logs.hint}</p>
          ) : (
            <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all font-mono text-muted-foreground">
              {(logs?.lines ?? []).join("\n") || "No log lines yet."}
            </pre>
          )}
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Sidequest?</AlertDialogTitle>
            <AlertDialogDescription>
              Restarts the background job worker only (index refresh and validation). Content saves keep working.
              On production this writes a flag file for systemd to pick up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void start();
              }}
            >
              Restart Sidequest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
