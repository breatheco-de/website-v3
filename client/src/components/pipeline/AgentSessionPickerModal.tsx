import { useMemo, useState } from "react";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ToggleButtonBar,
  ToggleButtonBarTrigger,
} from "@/components/ui/toggle-button-bar";
import { cn } from "@/lib/utils";
import { formatAttributionEntry } from "@/lib/formatIssueActor";
import { AgentIcon } from "./AgentIcon";
import {
  formatAgentLabel,
  resolveAgentId,
  type AgentId,
} from "./agentIcons";

export const SESSION_UNSCOPED = "unscoped";

export type AgentSessionPickerSummary = {
  agent_session_id: string;
  started_at: number;
  ended_at: number;
  event_count: number;
  write_count: number;
  issue_complete_count: number;
  attribution: Array<{
    author?: string;
    actor?: { type: string; client?: string; model?: string; source?: string };
  }>;
};

type SortMode = "date" | "writes";

type AgentSessionPickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AgentSessionPickerSummary[];
  value: string;
  onSelect: (value: "" | typeof SESSION_UNSCOPED | string) => void;
  formatRelative: (ts: number) => string;
};

function sessionSearchHaystack(session: AgentSessionPickerSummary): string {
  const agentId = resolveAgentId(session.attribution);
  const parts = [
    session.agent_session_id,
    agentId ? formatAgentLabel(agentId) : "",
    ...session.attribution.map((a) => formatAttributionEntry(a)),
    ...session.attribution.map((a) => a.author ?? ""),
    ...session.attribution.map((a) => a.actor?.client ?? ""),
    ...session.attribution.map((a) => a.actor?.model ?? ""),
  ];
  return parts.join(" ").toLowerCase();
}

function SessionActorCell({
  attribution,
}: {
  attribution: AgentSessionPickerSummary["attribution"];
}) {
  const agentId = resolveAgentId(attribution) as AgentId | null;
  if (agentId) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <AgentIcon agentId={agentId} size="sm" />
        <span className="truncate text-foreground">{formatAgentLabel(agentId)}</span>
      </span>
    );
  }
  const primary = attribution[0];
  const label = primary ? formatAttributionEntry(primary) : "Unknown";
  return <span className="truncate text-muted-foreground">{label}</span>;
}

export function AgentSessionPickerModal({
  open,
  onOpenChange,
  sessions,
  value,
  onSelect,
  formatRelative,
}: AgentSessionPickerModalProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("date");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sessions;
    if (q) {
      list = sessions.filter((s) => sessionSearchHaystack(s).includes(q));
    }
    const sorted = [...list];
    if (sort === "writes") {
      sorted.sort((a, b) => b.write_count - a.write_count || b.ended_at - a.ended_at);
    } else {
      sorted.sort((a, b) => b.ended_at - a.ended_at);
    }
    return sorted;
  }, [sessions, search, sort]);

  const q = search.trim().toLowerCase();
  const showAll = !q || "all sessions".includes(q);
  const showUnscoped =
    !q || "unscoped (no session)".includes(q) || "unscoped".includes(q) || "no session".includes(q);

  const pick = (next: "" | typeof SESSION_UNSCOPED | string) => {
    onSelect(next);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-3 overflow-hidden sm:max-w-lg"
        style={{ maxHeight: "85vh" }}
        data-testid="dialog-agent-session-picker"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Agent session</DialogTitle>
          <DialogDescription>
            Scope the event log to one session. Search by agent or session id.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent or session id…"
              className="h-8 pl-8 text-xs"
              data-testid="input-agent-session-search"
              autoFocus
            />
          </div>
          <ToggleButtonBar
            value={sort}
            onValueChange={(v) => {
              if (v === "date" || v === "writes") setSort(v);
            }}
            className="shrink-0"
          >
            <ToggleButtonBarTrigger value="date" data-testid="button-session-sort-date">
              Date
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="writes" data-testid="button-session-sort-writes">
              Writes
            </ToggleButtonBarTrigger>
          </ToggleButtonBar>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-border"
          style={{ maxHeight: "min(50vh, 380px)" }}
        >
          <ul className="divide-y divide-border">
            {showAll ? (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
                    value === "" && "bg-primary/10",
                  )}
                  data-testid="row-session-all"
                >
                  <span className="min-w-0 flex-1 font-medium text-foreground">All sessions</span>
                  {value === "" ? (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </button>
              </li>
            ) : null}
            {showUnscoped ? (
              <li>
                <button
                  type="button"
                  onClick={() => pick(SESSION_UNSCOPED)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
                    value === SESSION_UNSCOPED && "bg-primary/10",
                  )}
                  data-testid="row-session-unscoped"
                >
                  <span className="min-w-0 flex-1 font-medium text-foreground">
                    Unscoped (no session)
                  </span>
                  {value === SESSION_UNSCOPED ? (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </button>
              </li>
            ) : null}
            {filtered.map((s) => {
              const short = s.agent_session_id.slice(0, 8);
              const selected = value === s.agent_session_id;
              return (
                <li key={s.agent_session_id}>
                  <button
                    type="button"
                    onClick={() => pick(s.agent_session_id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
                      selected && "bg-primary/10",
                    )}
                    data-testid={`row-session-${s.agent_session_id}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <SessionActorCell attribution={s.attribution} />
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">{short}…</span>
                        <span>
                          {s.write_count} write{s.write_count === 1 ? "" : "s"}
                        </span>
                        <span>{formatRelative(s.ended_at)}</span>
                      </span>
                    </span>
                    {selected ? (
                      <IconCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {!showAll && !showUnscoped && filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No sessions match.
            </p>
          ) : null}
          {showAll && showUnscoped && filtered.length === 0 && q ? (
            <p className="border-t border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
              No sessions match.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
