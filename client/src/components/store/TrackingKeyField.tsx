/**
 * Store "Tracking key" field for products and personas: editable (pre-filled with a
 * suggestion) until first save, then read-only with an explicit Rename key action.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { shortKeyFormatError } from "@shared/tracking-keys";

export function trackingKeyError(value: string, taken: ReadonlySet<string>, savedKey?: string | null): string | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  const formatError = shortKeyFormatError(key);
  if (formatError) return formatError;
  if (key !== savedKey && taken.has(key)) return `"${key}" is already used (or retired) on this site.`;
  return null;
}

export function TrackingKeyField({
  kind,
  value,
  savedKey,
  suggestion,
  renaming,
  taken,
  onChange,
  onStartRename,
  testId,
}: {
  kind: "product" | "persona";
  value: string;
  savedKey: string | null;
  suggestion: string;
  renaming: boolean;
  taken: ReadonlySet<string>;
  onChange: (next: string) => void;
  onStartRename: () => void;
  testId: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const locked = !!savedKey && !renaming;
  const error = locked ? null : trackingKeyError(value, taken, renaming ? null : savedKey);

  return (
    <div className="space-y-1" data-testid={testId}>
      <Label>Tracking key</Label>
      {locked ? (
        <div className="flex items-center gap-2">
          <code className="rounded-md border bg-muted/40 px-2 py-1 text-sm" data-testid={`${testId}-value`}>
            {savedKey}
          </code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            data-testid={`${testId}-rename`}
          >
            Rename key
          </Button>
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder={suggestion}
          maxLength={6}
          className="font-mono"
          data-testid={`${testId}-input`}
        />
      )}
      {error ? (
        <p className="text-xs text-destructive" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {locked
            ? `Short code for this ${kind} in Google Analytics reports.`
            : `A short code that identifies this ${kind} in Google Analytics reports. Pick it once; changing it later splits reports into old and new codes.${
                value.trim() ? "" : ` Leave empty to use "${suggestion}".`
              }`}
        </p>
      )}
      {!locked && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-xs text-primary hover:underline">
            Read more (advanced)
          </summary>
          <div className="mt-1.5 space-y-1 leading-snug">
            <p>2 to 6 lowercase letters or digits. “all” and “none” are reserved.</p>
            <p>
              {kind === "product"
                ? "Unique among this site's products."
                : "Unique across every persona on this site, not just this product."}{" "}
              Retired keys (renamed or removed) can never be reused.
            </p>
            <p>
              Sites are separate: to report a product the same way on two sites, give it the same key on
              both by hand.
            </p>
            <p className="font-mono">
              {kind === "product" ? "_product.yml → short_key" : "_product.yml → personas[].short_key"}
            </p>
          </div>
        </details>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={`${testId}-rename-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename tracking key?</AlertDialogTitle>
            <AlertDialogDescription>
              Reports before today keep the old code “{savedKey}” and won&apos;t merge with the new one.
              The old code is retired and can&apos;t be used again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onStartRename();
              }}
              data-testid={`${testId}-rename-confirm`}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
