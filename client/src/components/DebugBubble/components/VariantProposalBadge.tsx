import { useState } from "react";
import { Bot, Unlink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import type { VariantProposalLink } from "../types";

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** "In proposal" chip on a draft row: who owns the draft, link to review, staff unlink. */
export function VariantProposalBadge({
  link,
  unlinkUrl,
  onUnlinked,
  testIdSuffix,
}: {
  link: VariantProposalLink;
  unlinkUrl: string | null;
  onUnlinked: () => void;
  testIdSuffix: string;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showUnlink, setShowUnlink] = useState(false);
  const open = !link.status || link.status === "open" || link.status === "partial";
  const stale = open && !!link.updated_at && Date.now() - link.updated_at > STALE_AFTER_MS;

  const unlink = async () => {
    if (!unlinkUrl) return;
    setBusy(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(unlinkUrl, { method: "POST", headers, body: JSON.stringify({ reason }) });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Could not unlink the draft", variant: "destructive" });
        return;
      }
      toast({ title: "Draft unlinked from the proposal" });
      setShowUnlink(false);
      setReason("");
      onUnlinked();
    } catch {
      toast({ title: "Could not unlink the draft", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex shrink-0" data-testid={`badge-variant-proposal-${testIdSuffix}`}>
          <Badge variant="outline" className="cursor-pointer gap-1 text-[10px] px-1.5 py-0 leading-4 font-normal">
            <Bot className="h-2.5 w-2.5" aria-hidden />
            {open ? "In proposal" : "Proposal closed"}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="end">
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">This draft belongs to a proposal</p>
          {link.updated_at ? (
            <p
              className={`text-xs ${stale ? "text-status-away" : "text-muted-foreground"}`}
              title={new Date(link.updated_at).toLocaleString()}
              data-testid={`text-variant-proposal-updated-${testIdSuffix}`}
            >
              Last updated {formatDistanceToNow(link.updated_at, { addSuffix: true })}
              {stale ? " · may be abandoned" : ""}
            </p>
          ) : null}
        </div>
        <p className="leading-5 text-muted-foreground">
          {link.title ? `"${link.title}"` : `Proposal ${link.id.slice(0, 8)}`}
          {link.proposer_username ? ` by ${link.proposer_username}` : ""}. Edits you make here become part of what
          reviewers approve, and you will count as a co-author (so you cannot approve it yourself).
        </p>
        <div className="flex items-center justify-between gap-3">
          {link.local ? (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={`/private/agents/proposals/${link.id}`} data-testid={`link-variant-proposal-${testIdSuffix}`}>
                <Bot className="h-3.5 w-3.5" aria-hidden />
                Open proposal
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              This proposal isn't in this copy of the data. Download proposals from production to open it.
            </p>
          )}
          {unlinkUrl && !showUnlink ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setShowUnlink(true)}
              data-testid={`button-unlink-proposal-${testIdSuffix}`}
            >
              <Unlink className="h-3.5 w-3.5" aria-hidden />
              Unlink
            </Button>
          ) : null}
        </div>
        {unlinkUrl && showUnlink ? (
          <div className="space-y-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              Unlinking keeps the draft content as it is; the proposal will no longer publish it.
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you unlinking this draft?"
              className="min-h-[60px] text-xs"
              data-testid={`input-unlink-reason-${testIdSuffix}`}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void unlink()}
                data-testid={`button-confirm-unlink-${testIdSuffix}`}
              >
                Unlink draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setShowUnlink(false);
                  setReason("");
                }}
                data-testid={`button-cancel-unlink-${testIdSuffix}`}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
