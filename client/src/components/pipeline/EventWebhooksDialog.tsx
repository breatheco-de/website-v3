import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconChevronDown,
  IconFilter,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSend,
  IconTrash,
  IconWebhook,
} from "@tabler/icons-react";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ToggleButtonBar,
  ToggleButtonBarTrigger,
} from "@/components/ui/toggle-button-bar";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import JsonViewer from "@/components/editing/JsonViewer";
import { TagInput } from "@/components/editing/TagInput";
import { SearchableMultiCombobox } from "@/components/ui/searchable-multi-combobox";
import { EventWebhookLogsPanel } from "@/components/pipeline/EventWebhookLogsPanel";
import {
  HookFilterBadges,
  KIND_CHIP_META,
  KIND_OPTIONS,
} from "@/components/pipeline/HookFilterBadges";
import type { StaffDirectoryEntry } from "@/components/editing";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import {
  FUNNEL_STAGE_ICON,
  FUNNEL_STAGE_ICON_TONE,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
} from "@/lib/funnel-stage-ui";

export type EventWebhookFilter = {
  event_authors?: string[];
  exclude_event_authors?: string[];
  event_actor_types?: Array<"ui" | "mcp" | "system">;
  event_models?: string[];
  exclude_event_models?: string[];
  event_clients?: string[];
  exclude_event_clients?: string[];
  proposal_authors?: string[];
  exclude_proposal_authors?: string[];
  proposal_models?: string[];
  exclude_proposal_models?: string[];
  proposal_actor_types?: Array<"ui" | "mcp" | "system">;
  proposal_roles?: string[];
  kinds?: Array<"idea" | "edits" | "notes">;
  exclude_kinds?: Array<"idea" | "edits" | "notes">;
  content_types?: string[];
  exclude_content_types?: string[];
  locales?: string[];
  exclude_locales?: string[];
  funnel_stages?: FunnelStage[];
  exclude_funnel_stages?: FunnelStage[];
  funnel_products?: string[];
  exclude_funnel_products?: string[];
};

export type EventWebhookHook = {
  id: string;
  enabled: boolean;
  url: string;
  method?: "POST";
  debounce_ms: number;
  max_wait_ms: number;
  max_events_per_call: number;
  headers?: Record<string, string>;
  filter?: EventWebhookFilter;
};

export type EventWebhookConfig = {
  version: 1;
  subscriptions: Record<string, EventWebhookHook[]>;
};

type DeliveryRow = {
  id: number;
  event_type: string;
  hook_id: string;
  event_ids: number[];
  url_host: string;
  status: "success" | "failure" | "skipped";
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
  batch_size: number;
  source: "live" | "test" | "retry";
  created_at: number;
};

type WebhookSummary = {
  config: EventWebhookConfig;
  pending: Record<string, number>;
  allowlist: string[];
  filter_keys?: Record<string, string[]>;
  enabled_hook_count: number;
  last_delivery: DeliveryRow | null;
  file?: string;
  site?: string;
};

