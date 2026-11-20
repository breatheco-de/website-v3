import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Info, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";

type ProposeResult = {
  ok: { slug: string; outcome?: string }[];
  failed: { slug: string; error: string; code?: string }[];
  decision_id?: string;
};

export function BulkProposeFunnelDialog({
  open,
  onOpenChange,
  contentType,
  slugs,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  slugs: string[];
  onDone: (result: ProposeResult) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false);
      setPromptOpen(false);
    }
  }, [open]);

  const { data: promptMeta } = useQuery<{
    decision_id: string;
    about: string;
    questions: Record<string, string>;
    suggestion_file: string;
  }>({
    queryKey: ["/api/content-types", contentType, "funnel", "propose-prompt"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/content-types/${contentType}/funnel/propose-prompt`,
      );
      return res.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const handlePropose = async () => {
    if (saving || slugs.length === 0) return;
    setSaving(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/content-types/${contentType}/funnel/propose`,
        { slugs: slugs.slice(0, 40) },
      );
      const json = (await res.json().catch(() => ({}))) as ProposeResult & { error?: string };
      if (!res.ok) {
        onDone({
          ok: [],
          failed: slugs.map((slug) => ({
            slug,
            error: json.error || "Propose failed",
          })),
        });
      } else {
        onDone({
          ok: json.ok ?? [],
          failed: json.failed ?? [],
          decision_id: json.decision_id,
        });
      }
      if ((json.failed ?? []).length === 0) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-bulk-propose-funnel">
        <DialogHeader>
          <DialogTitle>Propose funnel ({slugs.length})</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm text-muted-foreground">
          <p className="text-foreground font-medium flex items-center gap-1.5">
            <Info className="h-4 w-4 shrink-0" />
            Suggest with Jev
          </p>
          <p>
            Suggest funnel for selected pages from each page&apos;s title, hero, and CTAs using Jev.
            Accept writes the live page funnel; Reject or Edit Funnel drops the suggestion. Live stays
            until you Accept.
          </p>
          <p className="text-xs">
            Uses the site decision model (Jev). Up to 40 pages per run. Pages that already match live
            are cleared as already correct.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPromptOpen((v) => !v)}
            data-testid="button-view-propose-prompt"
          >
            {promptOpen ? "Hide prompt" : "View prompt"}
          </Button>
          {promptOpen && (
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap rounded border bg-background p-2 max-h-48 overflow-auto"
              data-testid="text-propose-prompt"
            >
              {JSON.stringify(
                promptMeta ?? {
                  decision_id: "funnel.classify",
                  loading: true,
                },
                null,
                2,
              )}
            </pre>
          )}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground hover:text-foreground/80">
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
              Read more (advanced)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 text-xs space-y-1 font-mono">
              <p>{`{type}/{slug}/_funnel_suggestion.yml`}</p>
              <p>POST /api/content-types/:type/funnel/propose</p>
              <p>Re-run replaces an existing suggestion; push on propose via content sync.</p>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handlePropose()}
            disabled={saving || slugs.length === 0}
            data-testid="button-bulk-propose-funnel-run"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {saving ? "Proposing…" : `Propose for ${Math.min(slugs.length, 40)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
