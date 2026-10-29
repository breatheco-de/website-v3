import { useEffect, useState } from "react";
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
import type { LocaleVisibilityRow, VisibilityKey } from "@/lib/seoSaveApi";
import { normalizeRobotsForForm } from "@/lib/robotsMeta";

const FIELD_LABELS: Record<VisibilityKey, string> = {
  robots: "Robots",
  priority: "Priority",
  change_frequency: "Change frequency",
};

const FIELD_ORDER: VisibilityKey[] = ["robots", "priority", "change_frequency"];

function displayValue(key: VisibilityKey, value: string): string {
  if (key === "robots") {
    const normalized = normalizeRobotsForForm(value);
    return normalized || "index, follow";
  }
  return value.trim() || "default";
}

export interface ApplyVisibilityLocalesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLocale: string;
  /** Freshly loaded values for the other live languages; null while loading. */
  locales: LocaleVisibilityRow[] | null;
  loadError?: string | null;
  /** Visibility fields changed in this save (prefilled in "What to copy"). */
  dirtyKeys: VisibilityKey[];
  /** The values about to be saved on the current language. */
  newValues: Record<VisibilityKey, string>;
  saving: boolean;
  onConfirm: (choice: { locales: string[]; copyKeys: VisibilityKey[] }) => void;
}

export function ApplyVisibilityLocalesDialog({
  open,
  onOpenChange,
  currentLocale,
  locales,
  loadError,
  dirtyKeys,
  newValues,
  saving,
  onConfirm,
}: ApplyVisibilityLocalesDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyKeys, setCopyKeys] = useState<Set<VisibilityKey>>(new Set());

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setCopyKeys(new Set(dirtyKeys));
    }
    // Reset only when the dialog opens, so a failed save keeps the choices for a retry.
  }, [open]);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const chosenLocales = (locales ?? []).map((l) => l.locale).filter((l) => selected.has(l));
  const chosenKeys = FIELD_ORDER.filter((k) => copyKeys.has(k));
  const copying = chosenLocales.length > 0 && chosenKeys.length > 0;
  const total = 1 + (copying ? chosenLocales.length : 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-apply-visibility-locales">
        <DialogHeader>
          <DialogTitle>Apply to other languages?</DialogTitle>
          <DialogDescription>
            Each language has its own crawl settings. Pick other languages to apply this change to;
            unchecked ones stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Languages</p>
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm opacity-80">
              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-input" />
              <span className="font-mono text-xs uppercase">{currentLocale}</span>
              <span className="text-xs text-muted-foreground">This language (always saved)</span>
            </label>
            {locales === null && !loadError ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading current settings…
              </div>
            ) : null}
            {loadError ? (
              <p className="px-3 py-2 text-xs text-destructive" data-testid="text-apply-visibility-load-error">
                Could not load the other languages: {loadError}. Only this language will be saved.
              </p>
            ) : null}
            {(locales ?? []).map((row) => (
              <label
                key={row.locale}
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover-elevate"
                data-testid={`row-apply-visibility-${row.locale}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.locale)}
                  onChange={() => setSelected((s) => toggle(s, row.locale))}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  data-testid={`checkbox-apply-visibility-${row.locale}`}
                />
                <div className="min-w-0 space-y-0.5">
                  <span className="font-mono text-xs uppercase">{row.locale}</span>
                  <p className="text-xs text-muted-foreground">
                    Now:{" "}
                    {FIELD_ORDER.map((k) => `${FIELD_LABELS[k].toLowerCase()} ${displayValue(k, row[k])}`).join(" · ")}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">What to copy</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {FIELD_ORDER.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyKeys.has(k)}
                    onChange={() => setCopyKeys((s) => toggle(s, k))}
                    className="h-4 w-4 rounded border-input"
                    data-testid={`checkbox-apply-visibility-field-${k}`}
                  />
                  <span>{FIELD_LABELS[k]}</span>
                  <span className="font-mono text-xs text-muted-foreground">{displayValue(k, newValues[k])}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            data-testid="button-apply-visibility-cancel"
          >
            Cancel
          </Button>
          <Button
            disabled={saving || (locales === null && !loadError)}
            onClick={() =>
              onConfirm({
                locales: copying ? chosenLocales : [],
                copyKeys: copying ? chosenKeys : [],
              })
            }
            data-testid="button-apply-visibility-confirm"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {total === 1 ? "Save to 1 language" : `Save to ${total} languages`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
