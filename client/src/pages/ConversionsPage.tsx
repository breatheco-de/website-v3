import { useState, useEffect, useRef, Fragment } from "react";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBraces,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconLink,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconSend,
  IconTargetArrow,
  IconTrash,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import JsonViewer from "@/components/editing/JsonViewer";
import { AutomationsTagsCard } from "@/components/editing/AutomationsTagsCard";
import { ConsentCard } from "@/components/editing/ConsentCard";
import type { ConsentValues } from "@/components/editing/ConsentCard";
import { WebhookCard } from "@/components/editing/WebhookCard";
import { SuccessCard } from "@/components/editing/SuccessCard";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { type TrackingSettingsResponse, type ConversionEventEntry } from "@/lib/tracking";
import {
  cardValuesToEventConsent,
  consentKeyFromYamlField,
  consentLabelFromKey,
  eventConsentToCardValues,
  extraConsentYamlFieldsFromObject,
} from "@shared/consent-settings";
import {
  CONVERSION_INTENT_MAX_CHARS,
  CONVERSION_INTENT_MIN_CHARS,
  isConversionIntentFieldValid,
} from "@shared/conversionEventIntent";
import { buildWebhookSamplePayload } from "@/lib/webhookPayload";
import { useSession } from "@/contexts/SessionContext";
import { Textarea } from "@/components/ui/textarea";

const SAMPLE_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const INTENT_FIELD_HINT = `2–4 sentences · ${CONVERSION_INTENT_MIN_CHARS}–${CONVERSION_INTENT_MAX_CHARS} characters. Agents match visitor CTA copy to these fields when choosing conversion_name.`;

interface EditingEventState {
  originalName: string;
  name: string;
  description: string;
  when_to_use: string;
  when_not_to_use: string;
  automations: string;
  tags: string[];
  consent: ConsentValues;
  successMessage: string;
  successUrl: string;
  successEditing: boolean;
  webhookUrl: string;
  webhookMethod: "POST" | "GET";
  webhookAuthHeader: string;
  webhookEditing: boolean;
}

function makeEditingState(entry: ConversionEventEntry): EditingEventState {
  return {
    originalName: entry.name,
    name: entry.name,
    description: entry.description ?? "",
    when_to_use: entry.when_to_use ?? "",
    when_not_to_use: entry.when_not_to_use ?? "",
    automations: entry.automations ?? "",
    tags: entry.tags ?? [],
    consent: eventConsentToCardValues(entry.consent),
    successMessage: entry.success?.message ?? "",
    successUrl: entry.success?.url ?? "",
    successEditing: false,
    webhookUrl: entry.webhook?.url ?? "",
    webhookMethod: entry.webhook?.method ?? "POST",
    webhookAuthHeader: entry.webhook?.auth_header ?? "",
    webhookEditing: false,
  };
}

function IntentCharCount({ value }: { value: string }) {
  const n = value.trim().length;
  const ok = isConversionIntentFieldValid(value);
  return (
    <span className={ok ? "text-muted-foreground" : "text-destructive"}>
      {n}/{CONVERSION_INTENT_MAX_CHARS}
      {n > 0 && n < CONVERSION_INTENT_MIN_CHARS
        ? ` · need ${CONVERSION_INTENT_MIN_CHARS - n} more`
        : ""}
    </span>
  );
}

interface UsageEntry {
  file: string;
  content_type: string;
  slug: string;
  locale: string;
  section_id: string;
  section_type: string;
  tags?: string[];
  consent?: Record<string, unknown>;
  page_url: string | null;
}

interface TrackingEvent {
  name: string;
  trigger: string;
  payload: Record<string, unknown>;
}

function PageLinkMenu({ url, className }: { url: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative shrink-0 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Open page"
      >
        <IconExternalLink className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-44 rounded-md border bg-popover shadow-md overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover-elevate"
            onClick={() => { window.location.href = url; setOpen(false); }}
          >
            <IconArrowRight className="h-3.5 w-3.5 shrink-0" />
            Open here
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover-elevate"
            onClick={() => { window.open(url, "_blank", "noopener,noreferrer"); setOpen(false); }}
          >
            <IconExternalLink className="h-3.5 w-3.5 shrink-0" />
            Open in new window
          </button>
        </div>
      )}
    </div>
  );
}

