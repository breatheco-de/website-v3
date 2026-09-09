import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useSystemAlerts, type SystemAlert } from "@/hooks/useSystemAlerts";
import { SidequestDiagnosticsPanel } from "@/components/pipeline/SidequestDiagnosticsPanel";
import { cn } from "@/lib/utils";

const SIDEQUEST_ALERT_CODES = new Set<SystemAlert["code"]>(["sidequest_engine_down", "sidequest_engine_stuck"]);

function alertVariantClasses(severity: SystemAlert["severity"]): string {
  if (severity === "warning") {
    return "bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-800";
  }
  return "bg-destructive/10 border-destructive/20";
}

function alertIconClasses(severity: SystemAlert["severity"]): string {
  if (severity === "warning") {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-destructive";
}

function alertTitleClasses(severity: SystemAlert["severity"]): string {
  if (severity === "warning") {
    return "text-amber-800 dark:text-amber-200";
  }
  return "text-foreground";
}

function alertMessageClasses(severity: SystemAlert["severity"]): string {
  if (severity === "warning") {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-muted-foreground";
}

const DATABASE_ALERT_CODES = new Set<SystemAlert["code"]>([
  "database_auth_env_missing",
  "database_auth_failed",
  "database_fetch_failed",
]);

export function SystemAlertItem({
  alert,
  compact = false,
  defaultExpanded = false,
  onRecheckGcs,
  recheckingGcs = false,
  recheckMessage,
  onRecheckDatabase,
  recheckingDatabase = false,
  databaseRecheckMessage,
  onRecheckSidequest,
  recheckingSidequest = false,
  sidequestRecheckMessage,
}: {
  alert: SystemAlert;
  compact?: boolean;
  defaultExpanded?: boolean;
  onRecheckGcs?: () => void;
  recheckingGcs?: boolean;
  recheckMessage?: string | null;
  onRecheckDatabase?: () => void;
  recheckingDatabase?: boolean;
  databaseRecheckMessage?: string | null;
  onRecheckSidequest?: () => void;
  recheckingSidequest?: boolean;
  sidequestRecheckMessage?: string | null;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const showGcsRecheck = alert.code === "gcs_migration_required" && onRecheckGcs;
  const showDbRecheck = DATABASE_ALERT_CODES.has(alert.code) && !!onRecheckDatabase;
  const showSidequestPanel = SIDEQUEST_ALERT_CODES.has(alert.code) && !!onRecheckSidequest;

  return (
    <div className={cn("flex items-start gap-3", compact && "gap-2")} data-testid={`system-alert-${alert.id}`}>
      <div
        className={cn(
          "p-1.5 rounded-full flex-shrink-0",
          alert.severity === "warning" ? "bg-amber-200/60 dark:bg-amber-800/40" : "bg-destructive/20",
        )}
      >
        <AlertTriangle className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", alertIconClasses(alert.severity))} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("flex-1 min-w-0 truncate", compact ? "text-xs" : "text-sm", "font-medium", alertTitleClasses(alert.severity))}>
            {alert.title}
            {alert.site ? (
              <span className="font-normal text-muted-foreground"> ({alert.site})</span>
            ) : null}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 flex-shrink-0 text-muted-foreground",
              compact ? "text-[11px]" : "text-xs",
            )}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-testid={`button-toggle-system-alert-${alert.id}`}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 mr-1" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                Expand
              </>
            )}
          </Button>
        </div>
        {expanded ? (
          <>
            <p className={cn(compact ? "text-[11px]" : "text-xs", "mt-0.5 break-words", alertMessageClasses(alert.severity))}>
              {alert.message}
            </p>
            {recheckMessage && showGcsRecheck ? (
              <p className={cn(compact ? "text-[11px]" : "text-xs", "mt-1", alertMessageClasses(alert.severity))}>
                {recheckMessage}
              </p>
            ) : null}
            {databaseRecheckMessage && showDbRecheck ? (
              <p className={cn(compact ? "text-[11px]" : "text-xs", "mt-1", alertMessageClasses(alert.severity))}>
                {databaseRecheckMessage}
              </p>
            ) : null}
            {showSidequestPanel ? (
              <div className="mt-2">
                <SidequestDiagnosticsPanel
                  compact={compact}
                  onRecheck={onRecheckSidequest}
                  rechecking={recheckingSidequest}
                  recheckMessage={sidequestRecheckMessage}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {showGcsRecheck ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("h-7", compact ? "text-[11px]" : "text-xs")}
                  onClick={onRecheckGcs}
                  disabled={recheckingGcs}
                  data-testid="button-recheck-gcs-migration"
                >
                  {recheckingGcs ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    "Re-check migration"
                  )}
                </Button>
              ) : null}
              {showDbRecheck ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("h-7", compact ? "text-[11px]" : "text-xs")}
                  onClick={onRecheckDatabase}
                  disabled={recheckingDatabase}
                  data-testid={`button-recheck-database-${alert.id}`}
                >
                  {recheckingDatabase ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    "Check again"
                  )}
                </Button>
              ) : null}
              {alert.actionHref ? (
                <Link href={alert.actionHref}>
                  <Button
                    variant="link"
                    size="sm"
                    className={cn("h-auto p-0", compact ? "text-[11px]" : "text-xs")}
                    data-testid={`system-alert-action-${alert.id}`}
                  >
                    {alert.actionLabel ?? "View details"}
                  </Button>
                </Link>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SystemAlertsPanel({ compact = false }: { compact?: boolean }) {
  const {
    alerts,
    hasAlerts,
    recheckGcsMigration,
    recheckingGcs,
    recheckMessage,
    recheckDatabase,
    recheckingDbId,
    dbRecheckMessages,
    recheckSidequest,
    recheckingSidequest,
    sidequestRecheckMessage,
  } = useSystemAlerts();
  if (!hasAlerts) return null;

  return (
    <div data-testid="system-alerts-panel">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={cn("p-3 border-b last:border-b-0", alertVariantClasses(alert.severity))}
        >
          <SystemAlertItem
            alert={alert}
            compact={compact}
            onRecheckGcs={alert.code === "gcs_migration_required" ? recheckGcsMigration : undefined}
            recheckingGcs={recheckingGcs}
            recheckMessage={recheckMessage}
            onRecheckDatabase={alert.database ? () => void recheckDatabase(alert) : undefined}
            recheckingDatabase={recheckingDbId === alert.id}
            databaseRecheckMessage={dbRecheckMessages[alert.id] ?? null}
            onRecheckSidequest={
              SIDEQUEST_ALERT_CODES.has(alert.code) ? () => void recheckSidequest() : undefined
            }
            recheckingSidequest={recheckingSidequest}
            sidequestRecheckMessage={sidequestRecheckMessage}
          />
        </div>
      ))}
    </div>
  );
}
