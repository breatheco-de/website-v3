import { useEffect, useState } from "react";
import { Braces, Type, TextCursor } from "lucide-react";
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
  onChooseVariable: () => void;
}

type Step = "choose" | "static";

export function ReplaceBindingModal({
  open,
  onOpenChange,
  expression,
  fieldPath,
  suggestedDefault,
  isMixedString,
  isSharedTemplate,
  onConfirm,
  onChooseVariable,
}: ReplaceBindingModalProps) {
  const [step, setStep] = useState<Step>("choose");
  const [value, setValue] = useState(suggestedDefault);

  useEffect(() => {
    if (open) {
      setStep("choose");
      setValue(suggestedDefault);
    }
  }, [open, suggestedDefault, expression]);

  const handleConfirmStatic = () => {
    onConfirm(value);
    onOpenChange(false);
  };

  const handleEmpty = () => {
    onConfirm("");
    onOpenChange(false);
  };

  const handleDismiss = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep("choose");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDismiss}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-replace-binding"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Replace this binding</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Replace{" "}
                <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground font-mono">
                  {expression}
                </code>
                . The YAML field stays; only this value changes.
              </p>
              {fieldPath && (
                <p>
                  Field:{" "}
                  <code className="text-xs font-mono text-foreground">{fieldPath}</code>
                </p>
              )}
              {step === "choose" && (
                <p className="text-xs">
                  Keep a live binding, bake fixed text into the template, or leave the field blank.
                </p>
              )}
              {isMixedString && (
                <p className="text-xs">
                  Only the binding segment is replaced; surrounding text is kept
                  {step === "choose" ? " (empty may leave extra spaces)" : ""}.
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

        {step === "choose" ? (
          <div className="flex flex-col gap-2 py-2" data-testid="replace-binding-choose">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={onChooseVariable}
              data-testid="button-replace-binding-variable"
            >
              <Braces className="h-4 w-4 shrink-0" />
              <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
                <span className="font-medium">Another variable</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Keep a live binding that pulls from entry or global data
                </span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={() => setStep("static")}
              data-testid="button-replace-binding-static"
            >
              <Type className="h-4 w-4 shrink-0" />
              <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
                <span className="font-medium">A static value</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Bake fixed text into the template
                </span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={handleEmpty}
              data-testid="button-replace-binding-empty"
            >
              <TextCursor className="h-4 w-4 shrink-0" />
              <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
                <span className="font-medium">Empty value</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Leave the field blank (key stays)
                </span>
              </div>
            </Button>
            <DialogFooter className="gap-2 sm:gap-0 mt-2">
              <Button
                variant="ghost"
                onClick={() => handleDismiss(false)}
                data-testid="button-replace-binding-cancel"
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
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
                    handleConfirmStatic();
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
                onClick={() => setStep("choose")}
                data-testid="button-replace-binding-back"
              >
                Back
              </Button>
              <Button
                variant="ghost"
                onClick={() => handleDismiss(false)}
                data-testid="button-replace-binding-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmStatic}
                data-testid="button-replace-binding-confirm"
              >
                Replace binding
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
