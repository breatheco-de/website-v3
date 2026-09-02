import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UnresolvedEditModeLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. entry.learnpack_url — shown only in advanced */
  variableName?: string;
}

/**
 * Shown when staff click an edit-mode CTA whose href is still an unresolved
 * {{ entry.* }} binding (no value / no | default).
 */
export function UnresolvedEditModeLinkDialog({
  open,
  onOpenChange,
  variableName,
}: UnresolvedEditModeLinkDialogProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setShowAdvanced(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md bg-background"
        data-testid="dialog-edit-mode-unresolved-link"
      >
        <DialogHeader>
          <DialogTitle>Link has no URL yet</DialogTitle>
          <DialogDescription>
            This button still points at an empty field binding, so there is nowhere to go. Fill the
            field on this entry, or switch to Read mode after the live value exists.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="button-edit-mode-unresolved-advanced"
        >
          {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>

        {showAdvanced && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
            <p>
              Edit mode keeps{" "}
              <code className="text-[11px] text-foreground">{"{{ entry.* }}"}</code> in the href so
              you can inspect bindings. Until the entry field
              {variableName ? (
                <>
                  {" "}
                  (<code className="text-[11px] text-foreground">{variableName}</code>)
                </>
              ) : null}{" "}
              or a <code className="text-[11px] text-foreground">| default</code> resolves, clicks are
              blocked to avoid a broken preview URL.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            data-testid="button-edit-mode-unresolved-close"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
