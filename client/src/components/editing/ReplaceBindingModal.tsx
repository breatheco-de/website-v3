import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ReplaceBindingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expression: string;
  fieldPath?: string;
  suggestedDefault: string;
  isMixedString: boolean;
  isSharedTemplate?: boolean;
  onConfirm: (literal: string) => void;
}

export function ReplaceBindingModal({
  open,
  onOpenChange,
  expression,
  fieldPath,
  suggestedDefault,
  isMixedString,
  isSharedTemplate,
  onConfirm,
}: ReplaceBindingModalProps) {
  const [value, setValue] = useState(suggestedDefault);

  useEffect(() => {
    if (open) {
      setValue(suggestedDefault);
    }
  }, [open, suggestedDefault, expression]);

  const handleConfirm = () => {
    onConfirm(value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-replace-binding"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Replace binding with static text</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Remove{" "}
                <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground font-mono">
                  {expression}
                </code>{" "}
                and use fixed text instead. The YAML field stays; only the value changes.
              </p>
              {fieldPath && (
                <p>
                  Field:{" "}
                  <code className="text-xs font-mono text-foreground">{fieldPath}</code>
                </p>
              )}
              {isMixedString && (
                <p className="text-xs">
                  Only the binding segment is replaced; surrounding text in this field is kept.
                </p>
              )}
              {isSharedTemplate && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  On save, this updates the shared template for all pages attached to this layout
                  in this language—not only the page you are viewing.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="replace-binding-value">Static text</Label>
          <Input
            id="replace-binding-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter static text (empty allowed)"
            data-testid="input-replace-binding-value"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
          {suggestedDefault !== "" && (
            <p className="text-xs text-muted-foreground">
              Pre-filled from pipe fallback or variable default. You can edit before confirming.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-replace-binding-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} data-testid="button-replace-binding-confirm">
            Replace binding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
