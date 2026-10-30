import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCw, ShieldOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import type { LeadsDeliverySummary } from "@shared/leads-query";

/**
 * Leads page banners: recovery off (no encryption key), leads that haven't reached the CRM
 * (with Retry all failed), and the progress of the latest bulk retry.
 */
export function LeadsDeliveryBanners({
  delivery,
  viewQs,
  onChanged,
  onShowFailed,
}: {
  delivery?: LeadsDeliverySummary;
  /** Current range / show / filters, so Retry all failed acts on what staff are looking at. */
  viewQs: string;
  onChanged: () => void;
  onShowFailed: () => void;
}) {
  const { toast } = useToast();
  const retryAll = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/ads/leads/retry-failed${viewQs ? `?${viewQs}` : ""}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; queued?: number } | null;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body?.queued ?? 0;
    },
    onSuccess: (queued) => {
      toast({
        title: queued > 0 ? `${queued.toLocaleString()} lead${queued === 1 ? "" : "s"} queued` : "Nothing to retry",
        description: queued > 0 ? "They go out a few at a time over the next minutes." : undefined,
      });
      onChanged();
    },
    onError: (err: Error) => toast({ title: "Could not retry", description: err.message, variant: "destructive" }),
  });

  if (!delivery) return null;
  const failedTests = delivery.retryable_count - delivery.needs_attention_count;
  const showFailed = delivery.needs_attention_count > 0 || delivery.retryable_count > 0;
  const bulk = delivery.bulk;

  return (
    <div className="space-y-2">
      {delivery.key_status === "missing" && (
        <Alert variant="destructive" data-testid="banner-leads-recovery-off">
          <ShieldOff className="h-4 w-4" />
          <AlertTitle>Recovery is off: the lead encryption key is not set on this server.</AlertTitle>
          <AlertDescription className="text-xs">
            Leads are still sent to your CRM, but if the CRM is down they are not saved for a retry. Ask a developer to set{" "}
            <code>LEAD_OUTBOX_ENCRYPTION_KEY</code>.
          </AlertDescription>
        </Alert>
      )}

      {showFailed && (
        <Alert className="border-status-away/50" data-testid="banner-leads-needs-attention">
          <AlertTriangle className="h-4 w-4 !text-status-away" />
          <AlertTitle>
            {delivery.needs_attention_count > 0
              ? `${delivery.needs_attention_count.toLocaleString()} lead${delivery.needs_attention_count === 1 ? "" : "s"} haven't reached your CRM.`
              : "Only test leads failed to reach your CRM."}
          </AlertTitle>
          <AlertDescription className="space-y-2 text-xs">
            <p>
              Open a lead to see the CRM&apos;s reply. Fix the webhook in settings if needed, then retry.
              {failedTests > 0 ? ` ${failedTests.toLocaleString()} test lead${failedTests === 1 ? "" : "s"} in this view also failed.` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onShowFailed} data-testid="button-leads-show-failed">
                Show them
              </Button>
              {delivery.can_retry && delivery.live_server && delivery.key_status === "ok" && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={retryAll.isPending}
                  onClick={() => retryAll.mutate()}
                  data-testid="button-leads-retry-all"
                >
                  {retryAll.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1.5 h-3 w-3" />}
                  Retry all failed ({delivery.retryable_count.toLocaleString()})
                </Button>
              )}
              {delivery.can_retry && !delivery.live_server && (
                <span className="text-muted-foreground">Retry all failed runs only on the live site. Retry single leads here to test.</span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {bulk && (
        <p className="text-xs text-muted-foreground" data-testid="text-leads-bulk-progress">
          Retry all failed: {bulk.queued.toLocaleString()} queued, {bulk.delivered.toLocaleString()} delivered
          {bulk.remaining > 0 ? `, ${bulk.remaining.toLocaleString()} still waiting (a few go out every 30 seconds).` : "."}
        </p>
      )}
    </div>
  );
}
