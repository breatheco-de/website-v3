import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type SeoBulkPair = { slug: string; locale: string };

export function BulkSeoOgRegenerateDialog({
  open,
  onOpenChange,
  pairs,
  customImageCount,
  captureReady,
  applying,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairs: SeoBulkPair[];
  /** Selected rows whose social image is hand-picked / custom. */
  customImageCount: number;
  captureReady: boolean;
  applying: boolean;
  onConfirm: (opts: { replaceCustom: boolean }) => void | Promise<void>;
}) {
  const [replaceCustom, setReplaceCustom] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReplaceCustom(false);
  }, [open]);

  const canRun = captureReady && pairs.length > 0 && !applying;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-bulk-seo-og-regenerate">
        <DialogHeader>
          <DialogTitle>Regenerate OG ({pairs.length})</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Queue new social preview images for the selected pages only (the languages you
                checked). Page content and SEO text do not change.
              </p>
              {!captureReady ? (
                <p className="text-destructive" data-testid="text-bulk-og-capture-not-ready">
                  Preview capture is not ready for this content type — regenerate is unavailable.
                </p>
              ) : null}
              {customImageCount > 0 ? (
                <div className="flex items-start gap-2 pt-1" data-testid="section-bulk-og-custom">
                  <Checkbox
                    id="bulk-og-replace-custom"
                    checked={replaceCustom}
                    onCheckedChange={(v) => setReplaceCustom(v === true)}
                    disabled={applying || !captureReady}
                    data-testid="checkbox-bulk-og-replace-custom"
                  />
                  <Label
                    htmlFor="bulk-og-replace-custom"
                    className="text-sm font-normal leading-snug text-muted-foreground cursor-pointer"
                  >
                    Also replace custom social images ({customImageCount} selected
                    {customImageCount === 1 ? " page has" : " pages have"} a hand-picked image).
                    Leave unchecked to keep those images.
                  </Label>
                </div>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
            data-testid="button-bulk-og-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canRun}
            onClick={() => void onConfirm({ replaceCustom })}
            data-testid="button-bulk-og-confirm"
          >
            {applying ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Queuing…
              </>
            ) : (
              `Queue ${pairs.length}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