function bufferKey(eventType: string, hookId: string) {
  return `${eventType}::${hookId}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "—";
  }
}

const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_MAX_EVENTS = 50;

function emptyHook(id: string): EventWebhookHook {
  return {
    id,
    enabled: false,
    url: "",
    debounce_ms: DEFAULT_DEBOUNCE_MS,
    max_wait_ms: DEFAULT_MAX_WAIT_MS,
    max_events_per_call: DEFAULT_MAX_EVENTS,
  };
}

function formatMsShort(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function formatThrottleSummary(hook: EventWebhookHook): string {
  if (hook.debounce_ms === 0 && hook.max_wait_ms === 0) return "immediate";
  return `${formatMsShort(hook.debounce_ms)} quiet / ${formatMsShort(hook.max_wait_ms)} max`;
}

function throttleTimingInvalid(hook: EventWebhookHook): boolean {
  return hook.debounce_ms > 0 && hook.max_wait_ms > 0 && hook.max_wait_ms < hook.debounce_ms;
}

/** Live-type slug: spaces → hyphens; lowercase a-z0-9_-, max 64. */
function slugifyHookId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function headersToText(headers?: Record<string, string>): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function stableFilterJson(f: EventWebhookFilter | undefined): string {
  if (!f || Object.keys(f).length === 0) return "";
  const keys = Object.keys(f).sort();
  const norm: Record<string, string[]> = {};
  for (const k of keys) {
    const v = (f as Record<string, string[] | undefined>)[k];
    if (!v || v.length === 0) continue;
    norm[k] = [...v].map((s) => s.toLowerCase()).sort();
  }
  return JSON.stringify(norm);
}

function filtersEqual(a: EventWebhookFilter | undefined, b: EventWebhookFilter | undefined): boolean {
  return stableFilterJson(a) === stableFilterJson(b);
}

function pruneFilter(f: EventWebhookFilter | undefined): EventWebhookFilter | undefined {
  if (!f) return undefined;
  const out: EventWebhookFilter = {};
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) && v.length > 0) {
      (out as Record<string, string[]>)[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function filterActiveCount(f: EventWebhookFilter | undefined): number {
  if (!f) return 0;
  let n = 0;
  for (const v of Object.values(f)) {
    if (Array.isArray(v) && v.length > 0) n += 1;
  }
  return n;
}

function patchFilter(
  hook: EventWebhookHook,
  patch: Partial<EventWebhookFilter>,
): EventWebhookHook {
  const next = pruneFilter({ ...(hook.filter ?? {}), ...patch });
  if (!next) {
    const { filter: _drop, ...rest } = hook;
    return rest;
  }
  return { ...hook, filter: next };
}

const ACTOR_TYPE_OPTIONS = ["ui", "mcp", "system"] as const;

function KindChips({
  values,
  onChange,
  testId,
}: {
  values: string[];
  onChange: (v: Array<"idea" | "edits" | "notes">) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {KIND_OPTIONS.map((k) => {
        const on = values.includes(k);
        const meta = KIND_CHIP_META[k];
        const KindIcon = meta.icon;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors",
              on ? meta.selected : meta.idle,
            )}
            onClick={() => {
              onChange(
                on
                  ? (values.filter((x) => x !== k) as Array<"idea" | "edits" | "notes">)
                  : ([...values, k] as Array<"idea" | "edits" | "notes">),
              );
            }}
          >
            {on ? <IconCheck className={cn("h-3 w-3 shrink-0", meta.iconClass)} aria-hidden /> : null}
            <KindIcon className={cn("h-3 w-3 shrink-0", meta.iconClass)} aria-hidden />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function ActorTypeChips({
  values,
  onChange,
  testId,
}: {
  values: string[];
  onChange: (v: Array<"ui" | "mcp" | "system">) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {ACTOR_TYPE_OPTIONS.map((k) => {
        const on = values.includes(k);
        return (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            className="h-7 text-xs"
            aria-pressed={on}
            onClick={() => {
              onChange(
                on
                  ? (values.filter((x) => x !== k) as Array<"ui" | "mcp" | "system">)
                  : ([...values, k] as Array<"ui" | "mcp" | "system">),
              );
            }}
          >
            {k}
          </Button>
        );
      })}
    </div>
  );
}

function FunnelStageChips({
  values,
  onChange,
  testId,
}: {
  values: string[];
  onChange: (v: FunnelStage[]) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {FUNNEL_STAGES.map((s) => {
        const on = values.includes(s);
        const taper = FUNNEL_STAGE_TAPER[s];
        const StageIcon = FUNNEL_STAGE_ICON[s];
        const iconClass = FUNNEL_STAGE_ICON_TONE[taper];
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors",
              on
                ? cn(FUNNEL_STAGE_TONE[taper], "text-foreground")
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
            data-testid={`chip-funnel-stage-${s}`}
            onClick={() => {
              onChange(
                on
                  ? (values.filter((x) => x !== s) as FunnelStage[])
                  : ([...values, s] as FunnelStage[]),
              );
            }}
          >
            {on ? <IconCheck className={cn("h-3 w-3 shrink-0", iconClass)} aria-hidden /> : null}
            <StageIcon className={cn("h-3 w-3 shrink-0", iconClass)} aria-hidden />
            {FUNNEL_STAGE_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}

/** Matches server test body shape (triggered_at refreshes at send time). */
function buildTestPayloadPreview(opts: {
  site: string;
  eventType: string;
  hook: EventWebhookHook;
}): Record<string, unknown> {
  return {
    event: "pipeline.events",
    site: opts.site,
    triggered_at: new Date().toISOString(),
    source: "test",
    hook_id: opts.hook.id,
    event_type: opts.eventType,
    throttle: {
      debounce_ms: opts.hook.debounce_ms,
      max_wait_ms: opts.hook.max_wait_ms,
      max_events_per_call: opts.hook.max_events_per_call,
      count_in_batch: 0,
    },
    events: [],
    test: true,
    message: "Event webhook test delivery",
  };
}

function headerPreviewLines(headers?: Record<string, string>): string[] {
  const base = ["Content-Type: application/json"];
  if (!headers) return base;
  for (const [k, v] of Object.entries(headers)) {
    const sensitive = /auth|token|secret|key|password|bearer/i.test(k);
    const shown = sensitive && !v.startsWith("•") ? "••••••••" : v;
    base.push(`${k}: ${shown}`);
  }
  return base;
}

function formatRelativeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

type PendingDrop = {
  kind: "save" | "delete";
  count: number;
  apply: () => Promise<void>;
};

/** Full settings body for /private/webhooks/hooks and /logs (no dialog chrome). */
export function EventWebhooksPanel({ tab }: { tab: "hooks" | "logs" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [advanced, setAdvanced] = useState(false);
  const [editing, setEditing] = useState<{
    mode: "settings" | "filters";
    eventType: string;
    hook: EventWebhookHook;
    headersText: string;
    isNew: boolean;
  } | null>(null);
  const [dropConfirm, setDropConfirm] = useState<PendingDrop | null>(null);
  const [testConfirm, setTestConfirm] = useState<{
    eventType: string;
    hook: EventWebhookHook;
  } | null>(null);
  const [testHeadersOpen, setTestHeadersOpen] = useState(false);
  /** Prevent filters Dialog from closing while a nested combobox popover is open. */
  const [nestedComboboxOpen, setNestedComboboxOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["/api/admin/event-webhooks"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/event-webhooks");
      if (!res.ok) throw new Error("Failed to load event webhooks");
      return res.json() as Promise<WebhookSummary>;
    },
  });

  const deliveriesQuery = useQuery({
    queryKey: ["/api/admin/event-webhooks/deliveries", { hours: 48, for: "hook-rows" }],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/event-webhooks/deliveries?hours=48");
      if (!res.ok) throw new Error("Failed to load deliveries");
      return res.json() as Promise<{ deliveries: DeliveryRow[] }>;
    },
    enabled: tab === "hooks",
    refetchInterval: () => (tab === "hooks" && !document.hidden ? 15_000 : false),
  });

  const allowlist = summaryQuery.data?.allowlist ?? [];
  const config = summaryQuery.data?.config ?? { version: 1 as const, subscriptions: {} };
  const pending = summaryQuery.data?.pending ?? {};
  const siteKey = summaryQuery.data?.site ?? "";
  const eventTypes = useMemo(() => [...allowlist], [allowlist]);
  const filtersDialogOpen = editing?.mode === "filters";

  const proposersQuery = useQuery({
    queryKey: ["/api/admin/proposals/proposers", 30],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/proposals/proposers?days=30");
      if (!res.ok) throw new Error("Failed to load proposers");
      const data = (await res.json()) as { proposers?: string[] };
      return Array.isArray(data.proposers) ? data.proposers : [];
    },
    enabled: filtersDialogOpen,
    staleTime: 30_000,
  });

  const staffQuery = useQuery({
    queryKey: ["/api/staff"],
    queryFn: async () => {
      const token = getDebugToken();
      const headers: Record<string, string> = { ...getSessionHeaders() };
      if (token) {
        headers.Authorization = `Token ${token}`;
        headers["X-Debug-Token"] = token;
      }
      const res = await fetch("/api/staff", { headers });
      if (!res.ok) throw new Error("Failed to load staff");
      const data = await res.json();
      return Array.isArray(data?.staff) ? (data.staff as StaffDirectoryEntry[]) : [];
    },
    enabled: filtersDialogOpen,
    staleTime: 60_000,
  });

  const eventAuthorsQuery = useQuery({
    queryKey: ["/api/admin/events/authors", siteKey],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/events/authors?site=${encodeURIComponent(siteKey)}`,
      );
      if (!res.ok) throw new Error("Failed to load authors");
      const data = (await res.json()) as { authors?: string[] };
      return Array.isArray(data.authors) ? data.authors : [];
    },
    enabled: filtersDialogOpen && Boolean(siteKey),
    staleTime: 30_000,
  });

  const contentTypesQuery = useQuery({
    queryKey: ["/api/content-types"],
    queryFn: async () => {
      const res = await fetch("/api/content-types");
      if (!res.ok) return [] as Array<{ name: string; label: string }>;
      return res.json() as Promise<Array<{ name: string; label: string }>>;
    },
    enabled: filtersDialogOpen,
    staleTime: 60_000,
  });

  const localesQuery = useQuery({
    queryKey: ["/api/settings/locales"],
    queryFn: async () => {
      const res = await fetch("/api/settings/locales");
      if (!res.ok) {
        return { supported_locales: [{ code: "en", label: "English" }] };
      }
      return res.json() as Promise<{
        supported_locales?: Array<{ code: string; label: string }>;
      }>;
    },
    enabled: filtersDialogOpen,
    staleTime: 60_000,
  });

  const productsQuery = useQuery({
    queryKey: ["/api/ecommerce/products", "webhook-filter"],
    queryFn: async () => {
      const res = await apiFetch("/api/ecommerce/products");
      if (!res.ok) return [] as Array<{ name: string; content_slug: string }>;
      const data = (await res.json()) as {
        products?: Array<{ name: string; content_slug: string }>;
      };
      return Array.isArray(data.products) ? data.products : [];
    },
    enabled: filtersDialogOpen,
    staleTime: 60_000,
  });

  const funnelProductOptions = useMemo(() => {
    const seen = new Set<string>(["all"]);
    const opts: Array<{ value: string; label?: string }> = [
      { value: "all", label: "All products (awareness ideas)" },
    ];
    for (const p of productsQuery.data ?? []) {
      const slug = p.content_slug?.trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      opts.push({ value: slug, label: p.name && p.name !== slug ? p.name : undefined });
    }
    return opts;
  }, [productsQuery.data]);

  const proposerOptions = useMemo(
    () => (proposersQuery.data ?? []).map((u) => ({ value: u })),
    [proposersQuery.data],
  );

  const eventAuthorOptions = useMemo(() => {
    const staff = staffQuery.data ?? [];
    const logAuthors = eventAuthorsQuery.data ?? [];
    const staffSet = new Set(staff.map((s) => s.username));
    const opts = staff.map((s) => ({
      value: s.username,
      label: s.displayName !== s.username ? s.displayName : undefined,
    }));
    for (const a of logAuthors) {
      if (!staffSet.has(a)) opts.push({ value: a, label: undefined });
    }
    return opts;
  }, [staffQuery.data, eventAuthorsQuery.data]);

  const contentTypeOptions = useMemo(
    () =>
      (contentTypesQuery.data ?? []).map((ct) => ({
        value: ct.name,
        label: ct.label && ct.label !== ct.name ? ct.label : undefined,
      })),
    [contentTypesQuery.data],
  );

  const localeOptions = useMemo(
    () =>
      (localesQuery.data?.supported_locales ?? []).map((l) => ({
        value: l.code,
        label: l.label && l.label !== l.code ? l.label : undefined,
      })),
    [localesQuery.data],
  );

  const lastLiveByHook = useMemo(() => {
    const map = new Map<string, { created_at: number; status: "success" | "failure" | "skipped" }>();
    for (const d of deliveriesQuery.data?.deliveries ?? []) {
      if (d.source !== "live") continue;
      const key = bufferKey(d.event_type, d.hook_id);
      const prev = map.get(key);
      if (!prev || d.created_at > prev.created_at) {
        map.set(key, { created_at: d.created_at, status: d.status });
      }
    }
    return map;
  }, [deliveriesQuery.data?.deliveries]);

  const saveMutation = useMutation({
    mutationFn: async (next: EventWebhookConfig) => {
      const res = await apiRequestWithAuth("PUT", "/api/admin/event-webhooks", { config: next });
      return res.json() as Promise<WebhookSummary & { dropped_pending_count?: number }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/admin/event-webhooks"], data);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks/deliveries"] });
      toast({
        title: "Webhooks saved",
        description:
          (data.dropped_pending_count ?? 0) > 0
            ? `Dropped ${data.dropped_pending_count} waiting event(s).`
            : "Config written to event-webhooks.yml (content sync).",
      });
      setEditing(null);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ eventType, hookId }: { eventType: string; hookId: string }) => {
      const res = await apiRequestWithAuth(
        "DELETE",
        `/api/admin/event-webhooks/${encodeURIComponent(eventType)}/${encodeURIComponent(hookId)}`,
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks"] });
      toast({ title: "Hook removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async ({ eventType, hookId }: { eventType: string; hookId: string }) => {
      const res = await apiRequestWithAuth(
        "POST",
        `/api/admin/event-webhooks/${encodeURIComponent(eventType)}/${encodeURIComponent(hookId)}/test`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Test failed");
      return body;
    },
    onSuccess: () => {
      setTestConfirm(null);
      setTestHeadersOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks/deliveries"] });
      toast({ title: "Test sent", description: "Logged as Test in the 48h history." });
    },
    onError: (err: Error) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/event-webhooks/deliveries"] });
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  const buildNextConfig = (
    eventType: string,
    hook: EventWebhookHook,
    isNew: boolean,
  ): EventWebhookConfig => {
    const subscriptions: Record<string, EventWebhookHook[]> = { ...config.subscriptions };
    const list = [...(subscriptions[eventType] ?? [])];
    const idx = list.findIndex((h) => h.id === hook.id);
    if (isNew && idx >= 0) {
      throw new Error(`Hook id "${hook.id}" already exists for ${eventType}`);
    }
    if (idx >= 0) list[idx] = hook;
    else list.push(hook);
    subscriptions[eventType] = list;
    return { version: 1, subscriptions };
  };

  const pendingForEdit = editing
    ? pending[bufferKey(editing.eventType, editing.hook.id)] ?? 0
    : 0;

  const declaredFilterKeys = summaryQuery.data?.filter_keys;
  const filterKeysForEdit = editing
    ? declaredFilterKeys
      ? new Set(declaredFilterKeys[editing.eventType] ?? [])
      : null
    : new Set<string>();
  const showFilter = (key: string) =>
    filterKeysForEdit === null || filterKeysForEdit.has(key);
  const pageContentType = showFilter("content_types") && !showFilter("kinds");
  const showExcludeLists =
    showFilter("exclude_proposal_authors") ||
    showFilter("exclude_kinds") ||
    showFilter("exclude_content_types") ||
    showFilter("exclude_locales") ||
    showFilter("exclude_funnel_stages") ||
    showFilter("exclude_funnel_products");

  const previousHook =
    editing && !editing.isNew
      ? (config.subscriptions[editing.eventType] ?? []).find((h) => h.id === editing.hook.id)
      : null;

  const willDropOnSave =
    !!editing &&
    !editing.isNew &&
    !!previousHook &&
    pendingForEdit > 0 &&
    (editing.mode === "settings"
      ? editing.hook.url.trim() !== (previousHook.url || "") ||
        editing.hook.enabled === false ||
        (previousHook.enabled && !editing.hook.enabled)
      : !filtersEqual(editing.hook.filter, previousHook.filter));

  const requestSave = () => {
    if (!editing) return;

    if (editing.mode === "filters") {
      if (editing.isNew || !previousHook) {
        toast({ title: "Save the hook first", variant: "destructive" });
        return;
      }
      const filter = pruneFilter(editing.hook.filter);
      const hook: EventWebhookHook = {
        ...previousHook,
        ...(filter ? { filter } : {}),
      };
      if (!filter) {
        delete hook.filter;
      }
      let next: EventWebhookConfig;
      try {
        next = buildNextConfig(editing.eventType, hook, false);
      } catch (err) {
        toast({
          title: "Invalid hook",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return;
      }
      const apply = async () => {
        await saveMutation.mutateAsync(next);
      };
      if (willDropOnSave) {
        setDropConfirm({ kind: "save", count: pendingForEdit, apply });
        return;
      }
      void apply();
      return;
    }

    const hook: EventWebhookHook = {
      ...editing.hook,
      id: slugifyHookId(editing.hook.id).replace(/^-+|-+$/g, ""),
      url: editing.hook.url.trim(),
      debounce_ms: Math.min(
        600_000,
        Math.max(0, Math.floor(Number(editing.hook.debounce_ms) || 0)),
      ),
      max_wait_ms: Math.min(
        600_000,
        Math.max(0, Math.floor(Number(editing.hook.max_wait_ms) || 0)),
      ),
      max_events_per_call: Math.min(
        50,
        Math.max(1, Math.floor(Number(editing.hook.max_events_per_call) || 1)),
      ),
      headers: parseHeadersText(editing.headersText),
      // Preserve filters when editing settings; new hooks start with none.
      ...(editing.isNew
        ? {}
        : previousHook?.filter
          ? { filter: previousHook.filter }
          : {}),
    };
    if (editing.isNew) {
      delete hook.filter;
    } else if (!previousHook?.filter) {
      delete hook.filter;
    }
    if (!hook.id) {
      toast({ title: "Hook id required", variant: "destructive" });
      return;
    }
    if (throttleTimingInvalid(hook)) {
      toast({
        title: "Max wait too short",
        description: "Max wait must be greater than or equal to the quiet period (or set either to 0).",
        variant: "destructive",
      });
      return;
    }
    if (hook.enabled && !hook.url) {
      toast({ title: "URL required when enabled", variant: "destructive" });
      return;
    }
    let next: EventWebhookConfig;
    try {
      next = buildNextConfig(editing.eventType, hook, editing.isNew);
    } catch (err) {
      toast({
        title: "Invalid hook",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return;
    }
    const apply = async () => {
      await saveMutation.mutateAsync(next);
    };
    if (willDropOnSave) {
      setDropConfirm({ kind: "save", count: pendingForEdit, apply });
      return;
    }
    void apply();
  };

  const requestDelete = (eventType: string, hook: EventWebhookHook) => {
    const count = pending[bufferKey(eventType, hook.id)] ?? 0;
    const apply = async () => {
      await deleteMutation.mutateAsync({ eventType, hookId: hook.id });
      setEditing(null);
    };
    if (count > 0) {
      setDropConfirm({ kind: "delete", count, apply });
      return;
    }
    void apply();
  };

  const requestToggleEnabled = (
    eventType: string,
    hook: EventWebhookHook,
    enabled: boolean,
  ) => {
    if (hook.enabled === enabled) return;
    if (enabled && !hook.url.trim()) {
      toast({
        title: "URL required",
        description: "Add a URL before turning this hook on.",
        variant: "destructive",
      });
      return;
    }
    const nextHook = { ...hook, enabled };
    const next = buildNextConfig(eventType, nextHook, false);
    const waiting = pending[bufferKey(eventType, hook.id)] ?? 0;
    const apply = async () => {
      await saveMutation.mutateAsync(next);
    };
    if (!enabled && waiting > 0) {
      setDropConfirm({ kind: "save", count: waiting, apply });
      return;
    }
    void apply();
  };

  return (
    <>
      <div className="space-y-6" data-testid="panel-event-webhooks">
        {tab === "hooks" ? (
          <>
            <Collapsible open={advanced} onOpenChange={setAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
                  {advanced ? "Hide advanced" : "Read more (advanced)"}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="text-xs text-muted-foreground space-y-1 pt-1">
                <p>
                  File: <code className="font-mono">event-webhooks.yml</code>. Allowlisted proposal event
                  types only. Timing keys: <code className="font-mono">debounce_ms</code>,{" "}
                  <code className="font-mono">max_wait_ms</code>, safety{" "}
                  <code className="font-mono">max_events_per_call</code>. Waiting events live in site
                  SQLite until due; saving re-checks timing. Changing URL or disabling drops waiting
                  events. Slim JSON payload; optional code enrichers. Production proposal import does
                  not notify.
                </p>
              </CollapsibleContent>
            </Collapsible>

            {summaryQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    {summaryQuery.data?.enabled_hook_count ?? 0} enabled hook
                    {(summaryQuery.data?.enabled_hook_count ?? 0) === 1 ? "" : "s"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void summaryQuery.refetch();
                      void deliveriesQuery.refetch();
                    }}
                  >
                    <IconRefresh className="h-3.5 w-3.5 mr-1.5" />
                    Refresh
                  </Button>
                </div>

                <div className="space-y-4">
                  {eventTypes.map((eventType) => {
                    const hooks = config.subscriptions[eventType] ?? [];
                    return (
                      <div key={eventType} className="rounded-md border border-border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs font-mono">{eventType}</code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setEditing({
                                mode: "settings",
                                eventType,
                                hook: emptyHook(`hook-${hooks.length + 1}`),
                                headersText: "",
                                isNew: true,
                              })
                            }
                            data-testid={`button-add-hook-${eventType}`}
                          >
                            <IconPlus className="h-3.5 w-3.5 mr-1" />
                            Add hook
                          </Button>
                        </div>
                        {hooks.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No hooks</p>
                        ) : (
                          <ul className="space-y-2">
                        {hooks.map((hook) => {
                          const waiting = pending[bufferKey(eventType, hook.id)] ?? 0;
                          const lastLive = lastLiveByHook.get(bufferKey(eventType, hook.id));
                          return (
                            <li
                              key={hook.id}
                              className="flex flex-wrap items-center gap-2 justify-between rounded-md bg-muted/40 px-2 py-2"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">{hook.id}</span>
                                  <ToggleButtonBar
                                    value={hook.enabled ? "on" : "off"}
                                    onValueChange={(v) => {
                                      if (v !== "on" && v !== "off") return;
                                      requestToggleEnabled(eventType, hook, v === "on");
                                    }}
                                    className="shrink-0"
                                    listClassName="h-7"
                                    listTestId={`toggle-hook-enabled-${eventType}-${hook.id}`}
                                  >
                                    <ToggleButtonBarTrigger
                                      value="on"
                                      className="px-2 py-0.5"
                                      disabled={saveMutation.isPending}
                                    >
                                      On
                                    </ToggleButtonBarTrigger>
                                    <ToggleButtonBarTrigger
                                      value="off"
                                      className="px-2 py-0.5"
                                      disabled={saveMutation.isPending}
                                    >
                                      Off
                                    </ToggleButtonBarTrigger>
                                  </ToggleButtonBar>
                                  <span className="text-xs text-muted-foreground">
                                    {formatThrottleSummary(hook)}
                                  </span>
                                  {waiting > 0 ? (
                                    <span className="text-xs text-amber-500">{waiting} waiting</span>
                                  ) : null}
                                </div>
                                <p className="text-xs text-muted-foreground truncate max-w-md">
                                  {hook.url ? hostOf(hook.url) : "No URL"}
                                  <span className="text-muted-foreground/80"> · </span>
                                  {lastLive ? (
                                    <>
                                      last{" "}
                                      <span
                                        className={cn(
                                          lastLive.status === "success"
                                            ? "text-status-online"
                                            : "text-destructive",
                                        )}
                                      >
                                        {formatRelativeShort(lastLive.created_at)}
                                      </span>
                                    </>
                                  ) : (
                                    <span>Never triggered</span>
                                  )}
                                </p>
                                <HookFilterBadges
                                  hook={hook}
                                  testIdSuffix={`${eventType}-${hook.id}`}
                                />
                              </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      disabled={!hook.url || testMutation.isPending}
                                      onClick={() => setTestConfirm({ eventType, hook })}
                                      data-testid={`button-test-hook-${eventType}-${hook.id}`}
                                    >
                                      <IconSend className="h-3.5 w-3.5 mr-1" />
                                      Test
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label="Edit filters"
                                      title="Filters"
                                      onClick={() =>
                                        setEditing({
                                          mode: "filters",
                                          eventType,
                                          hook: { ...hook },
                                          headersText: headersToText(hook.headers),
                                          isNew: false,
                                        })
                                      }
                                      data-testid={`button-edit-hook-filters-${eventType}-${hook.id}`}
                                    >
                                      <IconFilter className="h-3.5 w-3.5" />
                                      {filterActiveCount(hook.filter) > 0 ? (
                                        <Badge
                                          variant="secondary"
                                          className="ml-1 h-5 min-w-5 px-1 text-[10px]"
                                        >
                                          {filterActiveCount(hook.filter)}
                                        </Badge>
                                      ) : null}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label="Edit hook settings"
                                      title="Settings"
                                      onClick={() =>
                                        setEditing({
                                          mode: "settings",
                                          eventType,
                                          hook: { ...hook },
                                          headersText: headersToText(hook.headers),
                                          isNew: false,
                                        })
                                      }
                                      data-testid={`button-edit-hook-settings-${eventType}-${hook.id}`}
                                    >
                                      <IconPencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : null}

        {tab === "logs" ? (
          <EventWebhookLogsPanel config={config} allowlist={allowlist} />
        ) : null}
      </div>

      <Dialog
        open={editing?.mode === "settings"}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-background text-foreground"
          data-testid="form-event-webhook-edit"
        >
          {editing?.mode === "settings" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editing.isNew ? "New hook" : "Edit hook"}
                </DialogTitle>
                <DialogDescription>
                  Events wait briefly so a burst becomes one notification. They always send within
                  the max wait, even if more keep arriving. Event{" "}
                  <code className="font-mono text-xs">{editing.eventType}</code>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <div className="space-y-1.5">
                  <Label htmlFor="hook-id">Id</Label>
                  <Input
                    id="hook-id"
                    value={editing.hook.id}
                    disabled={!editing.isNew}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        hook: { ...editing.hook, id: slugifyHookId(e.target.value) },
                      })
                    }
                    placeholder="my-hook"
                    data-testid="input-hook-id"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, hyphens, or underscores. Spaces become hyphens.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="hook-quiet">Quiet period (seconds)</Label>
                    <Input
                      id="hook-quiet"
                      type="number"
                      min={0}
                      max={600}
                      value={Math.round((editing.hook.debounce_ms ?? 0) / 1000)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          hook: {
                            ...editing.hook,
                            debounce_ms: Math.max(0, Math.floor(Number(e.target.value) || 0) * 1000),
                          },
                        })
                      }
                      data-testid="input-hook-debounce-sec"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hook-max-wait">Max wait (seconds)</Label>
                    <Input
                      id="hook-max-wait"
                      type="number"
                      min={0}
                      max={600}
                      value={Math.round((editing.hook.max_wait_ms ?? 0) / 1000)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          hook: {
                            ...editing.hook,
                            max_wait_ms: Math.max(0, Math.floor(Number(e.target.value) || 0) * 1000),
                          },
                        })
                      }
                      data-testid="input-hook-max-wait-sec"
                    />
                  </div>
                </div>
                {throttleTimingInvalid(editing.hook) ? (
                  <p className="text-xs text-destructive" data-testid="text-hook-timing-error">
                    Max wait must be greater than or equal to the quiet period (or set either to 0).
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Set both to 0 to notify on every event. Defaults are 30s quiet / 60s max.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="hook-max-events">Max events per call (safety)</Label>
                  <Input
                    id="hook-max-events"
                    type="number"
                    min={1}
                    max={50}
                    value={editing.hook.max_events_per_call ?? DEFAULT_MAX_EVENTS}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        hook: {
                          ...editing.hook,
                          max_events_per_call: Math.min(
                            50,
                            Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          ),
                        },
                      })
                    }
                    data-testid="input-hook-max-events"
                  />
                  <p className="text-xs text-muted-foreground">
                    Flush early if this many events pile up before the quiet/max wait timers. Max 50.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hook-url">URL</Label>
                  <Input
                    id="hook-url"
                    value={editing.hook.url}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        hook: { ...editing.hook, url: e.target.value },
                      })
                    }
                    placeholder="https://"
                    data-testid="input-hook-url"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.hook.enabled}
                    onCheckedChange={(enabled) =>
                      setEditing({
                        ...editing,
                        hook: { ...editing.hook, enabled },
                      })
                    }
                    data-testid="switch-hook-enabled"
                  />
                  <Label>Enabled</Label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hook-headers">Headers (optional)</Label>
                  <textarea
                    id="hook-headers"
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editing.headersText}
                    onChange={(e) => setEditing({ ...editing, headersText: e.target.value })}
                    placeholder={"Authorization: Bearer …"}
                  />
                  <p className="text-xs text-muted-foreground">
                    One header per line as <code className="font-mono">Name: value</code>. Secrets
                    such as Authorization are stored encrypted. A masked value is already saved:
                    leave it to keep it, replace it to change it, or delete the line to remove it.
                  </p>
                </div>
                {willDropOnSave ? (
                  <p className="text-xs text-amber-500">
                    Saving will drop {pendingForEdit} waiting event(s) for this hook. They will not
                    be sent.
                  </p>
                ) : null}
              </div>
              <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                {!editing.isNew ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => requestDelete(editing.eventType, editing.hook)}
                    disabled={deleteMutation.isPending}
                    className="sm:mr-auto"
                  >
                    <IconTrash className="h-3.5 w-3.5 mr-1.5" />
                    Remove
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={requestSave}
                    disabled={saveMutation.isPending || throttleTimingInvalid(editing.hook)}
                    data-testid="button-save-hook"
                  >
                    {saveMutation.isPending ? (
                      <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        modal={false}
        open={editing?.mode === "filters"}
        onOpenChange={(open) => {
          if (!open && nestedComboboxOpen) return;
          if (!open) {
            setEditing(null);
            setNestedComboboxOpen(false);
          }
        }}
      >
        <DialogContent
          forceOverlay
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-background text-foreground"
          data-testid="form-event-webhook-filters"
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
        >
          {editing?.mode === "filters" ? (
            <>
              <DialogHeader>
                <DialogTitle>Hook filters</DialogTitle>
                <DialogDescription>
                  Only fire when every filled condition matches. Leave blank for any. Hook{" "}
                  <code className="font-mono text-xs">{editing.hook.id}</code> ·{" "}
                  <code className="font-mono text-xs">{editing.eventType}</code>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                {showFilter("proposal_authors") || showFilter("proposal_models") ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {showFilter("proposal_authors") ? (
                  <div className="space-y-1.5">
                    <Label>Proposal writer</Label>
                    <SearchableMultiCombobox
                      values={editing.hook.filter?.proposal_authors ?? []}
                      onChange={(proposal_authors) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { proposal_authors }),
                        })
                      }
                      options={proposerOptions}
                      isLoading={proposersQuery.isLoading}
                      placeholder="Any writer"
                      searchPlaceholder="Search proposers…"
                      emptyMessage="No proposers in the last 30 days"
                      onOpenChange={setNestedComboboxOpen}
                      testId="filter-proposal-authors"
                      mono
                    />
                  </div>
                  ) : null}
                  {showFilter("proposal_models") ? (
                  <div className="space-y-1.5">
                    <Label>Writer model</Label>
                    <TagInput
                      values={editing.hook.filter?.proposal_models ?? []}
                      suggestions={[]}
                      onChange={(proposal_models) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { proposal_models }),
                        })
                      }
                      placeholder="e.g. grok*"
                      testId="input-filter-proposal-models"
                      emptyMessage="Model id or prefix ending in *"
                    />
                    <p className="text-xs text-muted-foreground">
                      Match the model that wrote the proposal. Example:{" "}
                      <code className="font-mono text-[11px]">grok*</code> matches{" "}
                      <code className="font-mono text-[11px]">grok-4</code> and{" "}
                      <code className="font-mono text-[11px]">grok-4.1</code>.{" "}
                      <Popover modal={false} onOpenChange={setNestedComboboxOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="underline underline-offset-2 hover:text-foreground"
                            data-testid="button-writer-model-more-examples"
                          >
                            More examples
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="z-[10001] w-80 space-y-2 p-3 text-xs text-muted-foreground"
                          sideOffset={6}
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          data-testid="popover-writer-model-examples"
                        >
                          <p className="font-medium text-foreground">Writer model matching</p>
                          <ul className="space-y-2 list-none">
                            <li>
                              <code className="font-mono text-[11px] text-foreground">grok*</code>
                              <span className="block mt-0.5">
                                Any model id that starts with <code className="font-mono">grok</code>{" "}
                                (family match — usual pick for “wake this swarm”).
                              </span>
                            </li>
                            <li>
                              <code className="font-mono text-[11px] text-foreground">
                                anthropic/claude-sonnet-4*
                              </code>
                              <span className="block mt-0.5">
                                Prefix of a provider-scoped id; catches version suffixes after the
                                star.
                              </span>
                            </li>
                            <li>
                              <code className="font-mono text-[11px] text-foreground">
                                gpt-5.6-sol-medium
                              </code>
                              <span className="block mt-0.5">
                                Exact id only (case-insensitive). Use when one specific model must
                                match — not siblings like{" "}
                                <code className="font-mono">gpt-5.6-sol-high</code>.
                              </span>
                            </li>
                            <li>
                              <code className="font-mono text-[11px] text-foreground">claude*</code>
                              {" + "}
                              <code className="font-mono text-[11px] text-foreground">gpt*</code>
                              <span className="block mt-0.5">
                                Add several tags: a proposal matches if its model hits{" "}
                                <span className="font-medium text-foreground">any</span> of them.
                              </span>
                            </li>
                            <li>
                              <span className="text-foreground font-medium">Empty</span>
                              <span className="block mt-0.5">
                                No model gate — any writer model (or missing model) is allowed.
                              </span>
                            </li>
                          </ul>
                          <p>
                            Tip: prefer a short prefix with{" "}
                            <code className="font-mono">*</code> over a brittle full string; model
                            labels drift between providers.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </p>
                  </div>
                  ) : null}
                </div>
                ) : null}
                {showFilter("event_authors") || showFilter("kinds") ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {showFilter("event_authors") ? (
                  <div className="space-y-1.5">
                    <Label>Who triggered this event</Label>
                    <SearchableMultiCombobox
                      values={editing.hook.filter?.event_authors ?? []}
                      onChange={(event_authors) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { event_authors }),
                        })
                      }
                      options={eventAuthorOptions}
                      isLoading={staffQuery.isLoading || eventAuthorsQuery.isLoading}
                      placeholder="Anyone"
                      searchPlaceholder="Search authors…"
                      emptyMessage="No authors found"
                      onOpenChange={setNestedComboboxOpen}
                      testId="filter-event-authors"
                      mono
                    />
                  </div>
                  ) : null}
                  {showFilter("kinds") ? (
                  <div className="space-y-1.5">
                    <Label>Kind</Label>
                    <KindChips
                      values={editing.hook.filter?.kinds ?? []}
                      onChange={(kinds) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { kinds }),
                        })
                      }
                      testId="chips-filter-kinds"
                    />
                  </div>
                  ) : null}
                </div>
                ) : null}
                {showFilter("content_types") || showFilter("locales") ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {showFilter("content_types") ? (
                  <div className="space-y-1.5">
                    <Label>Content type</Label>
                    <SearchableMultiCombobox
                      values={editing.hook.filter?.content_types ?? []}
                      onChange={(content_types) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { content_types }),
                        })
                      }
                      options={contentTypeOptions}
                      isLoading={contentTypesQuery.isLoading}
                      placeholder="Any content type"
                      searchPlaceholder="Search content types…"
                      emptyMessage="No content types"
                      onOpenChange={setNestedComboboxOpen}
                      testId="filter-content-types"
                      mono
                    />
                    {pageContentType ? (
                      <p className="text-xs text-muted-foreground" data-testid="text-page-content-type-filter">
                        The entry&apos;s content type.
                      </p>
                    ) : null}
                  </div>
                  ) : null}
                  {showFilter("locales") ? (
                  <div className="space-y-1.5">
                    <Label>Locale</Label>
                    <SearchableMultiCombobox
                      values={editing.hook.filter?.locales ?? []}
                      onChange={(locales) =>
                        setEditing({
                          ...editing,
                          hook: patchFilter(editing.hook, { locales }),
                        })
                      }
                      options={localeOptions}
                      isLoading={localesQuery.isLoading}
                      placeholder="Any locale"
                      searchPlaceholder="Search locales…"
                      emptyMessage="No locales"
                      onOpenChange={setNestedComboboxOpen}
                      testId="filter-locales"
                      mono
                    />
                  </div>
                  ) : null}
                </div>
                ) : null}
                {showFilter("funnel_stages") || showFilter("funnel_products") ? (
                <div className="space-y-1.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {showFilter("funnel_stages") ? (
                    <div className="space-y-1.5">
                      <Label>Funnel stage</Label>
                      <FunnelStageChips
                        values={editing.hook.filter?.funnel_stages ?? []}
                        onChange={(funnel_stages) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { funnel_stages }),
                          })
                        }
                        testId="chips-filter-funnel-stages"
                      />
                    </div>
                    ) : null}
                    {showFilter("funnel_products") ? (
                    <div className="space-y-1.5">
                      <Label>Funnel product</Label>
                      <SearchableMultiCombobox
                        values={editing.hook.filter?.funnel_products ?? []}
                        onChange={(funnel_products) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { funnel_products }),
                          })
                        }
                        options={funnelProductOptions}
                        isLoading={productsQuery.isLoading}
                        placeholder="Any product"
                        searchPlaceholder="Search products…"
                        emptyMessage="No products"
                        onOpenChange={setNestedComboboxOpen}
                        testId="filter-funnel-products"
                        mono
                      />
                    </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground" data-testid="text-funnel-filter-help">
                    Only idea proposals have a funnel. Edits, notes, and ideas without a funnel
                    won&apos;t match. Ideas for all products match any product.
                  </p>
                </div>
                ) : null}
                {showFilter("event_actor_types") ? (
                <div className="space-y-1.5">
                  <Label>Event source</Label>
                  <ActorTypeChips
                    values={editing.hook.filter?.event_actor_types ?? []}
                    onChange={(event_actor_types) =>
                      setEditing({
                        ...editing,
                        hook: patchFilter(editing.hook, { event_actor_types }),
                      })
                    }
                    testId="chips-filter-event-actor-types"
                  />
                </div>
                ) : null}
                {showExcludeLists ? (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs">
                      <IconChevronDown className="h-3.5 w-3.5 mr-1" />
                      Exclude lists
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-2">
                    {showFilter("exclude_proposal_authors") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude proposal writers</Label>
                      <SearchableMultiCombobox
                        values={editing.hook.filter?.exclude_proposal_authors ?? []}
                        onChange={(exclude_proposal_authors) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_proposal_authors }),
                          })
                        }
                        options={proposerOptions}
                        isLoading={proposersQuery.isLoading}
                        placeholder="None excluded"
                        searchPlaceholder="Search proposers…"
                        onOpenChange={setNestedComboboxOpen}
                        testId="filter-exclude-proposal-authors"
                        mono
                      />
                    </div>
                    ) : null}
                    {showFilter("exclude_kinds") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude kinds</Label>
                      <KindChips
                        values={editing.hook.filter?.exclude_kinds ?? []}
                        onChange={(exclude_kinds) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_kinds }),
                          })
                        }
                      />
                    </div>
                    ) : null}
                    {showFilter("exclude_content_types") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude content types</Label>
                      <SearchableMultiCombobox
                        values={editing.hook.filter?.exclude_content_types ?? []}
                        onChange={(exclude_content_types) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_content_types }),
                          })
                        }
                        options={contentTypeOptions}
                        isLoading={contentTypesQuery.isLoading}
                        placeholder="None excluded"
                        searchPlaceholder="Search content types…"
                        onOpenChange={setNestedComboboxOpen}
                        testId="filter-exclude-content-types"
                        mono
                      />
                    </div>
                    ) : null}
                    {showFilter("exclude_locales") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude locales</Label>
                      <SearchableMultiCombobox
                        values={editing.hook.filter?.exclude_locales ?? []}
                        onChange={(exclude_locales) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_locales }),
                          })
                        }
                        options={localeOptions}
                        isLoading={localesQuery.isLoading}
                        placeholder="None excluded"
                        searchPlaceholder="Search locales…"
                        onOpenChange={setNestedComboboxOpen}
                        testId="filter-exclude-locales"
                        mono
                      />
                    </div>
                    ) : null}
                    {showFilter("exclude_funnel_stages") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude funnel stages</Label>
                      <FunnelStageChips
                        values={editing.hook.filter?.exclude_funnel_stages ?? []}
                        onChange={(exclude_funnel_stages) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_funnel_stages }),
                          })
                        }
                        testId="chips-filter-exclude-funnel-stages"
                      />
                    </div>
                    ) : null}
                    {showFilter("exclude_funnel_products") ? (
                    <div className="space-y-1.5">
                      <Label>Exclude funnel products</Label>
                      <SearchableMultiCombobox
                        values={editing.hook.filter?.exclude_funnel_products ?? []}
                        onChange={(exclude_funnel_products) =>
                          setEditing({
                            ...editing,
                            hook: patchFilter(editing.hook, { exclude_funnel_products }),
                          })
                        }
                        options={funnelProductOptions}
                        isLoading={productsQuery.isLoading}
                        placeholder="None excluded"
                        searchPlaceholder="Search products…"
                        onOpenChange={setNestedComboboxOpen}
                        testId="filter-exclude-funnel-products"
                        mono
                      />
                    </div>
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
                ) : null}
                {willDropOnSave ? (
                  <p className="text-xs text-amber-500">
                    Saving will drop {pendingForEdit} waiting event(s) for this hook. They will not
                    be sent.
                  </p>
                ) : null}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={requestSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-hook-filters"
                >
                  {saveMutation.isPending ? (
                    <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : null}
                  Save filters
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!testConfirm}
        onOpenChange={(open) => {
          if (!open && !testMutation.isPending) {
            setTestConfirm(null);
            setTestHeadersOpen(false);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-lg bg-background text-foreground"
          data-testid="dialog-event-webhook-test"
        >
          {testConfirm ? (
            <>
              <DialogHeader>
                <DialogTitle>Send test webhook?</DialogTitle>
                <DialogDescription>
                  We will POST a sample JSON body to this hook&apos;s URL right away. It is logged
                  as Test in the 48-hour delivery history. Waiting events, the live throttle
                  buffer, and hook filters are not applied (filters still apply to live traffic).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Endpoint
                  </p>
                  <p className="font-mono text-xs break-all rounded-md border border-border bg-muted/40 px-2 py-1.5">
                    <span className="inline-block rounded bg-zinc-800 text-zinc-100 px-1.5 py-0.5 mr-1.5 font-semibold tracking-wide">
                      POST
                    </span>
                    {testConfirm.hook.url}
                  </p>
                </div>
                <Collapsible open={testHeadersOpen} onOpenChange={setTestHeadersOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground"
                    >
                      <IconChevronDown
                        className={cn(
                          "h-3.5 w-3.5 mr-1 transition-transform",
                          testHeadersOpen && "rotate-180",
                        )}
                      />
                      Headers
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <pre className="font-mono text-xs whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 max-h-28 overflow-y-auto">
                      {headerPreviewLines(testConfirm.hook.headers).join("\n")}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Payload
                  </p>
                  <div className="overflow-hidden rounded-md border border-border max-h-56">
                    <JsonViewer
                      value={JSON.stringify(
                        buildTestPayloadPreview({
                          site: summaryQuery.data?.site || "(current site)",
                          eventType: testConfirm.eventType,
                          hook: testConfirm.hook,
                        }),
                        null,
                        2,
                      )}
                      className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-auto [&_.cm-editor]:!max-h-56 [&_.cm-editor]:!text-xs"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">events</code> is empty for tests.{" "}
                    <code className="font-mono">triggered_at</code> is set again at send time.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTestConfirm(null)}
                  disabled={testMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    testMutation.mutate({
                      eventType: testConfirm.eventType,
                      hookId: testConfirm.hook.id,
                    })
                  }
                  disabled={testMutation.isPending}
                  data-testid="button-confirm-webhook-test"
                >
                  {testMutation.isPending ? (
                    <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <IconSend className="h-4 w-4 mr-1.5" />
                  )}
                  Send test
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!dropConfirm} onOpenChange={(o) => !o && setDropConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop waiting events?</AlertDialogTitle>
            <AlertDialogDescription>
              {editing?.mode === "filters"
                ? `Changing filters will drop ${dropConfirm?.count ?? 0} waiting event(s). They will not be sent.`
                : `Turning this off or changing the URL will drop ${dropConfirm?.count ?? 0} waiting event(s). They will not be sent.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const apply = dropConfirm?.apply;
                setDropConfirm(null);
                void apply?.();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Compact KPI for proposals list — navigates to /private/webhooks/hooks. */
export function EventWebhooksKpiButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["/api/admin/event-webhooks"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/event-webhooks");
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<WebhookSummary>;
    },
    staleTime: 30_000,
  });
  const on = (data?.enabled_hook_count ?? 0) > 0;
  const last = data?.last_delivery;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full min-h-[7.5rem] w-full flex-col gap-2 rounded-card border border-card-border bg-card p-4 text-left shadow-card hover-elevate transition-colors",
        className,
      )}
      data-testid="kpi-event-webhooks"
    >
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="min-w-0">
          <p
            className={cn(
              "text-2xl font-bold tabular-nums",
              on ? "text-status-online" : "text-muted-foreground",
            )}
          >
            {on ? "On" : "Off"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Webhooks</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <IconWebhook className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Badge variant={on ? "default" : "secondary"} className="text-[10px]">
            {on ? "Live" : "Setup"}
          </Badge>
          {last ? (
            <p className="text-[10px] text-muted-foreground text-right leading-snug max-w-[7rem]">
              last {last.status}
              {last.source === "test" ? " (test)" : ""}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug w-full">
        {on
          ? `${data?.enabled_hook_count} hook${data?.enabled_hook_count === 1 ? "" : "s"} · real-time swarm notify`
          : "Enable notify URLs for agentic swarms"}
      </p>
    </button>
  );
}