function UsageRows({ eventName }: { eventName: string }) {
  const { data, isFetching } = useQuery<{ name: string; usages: UsageEntry[] }>({
    queryKey: ["/api/settings/tracking/conversion-events", eventName, "usage"],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/settings/tracking/conversion-events/${encodeURIComponent(eventName)}/usage`
      );
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
  });

  if (isFetching) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        Loading usage…
      </div>
    );
  }

  if (!data || data.usages.length === 0) {
    return (
      <p className="py-2 px-3 text-xs text-muted-foreground">
        No forms are currently using this event.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {data.usages.map((u, i) => (
        <li key={i} className="flex items-center gap-1.5 flex-wrap py-1.5 px-3 text-xs">
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
            {u.content_type}/{u.slug}
          </span>
          <span className="text-muted-foreground">({u.locale})</span>
          {u.section_type && (
            <span className="text-muted-foreground">· {u.section_type}</span>
          )}
          {u.tags && u.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 font-normal" data-testid={`badge-usage-tag-${tag}`}>
              {tag}
            </Badge>
          ))}
          {u.consent && Object.keys(u.consent).length > 0 && (
            <Badge
              variant="outline"
              className="text-xs px-1.5 py-0 font-normal"
              title={`Consent override: ${Object.keys(u.consent).join(", ")}`}
              data-testid="badge-usage-consent"
            >
              consent: {Object.keys(u.consent).join(" · ")}
            </Badge>
          )}
          {u.page_url && (
            <PageLinkMenu url={u.page_url} className="ml-auto" />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ConversionsPage() {
  return (
    <MetricsAccessGate>
      <ConversionsPageInner />
    </MetricsAccessGate>
  );
}

function ConversionsPageInner() {
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const { session } = useSession();

  const sessionEnrichedPayload = buildWebhookSamplePayload(null, null, session);

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<TrackingEvent | null>(null);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventDesc, setNewEventDesc] = useState("");
  const [newEventWhenToUse, setNewEventWhenToUse] = useState("");
  const [newEventWhenNotToUse, setNewEventWhenNotToUse] = useState("");
  const [deleteConfirmEvent, setDeleteConfirmEvent] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<EditingEventState | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [usageModalEvent, setUsageModalEvent] = useState<string | null>(null);
  const [checkedRows, setCheckedRows] = useState<Set<number>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState("");

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState("POST");
  const [webhookAuthHeader, setWebhookAuthHeader] = useState("");
  const [webhookEditing, setWebhookEditing] = useState(false);
  const [removeWebhookConfirmOpen, setRemoveWebhookConfirmOpen] = useState(false);
  const [samplePayloadOpen, setSamplePayloadOpen] = useState(false);
  const [signupEventNameDraft, setSignupEventNameDraft] = useState("sign_up");
  const [loginEventNameDraft, setLoginEventNameDraft] = useState("login");

  const { data: trackingSettings } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });
  const conversionEventEntries = trackingSettings?.conversion_events ?? [];

  useEffect(() => {
    if (trackingSettings?.webhook) {
      setWebhookUrl(trackingSettings.webhook.url);
      setWebhookMethod(trackingSettings.webhook.method ?? "POST");
      setWebhookAuthHeader(trackingSettings.webhook.auth_header ?? "");
    }
  }, [trackingSettings?.webhook]);

  useEffect(() => {
    if (typeof trackingSettings?.signup_event_name === "string" && trackingSettings.signup_event_name) {
      setSignupEventNameDraft(trackingSettings.signup_event_name);
    }
    if (typeof trackingSettings?.login_event_name === "string" && trackingSettings.login_event_name) {
      setLoginEventNameDraft(trackingSettings.login_event_name);
    }
  }, [trackingSettings?.signup_event_name, trackingSettings?.login_event_name]);

  const { data: conversionCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/form-state/conversion-counts"],
  });

  const { data: usageModalData, isFetching: usageModalFetching } = useQuery<{
    name: string;
    usages: UsageEntry[];
  }>({
    queryKey: ["/api/settings/tracking/conversion-events", usageModalEvent, "usage"],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/settings/tracking/conversion-events/${encodeURIComponent(usageModalEvent!)}/usage`
      );
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    enabled: !!usageModalEvent,
  });

  const { data: usageData, isFetching: usageFetching } = useQuery<{
    name: string;
    usages: UsageEntry[];
  }>({
    queryKey: ["/api/settings/tracking/conversion-events", deleteConfirmEvent, "usage"],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/settings/tracking/conversion-events/${encodeURIComponent(deleteConfirmEvent!)}/usage`
      );
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    enabled: !!deleteConfirmEvent,
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/settings/tracking/conversion-events/${encodeURIComponent(name)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form-state/conversion-counts"] });
      setDeleteConfirmEvent(null);
      toast({ title: "Event deleted", description: `"${name}" removed from conversion events.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete event", description: err.message, variant: "destructive" });
    },
  });

  const addEventMutation = useMutation({
    mutationFn: async ({
      name,
      description,
      when_to_use,
      when_not_to_use,
    }: {
      name: string;
      description: string;
      when_to_use: string;
      when_not_to_use: string;
    }) => {
      const updated: ConversionEventEntry[] = [
        ...conversionEventEntries,
        {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          when_to_use: when_to_use.trim(),
          when_not_to_use: when_not_to_use.trim(),
        },
      ];
      const res = await apiRequest("PUT", "/api/settings/tracking", { conversion_events: updated });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      setAddEventOpen(false);
      setNewEventName("");
      setNewEventDesc("");
      setNewEventWhenToUse("");
      setNewEventWhenNotToUse("");
      toast({ title: "Event added", description: `"${newEventName.trim()}" added to conversion events.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add event", description: err.message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/settings/tracking/conversion-events/${encodeURIComponent(oldName)}`,
        { newName }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to rename");
      }
      return res.json();
    },
    onSuccess: (_data, { oldName, newName }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form-state/conversion-counts"] });
      toast({ title: "Event renamed", description: `"${oldName}" renamed to "${newName}".` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to rename event", description: err.message, variant: "destructive" });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: async ({
      name,
      entries,
      newName,
    }: {
      name: string;
      entries: Array<{ file: string; section_id: string }>;
      newName: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/settings/tracking/conversion-events/${encodeURIComponent(name)}/reassign`,
        { newName, entries }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to reassign");
      }
      return res.json();
    },
    onSuccess: (_data, { newName, entries }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/settings/tracking/conversion-events", usageModalEvent, "usage"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/form-state/conversion-counts"] });
      setCheckedRows(new Set());
      setReassignOpen(false);
      setReassignTarget("");
      toast({
        title: "Reassigned",
        description: `${entries.length} ${entries.length === 1 ? "entry" : "entries"} moved to "${newName}".`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Reassign failed", description: err.message, variant: "destructive" });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ name, mergeInto }: { name: string; mergeInto: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/settings/tracking/conversion-events/${encodeURIComponent(name)}/merge`,
        { mergeInto }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to merge");
      }
      return res.json();
    },
    onSuccess: (_data, { name, mergeInto }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form-state/conversion-counts"] });
      setDeleteConfirmEvent(null);
      setMergeTarget("");
      toast({ title: "Event merged", description: `"${name}" merged into "${mergeInto}" and removed.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to merge event", description: err.message, variant: "destructive" });
    },
  });

  const saveWebhookMutation = useMutation({
    mutationFn: async ({ url, method, auth_header }: { url: string; method: string; auth_header: string }) => {
      const res = await apiRequest("PUT", "/api/settings/tracking", {
        webhook: { url: url.trim(), method, ...(auth_header.trim() ? { auth_header: auth_header.trim() } : {}) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      setWebhookEditing(false);
      toast({ title: "Webhook saved", description: "Global conversion webhook updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save webhook", description: err.message, variant: "destructive" });
    },
  });

  const saveAuthEventNamesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/settings/tracking", {
        signup_event_name: signupEventNameDraft.trim(),
        login_event_name: loginEventNameDraft.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save");
      }
      return res.json() as Promise<TrackingSettingsResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      toast({
        title: "Signup / login events saved",
        description: "Previous names are kept as aliases so existing forms still resolve.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save signup / login events",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const clearWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/settings/tracking", { webhook: null });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to remove webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      toast({ title: "Webhook removed", description: "Global conversion webhook has been cleared." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove webhook", description: err.message, variant: "destructive" });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tracking/webhook/test", { payload: sessionEnrichedPayload });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as any).ok) {
        throw new Error((data as any).error || `Request failed (${res.status})`);
      }
      return data as { ok: boolean; status: number };
    },
    onSuccess: (data) => {
      toast({ title: "Webhook test succeeded", description: `Upstream responded with HTTP ${data.status}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Webhook test failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: formStateSuggestions } = useQuery<{ automations: string[]; tags: string[] }>({
    queryKey: ["/api/form-state/suggestions"],
  });

  const saveEventMutation = useMutation({
    mutationFn: async (event: EditingEventState) => {
      const effectiveName = event.name.trim();

      if (effectiveName !== event.originalName) {
        const renameRes = await apiRequest(
          "PATCH",
          `/api/settings/tracking/conversion-events/${encodeURIComponent(event.originalName)}`,
          { newName: effectiveName }
        );
        if (!renameRes.ok) {
          const err = await renameRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to rename event");
        }
      }

      const current = queryClient.getQueryData<TrackingSettingsResponse>(["/api/settings/tracking"]);
      const updatedEvents: ConversionEventEntry[] = (current?.conversion_events ?? conversionEventEntries).map(
        (entry) => {
          if (entry.name === event.originalName) {
            const consent = cardValuesToEventConsent(event.consent, {
              marketing_text: entry.consent?.marketing_text,
              sms_text: entry.consent?.sms_text,
            });
            const updated: ConversionEventEntry = {
              name: effectiveName,
              ...(event.description.trim() ? { description: event.description.trim() } : {}),
              when_to_use: event.when_to_use.trim(),
              when_not_to_use: event.when_not_to_use.trim(),
              ...(event.automations.trim() ? { automations: event.automations.trim() } : {}),
              ...(event.tags.length > 0 ? { tags: event.tags } : {}),
              ...(Object.keys(consent).length > 0 ? { consent } : {}),
              ...(event.successMessage.trim() || event.successUrl.trim()
                ? {
                    success: {
                      ...(event.successMessage.trim()
                        ? { message: event.successMessage.trim() }
                        : {}),
                      ...(event.successUrl.trim()
                        ? { url: event.successUrl.trim() }
                        : {}),
                    },
                  }
                : {}),
              ...(event.webhookUrl.trim()
                ? {
                    webhook: {
                      url: event.webhookUrl.trim(),
                      method: event.webhookMethod,
                      ...(event.webhookAuthHeader.trim() ? { auth_header: event.webhookAuthHeader.trim() } : {}),
                    },
                  }
                : {}),
            };
            return updated;
          }
          return entry;
        }
      );

      const putRes = await apiRequest("PUT", "/api/settings/tracking", { conversion_events: updatedEvents });
      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save event");
      }
      return putRes.json();
    },
    onSuccess: (_data, event) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form-state/conversion-counts"] });
      setEditingEvent(null);
      toast({ title: "Event saved", description: `"${event.name.trim()}" defaults updated.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save event", description: err.message, variant: "destructive" });
    },
  });

  function toggleExpand(name: string) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  const conversionEvents: TrackingEvent[] = conversionEventEntries.map((entry) => ({
    name: entry.name,
    trigger: entry.description ?? "Form submission",
    payload: { ...sessionEnrichedPayload },
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/private/store/ecommerce">
            <Button variant="ghost" size="icon" data-testid="button-back-conversions">
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <IconTargetArrow className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-conversions-title">
                Conversion Events
              </h1>
              <p className="text-sm text-muted-foreground">
                {canMutateMetrics
                  ? "Manage conversion event definitions"
                  : "View conversion event definitions (read-only)"}
              </p>
            </div>
          </div>
        </div>

        {/* No-webhook warning banner */}
        {trackingSettings &&
          !trackingSettings.webhook?.url &&
          !trackingSettings.has_env_webhook &&
          !conversionEventEntries.some((e) => e.webhook?.url) && (
            <div
              className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
              data-testid="banner-no-webhook-configured"
            >
              <IconAlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-destructive">
                  No lead destination configured — submissions will be silently discarded
                </p>
                <p className="text-xs text-muted-foreground">
                  Set a global webhook below, or add a per-event webhook to at least one conversion event, to start receiving leads.
                </p>
              </div>
            </div>
          )}

        {/* Conversion Webhook card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">Conversion Webhook</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Global fallback — fired on every conversion unless overridden at the event or form level.
                  Configured in <code className="font-mono text-xs">settings.yml</code> under{" "}
                  <code className="font-mono text-xs">tracking.webhook</code>, or via the{" "}
                  <code className="font-mono text-xs">DEFAULT_WEBHOOK_URL</code> environment variable
                  when no URL is set in settings.
                </p>
              </div>
              {!webhookEditing && trackingSettings?.webhook?.url && canMutateMetrics && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWebhookEditing(true)}
                    data-testid="button-edit-webhook"
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testWebhookMutation.mutate()}
                    disabled={testWebhookMutation.isPending}
                    data-testid="button-test-webhook"
                  >
                    {testWebhookMutation.isPending
                      ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      : <IconSend className="h-3.5 w-3.5" />}
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRemoveWebhookConfirmOpen(true)}
                    disabled={clearWebhookMutation.isPending}
                    data-testid="button-remove-webhook"
                  >
                    {clearWebhookMutation.isPending
                      ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      : <IconTrash className="h-3.5 w-3.5" />}
                    Remove
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-5">
            {!webhookEditing && !trackingSettings?.webhook?.url ? (
              <div className="flex flex-col items-start gap-3 py-1">
                <p className="text-sm text-muted-foreground" data-testid="text-webhook-empty-state">
                  No global webhook configured yet.
                </p>
                {canMutateMetrics && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWebhookEditing(true)}
                  data-testid="button-configure-webhook"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  Configure
                </Button>
                )}
              </div>
            ) : !webhookEditing ? (
              <div className="space-y-2 py-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide w-20 shrink-0">URL</span>
                  <code
                    className="font-mono text-xs bg-muted px-2 py-1 rounded break-all"
                    data-testid="text-webhook-url"
                  >
                    {trackingSettings?.webhook?.url}
                  </code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide w-20 shrink-0">Method</span>
                  <code
                    className="font-mono text-xs bg-muted px-2 py-1 rounded"
                    data-testid="text-webhook-method"
                  >
                    {trackingSettings?.webhook?.method ?? "POST"}
                  </code>
                </div>
                {trackingSettings?.webhook?.auth_header && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide w-20 shrink-0">Auth</span>
                    <code
                      className="font-mono text-xs bg-muted px-2 py-1 rounded"
                      data-testid="text-webhook-auth"
                    >
                      {trackingSettings.webhook.auth_header.length > 16
                        ? trackingSettings.webhook.auth_header.slice(0, 16) + "•••"
                        : "•".repeat(trackingSettings.webhook.auth_header.length)}
                    </code>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label htmlFor="webhook-url">URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://hooks.example.com/..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    data-testid="input-webhook-url"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="webhook-method">Method</Label>
                  <Select value={webhookMethod} onValueChange={setWebhookMethod}>
                    <SelectTrigger id="webhook-method" data-testid="select-webhook-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="webhook-auth-header">
                    Authorization header{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="webhook-auth-header"
                    type="password"
                    placeholder="Bearer sk-..."
                    value={webhookAuthHeader}
                    onChange={(e) => setWebhookAuthHeader(e.target.value)}
                    data-testid="input-webhook-auth-header"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sent as the <code className="font-mono">Authorization</code> header on every webhook request.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => saveWebhookMutation.mutate({ url: webhookUrl, method: webhookMethod, auth_header: webhookAuthHeader })}
                    disabled={!webhookUrl.trim() || saveWebhookMutation.isPending}
                    data-testid="button-save-webhook"
                  >
                    {saveWebhookMutation.isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setWebhookEditing(false);
                      setWebhookUrl(trackingSettings?.webhook?.url ?? "");
                      setWebhookMethod(trackingSettings?.webhook?.method ?? "POST");
                      setWebhookAuthHeader(trackingSettings?.webhook?.auth_header ?? "");
                    }}
                    data-testid="button-cancel-webhook"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Sample payload */}
            <div className="border-t pt-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hover-elevate rounded w-full text-left"
                onClick={() => setSamplePayloadOpen((v) => !v)}
                data-testid="button-toggle-sample-payload"
              >
                {samplePayloadOpen ? (
                  <IconChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <IconChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                Sample payload
              </button>
              {samplePayloadOpen && (
                <div className="mt-2 space-y-2">
                  <div className="overflow-hidden rounded-md" data-testid="text-webhook-sample-payload">
                    <JsonViewer
                      value={JSON.stringify(sessionEnrichedPayload, null, 2)}
                      className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-x-auto"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sent as a JSON body (<code className="font-mono">Content-Type: application/json</code>) with the full lead fields.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Signup / login GTM names + Consumer Auth (not conversion webhooks) */}
        <Card data-testid="card-signup-login-webhook" id="signup-login-events">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <IconUserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                  <CardTitle className="text-base">Signup and Login</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">
                  These GTM event names fire when a visitor creates an account or signs in on an
                  account-gated form — not through the conversion webhook above. Account API path and
                  field map live under Consumer Auth. Renaming keeps the old name as an alias so
                  existing forms still match.
                </p>
              </div>
              <Link href="/private/security/auth">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="button-configure-signup-login"
                >
                  Consumer Auth
                  <IconExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signup-event-name">Signup event name</Label>
                <Input
                  id="signup-event-name"
                  value={signupEventNameDraft}
                  onChange={(e) => setSignupEventNameDraft(e.target.value)}
                  disabled={!canMutateMetrics}
                  placeholder="sign_up"
                  className="font-mono text-sm"
                  data-testid="input-signup-event-name"
                />
                {(trackingSettings?.signup_event_aliases?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-signup-aliases">
                    Aliases:{" "}
                    {(trackingSettings?.signup_event_aliases ?? []).join(", ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-event-name">Login event name</Label>
                <Input
                  id="login-event-name"
                  value={loginEventNameDraft}
                  onChange={(e) => setLoginEventNameDraft(e.target.value)}
                  disabled={!canMutateMetrics}
                  placeholder="login"
                  className="font-mono text-sm"
                  data-testid="input-login-event-name"
                />
                {(trackingSettings?.login_event_aliases?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-login-aliases">
                    Aliases:{" "}
                    {(trackingSettings?.login_event_aliases ?? []).join(", ")}
                  </p>
                )}
              </div>
            </div>
            {canMutateMetrics && (
              <Button
                size="sm"
                onClick={() => saveAuthEventNamesMutation.mutate()}
                disabled={saveAuthEventNamesMutation.isPending}
                data-testid="button-save-auth-event-names"
              >
                {saveAuthEventNamesMutation.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save event names
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">Conversion Events</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Fired via <code className="font-mono text-xs">trackConversion</code> when a user
                  completes a key action. Configured in{" "}
                  <code className="font-mono text-xs">settings.yml</code> under{" "}
                  <code className="font-mono text-xs">tracking.conversion_events</code>.
                </p>
              </div>
              {canMutateMetrics && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddEventOpen(true)}
                data-testid="button-add-conversion-event"
                className="shrink-0"
              >
                <IconPlus className="h-3.5 w-3.5" />
                Add event
              </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {conversionEventEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No conversion events configured yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full text-sm"
                  data-testid="table-conversion-events"
                >
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">
                        Event
                      </th>
                      <th className="py-2 text-xs font-medium text-muted-foreground text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversionEvents.map((ev) => {
                      const isExpanded = expandedEvents.has(ev.name);
                      const count = conversionCounts?.[ev.name];
                      const entry = conversionEventEntries.find((e) => e.name === ev.name);
                      const hasWebhook = !!entry?.webhook?.url;
                      const hasTags = (entry?.tags?.length ?? 0) > 0;
                      const hasAutomation = !!entry?.automations;
                      const hasConsent = entry?.consent ? Object.keys(entry.consent).length > 0 : false;
                      const hasIntent =
                        isConversionIntentFieldValid(entry?.when_to_use) &&
                        isConversionIntentFieldValid(entry?.when_not_to_use);
                      return (
                        <Fragment key={ev.name}>
                          <tr className="border-b last:border-0">
                            <td className="py-2 pr-4 align-middle">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(ev.name)}
                                  className="flex items-center gap-1 text-muted-foreground hover-elevate rounded"
                                  data-testid={`button-expand-event-${ev.name}`}
                                  aria-label={isExpanded ? "Collapse usage" : "Expand usage"}
                                >
                                  {isExpanded ? (
                                    <IconChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <IconChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <Badge variant="secondary" className="font-mono text-xs">
                                  {ev.name}
                                </Badge>
                                {count !== undefined && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs tabular-nums text-muted-foreground cursor-pointer"
                                    data-testid={`badge-form-count-${ev.name}`}
                                    onClick={() => {
                                      setUsageModalEvent(ev.name);
                                      setCheckedRows(new Set());
                                    }}
                                  >
                                    {count} {count === 1 ? "form" : "forms"}
                                  </Badge>
                                )}
                                {hasIntent ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 leading-4 font-normal text-muted-foreground"
                                    data-testid={`badge-intent-${ev.name}`}
                                  >
                                    intent
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 leading-4 font-normal text-destructive border-destructive/40"
                                    data-testid={`badge-intent-missing-${ev.name}`}
                                  >
                                    intent needed
                                  </Badge>
                                )}
                                {hasWebhook && (
                                  <Popover>
                                    <PopoverTrigger className="p-0 h-auto border-0 bg-transparent focus-visible:outline-none">
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 leading-4 font-normal text-muted-foreground cursor-pointer">
                                        webhook
                                      </Badge>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-3 space-y-1.5" align="start">
                                      <p className="text-xs font-medium">Per-event webhook</p>
                                      <div className="space-y-1">
                                        <div className="flex items-start gap-2">
                                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide w-12 shrink-0 pt-0.5">URL</span>
                                          <code className="text-[10px] font-mono break-all leading-4">{entry?.webhook?.url}</code>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide w-12 shrink-0">Method</span>
                                          <code className="text-[10px] font-mono">{entry?.webhook?.method ?? "POST"}</code>
                                        </div>
                                        {entry?.webhook?.auth_header && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide w-12 shrink-0">Auth</span>
                                            <code className="text-[10px] font-mono">{"•".repeat(Math.min(entry.webhook.auth_header.length, 12))}</code>
                                          </div>
                                        )}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}
                                {hasAutomation && (
                                  <Popover>
                                    <PopoverTrigger className="p-0 h-auto border-0 bg-transparent focus-visible:outline-none">
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 leading-4 font-normal text-muted-foreground cursor-pointer">
                                        automation
                                      </Badge>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-3 space-y-1" align="start">
                                      <p className="text-xs font-medium">Default automation</p>
                                      <code className="text-[11px] font-mono text-foreground">{entry?.automations}</code>
                                    </PopoverContent>
                                  </Popover>
                                )}
                                {hasTags && (
                                  <Popover>
                                    <PopoverTrigger className="p-0 h-auto border-0 bg-transparent focus-visible:outline-none">
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 leading-4 font-normal text-muted-foreground cursor-pointer">
                                        tags
                                      </Badge>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-3 space-y-2" align="start">
                                      <p className="text-xs font-medium">Default tags</p>
                                      <div className="flex flex-wrap gap-1">
                                        {entry?.tags?.map((t) => (
                                          <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 leading-4 font-mono font-normal">
                                            {t}
                                          </Badge>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}
                                {hasConsent && (
                                  <Popover>
                                    <PopoverTrigger className="p-0 h-auto border-0 bg-transparent focus-visible:outline-none">
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 leading-4 font-normal text-muted-foreground cursor-pointer">
                                        consent
                                      </Badge>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-3 space-y-2" align="start">
                                      <p className="text-xs font-medium">Default consent</p>
                                      <div className="space-y-0.5 text-[11px]">
                                        {entry?.consent?.marketing && <div className="text-muted-foreground">Marketing consent enabled</div>}
                                        {entry?.consent?.sms && <div className="text-muted-foreground">SMS consent enabled{entry.consent.sms_usa_only ? " (US only)" : ""}</div>}
                                        {entry?.consent?.whatsapp && <div className="text-muted-foreground">WhatsApp consent enabled</div>}
                                        {extraConsentYamlFieldsFromObject(entry?.consent).map((field) =>
                                          entry?.consent?.[field] ? (
                                            <div key={field} className="text-muted-foreground">
                                              {consentLabelFromKey(consentKeyFromYamlField(field))} consent enabled
                                            </div>
                                          ) : null,
                                        )}
                                        {entry?.consent?.show_terms && <div className="text-muted-foreground">Terms &amp; privacy shown</div>}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}
                              </div>
                            </td>
                            <td className="py-2 align-middle text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setSelectedEvent(ev)}
                                      data-testid={`button-show-payload-${ev.name}`}
                                    >
                                      <IconBraces className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Show payload</TooltipContent>
                                </Tooltip>
                                {canMutateMetrics && (
                                <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        const entry = conversionEventEntries.find((e) => e.name === ev.name);
                                        if (entry) setEditingEvent(makeEditingState(entry));
                                      }}
                                      data-testid={`button-edit-event-${ev.name}`}
                                    >
                                      <IconPencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit event defaults</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setDeleteConfirmEvent(ev.name);
                                        setMergeTarget("");
                                      }}
                                      data-testid={`button-delete-event-${ev.name}`}
                                    >
                                      <IconTrash className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete event</TooltipContent>
                                </Tooltip>
                                </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${ev.name}-usage`} className="border-b last:border-0 bg-muted/30">
                              <td colSpan={2} className="py-1">
                                <UsageRows eventName={ev.name} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!usageModalEvent}
        onOpenChange={(open) => {
          if (!open) {
            setUsageModalEvent(null);
            setCheckedRows(new Set());
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Forms using
              <code className="font-mono text-sm font-semibold bg-muted px-1.5 py-0.5 rounded">
                {usageModalEvent}
              </code>
            </DialogTitle>
            <DialogDescription>
              Check entries to reassign them to a different conversion event.
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            {usageModalFetching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : usageModalData && usageModalData.usages.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={checkedRows.size === usageModalData.usages.length}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCheckedRows(new Set(usageModalData.usages.map((_, i) => i)));
                        } else {
                          setCheckedRows(new Set());
                        }
                      }}
                      data-testid="checkbox-select-all-usages"
                    />
                    {checkedRows.size > 0 ? `${checkedRows.size} selected` : "Select all"}
                  </label>
                  {checkedRows.size > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReassignTarget("");
                        setReassignOpen(true);
                      }}
                      data-testid="button-reassign-selected"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                      Reassign
                    </Button>
                  )}
                </div>
                <ul className="space-y-0.5 max-h-64 overflow-y-auto">
                  {usageModalData.usages.map((u, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-2 py-1.5 px-1 rounded-md cursor-pointer border ${
                        checkedRows.has(i)
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:bg-muted/50"
                      }`}
                      onClick={() => {
                        setCheckedRows((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        });
                      }}
                      data-testid={`usage-row-${i}`}
                    >
                      <Checkbox
                        checked={checkedRows.has(i)}
                        onCheckedChange={() => {
                          setCheckedRows((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`checkbox-usage-${i}`}
                      />
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {u.content_type}/{u.slug}
                        </span>
                        <span className="text-muted-foreground text-xs">({u.locale})</span>
                        {u.section_type && (
                          <span className="text-muted-foreground text-xs">· {u.section_type}</span>
                        )}
                        {u.tags && u.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 font-normal" data-testid={`badge-modal-usage-tag-${tag}`}>
                            {tag}
                          </Badge>
                        ))}
                        {u.consent && Object.keys(u.consent).length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs px-1.5 py-0 font-normal"
                            title={`Consent override: ${Object.keys(u.consent).join(", ")}`}
                            data-testid="badge-modal-usage-consent"
                          >
                            consent: {Object.keys(u.consent).join(" · ")}
                          </Badge>
                        )}
                      </div>
                      {u.page_url && (
                        <PageLinkMenu url={u.page_url} />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No forms are currently using this event.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reassignOpen}
        onOpenChange={(open) => {
          if (!open) {
            setReassignOpen(false);
            setReassignTarget("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Reassign {checkedRows.size} {checkedRows.size === 1 ? "entry" : "entries"}
            </DialogTitle>
            <DialogDescription>
              Move the selected {checkedRows.size === 1 ? "entry" : "entries"} from{" "}
              <code className="font-mono text-xs">{usageModalEvent}</code> to a different
              conversion event.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="reassign-target-select">Target event</Label>
            <Select value={reassignTarget} onValueChange={setReassignTarget}>
              <SelectTrigger id="reassign-target-select" data-testid="select-reassign-target">
                <SelectValue placeholder="Select target event…" />
              </SelectTrigger>
              <SelectContent>
                {conversionEventEntries
                  .filter((e) => e.name !== usageModalEvent)
                  .map((e) => (
                    <SelectItem key={e.name} value={e.name}>
                      <span className="font-mono text-xs">{e.name}</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReassignOpen(false);
                setReassignTarget("");
              }}
              data-testid="button-cancel-reassign"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!usageModalEvent || !reassignTarget || !usageModalData) return;
                const selectedEntries = Array.from(checkedRows).map((i) => ({
                  file: usageModalData.usages[i].file,
                  section_id: usageModalData.usages[i].section_id,
                }));
                reassignMutation.mutate({
                  name: usageModalEvent,
                  entries: selectedEntries,
                  newName: reassignTarget,
                });
              }}
              disabled={!reassignTarget || reassignMutation.isPending}
              data-testid="button-confirm-reassign"
            >
              {reassignMutation.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconPencil className="h-4 w-4" />
              )}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm font-semibold">
              {selectedEvent?.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Every time <code className="font-mono text-xs">{selectedEvent?.name}</code> happens,
              the following payload gets sent to Google Tag Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-md" data-testid="text-payload-json">
            <JsonViewer
              value={selectedEvent ? JSON.stringify(selectedEvent.payload, null, 2) : ""}
              className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-x-auto"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirmEvent}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmEvent(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete conversion event</DialogTitle>
            <DialogDescription>
              This will remove{" "}
              <code className="font-mono text-xs">{deleteConfirmEvent}</code> from{" "}
              <code className="font-mono text-xs">settings.yml</code>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {usageFetching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Checking usage…
              </div>
            ) : usageData && usageData.usages.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This event is referenced in the following pages:
                </p>
                <ul className="space-y-1">
                  {usageData.usages.map((u, i) => (
                    <li key={i} className="text-sm flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">
                        {u.content_type}/{u.slug}
                      </span>
                      <span className="text-muted-foreground">({u.locale})</span>
                      {u.section_type && (
                        <span className="text-muted-foreground text-xs">· {u.section_type}</span>
                      )}
                      {u.tags && u.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 font-normal" data-testid={`badge-delete-usage-tag-${tag}`}>
                          {tag}
                        </Badge>
                      ))}
                      {u.consent && Object.keys(u.consent).length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 font-normal"
                          title={`Consent override: ${Object.keys(u.consent).join(", ")}`}
                          data-testid="badge-delete-usage-consent"
                        >
                          consent: {Object.keys(u.consent).join(" · ")}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="space-y-1.5 pt-1">
                  <p className="text-sm font-medium">
                    Merge all references into another event before deleting:
                  </p>
                  <Select value={mergeTarget} onValueChange={setMergeTarget}>
                    <SelectTrigger data-testid="select-merge-target">
                      <SelectValue placeholder="Select target event…" />
                    </SelectTrigger>
                    <SelectContent>
                      {conversionEventEntries
                        .filter((e) => e.name !== deleteConfirmEvent)
                        .map((e) => (
                          <SelectItem key={e.name} value={e.name}>
                            <span className="font-mono text-xs">{e.name}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No pages are using this event — safe to delete.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmEvent(null);
                setMergeTarget("");
              }}
              data-testid="button-cancel-delete-event"
            >
              Cancel
            </Button>
            {usageData && usageData.usages.length > 0 ? (
              <Button
                variant="destructive"
                onClick={() =>
                  deleteConfirmEvent &&
                  mergeMutation.mutate({ name: deleteConfirmEvent, mergeInto: mergeTarget })
                }
                disabled={!mergeTarget || mergeMutation.isPending}
                data-testid="button-confirm-merge-event"
              >
                {mergeMutation.isPending ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconTrash className="h-4 w-4" />
                )}
                Merge &amp; delete
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() =>
                  deleteConfirmEvent && deleteEventMutation.mutate(deleteConfirmEvent)
                }
                disabled={deleteEventMutation.isPending || usageFetching}
                data-testid="button-confirm-delete-event"
              >
                {deleteEventMutation.isPending ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconTrash className="h-4 w-4" />
                )}
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!editingEvent}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle className="text-base">Edit conversion event</SheetTitle>
            <SheetDescription className="text-xs">
              When to use / when not to use tell agents (and staff) which visitor offer maps to this
              event — required before save. Also set automations, consents, and optional webhook
              defaults (form-level settings always win).
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-4 space-y-4">
              {/* Rename field */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-event-name" className="text-sm font-medium">
                  Event name
                </Label>
                <Input
                  id="edit-event-name"
                  placeholder="e.g. scholarship_application"
                  value={editingEvent?.name ?? ""}
                  onChange={(e) =>
                    editingEvent && setEditingEvent({ ...editingEvent, name: e.target.value })
                  }
                  data-testid="input-edit-event-name"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Use snake_case. Renaming updates all YAML references automatically.
                </p>
              </div>

              {editingEvent && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-event-desc" className="text-sm font-medium">
                    Description{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="edit-event-desc"
                    placeholder="Short staff label"
                    value={editingEvent.description}
                    onChange={(e) =>
                      setEditingEvent({ ...editingEvent, description: e.target.value })
                    }
                    data-testid="input-edit-event-desc"
                  />
                </div>
              )}

              {editingEvent && (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground leading-snug">{INTENT_FIELD_HINT}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Advanced:{" "}
                    <code className="text-[10px]">site_*/settings.yml</code> →{" "}
                    <code className="text-[10px]">tracking.conversion_events</code>; agents read via
                    MCP <code className="text-[10px]">explain_site</code> topic{" "}
                    <code className="text-[10px]">component-behaviors</code>.
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="edit-when-to-use" className="text-sm font-medium">
                        When to use
                      </Label>
                      <IntentCharCount value={editingEvent.when_to_use} />
                    </div>
                    <Textarea
                      id="edit-when-to-use"
                      rows={3}
                      maxLength={CONVERSION_INTENT_MAX_CHARS}
                      placeholder="Visitor is applying / enrolling…"
                      value={editingEvent.when_to_use}
                      onChange={(e) =>
                        setEditingEvent({ ...editingEvent, when_to_use: e.target.value })
                      }
                      data-testid="input-edit-when-to-use"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="edit-when-not-to-use" className="text-sm font-medium">
                        When not to use
                      </Label>
                      <IntentCharCount value={editingEvent.when_not_to_use} />
                    </div>
                    <Textarea
                      id="edit-when-not-to-use"
                      rows={3}
                      maxLength={CONVERSION_INTENT_MAX_CHARS}
                      placeholder="Soft info-only, downloads, newsletter…"
                      value={editingEvent.when_not_to_use}
                      onChange={(e) =>
                        setEditingEvent({ ...editingEvent, when_not_to_use: e.target.value })
                      }
                      data-testid="input-edit-when-not-to-use"
                      className="text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Automations & Tags */}
              {editingEvent && (
                <AutomationsTagsCard
                  automation={editingEvent.automations}
                  tags={editingEvent.tags}
                  onAutomationChange={(val) =>
                    setEditingEvent({ ...editingEvent, automations: val })
                  }
                  onTagsChange={(tags) =>
                    setEditingEvent({ ...editingEvent, tags })
                  }
                  automationSuggestions={formStateSuggestions?.automations ?? []}
                  tagSuggestions={formStateSuggestions?.tags ?? []}
                />
              )}

              {/* Success defaults — applied to all forms using this conversion event */}
              {editingEvent && (
                <SuccessCard
                  message={editingEvent.successMessage}
                  url={editingEvent.successUrl}
                  editing={editingEvent.successEditing}
                  onEditingChange={(val) =>
                    setEditingEvent({ ...editingEvent, successEditing: val })
                  }
                  onChange={(field, value) => {
                    if (field === "message") {
                      setEditingEvent({
                        ...editingEvent,
                        successMessage: value,
                        ...(value.trim() ? { successUrl: "" } : {}),
                      });
                    } else {
                      setEditingEvent({
                        ...editingEvent,
                        successUrl: value,
                        ...(value.trim() ? { successMessage: "" } : {}),
                      });
                    }
                  }}
                  testIdPrefix="event-success"
                />
              )}

              {/* Consents */}
              {editingEvent && (
                <ConsentCard
                  values={editingEvent.consent}
                  onChange={(field, value) => {
                    setEditingEvent((prev) =>
                      prev
                        ? { ...prev, consent: { ...prev.consent, [field]: value } }
                        : prev,
                    );
                  }}
                />
              )}

              {/* No-fallback inline warning */}
              {editingEvent &&
                !editingEvent.webhookUrl.trim() &&
                trackingSettings &&
                !trackingSettings.webhook?.url &&
                !trackingSettings.has_env_webhook && (
                  <div
                    className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5"
                    data-testid="note-no-fallback-webhook"
                  >
                    <IconAlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                    <p className="text-xs text-destructive leading-snug">
                      No fallback webhook — leads from this event will be silently discarded unless
                      you set one here or globally.
                    </p>
                  </div>
                )}

              {/* Per-event Webhook */}
              {editingEvent && (
                <WebhookCard
                  url={editingEvent.webhookUrl}
                  method={editingEvent.webhookMethod}
                  authHeader={editingEvent.webhookAuthHeader}
                  editing={editingEvent.webhookEditing}
                  onEditingChange={(val) =>
                    setEditingEvent({ ...editingEvent, webhookEditing: val })
                  }
                  onChange={(field, value) => {
                    if (field === "url") setEditingEvent({ ...editingEvent, webhookUrl: value });
                    else if (field === "method") setEditingEvent({ ...editingEvent, webhookMethod: value as "POST" | "GET" });
                    else if (field === "authHeader") setEditingEvent({ ...editingEvent, webhookAuthHeader: value });
                  }}
                  samplePayload={sessionEnrichedPayload}
                  onTest={async () => {
                    try {
                      const data = await testWebhookMutation.mutateAsync();
                      return { ok: true, status: data.status };
                    } catch (e: any) {
                      return { ok: false, error: e.message };
                    }
                  }}
                  testIdPrefix="event-webhook"
                />
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-6 py-4 border-t shrink-0 flex items-center justify-end gap-2 flex-wrap">
            <Button
              variant="ghost"
              onClick={() => setEditingEvent(null)}
              data-testid="button-cancel-edit-event"
            >
              Cancel
            </Button>
            <Button
              onClick={() => editingEvent && saveEventMutation.mutate(editingEvent)}
              disabled={
                !editingEvent?.name.trim() ||
                !isConversionIntentFieldValid(editingEvent?.when_to_use) ||
                !isConversionIntentFieldValid(editingEvent?.when_not_to_use) ||
                saveEventMutation.isPending
              }
              data-testid="button-save-edit-event"
            >
              {saveEventMutation.isPending && (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Remove webhook confirmation dialog */}
      <Dialog
        open={removeWebhookConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setRemoveWebhookConfirmOpen(false);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove global webhook?</DialogTitle>
            <DialogDescription>
              This will clear the global fallback webhook. All conversions that rely on it will stop
              sending webhook calls immediately. This cannot be undone automatically — you will need
              to re-configure it manually.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveWebhookConfirmOpen(false)}
              data-testid="button-cancel-remove-webhook"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRemoveWebhookConfirmOpen(false);
                clearWebhookMutation.mutate();
              }}
              disabled={clearWebhookMutation.isPending}
              data-testid="button-confirm-remove-webhook"
            >
              {clearWebhookMutation.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconTrash className="h-4 w-4" />
              )}
              Remove webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addEventOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddEventOpen(false);
            setNewEventName("");
            setNewEventDesc("");
            setNewEventWhenToUse("");
            setNewEventWhenNotToUse("");
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add conversion event</DialogTitle>
            <DialogDescription>
              Event name is the GTM trigger key. When to use / when not to use are required so
              agents can match visitor CTA intent (not a duplicated page&apos;s old conversion_name).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="new-event-name">Event name</Label>
              <Input
                id="new-event-name"
                placeholder="e.g. scholarship_application"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                data-testid="input-new-event-name"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use snake_case. This becomes the GTM event name.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-event-desc">
                Description{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="new-event-desc"
                placeholder="e.g. Scholarship form submitted"
                value={newEventDesc}
                onChange={(e) => setNewEventDesc(e.target.value)}
                data-testid="input-new-event-desc"
              />
            </div>
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground leading-snug">{INTENT_FIELD_HINT}</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="new-when-to-use">When to use</Label>
                  <IntentCharCount value={newEventWhenToUse} />
                </div>
                <Textarea
                  id="new-when-to-use"
                  rows={3}
                  maxLength={CONVERSION_INTENT_MAX_CHARS}
                  placeholder="Visitor is applying / enrolling…"
                  value={newEventWhenToUse}
                  onChange={(e) => setNewEventWhenToUse(e.target.value)}
                  data-testid="input-new-when-to-use"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="new-when-not-to-use">When not to use</Label>
                  <IntentCharCount value={newEventWhenNotToUse} />
                </div>
                <Textarea
                  id="new-when-not-to-use"
                  rows={3}
                  maxLength={CONVERSION_INTENT_MAX_CHARS}
                  placeholder="Soft info-only, downloads, newsletter…"
                  value={newEventWhenNotToUse}
                  onChange={(e) => setNewEventWhenNotToUse(e.target.value)}
                  data-testid="input-new-when-not-to-use"
                  className="text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddEventOpen(false);
                setNewEventName("");
                setNewEventDesc("");
                setNewEventWhenToUse("");
                setNewEventWhenNotToUse("");
              }}
              data-testid="button-cancel-add-event"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                addEventMutation.mutate({
                  name: newEventName,
                  description: newEventDesc,
                  when_to_use: newEventWhenToUse,
                  when_not_to_use: newEventWhenNotToUse,
                })
              }
              disabled={
                !newEventName.trim() ||
                !isConversionIntentFieldValid(newEventWhenToUse) ||
                !isConversionIntentFieldValid(newEventWhenNotToUse) ||
                addEventMutation.isPending
              }
              data-testid="button-confirm-add-event"
            >
              {addEventMutation.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconPlus className="h-4 w-4" />
              )}
              Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
