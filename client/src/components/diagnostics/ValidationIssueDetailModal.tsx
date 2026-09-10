import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLoader2 } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  IssueCard,
  type PageIssue,
} from "@/components/DebugBubble/components/PageErrorsModal";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { apiFetch } from "@/lib/queryClient";
import { minLengthHint } from "@/lib/minLengthHint";

type CacheIssueApiRow = {
  id: string;
  url?: string;
  entryKey?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  lastFullRunAt?: string;
  suggestion?: string;
  file?: string;
  completed?: NonNullable<PageIssue["completed"]>;
  claimed?: NonNullable<PageIssue["claimed"]>;
  attempts?: PageIssue["attempts"];
};

function cacheIssueRowToPageIssue(row: CacheIssueApiRow): PageIssue {
  return {
    id: row.id,
    type: row.severity,
    code: row.code,
    message: row.message,
    category: row.category,
    suggestion: row.suggestion,
    validator: row.validator,
    file: row.file,
    validationCacheBuiltAt: row.lastFullRunAt,
    completed: row.completed ?? null,
    claimed: row.claimed ?? null,
    attempts: row.attempts,
  };
}

export function ValidationIssueDetailModal({
  issueId,
  open,
  onOpenChange,
}: {
  issueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const formatSitePath = useFormatSitePath();
  const [toggling, setToggling] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<PageIssue | null>(null);
  const [releaseReport, setReleaseReport] = useState("");

  const query = useQuery({
    queryKey: ["/api/validation/cache-issues/by-id", issueId],
    enabled: open && Boolean(issueId),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/validation/cache-issues/by-id?issueId=${encodeURIComponent(issueId!)}`,
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        issues?: CacheIssueApiRow[];
      };
      if (res.status === 404) {
        return {
          notFound: true as const,
          message: body.error || "Issue not found",
          issues: [] as CacheIssueApiRow[],
        };
      }
      if (!res.ok) {
        throw new Error(body.error || "Failed to load issue");
      }
      return {
        notFound: false as const,
        message: null as string | null,
        issues: Array.isArray(body.issues) ? body.issues : [],
      };
    },
  });

  const pageIssues = (query.data?.issues ?? []).map(cacheIssueRowToPageIssue);
  const primary = pageIssues[0] ?? null;
  const close = () => onOpenChange(false);

  const handleUpdateIssue = async (
    issue: PageIssue,
    action: "claim" | "release" | "complete" | "uncomplete",
    report?: string,
  ) => {
    if (action === "release") {
      if (report === undefined) {
        setReleaseTarget(issue);
        setReleaseReport("");
        return;
      }
      if (report.trim().length < 80) {
        toast({
          title: "Report too short",
          description: "Say what you tried and why you’re stopping (min 80 characters).",
          variant: "destructive",
        });
        return;
      }
    }
    if (!issue.id) return;
    setToggling(true);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/validation/cache-issues/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          issueId: issue.id,
          action,
          ...(report ? { report } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Update failed");
      }
      setReleaseTarget(null);
      setReleaseReport("");
      await query.refetch();
      void qc.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
    } catch (err) {
      toast({
        title: "Could not update issue",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  };

  const shellClassName =
    primary && !query.isLoading && !query.isError && !query.data?.notFound
      ? "max-w-lg max-h-[85vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none gap-0"
      : "max-w-lg max-h-[85vh] overflow-y-auto";

  const releaseHint = minLengthHint(releaseReport, 80);
  const releaseReportOk = releaseHint.ok;
  const releasePending = Boolean(releaseTarget);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          hideClose={Boolean(
            primary && !query.isLoading && !query.isError && !query.data?.notFound,
          )}
          className={shellClassName}
          data-testid="dialog-validation-issue-detail"
        >
          <DialogTitle className="sr-only">
            {primary?.code || issueId || "Validation issue"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Details for linked validation issue
          </DialogDescription>

          {query.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading issue…
            </div>
          ) : query.isError ? (
            <p className="text-sm text-destructive py-4">
              {query.error instanceof Error ? query.error.message : "Failed to load issue"}
            </p>
          ) : query.data?.notFound ? (
            <div className="space-y-2 py-2 text-sm" data-testid="text-issue-not-found">
              <p className="text-muted-foreground">{query.data.message}</p>
              <p className="font-mono text-xs break-all text-foreground/80">{issueId}</p>
            </div>
          ) : primary ? (
            <div className="space-y-2">
              {pageIssues.map((issue, index) => (
                <IssueCard
                  key={`${issue.id}-${issue.file ?? index}-${index}`}
                  issue={issue}
                  index={index}
                  variant={issue.type === "warning" ? "warning" : "error"}
                  formatSitePath={formatSitePath}
                  onUpdateIssue={handleUpdateIssue}
                  togglePending={toggling || releasePending}
                  showSeverityBadge
                  forceExpanded
                  onClose={index === 0 ? close : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No issue data returned.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={releasePending}
        onOpenChange={(next) => {
          if (!next) {
            setReleaseTarget(null);
            setReleaseReport("");
          }
        }}
      >
        <DialogContent className="max-w-md z-[10001]" overlayClassName="z-[10001]">
          <DialogHeader>
            <DialogTitle>Release claim</DialogTitle>
            <DialogDescription>
              Briefly say what you tried and why you’re stopping (min 80 characters). Release stays
              disabled until the report is long enough.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="proposal-issue-release-report">Report</Label>
            <Textarea
              id="proposal-issue-release-report"
              value={releaseReport}
              onChange={(e) => setReleaseReport(e.target.value)}
              rows={4}
              placeholder="Tried X… still failing because Y…"
              data-testid="input-issue-release-report"
            />
            <p className={releaseHint.className} data-testid="text-issue-release-report-count">
              {releaseHint.text}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReleaseTarget(null);
                setReleaseReport("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!releaseReportOk || toggling || !releaseTarget}
              title={
                releaseReportOk
                  ? undefined
                  : `Need ${80 - releaseReport.trim().length} more characters`
              }
              onClick={() => {
                if (!releaseTarget || !releaseReportOk) return;
                void handleUpdateIssue(releaseTarget, "release", releaseReport.trim());
              }}
              data-testid="button-confirm-issue-release"
            >
              Release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
