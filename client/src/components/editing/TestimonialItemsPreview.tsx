import { useMemo, useState } from "react";
import { ChevronDown, Star } from "lucide-react";
import { IconTrash } from "@tabler/icons-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isAnonymousTestimonial,
  testimonialText,
  type TestimonialBankRow,
  type TestimonialEditorItem,
} from "@shared/testimonials-listing";

/** Editor-friendly shape for a manually added testimonial (this section only). */
export type HardcodedTestimonialItem = TestimonialEditorItem;

type DisplaySource = "hardcoded" | "db";

type DisplayItem = {
  key: string;
  name: string;
  role?: string;
  company?: string;
  rating?: number;
  text: string;
  avatar?: string;
  source: DisplaySource;
  featured?: boolean;
};

interface TestimonialItemsPreviewProps {
  /** Manually added rows, read live from this section's YAML. */
  hardcodedItems?: HardcodedTestimonialItem[];
  onHardcodedItemsChange?: (items: HardcodedTestimonialItem[]) => void;
  /**
   * Rows the server resolved for this section (manually added first, then bank).
   * Bank rows are taken from here so the list matches what the page renders.
   */
  resolvedItems?: TestimonialBankRow[];
  /** Leading resolved rows that came from hardcoded_entries when the page rendered. */
  resolvedHardcodedCount?: number;
  hasTopics?: boolean;
  hasSearch?: boolean;
  locale: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function hardcodedKey(item: HardcodedTestimonialItem, index: number): string {
  const base = item.name.trim().toLowerCase() || "unnamed";
  return `hardcoded:${base}:${index}`;
}

export function TestimonialItemsPreview({
  hardcodedItems = [],
  onHardcodedItemsChange,
  resolvedItems = [],
  resolvedHardcodedCount = 0,
  hasTopics = false,
  hasSearch = false,
  locale,
}: TestimonialItemsPreviewProps) {
  const isSpanish = locale === "es";
  const [deleteConfirm, setDeleteConfirm] = useState<{
    index: number;
    name: string;
  } | null>(null);

  const bankItems: DisplayItem[] = useMemo(
    () =>
      resolvedItems
        .slice(resolvedHardcodedCount)
        .filter((row) => !isAnonymousTestimonial(row.student_name))
        .map((row, index) => ({
          key: `db:${row.student_name ?? ""}:${index}`,
          name: row.student_name ?? "",
          role: row.role,
          company: row.company,
          rating: row.rating,
          text: testimonialText(row),
          avatar: row.student_thumb,
          source: "db" as const,
          featured: row.featured,
        })),
    [resolvedItems, resolvedHardcodedCount],
  );

  const hardcodedDisplay: DisplayItem[] = useMemo(
    () =>
      hardcodedItems.map((item, index) => ({
        key: hardcodedKey(item, index),
        name: item.name,
        role: item.role,
        company: item.company,
        rating: item.rating,
        text: item.comment,
        avatar: item.avatar,
        source: "hardcoded" as const,
      })),
    [hardcodedItems],
  );

  const displayedItems = useMemo(
    () => [...hardcodedDisplay, ...bankItems],
    [hardcodedDisplay, bankItems],
  );

  const hardcodedCount = hardcodedDisplay.length;
  const dbCount = bankItems.length;
  const canDeleteHardcoded = !!onHardcodedItemsChange;

  const confirmDelete = () => {
    if (!deleteConfirm || !onHardcodedItemsChange) return;
    onHardcodedItemsChange(
      hardcodedItems.filter((_, i) => i !== deleteConfirm.index),
    );
    setDeleteConfirm(null);
  };

  if (displayedItems.length === 0) {
    const emptyCopy = (() => {
      if (hasTopics || hasSearch) {
        return isSpanish
          ? "Nada del banco coincide todavía. Guarda para volver a consultar el banco, o ajusta los topics y la búsqueda."
          : "Nothing from the bank matches yet. Save to re-query the bank, or adjust topics and search.";
      }
      return isSpanish
        ? "Sin testimonios. Elige topics (o una búsqueda) para traer gente del banco, o agrega uno manualmente."
        : "No testimonials yet. Pick topics (or a search phrase) to pull people from the bank, or add one manually.";
    })();
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Items (0)</Label>
        <p className="text-xs text-muted-foreground">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
        Items ({displayedItems.length})
        {hardcodedCount > 0 && (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {hardcodedCount} manually added
          </Badge>
        )}
        {dbCount > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {dbCount} DB
          </Badge>
        )}
      </Label>
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {displayedItems.map((item) => {
          const hardcodedIndex =
            item.source === "hardcoded"
              ? hardcodedItems.findIndex(
                  (h, i) => hardcodedKey(h, i) === item.key,
                )
              : -1;
          return (
            <TestimonialItemRow
              key={item.key}
              item={item}
              onDelete={
                item.source === "hardcoded" && canDeleteHardcoded && hardcodedIndex >= 0
                  ? () =>
                      setDeleteConfirm({
                        index: hardcodedIndex,
                        name: item.name,
                      })
                  : undefined
              }
            />
          );
        })}
      </div>

      {deleteConfirm && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setDeleteConfirm(null);
          }}
        >
          <DialogContent className="max-w-sm z-[10002]">
            <DialogHeader>
              <DialogTitle>
                {isSpanish
                  ? "¿Quitar testimonio local?"
                  : "Remove local testimonial?"}
              </DialogTitle>
              <DialogDescription>
                {isSpanish
                  ? "Se elimina de esta sección. El banco centralizado no se afecta."
                  : "This removes it from this section's content. The centralized bank is not affected."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground border rounded-md p-2 line-clamp-3">
              {deleteConfirm.name}
            </p>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={confirmDelete}
                data-testid="button-confirm-delete-hardcoded-testimonial"
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface TestimonialItemRowProps {
  item: DisplayItem;
  onDelete?: () => void;
}

function TestimonialItemRow({ item, onDelete }: TestimonialItemRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isHardcoded = item.source === "hardcoded";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`border rounded-lg ${isHardcoded ? "bg-secondary" : "bg-muted/50"}`}
      >
        <div className="flex items-center gap-1 pr-1">
          <CollapsibleTrigger className="flex-1 min-w-0" asChild>
            <button
              type="button"
              className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/80 transition-colors text-left"
              data-testid={`testimonial-item-${item.key}`}
            >
              <Avatar className="w-7 h-7 flex-shrink-0">
                {item.avatar && (
                  <AvatarImage src={item.avatar} alt={item.name} />
                )}
                <AvatarFallback className="bg-foreground/10 text-foreground/70 text-[10px] font-semibold">
                  {getInitials(item.name || "?")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {item.name}
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 py-0 ml-1.5 text-muted-foreground align-middle no-default-hover-elevate no-default-active-elevate"
                  >
                    {isHardcoded ? "manually added" : "DB"}
                  </Badge>
                  {item.featured && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 ml-1 text-muted-foreground align-middle no-default-hover-elevate no-default-active-elevate"
                    >
                      featured
                    </Badge>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {item.role || ""}
                  {item.company ? ` - ${item.company}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {item.rating != null && item.rating > 0 && (
                  <div className="flex items-center gap-0.5">
                    <Star className="fill-current w-3 h-3 text-yellow-500" />
                    <span className="text-[10px] text-muted-foreground">
                      {item.rating}
                    </span>
                  </div>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>
          </CollapsibleTrigger>
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              data-testid={`button-testimonial-item-delete-${item.key}`}
              title="Delete"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <div className="pl-11 pr-2 pb-2 space-y-3">
            {item.text && (
              <p className="text-[11px] text-muted-foreground line-clamp-3 italic">
                &ldquo;{item.text}&rdquo;
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
