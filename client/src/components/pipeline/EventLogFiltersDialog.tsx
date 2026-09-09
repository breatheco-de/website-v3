import { useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconChevronDown,
  IconCircleCheck,
  IconClipboardText,
  IconNotes,
  IconPencil,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  type EventActorId,
  type EventKindId,
} from "@shared/event-log-filters";
import {
  eventLogActiveFilterCount,
  eventLogHasTimeWindow,
  type EventLogViewState,
} from "@/components/pipeline/event-log-url";
import {
  AgentSessionPickerModal,
  SESSION_UNSCOPED,
  type AgentSessionPickerSummary,
} from "@/components/pipeline/AgentSessionPickerModal";
import { EventLogAuthorCombobox } from "@/components/pipeline/EventLogAuthorCombobox";
import {
  AGENT_FILTER_OTHER,
  AGENT_IDS,
  formatAgentLabel,
} from "@/components/pipeline/agentIcons";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { sitemapEntrySeoId, type SitemapSearchEntry } from "@/lib/sitemapSearch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const EVENT_ACTOR_CHIPS: Array<{
  id: EventActorId;
  label: string;
  icon: typeof IconActivity;
}> = [
  { id: "people", label: "People", icon: IconNotes },
  { id: "agents", label: "Agents", icon: IconSparkles },
  { id: "system", label: "System", icon: IconActivity },
];

const EVENT_KIND_CHIPS: Array<{
  id: EventKindId;
  label: string;
  icon: typeof IconActivity;
}> = [
  { id: "writes", label: "Writes", icon: IconPencil },
  { id: "deletes", label: "Deletes", icon: IconTrash },
  { id: "claims", label: "Claims", icon: IconClipboardText },
  { id: "completes", label: "Completes", icon: IconCircleCheck },
  { id: "session", label: "Session", icon: IconSparkles },
  { id: "background", label: "Background", icon: IconActivity },
];

