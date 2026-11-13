import { useState, useMemo, type ReactNode } from "react";
import {
  IconSearch,
  IconPlus,
  IconPencil,
  IconX,
  IconCheck,
  IconTrash,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
  group?: string;
  prefix?: ReactNode;
  badgeLabel?: string;
  searchTerms?: string[];
}

interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  label: ReactNode;
  searchPlaceholder?: string;
  groupLabels?: Record<string, string>;
  isLoading?: boolean;
  testIdPrefix?: string;
  emptyMessage?: string;
  addLabel?: string;
  clearAllLabel?: string;
  /** Extra controls rendered next to the inline Clear button (e.g. "Reset to defaults"). */
  headerActions?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Render only the search + options panel (for nesting inside an external popover). */
  panelOnly?: boolean;
  /** ScrollArea class for the options list. Default fixed height; pass max-h-* to shrink with few options. */
  listClassName?: string;
}

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  label,
  searchPlaceholder = "Search...",
  groupLabels,
  isLoading = false,
  testIdPrefix = "item",
  emptyMessage = "No options found",
  addLabel = "Add filter",
  clearAllLabel = "Clear all filters",
  headerActions,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  portalContainer,
  panelOnly = false,
  listClassName = "h-[240px]",
}: SearchableMultiSelectProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = (v: boolean) => {
    setOpenInternal(v);
    onOpenChangeProp?.(v);
  };
  const [search, setSearch] = useState("");

  const hasValues = value.length > 0;

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        opt.searchTerms?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [options, search]);

  const grouped = useMemo(() => {
    const hasGroups = filteredOptions.some((o) => o.group);
    if (!hasGroups) return { "": filteredOptions };
    const result: Record<string, SearchableMultiSelectOption[]> = {};
    for (const opt of filteredOptions) {
      const key = opt.group ?? "";
      if (!result[key]) result[key] = [];
      result[key].push(opt);
    }
    return result;
  }, [filteredOptions]);

  const optionByValue = useMemo(() => {
    const map: Record<string, SearchableMultiSelectOption> = {};
    for (const opt of options) map[opt.value] = opt;
    return map;
  }, [options]);

  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  const optionsPanel = (
    <>
      <div className="p-2 border-b">
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid={`input-${testIdPrefix}-filter-search`}
            autoFocus
          />
        </div>
      </div>
      <ScrollArea className={listClassName}>
        <div className="p-1">
          {isLoading && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {!isLoading && filteredOptions.length === 0 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          )}
          {!isLoading &&
            Object.entries(grouped).map(([groupKey, opts]) => (
              <div key={groupKey || "__ungrouped"} className={groupKey ? "mb-1" : undefined}>
                {groupKey && (
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {groupLabels?.[groupKey] ?? groupKey}
                  </div>
                )}
                {opts.map((opt) => {
                  const isSelected = value.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggle(opt.value)}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md transition-colors ${
                        isSelected
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      data-testid={`button-${testIdPrefix}-toggle-${opt.value}`}
                    >
                      {opt.prefix && (
                        <span className="flex-shrink-0 leading-none">
                          {opt.prefix}
                        </span>
                      )}
                      <span className="flex-1 text-left truncate">
                        {opt.label}
                      </span>
                      {isSelected && (
                        <IconCheck className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      </ScrollArea>
      {hasValues && (
        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive"
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
            data-testid={`button-clear-${testIdPrefix}-all`}
          >
            {clearAllLabel}
          </Button>
        </div>
      )}
    </>
  );

  if (panelOnly) {
    return <div className="w-full">{optionsPanel}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium whitespace-nowrap flex items-center gap-1.5">
          {label}
        </Label>
        <div className="flex items-center gap-1.5">
          {headerActions}
          {hasValues && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              data-testid={`button-clear-${testIdPrefix}-inline`}
              onClick={() => onChange([])}
            >
              <IconTrash className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}
          <Popover
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setSearch("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                data-testid={`button-edit-${testIdPrefix}`}
              >
                {hasValues ? (
                  <IconPencil className="h-3.5 w-3.5" />
                ) : (
                  <>
                    <IconPlus className="h-3.5 w-3.5 mr-1" />
                    <span>{addLabel}</span>
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-72 p-0 z-[10001] pointer-events-auto"
              align="end"
              container={portalContainer}
            >
              {optionsPanel}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {hasValues && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => {
            const opt = optionByValue[v];
            if (!opt) return null;
            return (
              <Badge key={v} variant="secondary" className="gap-1 pr-1">
                {opt.prefix && (
                  <span className="flex-shrink-0 text-xs leading-none">
                    {opt.prefix}
                  </span>
                )}
                <span>{opt.badgeLabel ?? opt.label}</span>
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                  data-testid={`button-remove-${testIdPrefix}-${v}`}
                >
                  <IconX className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
