import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RowArchiveView } from "@shared/evidence-archive";

export const ARCHIVE_COLUMN_HELP =
  "We save a copy of each source link on the Internet Archive, so the proof survives if the article is removed. Visitors still see the original link.";

const ORIGINAL_GONE_HELP =
  "The original article no longer loads. The archived copy is still available; update the public link if you want.";

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Databases page cell: Internet Archive copy of an evidence row's source link. */
export function EvidenceArchiveCell({
  view,
  dbName,
  storedIndex,
  canEdit,
  onChanged,
  testId,
}: {
  view: RowArchiveView | null;
  dbName: string;
  /** Stored row position for `/items/:index/*`. */
  storedIndex: number;
  canEdit: boolean;
  onChanged: () => void | Promise<unknown>;
  testId: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [backupUrl, setBackupUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);

  if (!view || view.status === "none") {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }

  const call = async (path: string, init: RequestInit, success: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/databases/${dbName}/items/${storedIndex}/${path}`, init);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Request failed");
      }
      await onChanged();
      toast({ title: success });
      return true;
    } catch (err) {
      toast({
        title: "Archive copy not updated",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const archiveNow = () => void call("archive", { method: "POST" }, "Archiving started");
  const openDialog = () => {
    setBackupUrl("");
    setAdvanced(false);
    setDialogOpen(true);
  };

  const goneBadge = view.original_gone ? (
    <Badge variant="outline" className="font-normal text-[10px]" title={ORIGINAL_GONE_HELP} data-testid={`badge-original-gone-${testId}`}>
      Original gone
    </Badge>
  ) : null;

  let body: ReactNode;
  if (view.status === "archived") {
    const date = shortDate(view.captured_at);
    body = (
      <div className="flex items-center gap-1.5">
        <a
          href={view.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-primary hover:underline"
          title={view.manual ? "Backup copy pasted by staff" : "Internet Archive copy"}
          data-testid={`link-archive-copy-${testId}`}
        >
          View copy
        </a>
        {date ? <span className="text-[10px] text-muted-foreground">{date}</span> : null}
        {view.manual ? <span className="text-[10px] text-muted-foreground">(backup)</span> : null}
        {goneBadge}
      </div>
    );
  } else if (view.status === "pending") {
    body = (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground" data-testid={`text-archiving-${testId}`}>
          Archiving…
        </span>
        {goneBadge}
      </div>
    );
  } else if (view.status === "failed") {
    body = (
      <div className="flex items-center gap-1.5">
        <Badge
          variant="outline"
          className="font-normal text-[10px] text-destructive border-destructive/40"
          title={view.error ?? "archive.org could not save this page."}
          data-testid={`badge-archive-failed-${testId}`}
        >
          Archive failed
        </Badge>
        {canEdit ? (
          <>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={archiveNow} data-testid={`button-archive-retry-${testId}`}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={busy} onClick={openDialog} data-testid={`button-archive-paste-${testId}`}>
              Paste backup link
            </Button>
          </>
        ) : null}
        {goneBadge}
      </div>
    );
  } else {
    body = (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Not archived</span>
        {canEdit ? (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={archiveNow} data-testid={`button-archive-now-${testId}`}>
            {busy ? "Starting…" : "Archive now"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {body}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-archive-backup-link">
          <DialogHeader>
            <DialogTitle>Paste a backup copy</DialogTitle>
            <DialogDescription className="text-left">
              archive.org couldn&apos;t save this page. Paste a link to a saved copy from another archive. This only
              changes the proof copy; the public link stays the same.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`archive-backup-${testId}`}>Saved copy link</Label>
            <Input
              id={`archive-backup-${testId}`}
              value={backupUrl}
              onChange={(e) => setBackupUrl(e.target.value)}
              placeholder="https://archive.ph/…"
              data-testid="input-archive-backup-link"
            />
          </div>
          <button
            type="button"
            className="text-xs text-primary hover:underline text-left"
            onClick={() => setAdvanced((v) => !v)}
            data-testid="button-archive-advanced"
          >
            {advanced ? "Hide advanced" : "Read more (advanced)"}
          </button>
          {advanced ? (
            <div className="space-y-1.5 border-t pt-2 text-xs leading-5 text-muted-foreground">
              <p>
                The copy is stored on this row as a hidden <span className="font-mono">_archive</span> record in{" "}
                <span className="font-mono">db/{dbName}/</span>. It never reaches pages, listings or agents, and
                pasted links are never replaced automatically.
              </p>
              <p>
                Only the live server talks to archive.org. It archives a link when the row is saved, and a weekly
                check retries failures older than a week and flags originals that return 404 or 410. Saving new
                pages needs <span className="font-mono">ARCHIVE_ORG_ACCESS_KEY</span> and{" "}
                <span className="font-mono">ARCHIVE_ORG_SECRET_KEY</span> on the server.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !backupUrl.trim()}
              onClick={async () => {
                const ok = await call(
                  "archive-link",
                  {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: backupUrl.trim() }),
                  },
                  "Backup copy saved",
                );
                if (ok) setDialogOpen(false);
              }}
              data-testid="button-save-archive-backup-link"
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