/** `datetime-local` value from epoch ms (local timezone). */
function msToDatetimeLocal(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToMs(value: string): number | null {
  if (!value.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export type EventLogFiltersApplyOpts = {
  clearFocus?: boolean;
};

export type EventLogFiltersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: EventLogViewState;
  /** Hash-focused event id when a time window is active; null otherwise. */
  focusedEventId: number | null;
  /** Content site root for author-list API (same as events list). */
  site: string;
  sessions: AgentSessionPickerSummary[];
  typeOptions: Array<{ value: string; label: string }>;
  formatRelative: (ts: number) => string;
  /** Commit draft filters to the URL (call on Apply). */
  onApply: (next: EventLogViewState, opts?: EventLogFiltersApplyOpts) => void;
  /** Reset applied filters (parent) and close. */
  onClear: () => void;
};

export function EventLogFiltersDialog({
  open,
  onOpenChange,
  filters,
  focusedEventId,
  site,
  sessions,
  typeOptions,
  formatRelative,
  onApply,
  onClear,
}: EventLogFiltersDialogProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<EventLogViewState>(filters);
  const [clearFocusDraft, setClearFocusDraft] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [entryPickerOpen, setEntryPickerOpen] = useState(false);
  const [authorPickerOpen, setAuthorPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(filters);
      setClearFocusDraft(false);
    }
  }, [open, filters]);

  const patchDraft = (patch: Partial<EventLogViewState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const kindChips = useMemo(() => new Set(draft.kinds), [draft.kinds]);
  const actorChips = useMemo(() => new Set(draft.actors), [draft.actors]);
  const draftFilterCount = eventLogActiveFilterCount(draft);
  const showFocused = focusedEventId != null && !clearFocusDraft;

  const windowInverted =
    draft.startingAt != null &&
    draft.endingAt != null &&
    draft.startingAt > draft.endingAt;

  function setTimeRangeField(which: "startingAt" | "endingAt", raw: string) {
    const ms = datetimeLocalToMs(raw);
    if (ms == null) {
      patchDraft({ startingAt: null, endingAt: null });
      return;
    }
    if (which === "startingAt") {
      patchDraft({
        startingAt: ms,
        endingAt: draft.endingAt ?? ms,
      });
    } else {
      patchDraft({
        endingAt: ms,
        startingAt: draft.startingAt ?? ms,
      });
    }
  }

  function handleApply() {
    if (windowInverted) {
      toast({
        title: "Invalid time range",
        description: "Start must be before or equal to end.",
        variant: "destructive",
      });
      return;
    }
    const hasWindow = eventLogHasTimeWindow(draft);
    onApply(draft, {
      clearFocus: clearFocusDraft || !hasWindow,
    });
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  function toggleKindChip(id: EventKindId) {
    const next = new Set(kindChips);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patchDraft({ kinds: [...next] as EventKindId[] });
  }

  function toggleActorChip(id: EventActorId) {
    const next = new Set(actorChips);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patchDraft({ actors: [...next] as EventActorId[] });
  }

  function addEntryFilter(entry: SitemapSearchEntry) {
    const key = sitemapEntrySeoId(entry);
    if (!key) {
      toast({
        title: "Missing entry metadata",
        description: "Pick a page with content type, slug, and locale — not URL alone.",
        variant: "destructive",
      });
      return;
    }
    if (draft.entries.includes(key)) return;
    patchDraft({ entries: [...draft.entries, key] });
  }

  function removeEntryFilter(key: string) {
    patchDraft({ entries: draft.entries.filter((e) => e !== key) });
  }

  const nestedOpen = sessionPickerOpen || entryPickerOpen || authorPickerOpen;
  const canClear =
    draftFilterCount > 0 ||
    eventLogActiveFilterCount(filters) > 0 ||
    focusedEventId != null;

  return (
    <>
      <Dialog
        modal={false}
        open={open}
        onOpenChange={(next) => {
          if (!next && nestedOpen) return;
          onOpenChange(next);
          if (!next) {
            setSessionPickerOpen(false);
            setEntryPickerOpen(false);
            setAuthorPickerOpen(false);
          }
        }}
      >
        <DialogContent
          forceOverlay
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          data-testid="dialog-event-log-filters"
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest("[data-radix-popper-content-wrapper]") ||
              target.closest('[data-testid="dialog-agent-session-picker"]') ||
              target.closest('[data-testid="popover-event-author-filter"]')
            ) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest("[data-radix-popper-content-wrapper]") ||
              target.closest('[data-testid="dialog-agent-session-picker"]') ||
              target.closest('[data-testid="popover-event-author-filter"]')
            ) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest("[data-radix-popper-content-wrapper]") ||
              target.closest('[data-testid="dialog-agent-session-picker"]') ||
              target.closest('[data-testid="popover-event-author-filter"]')
            ) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Event log filters</DialogTitle>
            <DialogDescription>
              Narrow which rows show in the log. Changes apply when you click Apply.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium">Time range</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Only rows in this start–end window. Clear either field to remove the window.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="event-filter-starting-at">
                    Start
                  </label>
                  <input
                    id="event-filter-starting-at"
                    type="datetime-local"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={msToDatetimeLocal(draft.startingAt)}
                    onChange={(e) => setTimeRangeField("startingAt", e.target.value)}
                    data-testid="input-event-filter-starting-at"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="event-filter-ending-at">
                    End
                  </label>
                  <input
                    id="event-filter-ending-at"
                    type="datetime-local"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={msToDatetimeLocal(draft.endingAt)}
                    onChange={(e) => setTimeRangeField("endingAt", e.target.value)}
                    data-testid="input-event-filter-ending-at"
                  />
                </div>
              </div>
              {windowInverted ? (
                <p className="text-[11px] text-destructive" data-testid="text-event-filter-range-invalid">
                  Start must be before or equal to end.
                </p>
              ) : null}
            </div>

            {focusedEventId != null ? (
              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs font-medium">Focused event</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Scrolls to this row when a time range is set. Clear removes the highlight.
                </p>
                {showFocused ? (
                  <div
                    className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-[11px]"
                    data-testid="chip-event-filter-focus"
                  >
                    <span className="font-mono">Focused: #{focusedEventId}</span>
                    <button
                      type="button"
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label="Clear focused event"
                      onClick={() => setClearFocusDraft(true)}
                      data-testid="button-clear-event-focus"
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground" data-testid="text-event-focus-cleared-draft">
                    Focus will be cleared when you Apply.
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-1">
              <p className="text-xs font-medium">Agent session</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Pick a session to scope the log. Search by agent or session id.
              </p>
              <button
                type="button"
                id="event-session-filter"
                onClick={() => setSessionPickerOpen(true)}
                className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-left text-xs hover:bg-muted/40"
                data-testid="button-event-session-filter"
              >
                <span className="min-w-0 truncate">
                  {(() => {
                    if (!draft.session) return "All sessions";
                    if (draft.session === SESSION_UNSCOPED) return "Unscoped (no session)";
                    const s = sessions.find((x) => x.agent_session_id === draft.session);
                    const short = draft.session.slice(0, 8);
                    if (!s) return `${short}…`;
                    return `${short}… · ${s.write_count} write${s.write_count === 1 ? "" : "s"} · ${formatRelative(s.ended_at)}`;
                  })()}
                </span>
                <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Kind</p>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_KIND_CHIPS.map((chip) => {
                  const active = kindChips.has(chip.id);
                  const ChipIcon = chip.icon;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => toggleKindChip(chip.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                        active
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                      )}
                      data-testid={`chip-event-kind-${chip.id}`}
                    >
                      <ChipIcon className="h-3 w-3" />
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Actor</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Who ran this row—people in the admin UI, agents over MCP, or automated system jobs.
                Parent saves show on the “Caused by…” line.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_ACTOR_CHIPS.map((chip) => {
                  const active = actorChips.has(chip.id);
                  const ChipIcon = chip.icon;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => toggleActorChip(chip.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                        active
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                      )}
                      data-testid={`chip-event-actor-${chip.id}`}
                    >
                      <ChipIcon className="h-3 w-3" />
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Entries</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Limit the log to these pages. Add from the sitemap.
              </p>
              {draft.entries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {draft.entries.map((key) => (
                    <span
                      key={key}
                      className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] text-foreground"
                      data-testid={`chip-event-entry-${key}`}
                    >
                      <span className="min-w-0 truncate font-mono" title={key}>
                        {key}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${key}`}
                        onClick={() => removeEntryFilter(key)}
                      >
                        <IconX className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <Popover modal={false} open={entryPickerOpen} onOpenChange={setEntryPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-full text-xs"
                    data-testid="button-event-entry-add"
                  >
                    Add page
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0 bg-popover" sideOffset={4}>
                  <SitemapSearch
                    embedded
                    value=""
                    onChange={() => {}}
                    hideCustomUrl
                    excludeIds={draft.entries}
                    onSelectEntry={(entry) => {
                      addEntryFilter(entry);
                    }}
                    onClose={() => setEntryPickerOpen(false)}
                    testId="event-log-entry-picker"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="event-type-filter">
                Exact event type
              </label>
              <select
                id="event-type-filter"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={draft.type}
                onChange={(e) => patchDraft({ type: e.target.value })}
              >
                <option value="">All types</option>
                {typeOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="event-agent-filter">
                Agent
              </label>
              <select
                id="event-agent-filter"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={draft.agent}
                onChange={(e) =>
                  patchDraft({
                    agent: e.target.value as EventLogViewState["agent"],
                  })
                }
                data-testid="select-event-agent-filter"
              >
                <option value="">All agents</option>
                {AGENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {formatAgentLabel(id)}
                  </option>
                ))}
                <option value={AGENT_FILTER_OTHER}>{formatAgentLabel(AGENT_FILTER_OTHER)}</option>
              </select>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium">Author</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Who is named on the row (person or MCP label), not the AI product. Use Agent for
                Claude / ChatGPT.
              </p>
              <EventLogAuthorCombobox
                site={site}
                value={draft.author}
                onChange={(author) => patchDraft({ author })}
                enabled={open}
                onOpenChange={setAuthorPickerOpen}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={!canClear}
              data-testid="button-clear-event-filters"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={windowInverted}
              data-testid="button-apply-event-filters"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentSessionPickerModal
        open={sessionPickerOpen}
        onOpenChange={setSessionPickerOpen}
        sessions={sessions}
        value={draft.session}
        onSelect={(value) => patchDraft({ session: value })}
        formatRelative={formatRelative}
      />
    </>
  );
}
