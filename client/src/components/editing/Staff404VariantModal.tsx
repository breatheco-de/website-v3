import { useMemo, useState } from "react";
import { ChevronDown, FilePenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sortVariantsForModal } from "@/lib/staff404";

export type Staff404VariantOption = {
  variantSlug: string;
  locale: string;
  displayName: string;
  isPromoted: boolean;
  version: number | null;
  allocation: number | null;
};

export default function Staff404VariantModal({
  open,
  onOpenChange,
  mode,
  typeLabel,
  typeDirectory,
  variants,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "templates" | "entry";
  typeLabel: string;
  typeDirectory?: string;
  variants: Staff404VariantOption[];
  onSelect: (option: Staff404VariantOption) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const liveLast = mode === "templates";
  const sorted = useMemo(() => sortVariantsForModal(variants, liveLast), [variants, liveLast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto" data-testid="staff-404-variant-modal">
        <DialogHeader>
          <DialogTitle>
            {mode === "templates"
              ? "Choose the template variant you want to edit"
              : "Choose a draft or variant of this entry"}
          </DialogTitle>
          <DialogDescription>
            {mode === "templates"
              ? `These versions are this type’s shared layout (template.*.yml), not this missing entry.`
              : "Open a draft or variant to preview and edit this entry."}
          </DialogDescription>
        </DialogHeader>

        {mode === "templates" && (
          <div className="mb-1">
            <p className="text-xs text-muted-foreground">
              Opening one edits the template for all attached {typeLabel}s.
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2"
              onClick={() => setShowAdvanced((v) => !v)}
              data-testid="button-shared-template-advanced"
            >
              {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
            </button>
            {showAdvanced && (
              <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                <li>
                  <code className="text-[11px] font-mono">
                    {typeDirectory || "content"}/template.{"{locale}"}.yml
                  </code>
                </li>
                <li>
                  <code className="text-[11px] font-mono">server/shared-layout-entry.ts</code> (
                  <code className="text-[11px] font-mono">resolveVersioningReadSlug</code>)
                </li>
                <li>
                  <code className="text-[11px] font-mono">server/versioning/VersioningManager.ts</code>{" "}
                  (<code className="text-[11px] font-mono">getAvailableVariants</code>)
                </li>
              </ul>
            )}
          </div>
        )}

        <ul className="space-y-2">
          {sorted.map((option) => {
            const name = option.isPromoted
              ? liveLast
                ? `Live (all attached ${typeLabel}s)`
                : "Live"
              : option.variantSlug;
            return (
              <li
                key={`${option.variantSlug}:${option.locale}:${option.version ?? ""}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{name}</p>
                    {option.allocation != null && (
                      <Badge
                        variant={option.allocation > 0 ? "default" : "secondary"}
                        className="text-[10px] shrink-0"
                        data-testid={`badge-allocation-${option.variantSlug}-${option.locale}`}
                      >
                        {option.allocation}% traffic allocated
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {option.locale.toUpperCase()}
                    {option.version != null ? ` · v${option.version}` : ""}
                    {option.isPromoted ? " · published" : " · variant"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(option);
                  }}
                  data-testid={`button-edit-variant-${option.variantSlug}-${option.locale}`}
                >
                  <FilePenLine className="w-4 h-4 mr-2" />
                  {option.isPromoted ? "Edit live" : "Edit this variant"}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
