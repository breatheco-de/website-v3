import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export type SeoReindexResponse = {
  ok: boolean;
  entries: number;
  clusters: number;
  orphans: number;
  warnings: number;
  durationMs: number;
};

export type SeoIndexReindexControlProps = {
  /** default = outline "Re-index" (SEO Geo); compact = icon-only next to conflict UI */
  size?: "default" | "compact";
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  dialogTestId?: string;
  confirmTestId?: string;
  /** Called after a successful rebuild (e.g. invalidate keyword-owners). */
  onSuccess?: (result: SeoReindexResponse) => void;
};

/**
 * Rebuild on-disk seo-index.json from live YAML (POST /api/seo/reindex).
 * Requires seo_settings. Same control as Cluster Map “Re-index”, with a compact variant.
 */
export function SeoIndexReindexControl({
  size = "default",
  disabled = false,
  className,
  "data-testid": dataTestId = "button-cluster-reindex",
  dialogTestId = "dialog-cluster-reindex",
  confirmTestId = "button-cluster-reindex-confirm",
  onSuccess,
}: SeoIndexReindexControlProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const compact = size === "compact";

  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequestWithAuth("POST", "/api/seo/reindex");
      return res.json() as Promise<SeoReindexResponse>;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/seo/overview"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/seo/keyword-owners"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/seo/cluster-entries"] });
      toast({
        title: "SEO index rebuilt",
        description: `${result.entries} entries, ${result.clusters} clusters, ${result.orphans} broken refs — in ${(result.durationMs / 1000).toFixed(1)}s.`,
      });
      onSuccess?.(result);
    },
    onError: (e) => {
      toast({
        title: "Re-index failed",
        description: e instanceof Error ? e.message : "Could not rebuild the SEO index.",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        className={cn(
          compact ? "h-6 w-6 text-muted-foreground hover:text-foreground" : "h-8",
          className,
        )}
        disabled={disabled || reindexMutation.isPending}
        onClick={() => setConfirmOpen(true)}
        data-testid={dataTestId}
        title="Rebuild SEO index from live YAML"
        aria-label="Rebuild SEO index"
      >
        {reindexMutation.isPending ? (
          <Loader2 className={cn("animate-spin", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
        ) : (
          <RefreshCw className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        )}
        {!compact ? "Re-index" : null}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={dialogTestId}>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild the SEO index?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Re-indexing rescans every content YAML file and rebuilds the cached SEO index —
                  cluster memberships, pillar assignments, and main-keyword ownership used for
                  uniqueness checks.
                </p>
                <p>
                  The cache only updates automatically when pages are saved through the app. Edits
                  made outside it (git pulls, scripts, manual file changes) can leave keyword checks
                  out of sync until a rebuild runs.
                </p>
                <p className="text-muted-foreground">
                  It is safe and non-destructive — no content is modified. It usually takes a few
                  seconds, up to about a minute on large sites.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                reindexMutation.mutate();
              }}
              data-testid={confirmTestId}
            >
              Rebuild index
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
