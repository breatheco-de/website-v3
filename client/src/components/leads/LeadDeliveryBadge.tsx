import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LEAD_DELIVERY_STATUS_LABELS, type LeadDeliveryStatus } from "@shared/leads-query";

const TONE: Record<LeadDeliveryStatus, string> = {
  delivered: "border-status-online/40 text-status-online",
  retrying: "border-status-away/40 text-status-away",
  needs_attention: "border-destructive/50 text-destructive",
  gave_up: "border-destructive/50 text-destructive",
  superseded: "border-muted-foreground/30 text-muted-foreground",
  expired: "border-muted-foreground/30 text-muted-foreground",
  not_sent_no_webhook: "border-muted-foreground/30 text-muted-foreground",
};

const TITLES: Record<LeadDeliveryStatus, string> = {
  delivered: "The CRM accepted this lead.",
  retrying: "The CRM could not be reached yet. It will be retried automatically.",
  needs_attention: "The CRM rejected this lead or the webhook is misconfigured. Open the details to see why and retry.",
  gave_up: "Automatic retries stopped. Open the details to retry.",
  superseded: "The same visitor sent this form again and that lead was delivered.",
  expired: "Not delivered within 30 days. The saved copy was erased.",
  not_sent_no_webhook: "No lead webhook was configured when this lead was sent.",
};

/** CRM delivery status for one lead; null = recorded before delivery tracking. */
export function LeadDeliveryBadge({
  status,
  className,
  testId,
}: {
  status: LeadDeliveryStatus | null | undefined;
  className?: string;
  testId?: string;
}) {
  if (!status) {
    return (
      <span className="text-[11px] text-muted-foreground" title="Recorded before delivery tracking started." data-testid={testId}>
        Not tracked
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("px-1.5 py-0 text-[10px] font-normal whitespace-nowrap", TONE[status], className)}
      title={TITLES[status]}
      data-testid={testId}
    >
      {LEAD_DELIVERY_STATUS_LABELS[status]}
    </Badge>
  );
}
