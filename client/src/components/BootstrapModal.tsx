import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { IconCloudDownload, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useDebugAuth } from "@/hooks/useDebugAuth";

interface BootstrapStatus {
  running: boolean;
  total: number;
  pulled: number;
  errors: string[];
  startedAt: number | null;
  doneAt: number | null;
  success: boolean | null;
  commitSha: string | null;
}

export function BootstrapModal() {
  const { isValidated } = useDebugAuth();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const { data: status } = useQuery<BootstrapStatus>({
    queryKey: ["/api/github/bootstrap-status"],
    enabled: isValidated === true,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 1500;
      if (d.running) return 1000;
      if (d.doneAt && Date.now() - d.doneAt < 8000) return 1000;
      return false;
    },
    staleTime: 0,
  });

  // Auto-dismiss 5s after done
  useEffect(() => {
    if (!status) return;
    if (!status.running && status.doneAt !== null && dismissedAt === null) {
      const timer = setTimeout(() => setDismissedAt(Date.now()), 5000);
      return () => clearTimeout(timer);
    }
  }, [status?.running, status?.doneAt, dismissedAt]);

  // Reset dismissed state whenever a new bootstrap starts
  useEffect(() => {
    if (status?.running) setDismissedAt(null);
  }, [status?.running]);

  if (!isValidated || !status) return null;

  const show =
    status.running ||
    (status.doneAt !== null &&
      dismissedAt === null &&
      Date.now() - status.doneAt < 8000);

  if (!show) return null;

  const pct =
    status.total > 0
      ? Math.round((status.pulled / status.total) * 100)
      : status.running
      ? 0
      : 100;

  const isDone = !status.running && status.doneAt !== null;
  const hasErrors = status.errors.length > 0;

  return (
    <Dialog open modal>
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideClose
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDone ? (
              hasErrors ? (
                <IconAlertTriangle size={18} className="text-destructive shrink-0" />
              ) : (
                <IconCheck size={18} className="text-primary shrink-0" />
              )
            ) : (
              <IconCloudDownload size={18} className="shrink-0 animate-pulse" />
            )}
            {isDone
              ? hasErrors
                ? "Bootstrap completed with errors"
                : "Content downloaded"
              : "Downloading content…"}
          </DialogTitle>
          <DialogDescription>
            {isDone
              ? hasErrors
                ? `${status.pulled} file${status.pulled !== 1 ? "s" : ""} downloaded, ${status.errors.length} failed.`
                : `${status.pulled} file${status.pulled !== 1 ? "s" : ""} downloaded successfully.`
              : status.total > 0
              ? `Fetching files from the content repo — ${status.pulled} of ${status.total} done.`
              : "Connecting to the content repo…"}
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              backgroundColor: isDone && hasErrors
                ? "hsl(var(--destructive))"
                : "hsl(var(--primary))",
            }}
          />
        </div>

        {status.total > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {status.pulled} / {status.total} files
          </p>
        )}

        {isDone && hasErrors && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 space-y-1 max-h-28 overflow-y-auto">
            {status.errors.slice(0, 5).map((e, i) => (
              <p key={i} className="text-xs font-mono text-destructive break-all">{e}</p>
            ))}
            {status.errors.length > 5 && (
              <p className="text-xs text-muted-foreground">…and {status.errors.length - 5} more</p>
            )}
          </div>
        )}

        {isDone && !hasErrors && (
          <p className="text-xs text-muted-foreground text-center">
            This window will close automatically.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
