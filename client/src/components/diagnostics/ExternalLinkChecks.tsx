import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Info, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const VERIFY_OK_ISSUE_CODES = new Set(["EXTERNAL_LINK_GONE", "EXTERNAL_LINK_UNREACHABLE"]);

export type ExternalLinkDetails = {
  url: string;
  other_entries_using_url: number;
};

type Coverage = { total: number; checked: number; gone: number; unreachable: number; verified_ok: number };

/** One line under the Global Health status: how much of the site's external links have been checked. */
export function ExternalLinkCoverageLine() {
  const { data } = useQuery<{ external_links: Coverage }>({
    queryKey: ["/api/validation/link-status/coverage"],
    queryFn: async () => {
      const res = await apiFetch("/api/validation/link-status/coverage", { credentials: "include" });
      if (!res.ok) throw new Error(`coverage ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const cov = data?.external_links;
  if (!cov || cov.total === 0) return null;
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div
      className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
      data-testid="text-external-link-coverage"
    >
      <span>
        External links: {fmt(cov.checked)} of {fmt(cov.total)} checked. Dead links are confirmed on a second check a
        few days later.
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            aria-label="Read more (advanced)"
            data-testid="button-external-link-coverage-info"
          >
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
          <p>
            The live server checks external links during diagnostics runs, up to 300 links per run, and rechecks
            each one about once a week. Only clear answers count: &quot;not found&quot; (404/410) or a link that now
            lands on the site&apos;s homepage. Sites that block automated checks are never flagged.
          </p>
          <p>
            Confirmed so far: {fmt(cov.gone)} dead, {fmt(cov.unreachable)} unreachable, {fmt(cov.verified_ok)} marked
            as working. Drafts are not checked.
          </p>
          <p>
            Results are saved in <code>link-status.json</code> in the site content folder (synced to cloud storage on
            production, never committed to the content repo).
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** "This link works": stop flagging this URL on every page that uses it. */
export function ExternalLinkWorksButton({
  issueId,
  link,
  onDone,
}: {
  issueId: string;
  link: ExternalLinkDetails;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const others = link.other_entries_using_url;

  const confirm = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/validation/link-status/verify-ok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ issueId, reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; cleared_issue_ids?: string[] };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const cleared = data.cleared_issue_ids?.length ?? 0;
      toast({
        title: "Link marked as working",
        description:
          cleared > 0
            ? `Cleared ${cleared} warning${cleared === 1 ? "" : "s"} for this link.`
            : "It won't be flagged again on any page that uses it.",
      });
      setDone(true);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/link-status/coverage"] });
      onDone();
    } catch (err) {
      toast({
        title: "Could not mark the link",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <span className="text-[10px] text-chart-2 flex items-center gap-1">
        <CircleCheck className="h-3 w-3" /> marked as working
      </span>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[10px] gap-1 text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid="button-external-link-works"
      >
        <Link2 className="h-3 w-3" /> This link works
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="dialog-external-link-works">
          <DialogHeader>
            <DialogTitle>Mark this link as working?</DialogTitle>
            <DialogDescription>
              It won&apos;t be flagged on any page that uses it
              {others > 0 ? `, including the ${others} other page${others === 1 ? "" : "s"} that link to it` : ""}.
              If every page stops using it, the mark is removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{link.url}</p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What did you check? e.g. Opened it in a browser and it shows the cited report."
              className="min-h-[72px] text-sm"
              data-testid="input-external-link-works-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={saving || reason.trim().length === 0}
              data-testid="button-external-link-works-confirm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Mark as working
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
