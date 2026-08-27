import { useState } from "react";
import { ExternalLink, Info, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { entryBagFieldPathFromVarName } from "@shared/entryTemplateVars";

interface SingleVariableDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variableName: string;
  inlineDefault: string;
  contentType: string;
  currentSlug?: string;
}

interface FieldValueEntry {
  slug: string;
  value: unknown;
  url: string | null;
}

const INITIAL_VISIBLE = 4;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(not set)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SingleVariableDetailModal({
  open,
  onOpenChange,
  variableName,
  inlineDefault,
  contentType,
  currentSlug,
}: SingleVariableDetailModalProps) {
  const [expanded, setExpanded] = useState(false);

  const fieldName = entryBagFieldPathFromVarName(variableName) ?? variableName;

  const { data, isLoading } = useQuery<{
    field: string;
    source: string;
    entries: FieldValueEntry[];
  }>({
    queryKey: ["/api/content-types", contentType, "single-field-values", fieldName],
    queryFn: async () => {
      const res = await fetch(
        `/api/content-types/${contentType}/single-field-values?field=${encodeURIComponent(fieldName)}`
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!contentType && !!fieldName,
  });

  const currentEntry = data?.entries.find((e) => e.slug === currentSlug);
  const allEntries = data?.entries || [];
  const visibleEntries = expanded ? allEntries : allEntries.slice(0, INITIAL_VISIBLE);
  const hasMore = allEntries.length > INITIAL_VISIBLE;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setExpanded(false); onOpenChange(o); }}>
      <DialogContent
        className="max-w-lg max-h-[85vh] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        data-testid="single-variable-detail-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm px-2 py-1 rounded-md bg-muted">
              {"{{ "}
              {variableName}
              {inlineDefault ? ` | ${inlineDefault}` : ""}
              {" }}"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {currentEntry ? (
              <>
                Currently resolves to:{" "}
                <span className="font-semibold text-foreground">
                  "{formatValue(currentEntry.value)}"
                </span>
              </>
            ) : inlineDefault ? (
              <>
                Inline default:{" "}
                <span className="font-semibold text-foreground">
                  "{inlineDefault}"
                </span>
              </>
            ) : (
              "Entry-specific variable"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mt-2">
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p>
                <span className="font-medium text-foreground">Single variables</span> pull
                their value from each entry's own data. Unlike global variables
                which are the same everywhere, single variables change based on
                which {contentType} page you're viewing.
              </p>
              {data?.source && (
                <p className="mt-1.5">
                  This variable reads from the{" "}
                  <span className="font-mono text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                    {data.source}
                  </span>{" "}
                  property in each entry's YAML data.
                </p>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading values...
            </div>
          ) : allEntries.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">
                Values across {allEntries.length} {contentType} {allEntries.length === 1 ? "entry" : "entries"}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {visibleEntries.map((entry) => {
                  const isCurrent = entry.slug === currentSlug;
                  const label = entry.value !== null && entry.value !== undefined
                    ? formatValue(entry.value)
                    : "(not set)";
                  return (
                    <Badge
                      key={entry.slug}
                      variant={isCurrent ? "default" : "secondary"}
                      className="gap-1 max-w-full"
                      data-testid={`single-value-entry-${entry.slug}`}
                    >
                      <span className="truncate max-w-[10rem]" title={`${entry.slug}: ${label}`}>
                        {entry.slug}
                        <span className="text-[10px] opacity-70 ml-1">=</span>{" "}
                        {label}
                      </span>
                      {isCurrent && (
                        <span className="text-[9px] opacity-70 flex-shrink-0">
                          (current)
                        </span>
                      )}
                      {entry.url && (
                        <a
                          href={entry.url}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 opacity-60"
                          title={`Go to ${entry.url}`}
                          data-testid={`link-entry-${entry.slug}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </Badge>
                  );
                })}
                {hasMore && !expanded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(true)}
                    className="text-xs text-muted-foreground"
                    data-testid="button-see-more-entries"
                  >
                    +{allEntries.length - INITIAL_VISIBLE} more
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              No entries found for this content type.
            </p>
          )}
        </div>

        <div className="flex justify-end pt-2 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-single-detail"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
