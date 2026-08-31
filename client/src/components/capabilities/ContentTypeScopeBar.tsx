import { useEffect, useId, useMemo, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ContentTypeScopeMode = "all" | "same" | "specific";

export interface ContentTypeScopeEntry {
  name: string;
  label: string;
}

export interface ContentTypeScopeBarProps {
  /** Empty string = all content types; otherwise comma-separated type names. */
  value: string;
  onChange: (value: string) => void;
  /**
   * When provided (including empty string), show "Same as above".
   * While that mode is active, value stays live-linked to this prop.
   */
  sameAsValue?: string | null;
  className?: string;
  testId?: string;
  /** Optional list; defaults to fetching `/api/content-types`. */
  contentTypes?: ContentTypeScopeEntry[];
}

const segmentInactive =
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2 py-1.5 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-muted-foreground hover-elevate";

const segmentActive =
  "bg-primary text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground";

export function parseContentTypeScope(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeContentTypeScope(names: string[]): string {
  return names.join(", ");
}

/** Derive UI mode from stored scope + optional parent scope. */
export function deriveContentTypeScopeMode(
  value: string,
  sameAsValue: string | null | undefined,
): ContentTypeScopeMode {
  const trimmed = value.trim();
  if (!trimmed) return "all";
  if (sameAsValue != null && trimmed === sameAsValue.trim()) return "same";
  return "specific";
}

export function formatContentTypeScopeLabel(
  selected: string[],
  contentTypes: ContentTypeScopeEntry[],
): string {
  if (selected.length === 0) return "Specific";
  const labels = selected.map(
    (name) => contentTypes.find((ct) => ct.name === name)?.label ?? name,
  );
  const names =
    labels.length <= 4
      ? labels.join(", ")
      : `${labels.slice(0, 4).join(", ")} and ${labels.length - 4} more`;
  return `Only ${labels.length}: ${names}`;
}

/** Label for the live-linked parent scope segment. */
export function formatSameAsAboveLabel(sameAsValue: string): string {
  const count = parseContentTypeScope(sameAsValue).length;
  if (count === 0) return "Same as above";
  return `Same ${count} as above`;
}

/**
 * Compact scope control for capability grants: All | Same as above | Specific (dropdown).
 * Reuse anywhere staff pick content-type scope for a capability.
 */
export function ContentTypeScopeBar({
  value,
  onChange,
  sameAsValue = null,
  className,
  testId = "content-type-scope-bar",
  contentTypes: contentTypesProp,
}: ContentTypeScopeBarProps) {
  const reactId = useId();
  const showSame = sameAsValue != null;

  const { data: fetchedTypes } = useQuery<ContentTypeScopeEntry[]>({
    queryKey: ["/api/content-types"],
    enabled: contentTypesProp == null,
  });
  const contentTypes = contentTypesProp ?? fetchedTypes ?? [];

  const selected = useMemo(() => parseContentTypeScope(value), [value]);
  const sameLabel = showSame ? formatSameAsAboveLabel(sameAsValue ?? "") : "";
  const derivedMode = deriveContentTypeScopeMode(value, showSame ? sameAsValue : null);

  /**
   * Sticky "same" while linked. Needed when parent is also All (both empty):
   * deriveContentTypeScopeMode returns "all", so we pin after an explicit Same click.
   */
  const [pinnedSame, setPinnedSame] = useState(
    () => showSame && deriveContentTypeScopeMode(value, sameAsValue) === "same",
  );
  const mode: ContentTypeScopeMode =
    pinnedSame && showSame
      ? "same"
      : derivedMode === "same" && showSame
        ? "same"
        : derivedMode === "same"
          ? "specific"
          : derivedMode;

  useEffect(() => {
    if (!showSame) {
      setPinnedSame(false);
      return;
    }
    if (derivedMode === "same") setPinnedSame(true);
    else if (derivedMode === "specific") setPinnedSame(false);
  }, [derivedMode, showSame]);

  useEffect(() => {
    if (mode !== "same" || sameAsValue == null) return;
    if (value.trim() === sameAsValue.trim()) return;
    onChange(sameAsValue);
  }, [mode, sameAsValue, value, onChange]);

  const [popoverOpen, setPopoverOpen] = useState(false);

  function selectAll() {
    setPinnedSame(false);
    onChange("");
    setPopoverOpen(false);
  }

  function selectSame() {
    if (sameAsValue == null) return;
    setPinnedSame(true);
    onChange(sameAsValue);
    setPopoverOpen(false);
  }

  function toggleType(name: string) {
    setPinnedSame(false);
    if (selected.includes(name)) {
      const next = selected.filter((t) => t !== name);
      onChange(serializeContentTypeScope(next));
    } else {
      onChange(serializeContentTypeScope([...selected, name]));
    }
  }

  const specificLabel =
    mode === "specific"
      ? formatContentTypeScopeLabel(selected, contentTypes)
      : "Specific";

  return (
    <div
      className={cn(
        "inline-flex h-auto max-w-full flex-wrap items-center justify-start gap-0.5 rounded-md border border-muted-foreground/20 bg-muted/40 p-0.5 text-muted-foreground",
        className,
      )}
      data-testid={testId}
      role="group"
      aria-label="Content type scope"
    >
      <button
        type="button"
        className={cn(segmentInactive, mode === "all" && segmentActive)}
        onClick={selectAll}
        data-testid={`${testId}-all`}
        aria-pressed={mode === "all"}
      >
        All
      </button>
      {showSame && (
        <button
          type="button"
          className={cn(segmentInactive, mode === "same" && segmentActive)}
          onClick={selectSame}
          data-testid={`${testId}-same`}
          aria-pressed={mode === "same"}
        >
          {sameLabel}
        </button>
      )}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              segmentInactive,
              "max-w-[28rem] gap-1",
              mode === "specific" && segmentActive,
            )}
            data-testid={`${testId}-specific`}
            aria-pressed={mode === "specific"}
            aria-haspopup="listbox"
          >
            <span className="truncate">{specificLabel}</span>
            <IconChevronDown className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-2 w-64" align="start">
          <div
            className="max-h-60 space-y-0.5 overflow-y-auto"
            role="listbox"
            aria-label="Content types"
          >
            {contentTypes.map((ct) => {
              const id = `${reactId}-${ct.name}`;
              const checked = mode !== "all" && selected.includes(ct.name);
              return (
                <div
                  key={ct.name}
                  className="flex items-center gap-2 px-1 py-1 rounded-sm hover-elevate cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleType(ct.name)}
                    id={id}
                    data-testid={`${testId}-ct-${ct.name}`}
                  />
                  <label htmlFor={id} className="text-xs cursor-pointer flex-1 min-w-0">
                    <span className="block truncate">{ct.label}</span>
                    <span className="block text-muted-foreground font-mono">{ct.name}</span>
                  </label>
                </div>
              );
            })}
            {contentTypes.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-1">Loading content types…</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
