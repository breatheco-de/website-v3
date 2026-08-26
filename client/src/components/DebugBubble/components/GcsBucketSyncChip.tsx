import { Cloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { gcsStatusLabel, useGcsSyncStatus } from "@/hooks/useGcsSyncStatus";

export interface GcsBucketSyncChipProps {
  className?: string;
  enabled?: boolean;
  onNavigate: () => void;
}

function statusClassName(status: string): string {
  switch (status) {
    case "active":
      return "text-chart-3";
    case "local_dev":
      return "text-muted-foreground";
    case "syncing":
      return "text-primary";
    case "migration_required":
      return "text-amber-600 dark:text-amber-400";
    case "unavailable":
      return "text-muted-foreground";
    case "error":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function GcsBucketSyncChip({ className, enabled = true, onNavigate }: GcsBucketSyncChipProps) {
  const { data, isLoading } = useGcsSyncStatus({ enabled, refetchInterval: 10_000 });
  const status = data?.status ?? (isLoading ? null : "unavailable");
  const isSyncing = status === "syncing";

  return (
    <button
      type="button"
      onClick={onNavigate}
      className={cn(
        "flex items-center justify-between gap-1 min-w-0 px-2 py-2 text-sm hover-elevate text-left w-full",
        className,
      )}
      data-testid="chip-gcs-sync"
      title="Open cloud sync dashboard"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs truncate">Cloud</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : status ? (
          <span className={cn("text-[10px] flex items-center gap-0.5 truncate", statusClassName(status))}>
            {isSyncing && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
            {gcsStatusLabel(status)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">--</span>
        )}
      </div>
    </button>
  );
}
