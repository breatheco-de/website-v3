import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Info, Loader2, RotateCw } from "lucide-react";
import JsonViewer from "@/components/editing/JsonViewer";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadDeliveryBadge } from "@/components/leads/LeadDeliveryBadge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import {
  LEAD_DELIVERY_ERROR_LABELS,
  LEAD_DELIVERY_STATUS_LABELS,
  type LeadDeliveryAttemptView,
  type LeadDeliveryView,
  type LeadDetail,
} from "@shared/leads-query";

async function fetchLead(id: string): Promise<LeadDetail> {
  const res = await apiFetch(`/api/ads/leads/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<LeadDetail>;
}

function localTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

const SOURCE_LABELS: Record<string, string> = {
  event: "the conversion event's webhook (settings)",
  global: "the site's lead webhook (settings)",
  env: "the server's default webhook",
  form: "a webhook set on this form",
};

const TRIGGER_LABELS: Record<LeadDeliveryAttemptView["trigger"], string> = {
  submit: "On submit",
  retry: "Automatic retry",
  manual: "Manual retry",
};

function attemptSummary(a: LeadDeliveryAttemptView): string {
  if (a.http_status != null && a.http_status >= 200 && a.http_status < 300) return `Delivered · HTTP ${a.http_status}`;
  if (a.http_status != null) return `HTTP ${a.http_status}`;
  return a.error_kind ? LEAD_DELIVERY_ERROR_LABELS[a.error_kind] : "Failed";
}

function AttemptRow({ attempt }: { attempt: LeadDeliveryAttemptView }) {
  const [open, setOpen] = useState(false);
  const ok = attempt.http_status != null && attempt.http_status >= 200 && attempt.http_status < 300;
  const hasBody = !!attempt.response_body || attempt.response_body_hidden;
  return (
    <li className="rounded-md border border-border p-2 text-xs" data-testid={`row-lead-attempt-${attempt.attempt}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium tabular-nums">#{attempt.attempt}</span>
          <span className={ok ? "text-status-online" : "text-destructive"}>{attemptSummary(attempt)}</span>
          <span className="text-muted-foreground">{TRIGGER_LABELS[attempt.trigger]}</span>
        </div>
        <span className="text-muted-foreground tabular-nums">
          {localTime(attempt.started_at)}
          {attempt.duration_ms != null ? ` · ${attempt.duration_ms.toLocaleString()} ms` : ""}
        </span>
      </div>
      {attempt.error_message && !ok && (
        <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{attempt.error_message}</p>
      )}
      {hasBody && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              data-testid={`button-lead-attempt-reply-${attempt.attempt}`}
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
              CRM reply
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {attempt.response_body_hidden ? (
              <p className="mt-1 text-[11px] italic text-muted-foreground">Reply hidden: requires ads edit permission.</p>
            ) : (
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">
                {attempt.response_body}
              </pre>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}

function DeliverySection({ leadId, delivery }: { leadId: string; delivery: LeadDeliveryView | null | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/ads/leads/${encodeURIComponent(leadId)}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; status?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: (body) => {
      const status = body?.status as keyof typeof LEAD_DELIVERY_STATUS_LABELS | undefined;
      toast({
        title: status === "delivered" ? "Lead delivered" : "Retry sent",
        description: status && status !== "delivered" ? `Status now: ${LEAD_DELIVERY_STATUS_LABELS[status]}.` : undefined,
        variant: status === "delivered" ? undefined : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Could not retry", description: err.message, variant: "destructive" }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/ads/leads"),
      });
    },
  });

  return (
    <section className="space-y-2 rounded-md border border-border p-3" data-testid="section-lead-delivery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Delivery</h3>
          <LeadDeliveryBadge status={delivery?.status ?? null} testId="badge-lead-details-delivery" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Read more (advanced)" data-testid="button-lead-delivery-advanced">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
              <p>
                Outages (timeouts, network errors, HTTP 5xx and 429) are retried automatically after 1 min, 5 min, 30 min, 2 h and 12 h
                (6 tries), then the lead shows <span className="text-foreground">Gave up</span>. A CRM rejection (other 4xx) or a missing
                webhook goes straight to <span className="text-foreground">Needs attention</span>; nothing is retried until someone presses Retry.
                Automatic retries and the <code>lead_delivery_failed</code> event run only on the live server.
              </p>
              <p>
                Every try sends the header <code>Idempotency-Key</code> with the lead ID. The saved copy is encrypted with{" "}
                <code>LEAD_OUTBOX_ENCRYPTION_KEY</code> and erased once delivered, when the visitor&apos;s next submission is delivered
                (superseded), or after 30 days. CRM replies are kept 30 days.
              </p>
              <p>
                Data: pipeline SQLite tables <code>lead_outbox</code> and <code>lead_delivery_attempts</code> (
                <code>server/ads/lead-outbox.ts</code>).
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {delivery && delivery.status !== "delivered" && (
          <Button
            size="sm"
            variant="outline"
            disabled={!delivery.can_retry || retry.isPending}
            title={delivery.retry_blocked_reason ?? "Send the saved copy to the CRM again"}
            onClick={() => retry.mutate()}
            data-testid="button-lead-retry"
          >
            {retry.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}
            Retry
          </Button>
        )}
      </div>

      {!delivery ? (
        <p className="text-xs text-muted-foreground">This lead was recorded before delivery tracking started, so there is no delivery history.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Did this lead reach your CRM? Retry sends the saved copy again with the same lead ID, so the CRM can skip duplicates. Names and
            emails are kept encrypted only until delivery.
          </p>
          <p className="text-xs text-muted-foreground">
            Retries go to the webhook in your current settings. Form-specific webhooks reuse the address saved with the lead.
            {delivery.webhook_source ? ` This lead uses ${SOURCE_LABELS[delivery.webhook_source] ?? delivery.webhook_source}` : ""}
            {delivery.url_host ? ` (${delivery.url_host}).` : delivery.webhook_source ? "." : ""}
          </p>
          {delivery.status === "retrying" && delivery.next_attempt_at && (
            <p className="text-xs" data-testid="text-lead-next-attempt">
              Next automatic try: {localTime(delivery.next_attempt_at)}
            </p>
          )}
          {delivery.status !== "delivered" && delivery.retry_blocked_reason && (
            <p className="text-xs text-muted-foreground" data-testid="text-lead-retry-blocked">
              {delivery.retry_blocked_reason}
            </p>
          )}
          {delivery.attempts_log.length > 0 ? (
            <ol className="space-y-1.5" data-testid="list-lead-attempts">
              {delivery.attempts_log.map((a) => (
                <AttemptRow key={`${a.attempt}-${a.started_at}`} attempt={a} />
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">No delivery attempts recorded.</p>
          )}
        </>
      )}
    </section>
  );
}

export function LeadDetailsDialog({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const lead = useQuery<LeadDetail>({
    queryKey: ["/api/ads/leads/detail", leadId],
    queryFn: () => fetchLead(leadId!),
    enabled: !!leadId,
  });
  const { delivery, ...ledger } = lead.data ?? ({} as LeadDetail);
  const json = lead.data ? JSON.stringify(ledger, null, 2) : "";

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast({ title: "Lead details copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!leadId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-lead-details">
        <DialogHeader>
          <DialogTitle>Lead details</DialogTitle>
          <DialogDescription>
            Everything this site saved about this lead. Names, emails and phone numbers are not shown here; search the lead ID in the CRM
            to see them.
          </DialogDescription>
        </DialogHeader>
        {lead.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : lead.error ? (
          <p className="text-sm text-destructive" data-testid="text-lead-details-error">
            Could not load this lead: {(lead.error as Error).message}
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            {leadId && <DeliverySection leadId={leadId} delivery={delivery} />}
            <div className="rounded-md text-xs" data-testid="text-lead-details-json">
              <JsonViewer
                value={json}
                className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-auto [&_.cm-editor]:!max-h-none"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => void copyJson()} data-testid="button-copy-lead-details">
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy JSON
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
