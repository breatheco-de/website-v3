import { useId, useMemo, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DatabaseScopeMode = "all" | "specific";

export interface DatabaseScopeEntry {
  name: string;
  label: string;
}

export interface DatabaseScopeBarProps {
  /** Empty string = all databases; otherwise comma-separated database slugs. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  testId?: string;
  /** Optional list; defaults to fetching `/api/databases`. */
  databases?: DatabaseScopeEntry[];
}

const segmentInactive =
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2 py-1.5 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-muted-foreground hover-elevate";

const segmentActive =
  "bg-primary text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground";

export function parseDatabaseScope(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeDatabaseScope(names: string[]): string {
  return names.join(", ");
}

/** Derive UI mode from stored scope. Empty = all. */
export function deriveDatabaseScopeMode(value: string): DatabaseScopeMode {
  return value.trim() ? "specific" : "all";
}

export function formatDatabaseScopeLabel(
  selected: string[],
  databases: DatabaseScopeEntry[],
): string {
  if (selected.length === 0) return "Specific";
  const labels = selected.map(
    (name) => databases.find((db) => db.name === name)?.label ?? name,
  );
  const names =
    labels.length <= 4
      ? labels.join(", ")
      : `${labels.slice(0, 4).join(", ")} and ${labels.length - 4} more`;
  return `Only ${labels.length}: ${names}`;
}

/**
 * Compact scope control for database-scoped capability grants: All | Specific (dropdown).
 */
export function DatabaseScopeBar({
  value,
  onChange,
  className,
  testId = "database-scope-bar",
  databases: databasesProp,
}: DatabaseScopeBarProps) {
  const reactId = useId();

  const { data: fetchedDatabases } = useQuery<Array<{ name: string; label?: string }>>({
    queryKey: ["/api/databases"],
    enabled: databasesProp == null,
  });
  const databases = useMemo(() => {
    if (databasesProp) return databasesProp;
    return (fetchedDatabases ?? []).map((db) => ({
      name: db.name,
      label: db.label || db.name,
    }));
  }, [databasesProp, fetchedDatabases]);

  const selected = useMemo(() => parseDatabaseScope(value), [value]);
  const mode = deriveDatabaseScopeMode(value);
  const [popoverOpen, setPopoverOpen] = useState(false);

  function selectAll() {
    onChange("");
    setPopoverOpen(false);
  }

  function toggleDatabase(name: string) {
    if (selected.includes(name)) {
      onChange(serializeDatabaseScope(selected.filter((t) => t !== name)));
    } else {
      onChange(serializeDatabaseScope([...selected, name]));
    }
  }

  const specificLabel =
    mode === "specific"
      ? formatDatabaseScopeLabel(selected, databases)
      : "Specific";

  return (
    <div
      className={cn(
        "inline-flex h-auto max-w-full flex-wrap items-center justify-start gap-0.5 rounded-md border border-muted-foreground/20 bg-muted/40 p-0.5 text-muted-foreground",
        className,
      )}
      data-testid={testId}
      role="group"
      aria-label="Database scope"
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
            aria-label="Databases"
          >
            {databases.map((db) => {
              const id = `${reactId}-${db.name}`;
              const checked = mode !== "all" && selected.includes(db.name);
              return (
                <div
                  key={db.name}
                  className="flex items-center gap-2 px-1 py-1 rounded-sm hover-elevate cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleDatabase(db.name)}
                    id={id}
                    data-testid={`${testId}-db-${db.name}`}
                  />
                  <label htmlFor={id} className="text-xs cursor-pointer flex-1 min-w-0">
                    <span className="block truncate">{db.label}</span>
                    <span className="block text-muted-foreground font-mono">{db.name}</span>
                  </label>
                </div>
              );
            })}
            {databases.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-1">Loading databases…</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
