import { useState } from "react";
import { IconLoader2, IconRefresh, IconRotateClockwise, IconTerminal2 } from "@tabler/icons-react";
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

const IS_DEV = import.meta.env.DEV;

type SidequestDiagnosticsPanelProps = {
  site?: string;
  compact?: boolean;
  onRecheck?: () => void;
  rechecking?: boolean;
  recheckMessage?: string | null;
};

function DevSidequestInstructions({
  compact,
  onRefresh,
  refreshing,
}: {
  compact: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-muted/40 space-y-2",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
      )}
      data-testid="sidequest-dev-instructions"
    >
      <p
        className={cn(
          "text-muted-foreground leading-relaxed flex items-start gap-2",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        <IconTerminal2 className={cn("shrink-0 mt-0.5", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        <span>
          Locally, the job queue runs in a <strong className="text-foreground font-medium">separate process</strong> —{" "}
          <code className="text-[0.95em]">npm run dev</code> only enqueues work. Open another terminal in the repo
          root and start Sidequest:
        </span>
      </p>
      <pre
        className={cn(
          "rounded border border-border bg-background px-2.5 py-2 font-mono text-foreground overflow-x-auto",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        npm run sidequest
      </pre>
      <p className={cn("text-muted-foreground leading-relaxed", compact ? "text-[11px]" : "text-xs")}>
        Leave that process running while you develop. Index refresh and on-save validation will resume once it is
        up.
      </p>
      <Button
        variant="outline"
        size="sm"
        className={cn("h-7", compact && "text-[11px]")}
        onClick={onRefresh}
        disabled={refreshing}
        data-testid="button-recheck-sidequest"
      >
        {refreshing ? (
          <>
            <IconLoader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            Checking…
          </>
        ) : (
          <>
            <IconRefresh className="h-3.5 w-3.5 mr-1" />
            Refresh status
          </>
        )}
      </Button>
    </div>
  );
}

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
  const refreshing = onRecheck ? rechecking : isFetching;

  const handleRefresh = () => {
    if (onRecheck) onRecheck();
    else void refetch();
  };

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
            {!IS_DEV && data.restart.mechanism === "systemd-flag" && !data.restart.pathUnitDetected ? (
              <div className="text-amber-400/90 col-span-full">
                Restart flag works only when website-sidequest-restart.path is enabled on the VPS (see docs/vps.md).
              </div>
            ) : null}
          </dl>
        </>
      ) : null}

      {IS_DEV && showActions ? (
        <DevSidequestInstructions
          compact={compact}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      ) : (
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
      )}

      {recheckMessage ? (
        <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{recheckMessage}</p>
      ) : null}

      {!IS_DEV && phase !== "idle" ? (
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

      {!IS_DEV && logsOpen ? (
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

      {!IS_DEV ? (
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
      ) : null}
    </div>
  );
}
