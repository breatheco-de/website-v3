import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiFetch } from "@/lib/queryClient";

export type BulkDeletePreview = {
  index_ready: boolean;
  index_updated_at: string | null;
  blocked_protected: string[];
  blocked_by_relation: { slug: string; dependents: string[] }[];
  deletable: string[];
  rebuild_hint?: string;
  link_preview_by_slug?: Record<string, { referrers?: { entryKey: string }[] }>;
};

export function BulkDeleteStaticDialog({
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
  onDone: (result: {
    ok: string[];
    failed: { slug: string; error: string }[];
    blockedLeft: string[];
  }) => void;
}) {
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<BulkDeletePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmInput("");
    setPreview(null);
    setLoadError(null);
    setAdvancedOpen(false);
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await apiFetch("/api/content/delete-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType, slugs, confirm: false }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error || "Failed to load delete preview");
          return;
        }
        setPreview(data.preview as BulkDeletePreview);
      } catch {
        if (!cancelled) setLoadError("Connection error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contentType, slugs]);

  const confirmOk =
    confirmInput === "DELETE" || confirmInput.toLowerCase() === contentType.toLowerCase();
  const canDelete =
    !!preview?.index_ready && (preview.deletable?.length ?? 0) > 0 && confirmOk && !deleting;

  const handleConfirm = async () => {
    if (!canDelete || !preview) return;
    setDeleting(true);
    try {
      const res = await apiFetch("/api/content/delete-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType,
          slugs: preview.deletable,
          confirm: true,
        }),
      });
      const data = await res.json();
      if (res.status === 503 || data.code === "relation_index_not_ready") {
        setLoadError(data.error || preview.rebuild_hint || "Relation index not ready");
        setPreview((p) => (p ? { ...p, index_ready: false } : p));
        return;
      }
      const results = Array.isArray(data.results) ? data.results : [];
      const ok = results.filter((r: { ok?: boolean }) => r.ok).map((r: { slug: string }) => r.slug);
      const failed = results
        .filter((r: { ok?: boolean }) => !r.ok)
        .map((r: { slug: string; error?: string }) => ({
          slug: r.slug,
          error: r.error || "Failed",
        }));
      const blockedLeft = [
        ...(preview.blocked_protected || []),
        ...(preview.blocked_by_relation || []).map((b) => b.slug),
      ];
      onDone({ ok, failed, blockedLeft });
      onOpenChange(false);
    } catch {
      setLoadError("Connection error during delete");
    } finally {
      setDeleting(false);
    }
  };

  const linkWarningCount = preview
    ? Object.values(preview.link_preview_by_slug || {}).filter(
        (p) => (p.referrers?.length ?? 0) > 0,
      ).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-bulk-delete-static">
        <DialogHeader>
          <DialogTitle>Delete {slugs.length} entries</DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Checking relations…</p>}
        {loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {preview && !preview.index_ready && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              Relation index isn’t ready
            </p>
            <p className="text-muted-foreground">
              {preview.rebuild_hint ||
                "It normally rebuilds when site validation runs the site-relation-index check — try again after that."}
            </p>
          </div>
        )}

        {preview?.index_ready && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-muted-foreground">
              <p className="text-foreground font-medium flex items-center gap-1.5">
                <Info className="h-4 w-4 shrink-0" />
                What will happen
              </p>
              <p>
                <strong className="text-foreground">{preview.deletable.length}</strong> will be
                deleted.{" "}
                <strong className="text-foreground">
                  {(preview.blocked_by_relation?.length ?? 0) +
                    (preview.blocked_protected?.length ?? 0)}
                </strong>{" "}
                are still used by other content (or protected) — remove those relations first, then
                delete them one by one.
              </p>
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground">
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                  Read more (advanced)
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs font-mono space-y-1">
                  <p>relation-index.json · link-index.json</p>
                  <p>POST /api/content/delete-entries</p>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {preview.deletable.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Will delete
                </p>
                <ul className="max-h-28 overflow-y-auto text-xs font-mono border rounded-md p-2 space-y-0.5">
                  {preview.deletable.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {(preview.blocked_by_relation.length > 0 || preview.blocked_protected.length > 0) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Blocked — handle manually
                </p>
                <ul className="max-h-32 overflow-y-auto text-xs border rounded-md p-2 space-y-1">
                  {preview.blocked_protected.map((s) => (
                    <li key={`p-${s}`}>
                      <span className="font-mono">{s}</span> — protected
                    </li>
                  ))}
                  {preview.blocked_by_relation.map((b) => (
                    <li key={b.slug}>
                      <span className="font-mono">{b.slug}</span> — used by{" "}
                      {b.dependents.slice(0, 3).join(", ")}
                      {b.dependents.length > 3 ? ` +${b.dependents.length - 3}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {linkWarningCount > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {linkWarningCount} selected page(s) have internal links pointing at them (warning
                only — not a hard block).
              </p>
            )}

            {preview.deletable.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-delete-confirm">
                  Type DELETE or {contentType} to confirm
                </Label>
                <Input
                  id="bulk-delete-confirm"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  autoComplete="off"
                  data-testid="input-bulk-delete-confirm"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          {preview?.index_ready && preview.deletable.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              disabled={!canDelete}
              onClick={() => void handleConfirm()}
              data-testid="button-bulk-delete-confirm"
            >
              {deleting ? "Deleting…" : `Delete ${preview.deletable.length}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkDeleteDbInfoDialog({
  open,
  onOpenChange,
  count,
  databaseSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  databaseSlug?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-bulk-delete-db-info">
        <DialogHeader>
          <DialogTitle>Cannot delete here</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            These {count} row{count === 1 ? "" : "s"} come from the linked database
            {databaseSlug ? (
              <>
                {" "}
                (<code className="text-xs bg-muted px-1 rounded">{databaseSlug}</code>)
              </>
            ) : null}
            . This list cannot remove them.
          </p>
          <p>
            Delete or archive them in the source database, then refresh the list/cache here.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} data-testid="button-db-delete-dismiss">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
