import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconThumbDown, IconThumbDownFilled, IconThumbUp, IconThumbUpFilled } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";

type ApprovalState = "approved" | "implicit" | "rejected" | "stale" | "none";

interface LayoutApprovalResponse {
  key: string;
  layout_owner: "entry" | "shared_template";
  fingerprint: string;
  section_count: number;
  review: { status: "approved" | "rejected"; fingerprint: string; by: string; at: string } | null;
  approval: { state: ApprovalState; factor: number; by?: string; at?: string; stable_since?: string };
  file: string;
  shared_with_entries?: boolean;
}

const STATE_LABEL: Record<ApprovalState, string> = {
  approved: "Approved reference",
  implicit: "Trusted (unchanged 30+ days)",
  rejected: "Marked as not a good example",
  stale: "Approval paused — layout changed",
  none: "Not reviewed",
};

export function LayoutApprovalControl({ contentType, slug }: { contentType: string; slug: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState<null | "approved" | "rejected" | "clear">(null);
  const queryKey = ["/api/private/component-insights/layout-approval", contentType, slug];

  const query = useQuery<LayoutApprovalResponse | null>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ contentType, slug });
      const res = await apiFetch(`/api/private/component-insights/layout-approval?${params}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load layout approval");
      return (await res.json()) as LayoutApprovalResponse;
    },
  });

  const data = query.data;
  if (query.isSuccess && !data) return null;

  const save = async (status: "approved" | "rejected" | null) => {
    setSaving(status ?? "clear");
    try {
      const res = await apiFetch("/api/private/component-insights/layout-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, slug, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Save failed");
      qc.setQueryData(queryKey, json);
      toast({
        title: status === "approved" ? "Layout approved" : status === "rejected" ? "Marked as not a good example" : "Approval cleared",
        description: "Agents will see the change after the next insights rebuild (within a minute).",
      });
    } catch (err) {
      toast({ title: "Could not save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const state = data?.approval.state ?? "none";
  const approved = state === "approved" || state === "implicit";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title={`Design reference · ${STATE_LABEL[state]}`}
          aria-label={`Design reference: ${STATE_LABEL[state]}`}
          data-testid="button-layout-approval"
        >
          {query.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : state === "rejected" ? (
            <IconThumbDownFilled className="h-3.5 w-3.5 text-status-busy" />
          ) : state === "approved" ? (
            <IconThumbUpFilled className="h-3.5 w-3.5 text-status-online" />
          ) : (
            <IconThumbUp
              className={`h-3.5 w-3.5 ${
                approved ? "text-status-online" : state === "stale" ? "text-status-away" : ""
              }`}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-xs space-y-3 z-[10001]" data-testid="popover-layout-approval">
        <div className="space-y-1">
          <p className="font-medium text-sm text-foreground">Use this layout as a design reference?</p>
          <p className="text-muted-foreground leading-snug">
            Approved layouts teach agents how pages should look. Editing sections later pauses the approval until you
            re-approve.
          </p>
          {data?.shared_with_entries && (
            <p className="text-muted-foreground leading-snug">
              This page uses the shared template, so you are judging the template layout for every page that uses it.
            </p>
          )}
        </div>

        {data && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-layout-approval-state">
              {STATE_LABEL[state]}
            </Badge>
            {data.approval.by && (state === "approved" || state === "rejected" || state === "stale") && (
              <span className="text-muted-foreground truncate">by {data.approval.by}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs border-status-online/40 bg-status-online/15 text-status-online"
            disabled={!!saving || state === "approved"}
            onClick={() => void save("approved")}
            data-testid="button-layout-approve"
          >
            {saving === "approved" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconThumbUp className="h-3.5 w-3.5" aria-hidden />
            )}
            Approve layout
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs border-status-busy/40 bg-status-busy/15 text-status-busy"
            disabled={!!saving || state === "rejected"}
            onClick={() => void save("rejected")}
            data-testid="button-layout-reject"
          >
            {saving === "rejected" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconThumbDown className="h-3.5 w-3.5" aria-hidden />
            )}
            Not good
          </Button>
          {data?.review && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={!!saving}
              onClick={() => void save(null)}
              data-testid="button-layout-clear"
            >
              Clear
            </Button>
          )}
        </div>

        <button
          type="button"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setAdvanced((v) => !v)}
          data-testid="button-layout-approval-advanced"
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced && data && (
          <div className="space-y-1.5 text-muted-foreground leading-snug" data-testid="text-layout-approval-advanced">
            <p>
              The approval is saved as <code className="font-mono">insights_review</code> in{" "}
              <code className="font-mono break-all">{data.file}</code> with the layout fingerprint{" "}
              <code className="font-mono">{data.fingerprint}</code> (section order, component, variant, background).
              Copy edits keep it; structural edits pause it.
            </p>
            <p>
              Weight in component insights: approved ×2, trusted (staff-published, unchanged 30 days) ×1.2, not a good
              example ×0 (ignored). It multiplies with performance vs expected (GA4, last 90 days), relevance, locale,
              and <code className="font-mono">insights_weight</code>. Current approval factor: ×{data.approval.factor}.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
