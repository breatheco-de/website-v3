import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconPlus, IconSelector } from "@tabler/icons-react";
import { AUTHOR_FILTER_NONE } from "@shared/event-log-filters";
import type { StaffDirectoryEntry } from "@/components/editing";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { apiFetch } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { cn } from "@/lib/utils";

async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const token = getDebugToken();
  const headers: Record<string, string> = {
    ...getSessionHeaders(),
  };
  if (token) {
    headers.Authorization = `Token ${token}`;
    headers["X-Debug-Token"] = token;
  }
  const res = await fetch("/api/staff", { headers });
  if (!res.ok) {
    throw new Error(`Failed to load staff (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data?.staff) ? (data.staff as StaffDirectoryEntry[]) : [];
}

async function fetchEventAuthors(site: string): Promise<string[]> {
  const res = await apiFetch(`/api/admin/events/authors?site=${encodeURIComponent(site)}`);
  if (!res.ok) {
    throw new Error(`Failed to load authors (${res.status})`);
  }
  const data = (await res.json()) as { authors?: string[] };
  return Array.isArray(data.authors) ? data.authors : [];
}

export type EventLogAuthorComboboxProps = {
  site: string;
  value: string;
  onChange: (next: string) => void;
  /** When true, load staff + log authors (e.g. while filters dialog is open). */
  enabled?: boolean;
  /** Nested-popover open callback so the parent dialog can avoid closing. */
  onOpenChange?: (open: boolean) => void;
};

function authorTriggerLabel(
  value: string,
  staff: StaffDirectoryEntry[],
): string {
  if (!value) return "All authors";
  if (value === AUTHOR_FILTER_NONE) return "No author";
  const match = staff.find((s) => s.username === value);
  return match?.displayName || value;
}

export function EventLogAuthorCombobox({
  site,
  value,
  onChange,
  enabled = true,
  onOpenChange,
}: EventLogAuthorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const staffQuery = useQuery({
    queryKey: ["/api/staff"],
    queryFn: fetchStaffDirectory,
    enabled,
    staleTime: 60_000,
  });

  const authorsQuery = useQuery({
    queryKey: ["/api/admin/events/authors", site],
    queryFn: () => fetchEventAuthors(site),
    enabled: enabled && Boolean(site),
    staleTime: 30_000,
  });

  const staff = staffQuery.data ?? [];
  const logAuthors = authorsQuery.data ?? [];

  const staffUsernames = useMemo(() => new Set(staff.map((s) => s.username)), [staff]);

  const alsoInLog = useMemo(
    () => logAuthors.filter((a) => !staffUsernames.has(a)),
    [logAuthors, staffUsernames],
  );

  const trimmedSearch = search.trim();
  const knownValues = useMemo(() => {
    const set = new Set<string>([AUTHOR_FILTER_NONE, ...staff.map((s) => s.username), ...logAuthors]);
    return set;
  }, [staff, logAuthors]);

  const showCustom =
    Boolean(trimmedSearch) &&
    trimmedSearch !== AUTHOR_FILTER_NONE &&
    !knownValues.has(trimmedSearch);

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    setSearch("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) setSearch("");
  }

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between px-2 font-normal text-xs"
          data-testid="button-event-author-filter"
        >
          <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>
            {authorTriggerLabel(value, staff)}
          </span>
          <IconSelector className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0 bg-popover"
        sideOffset={4}
        data-testid="popover-event-author-filter"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Search authors…"
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmedSearch && trimmedSearch !== AUTHOR_FILTER_NONE) {
                e.preventDefault();
                commit(trimmedSearch);
              }
            }}
            data-testid="input-event-author-filter"
          />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {trimmedSearch
                ? `Press Enter to use “${trimmedSearch}”`
                : "No authors found"}
            </CommandEmpty>
            <CommandGroup heading="Special">
              <CommandItem
                value="all-authors"
                onSelect={() => commit("")}
                data-testid="option-event-author-all"
              >
                <IconCheck
                  className={cn("mr-2 h-3.5 w-3.5 shrink-0", !value ? "opacity-100" : "opacity-0")}
                />
                All authors
              </CommandItem>
              <CommandItem
                value={`no-author ${AUTHOR_FILTER_NONE}`}
                onSelect={() => commit(AUTHOR_FILTER_NONE)}
                data-testid="option-event-author-none"
              >
                <IconCheck
                  className={cn(
                    "mr-2 h-3.5 w-3.5 shrink-0",
                    value === AUTHOR_FILTER_NONE ? "opacity-100" : "opacity-0",
                  )}
                />
                No author
              </CommandItem>
            </CommandGroup>
            {showCustom ? (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`custom-${trimmedSearch}`}
                  onSelect={() => commit(trimmedSearch)}
                  className="font-mono text-xs"
                  data-testid="option-event-author-custom"
                >
                  <IconPlus className="mr-2 h-3.5 w-3.5 shrink-0" />
                  Use “{trimmedSearch}”
                </CommandItem>
              </CommandGroup>
            ) : null}
            {staff.length > 0 ? (
              <CommandGroup heading="People">
                {staff.map((person) => (
                  <CommandItem
                    key={person.id}
                    value={`${person.displayName} ${person.username}`}
                    onSelect={() => commit(person.username)}
                    data-testid={`option-event-author-staff-${person.username}`}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3.5 w-3.5 shrink-0",
                        value === person.username ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate">{person.displayName}</span>
                    {person.displayName !== person.username ? (
                      <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground truncate">
                        {person.username}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {alsoInLog.length > 0 ? (
              <CommandGroup heading="Also in log">
                {alsoInLog.map((author) => (
                  <CommandItem
                    key={author}
                    value={author}
                    onSelect={() => commit(author)}
                    className="font-mono text-xs"
                    data-testid={`option-event-author-log-${author}`}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3.5 w-3.5 shrink-0",
                        value === author ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {author}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
