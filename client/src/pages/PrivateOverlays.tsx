import { useState, useRef, useEffect, lazy, Suspense } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconTrash,
  IconCheck,
  IconX,
  IconLayersIntersect,
  IconLoader2,
  IconEye,
  IconPencil,
  IconFileText,
  IconAdjustments,
  IconChevronDown,
  IconPhoto,
  IconArrowUp,
  IconArrowDown,
  IconCode,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageTargetingChips } from "@/components/editing/PageTargetingChips";
import { RichTextArea } from "@/components/editing/RichTextArea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { COUNTRY_OPTIONS, REGION_OPTIONS } from "@/lib/geoData";

import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import type { Overlay, OverlayButton, OverlayConfig } from "@/hooks/useOverlays";
import {
  isOverlayDismissible,
  overlayBlockingSaveError,
} from "@/hooks/useOverlays";
import { LinkPicker } from "@/components/editing/LinkPicker";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";

function parseApiError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : "";
  const jsonMatch = raw.match(/^\d+:\s*(\{[\s\S]*\})$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // keep fallback
    }
  }
  return fallback;
}

function overlayConfigPayload(overlay: Overlay) {
  return {
    enabled: overlay.enabled,
    component: overlay.component,
    trigger: overlay.trigger,
    targeting: overlay.targeting,
    frequency: overlay.frequency,
    dismissible: overlay.dismissible,
  };
}

function isContentDirty(draft: Overlay, baseline: Overlay | null): boolean {
  if (!baseline) return true;
  return JSON.stringify(draft.content) !== JSON.stringify(baseline.content);
}

function isConfigDirty(draft: Overlay, baseline: Overlay | null): boolean {
  if (!baseline) return true;
  return (
    JSON.stringify(overlayConfigPayload(draft)) !==
    JSON.stringify(overlayConfigPayload(baseline))
  );
}

const OverlaysYmlEditorPanel = lazy(() => import("@/components/editing/OverlaysYmlEditorPanel"));

const COMPONENT_LABELS: Record<string, string> = {
  modal: "Modal",
  top_banner: "Top Banner",
  slide_in: "Slide-In",
};

const TRIGGER_LABELS: Record<string, string> = {
  page_load: "Page Load",
  time_delay: "Time Delay",
  scroll_depth: "Scroll Depth",
  exit_intent: "Exit Intent",
};

const FREQUENCY_LABELS: Record<string, string> = {
  once: "Once",
  session: "Per Session",
  always: "Always",
};

function triggerDelayLabel(overlay: Overlay): string {
  const ev = overlay.trigger.event;
  if ((ev === "page_load" || ev === "time_delay") && overlay.trigger.delay) {
    return `${overlay.trigger.delay}ms`;
  }
  if (ev === "scroll_depth" && overlay.trigger.delay != null) {
    return `${overlay.trigger.delay}%`;
  }
  return "";
}

function pageTargetingLabel(overlay: Overlay): string {
  const pages = overlay.targeting.pages;
  const exclude = overlay.targeting.exclude_pages ?? [];
  const exclSuffix =
    exclude.length === 0
      ? ""
      : exclude.length === 1
        ? ` · Excl. ${exclude[0]}`
        : ` · Excl. ${exclude.length}`;

  if (pages === "all") return `All pages${exclSuffix}`;
  if (Array.isArray(pages)) {
    // Empty include + excludes ⇒ all pages minus exceptions (matches runtime)
    if (pages.length === 0) {
      return exclude.length > 0 ? `All pages${exclSuffix}` : "No pages";
    }
    if (pages.length === 1) return `${pages[0]}${exclSuffix}`;
    return `${pages.length} pages${exclSuffix}`;
  }
  return `All pages${exclSuffix}`;
}

function pageTargetingConflicts(include: string[], exclude: string[]): string[] {
  if (include.length === 0 || exclude.length === 0) return [];
  const excludeSet = new Set(exclude.map((e) => e.trim()).filter(Boolean));
  const seen = new Set<string>();
  const conflicts: string[] = [];
  for (const entry of include) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (excludeSet.has(trimmed)) {
      seen.add(trimmed);
      conflicts.push(trimmed);
    }
  }
  return conflicts;
}

function geoTargetingLabel(overlay: Overlay): string {
  const geo = overlay.targeting.geo;
  if (!geo) return "All countries";
  const parts: string[] = [];
  if (geo.countries && geo.countries.length > 0) parts.push(geo.countries.join(", "));
  if (geo.regions && geo.regions.length > 0) parts.push(geo.regions.join(", "));
  if (geo.exclude_countries && geo.exclude_countries.length > 0)
    parts.push(`Excl. ${geo.exclude_countries.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "All countries";
}

function newOverlay(): Overlay {
  return {
    id: `overlay-${Date.now()}`,
    enabled: false,
    trigger: { event: "page_load", delay: 0 },
    targeting: { pages: "all", geo: {} },
    frequency: "once",
    component: "modal",
    dismissible: true,
    content: { title: "", body: "", buttons: [], image_id: "" },
  };
}

function buttonChipClass(variant: OverlayButton["variant"]): string {
  if (variant === "outline") {
    return "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium border border-border cursor-default select-none";
  }
  if (variant === "secondary") {
    return "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground cursor-default select-none";
  }
  if (variant === "ghost") {
    return "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium cursor-default select-none";
  }
  if (variant === "destructive") {
    return "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground cursor-default select-none";
  }
  return "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground cursor-default select-none";
}

function PreviewButtons({ buttons }: { buttons?: OverlayButton[] }) {
  if (!buttons || buttons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {buttons.map((btn, i) => (
        <span key={i} className={buttonChipClass(btn.variant)}>
          {btn.label || "Button"}
        </span>
      ))}
    </div>
  );
}

/** Close modal vs link destination — overlay editor only (does not change shared LinkPicker). */
function OverlayButtonDestination({
  href,
  onChange,
  portalContainer,
  testId,
}: {
  href: string;
  onChange: (href: string) => void;
  portalContainer?: HTMLElement | null;
  testId: string;
}) {
  const [picking, setPicking] = useState(!!href);

  useEffect(() => {
    if (href) setPicking(true);
  }, [href]);

  const mode = !href && !picking ? "close" : "destination";

  return (
    <div className="space-y-2">
      <div
        className="flex rounded-md border overflow-hidden"
        role="radiogroup"
        aria-label="Button destination"
        data-testid={`${testId}-mode`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "close"}
          className={`flex-1 text-xs py-1.5 px-2 transition-colors ${
            mode === "close"
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover-elevate"
          }`}
          onClick={() => {
            onChange("");
            setPicking(false);
          }}
          data-testid={`${testId}-close-modal`}
        >
          Close modal
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "destination"}
          className={`flex-1 text-xs py-1.5 px-2 transition-colors border-l border-border ${
            mode === "destination"
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover-elevate"
          }`}
          onClick={() => setPicking(true)}
          data-testid={`${testId}-choose-destination`}
        >
          Choose destination
        </button>
      </div>
      {mode === "close" ? (
        <p className="text-xs text-muted-foreground">
          Button will dismiss the overlay without navigating.
        </p>
      ) : (
        <LinkPicker
          value={href}
          onChange={(v) => {
            onChange(v);
            setPicking(true);
          }}
          allowedTypes={["internal", "external"]}
          portalContainer={portalContainer}
          testId={testId}
        />
      )}
    </div>
  );
}

function OverlayInlinePreview({ overlay }: { overlay: Overlay }) {
  const { content } = overlay;
  const buttons = content.buttons ?? [];
  const dismissible = isOverlayDismissible(overlay);
  const image = content.image_id ? (
    <img
      src={content.image_id}
      alt=""
      className="w-full object-cover max-h-28 rounded-md"
    />
  ) : null;

  if (overlay.component === "top_banner") {
    return (
      <div className="rounded-md overflow-hidden border border-border">
        <div className="bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3">
          {content.image_id && (
            <img
              src={content.image_id}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover bg-primary-foreground/10"
            />
          )}
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
            {content.title && <span className="font-semibold text-sm">{content.title}</span>}
            {content.body && <span className="text-sm opacity-90">{content.body}</span>}
            {buttons.length > 0 && (
              <span className="inline-flex items-center rounded-md bg-primary-foreground/20 border border-primary-foreground/30 px-2.5 py-1 text-xs font-medium cursor-default select-none">
                {buttons[0].label || "Button"}
              </span>
            )}
          </div>
          {dismissible && (
            <span className="shrink-0 opacity-60 cursor-default">
              <IconX size={14} />
            </span>
          )}
        </div>
        <div className="bg-muted/30 h-14 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Page content below</span>
        </div>
      </div>
    );
  }

  if (overlay.component === "slide_in") {
    return (
      <div className="rounded-md overflow-hidden border border-border bg-muted/20 p-4 min-h-[10rem] flex flex-col">
        <span className="text-xs text-muted-foreground mb-3">Page content</span>
        <div className="mt-auto self-end w-64 max-w-full rounded-[0.8rem] border border-border bg-card shadow-md overflow-hidden">
          {dismissible && (
            <div className="flex justify-end px-2 pt-2">
              <span className="inline-flex h-6 w-6 items-center justify-center opacity-40 cursor-default">
                <IconX size={14} />
              </span>
            </div>
          )}
          {image}
          <div className="p-3 space-y-2 text-center">
            <span className="text-sm font-semibold leading-snug block">{content.title}</span>
            {content.body && <p className="text-xs text-muted-foreground">{content.body}</p>}
            {buttons.length > 0 && <PreviewButtons buttons={buttons} />}
            {dismissible && (
              <span className="inline-flex min-w-[7rem] mx-auto items-center justify-center rounded-md border border-border px-6 py-1.5 text-xs font-medium cursor-default select-none">
                Close
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md overflow-hidden border border-border bg-muted/20 p-6">
      <div className="flex items-center justify-center">
        <div className="w-full max-w-sm rounded-[0.8rem] border border-border bg-card shadow-lg p-5 space-y-3">
          {image}
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold leading-snug">{content.title || "Untitled overlay"}</span>
            {dismissible && (
              <span className="opacity-40 cursor-default shrink-0"><IconX size={14} /></span>
            )}
          </div>
          {content.body && <p className="text-xs text-muted-foreground">{content.body}</p>}
          {buttons.length > 0 ? (
            <div className="flex justify-end gap-2">
              <PreviewButtons buttons={buttons} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type SheetTab = "content" | "conditions";

export default function PrivateOverlays() {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEditContent = hasCapability("overlays_edit_content");
  const canConfigure = hasCapability("overlays_configure");
  const canMutate = canEditContent || canConfigure;

  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [sheetDraft, setSheetDraft] = useState<Overlay | null>(null);
  const [sheetBaseline, setSheetBaseline] = useState<Overlay | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>("content");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetContainer, setSheetContainer] = useState<HTMLDivElement | null>(null);
  const [showYmlEditor, setShowYmlEditor] = useState(false);
  const [editingButtonIndex, setEditingButtonIndex] = useState<number | null>(null);

  const { data, isLoading } = useQuery<OverlayConfig>({
    queryKey: ["/api/overlays"],
    staleTime: 30_000,
  });

  const overlays: Overlay[] = data?.overlays ?? [];

  async function invalidateOverlays() {
    await queryClient.invalidateQueries({ queryKey: ["/api/overlays"] });
  }

  async function putConfig(id: string, overlay: Overlay): Promise<boolean> {
    try {
      await apiRequest("PUT", `/api/overlays/${encodeURIComponent(id)}/config`, overlayConfigPayload(overlay));
      await invalidateOverlays();
      return true;
    } catch (err) {
      toast({
        title: "Failed to save configuration",
        description: parseApiError(err, "Failed to save overlay configuration"),
        variant: "destructive",
      });
      return false;
    }
  }

  async function putContent(id: string, overlay: Overlay): Promise<boolean> {
    try {
      await apiRequest("PUT", `/api/overlays/${encodeURIComponent(id)}/content`, {
        content: overlay.content,
      });
      await invalidateOverlays();
      return true;
    } catch (err) {
      toast({
        title: "Failed to save content",
        description: parseApiError(err, "Failed to save overlay content"),
        variant: "destructive",
      });
      return false;
    }
  }

  async function postOverlay(overlay: Overlay): Promise<boolean> {
    try {
      await apiRequest("POST", "/api/overlays", overlay);
      await invalidateOverlays();
      return true;
    } catch (err) {
      toast({
        title: "Failed to create overlay",
        description: parseApiError(err, "Failed to create overlay"),
        variant: "destructive",
      });
      return false;
    }
  }

  async function toggleEnabled(overlay: Overlay) {
    if (!canConfigure) return;
    setSaving(true);
    try {
      const ok = await putConfig(overlay.id, { ...overlay, enabled: !overlay.enabled });
      if (ok) toast({ title: overlay.enabled ? "Overlay disabled" : "Overlay enabled" });
    } finally {
      setSaving(false);
    }
  }

  async function changeComponent(overlay: Overlay, component: Overlay["component"]) {
    if (!canConfigure) return;
    setSaving(true);
    try {
      const ok = await putConfig(overlay.id, { ...overlay, component });
      if (ok) toast({ title: "Component updated" });
    } finally {
      setSaving(false);
    }
  }

  function openSheet(overlay: Overlay | null) {
    const draft = overlay ? structuredClone(overlay) : newOverlay();
    setSheetDraft(draft);
    setSheetBaseline(overlay ? structuredClone(overlay) : null);
    setSheetTab(canEditContent && !canConfigure ? "content" : overlay ? "content" : "conditions");
    setEditingButtonIndex(null);
  }

  function discardSheet() {
    setSheetDraft(null);
    setSheetBaseline(null);
    setEditingButtonIndex(null);
  }

  function requestCloseSheet() {
    if (!sheetDraft) {
      discardSheet();
      return;
    }
    const contentDirty = canEditContent && isContentDirty(sheetDraft, sheetBaseline);
    const configDirty = canConfigure && isConfigDirty(sheetDraft, sheetBaseline);
    if (contentDirty || configDirty) {
      const ok = window.confirm("You have unsaved changes. Discard them?");
      if (!ok) return;
    }
    discardSheet();
  }

  function handleTabChange(tab: string) {
    setSheetTab(tab as SheetTab);
  }

  function patchContent(partial: Partial<Overlay["content"]>) {
    if (!sheetDraft || !canEditContent) return;
    setSheetDraft({ ...sheetDraft, content: { ...sheetDraft.content, ...partial } });
  }

  function patchOverlay(partial: Partial<Overlay>) {
    if (!sheetDraft || !canConfigure) return;
    setSheetDraft({ ...sheetDraft, ...partial });
  }

  function patchTrigger(partial: Partial<Overlay["trigger"]>) {
    if (!sheetDraft || !canConfigure) return;
    setSheetDraft({ ...sheetDraft, trigger: { ...sheetDraft.trigger, ...partial } });
  }

  function patchGeo(partial: Partial<NonNullable<Overlay["targeting"]["geo"]>>) {
    if (!sheetDraft || !canConfigure) return;
    setSheetDraft({
      ...sheetDraft,
      targeting: {
        ...sheetDraft.targeting,
        geo: { ...(sheetDraft.targeting.geo ?? {}), ...partial },
      },
    });
  }

  async function saveSheet() {
    if (!sheetDraft) return;
    const toSave = sheetDraft;
    if (!toSave.id?.trim()) {
      toast({ title: "Overlay ID is required", variant: "destructive" });
      return;
    }

    const isNew = !overlays.find((o) => o.id === sheetDraft.id);
    const contentDirty = isContentDirty(toSave, sheetBaseline);
    const configDirty = isConfigDirty(toSave, sheetBaseline);

    const shouldSaveContent = canEditContent && contentDirty && !isNew;
    const shouldSaveConfig = canConfigure && (isNew || configDirty);
    // Both caps + new: create (config+content body) then content if also dirty after create with content in POST
    // New overlay: POST includes content; if both caps, one POST is enough when creating
    const shouldCreate = canConfigure && isNew;

    if (!shouldSaveContent && !shouldSaveConfig && !shouldCreate) {
      toast({ title: "No changes to save" });
      return;
    }

    if ((shouldSaveConfig || shouldCreate) && overlayBlockingSaveError(toSave)) {
      toast({
        title: "Cannot save",
        description: overlayBlockingSaveError(toSave)!,
        variant: "destructive",
      });
      return;
    }
    if (shouldSaveContent && overlayBlockingSaveError(toSave)) {
      toast({
        title: "Cannot save",
        description: overlayBlockingSaveError(toSave)!,
        variant: "destructive",
      });
      return;
    }

    setSheetSaving(true);
    try {
      if (shouldCreate) {
        const created = await postOverlay({ ...toSave, enabled: false });
        if (!created) return;
        // POST already stored content; if configure-only created empty shell with content edits from someone with both caps, content is in POST body
        toast({ title: "Overlay created (disabled until you enable it)" });
        discardSheet();
        return;
      }

      let ok = true;
      if (shouldSaveContent) {
        ok = await putContent(toSave.id, toSave);
      }
      if (ok && shouldSaveConfig) {
        ok = await putConfig(toSave.id, toSave);
      }
      if (ok) {
        toast({ title: "Overlay saved" });
        discardSheet();
      }
    } finally {
      setSheetSaving(false);
    }
  }

  async function deleteOverlay(id: string) {
    if (!canConfigure) return;
    setSaving(true);
    try {
      await apiRequest("DELETE", `/api/overlays/${encodeURIComponent(id)}`);
      await invalidateOverlays();
      toast({ title: "Overlay deleted" });
      setConfirmDeleteId(null);
    } catch (err) {
      toast({
        title: "Failed to delete overlay",
        description: parseApiError(err, "Failed to delete overlay"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const geo = sheetDraft?.targeting.geo ?? {};
  const pagesIsAll = sheetDraft?.targeting.pages === "all";
  const pagesArray = Array.isArray(sheetDraft?.targeting.pages)
    ? sheetDraft!.targeting.pages
    : [];
  const excludePagesArray = sheetDraft?.targeting.exclude_pages ?? [];
  const pageConflicts = !pagesIsAll
    ? pageTargetingConflicts(pagesArray, excludePagesArray)
    : [];
  const isNewOverlay = sheetDraft ? !overlays.find((o) => o.id === sheetDraft.id) : false;
  const sheetBlockingError = sheetDraft ? overlayBlockingSaveError(sheetDraft) : null;
  const contentDirty = sheetDraft ? isContentDirty(sheetDraft, sheetBaseline) : false;
  const configDirty = sheetDraft ? isConfigDirty(sheetDraft, sheetBaseline) : false;
  const canSaveSheet =
    canMutate &&
    !sheetSaving &&
    !sheetBlockingError &&
    (isNewOverlay
      ? canConfigure
      : (canEditContent && contentDirty) || (canConfigure && configDirty));
  const sheetSaveDisabled = !canSaveSheet;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/private/diagnostics">
              <IconArrowLeft size={18} />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <IconLayersIntersect size={20} />
              Modals &amp; CTA Overlays
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              This page separates copy (what the modal says) from configuration (who sees it, when, and on/off).
              New overlays start off until you enable them.
              {canEditContent && canConfigure
                ? " If you can edit both, Save writes both unsaved parts."
                : " Locked controls mean your role lacks that permission."}
            </p>
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline mt-1"
              onClick={() => setShowAdvanced((v) => !v)}
              data-testid="button-overlays-read-more"
            >
              {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {showAdvanced && (
              <ul className="mt-1.5 list-disc pl-5 text-[11px] text-muted-foreground space-y-1" data-testid="overlays-advanced-help">
                <li>
                  Capabilities: <code className="text-[10px]">overlays_edit_content</code> (copy) and{" "}
                  <code className="text-[10px]">overlays_configure</code> (targeting, triggers, enable)
                </li>
                <li>
                  APIs: <code className="text-[10px]">PUT …/content</code> vs{" "}
                  <code className="text-[10px]">PUT …/config</code> (plus create/delete)
                </li>
                <li>
                  YAML editor is configure-only and can change copy; file is{" "}
                  <code className="text-[10px]">site_*/overlays.yml</code>
                </li>
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowYmlEditor(true)}
            disabled={!canConfigure}
            title={!canConfigure ? "You need the overlays_configure capability" : undefined}
            data-testid="button-edit-overlays-yml"
          >
            <IconCode size={16} />
            Code
          </Button>
          <Button
            onClick={() => openSheet(null)}
            disabled={!canConfigure}
            title={!canConfigure ? "You need the overlays_configure capability" : undefined}
            data-testid="button-create-overlay"
          >
            <IconPlus size={16} />
            New overlay
          </Button>
        </div>
      </div>

      {!canMutate && !isLoading && (
        <p className="text-sm text-muted-foreground border rounded-md px-3 py-2" data-testid="text-overlays-readonly">
          You can view overlays but not edit them. Ask for{" "}
          <code className="text-xs">overlays_edit_content</code> and/or{" "}
          <code className="text-xs">overlays_configure</code>.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <IconLoader2 size={18} className="animate-spin" />
          Loading overlays…
        </div>
      ) : overlays.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <IconLayersIntersect size={32} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">No overlays configured</p>
            <p className="text-sm mt-1">
              {canConfigure
                ? "Click “New overlay” to create your first modal, banner, or slide-in."
                : "No overlays yet. Someone with configure access can create one."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {overlays.map((overlay) => (
            <Card key={overlay.id} data-testid={`card-overlay-${overlay.id}`}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{overlay.id}</span>
                    <Badge variant={overlay.enabled ? "default" : "secondary"}>
                      {overlay.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={!canConfigure || saving}
                        className="whitespace-nowrap inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover-elevate [border-color:var(--badge-outline)] shadow-xs cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                        data-testid={`badge-component-${overlay.id}`}
                      >
                        {COMPONENT_LABELS[overlay.component] ?? overlay.component}
                        <IconChevronDown size={11} className="opacity-60" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {(["modal", "top_banner", "slide_in"] as const).map((type) => (
                          <DropdownMenuItem
                            key={type}
                            onClick={() => changeComponent(overlay, type)}
                            className="flex items-center gap-2"
                            data-testid={`menu-component-${type}`}
                          >
                            {overlay.component === type && <IconCheck size={13} />}
                            <span className={overlay.component === type ? "" : "pl-[21px]"}>
                              {COMPONENT_LABELS[type]}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>
                      <span className="text-foreground/60">Trigger:</span>{" "}
                      {TRIGGER_LABELS[overlay.trigger.event] ?? overlay.trigger.event}
                      {triggerDelayLabel(overlay) && ` (${triggerDelayLabel(overlay)})`}
                    </span>
                    <span>
                      <span className="text-foreground/60">Freq:</span>{" "}
                      {FREQUENCY_LABELS[overlay.frequency] ?? overlay.frequency}
                    </span>
                    <span>
                      <span className="text-foreground/60">Pages:</span>{" "}
                      {pageTargetingLabel(overlay)}
                    </span>
                    <span>
                      <span className="text-foreground/60">Geo:</span>{" "}
                      {geoTargetingLabel(overlay)}
                    </span>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={overlay.enabled}
                    onCheckedChange={() => toggleEnabled(overlay)}
                    aria-label="Toggle enabled"
                    data-testid={`switch-overlay-enabled-${overlay.id}`}
                    disabled={saving || !canConfigure}
                    title={!canConfigure ? "You need the overlays_configure capability" : undefined}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setExpandedPreviewId(
                        expandedPreviewId === overlay.id ? null : overlay.id
                      )
                    }
                    aria-label="Toggle preview"
                    data-testid={`button-preview-overlay-${overlay.id}`}
                    className={expandedPreviewId === overlay.id ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
                  >
                    <IconEye size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openSheet(overlay)}
                    title={canMutate ? "Edit overlay" : "View overlay"}
                    data-testid={`button-edit-overlay-${overlay.id}`}
                  >
                    <IconPencil size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(overlay.id)}
                    disabled={!canConfigure}
                    title={!canConfigure ? "You need the overlays_configure capability" : undefined}
                    data-testid={`button-delete-overlay-${overlay.id}`}
                  >
                    <IconTrash size={16} />
                  </Button>
                </div>
              </CardHeader>
              {overlay.content.title && (
                <CardContent className="pt-0 pb-3">
                  <p className="text-sm font-medium">{overlay.content.title}</p>
                  {overlay.content.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {overlay.content.body}
                    </p>
                  )}
                </CardContent>
              )}
              {expandedPreviewId === overlay.id && (
                <CardContent className="pt-0 pb-4 border-t border-border mt-1">
                  <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                    <IconEye size={12} />
                    Preview
                    <span className="ml-auto opacity-60">
                      {COMPONENT_LABELS[overlay.component] ?? overlay.component}
                    </span>
                  </div>
                  <OverlayInlinePreview overlay={overlay} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete overlay?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove{" "}
            <span className="font-mono">{confirmDeleteId}</span> from the YAML.
            This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteId(null)}
              data-testid="button-cancel-delete-overlay"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteOverlay(confirmDeleteId)}
              disabled={saving}
              data-testid="button-confirm-delete-overlay"
            >
              {saving ? <IconLoader2 size={16} className="animate-spin" /> : <IconTrash size={16} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3-tab overlay editor sheet */}
      <Sheet open={!!sheetDraft} onOpenChange={(open) => { if (!open) requestCloseSheet(); }}>
        <SheetContent ref={setSheetContainer as React.Ref<HTMLDivElement>} side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <IconLayersIntersect size={18} />
              {isNewOverlay ? "New overlay" : sheetDraft?.id}
            </SheetTitle>
            <SheetDescription>
              {isNewOverlay
                ? "Starts disabled. Set conditions (and copy if you can), then enable it from the list when ready."
                : "Edit copy and/or conditions based on your permissions. Save writes unsaved parts you are allowed to change."}
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={sheetTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col"
          >
            <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0 h-auto justify-start gap-0">
              <TabsTrigger value="content" className="flex items-center gap-1.5 rounded-none px-5 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px" data-testid="tab-content">
                <IconFileText size={14} />
                Content
              </TabsTrigger>
              <TabsTrigger value="conditions" className="flex items-center gap-1.5 rounded-none px-5 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px" data-testid="tab-conditions">
                <IconAdjustments size={14} />
                Conditions
              </TabsTrigger>
            </TabsList>

            {/* Content tab */}
            <TabsContent value="content" style={{ height: "calc(100vh - 242px)" }} className="overflow-y-auto overflow-x-hidden px-6 py-4 mt-0">
              {sheetDraft && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      value={sheetDraft.content.title}
                      onChange={(e) => patchContent({ title: e.target.value })}
                      placeholder="Enter a headline"
                      disabled={!canEditContent}
                      data-testid="input-overlay-title"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Body</Label>
                    <div className={!canEditContent ? "pointer-events-none opacity-70" : undefined}>
                      <RichTextArea
                        value={sheetDraft.content.body}
                        onChange={(html) => patchContent({ body: html })}
                        placeholder="Supporting copy"
                        minHeight="80px"
                        data-testid="input-overlay-body"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Buttons</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canEditContent}
                        onClick={() => {
                          const next = [
                            ...(sheetDraft.content.buttons ?? []),
                            { label: "", variant: "default", href: "" } as OverlayButton,
                          ];
                          patchContent({ buttons: next });
                          setEditingButtonIndex(next.length - 1);
                        }}
                        data-testid="button-add-overlay-button"
                      >
                        <IconPlus size={13} />
                        Add button
                      </Button>
                    </div>

                    {(sheetDraft.content.buttons ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">No buttons yet — click "Add button" to add one.</p>
                    )}

                    <div className="space-y-3">
                      {(sheetDraft.content.buttons ?? []).map((btn, i) => {
                        const updateBtn = (patch: Partial<OverlayButton>) => {
                          const updated = [...(sheetDraft.content.buttons ?? [])];
                          updated[i] = { ...updated[i], ...patch };
                          patchContent({ buttons: updated });
                        };
                        const removeBtn = () => {
                          const updated = (sheetDraft.content.buttons ?? []).filter((_, idx) => idx !== i);
                          patchContent({ buttons: updated });
                          setEditingButtonIndex((prev) => {
                            if (prev === null) return null;
                            if (prev === i) return null;
                            if (prev > i) return prev - 1;
                            return prev;
                          });
                        };
                        const moveBtn = (dir: -1 | 1) => {
                          const arr = [...(sheetDraft.content.buttons ?? [])];
                          const j = i + dir;
                          if (j < 0 || j >= arr.length) return;
                          [arr[i], arr[j]] = [arr[j], arr[i]];
                          patchContent({ buttons: arr });
                          setEditingButtonIndex((prev) => {
                            if (prev === i) return j;
                            if (prev === j) return i;
                            return prev;
                          });
                        };
                        const total = (sheetDraft.content.buttons ?? []).length;
                        const isEditing = editingButtonIndex === i;
                        const destMeta = btn.href?.trim()
                          ? btn.href.trim()
                          : "Close modal";
                        return (
                          <div
                            key={i}
                            className="rounded-md border p-2.5 space-y-2.5 bg-muted/30"
                            data-testid={`card-overlay-button-${i}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <span className={buttonChipClass(btn.variant)}>
                                  {btn.label || "Button"}
                                </span>
                                <p className="text-[11px] text-muted-foreground truncate" title={destMeta}>
                                  {destMeta}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => moveBtn(-1)}
                                  disabled={i === 0}
                                  data-testid={`button-move-up-overlay-button-${i}`}
                                >
                                  <IconArrowUp size={14} />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => moveBtn(1)}
                                  disabled={i === total - 1}
                                  data-testid={`button-move-down-overlay-button-${i}`}
                                >
                                  <IconArrowDown size={14} />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() =>
                                    setEditingButtonIndex(isEditing ? null : i)
                                  }
                                  title={isEditing ? "Collapse" : "Edit button"}
                                  data-testid={`button-edit-overlay-button-${i}`}
                                >
                                  {isEditing ? <IconX size={14} /> : <IconPencil size={14} />}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={removeBtn}
                                  data-testid={`button-remove-overlay-button-${i}`}
                                >
                                  <IconTrash size={14} />
                                </Button>
                              </div>
                            </div>
                            {isEditing && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Label</Label>
                                    <Input
                                      value={btn.label}
                                      onChange={(e) => updateBtn({ label: e.target.value })}
                                      placeholder="Apply now"
                                      data-testid={`input-overlay-button-label-${i}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Style</Label>
                                    <Select
                                      value={btn.variant}
                                      onValueChange={(v) => updateBtn({ variant: v as OverlayButton["variant"] })}
                                    >
                                      <SelectTrigger data-testid={`select-overlay-button-variant-${i}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="default">Primary</SelectItem>
                                        <SelectItem value="secondary">Secondary</SelectItem>
                                        <SelectItem value="outline">Outline</SelectItem>
                                        <SelectItem value="ghost">Ghost</SelectItem>
                                        <SelectItem value="destructive">Destructive</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Destination</Label>
                                  <OverlayButtonDestination
                                    href={btn.href}
                                    onChange={(v) => updateBtn({ href: v })}
                                    portalContainer={sheetContainer}
                                    testId={`link-picker-overlay-button-${i}`}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Image <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-md border bg-muted/50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {sheetDraft.content.image_id ? (
                          <img
                            src={sheetDraft.content.image_id}
                            alt="Overlay image"
                            className="w-full h-full object-cover"
                            data-testid="img-overlay-image-preview"
                          />
                        ) : (
                          <IconPhoto size={20} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canEditContent}
                          onClick={() => setImagePickerOpen(true)}
                          data-testid="button-overlay-choose-image"
                        >
                          Choose image
                        </Button>
                        {sheetDraft.content.image_id && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!canEditContent}
                            onClick={() => patchContent({ image_id: undefined })}
                            data-testid="button-overlay-remove-image"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    <ImagePickerDialog
                      open={imagePickerOpen}
                      onOpenChange={setImagePickerOpen}
                      title="Select overlay image"
                      initialSrc={sheetDraft.content.image_id ?? ""}
                      onSave={(src) => {
                        patchContent({ image_id: src || undefined });
                        setImagePickerOpen(false);
                      }}
                      onRemove={() => patchContent({ image_id: undefined })}
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Conditions tab */}
            <TabsContent value="conditions" style={{ height: "calc(100vh - 242px)" }} className="overflow-y-auto overflow-x-hidden px-6 py-4 mt-0">
              {sheetDraft && (
                <div className="space-y-5">
                  {!canConfigure && (
                    <p className="text-xs text-muted-foreground" data-testid="text-conditions-readonly">
                      Configuration is read-only — you need the overlays_configure capability.
                    </p>
                  )}
                  <div className="space-y-2 rounded-md border p-3 bg-muted/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <Label htmlFor="overlay-dismissible">Allow close without answering</Label>
                        <p className="text-xs text-muted-foreground">
                          When off, visitors must use a button — X and backdrop (modals) will not dismiss.
                          You can save this while the overlay is disabled; enabling requires a labeled button.
                        </p>
                      </div>
                      <Switch
                        id="overlay-dismissible"
                        checked={isOverlayDismissible(sheetDraft)}
                        onCheckedChange={(checked) => patchOverlay({ dismissible: checked })}
                        disabled={!canConfigure}
                        data-testid="switch-overlay-dismissible"
                      />
                    </div>
                    {sheetBlockingError && (
                      <p
                        className="text-xs text-destructive"
                        data-testid="text-overlay-blocking-error"
                      >
                        {sheetBlockingError}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Component type</Label>
                      <Select
                        value={sheetDraft.component}
                        onValueChange={(v) => patchOverlay({ component: v as Overlay["component"] })}
                        disabled={!canConfigure}
                      >
                        <SelectTrigger data-testid="select-overlay-component" disabled={!canConfigure}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="modal">
                            <div>
                              <div className="font-medium">Modal</div>
                              <div className="text-xs text-muted-foreground">Centred dialog that dims the page</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="top_banner">
                            <div>
                              <div className="font-medium">Top Banner</div>
                              <div className="text-xs text-muted-foreground">Full-width bar pinned to the top of the page</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="slide_in">
                            <div>
                              <div className="font-medium">Slide-In</div>
                              <div className="text-xs text-muted-foreground">Small card that slides in from the corner</div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Trigger event</Label>
                      <Select
                        value={sheetDraft.trigger.event}
                        onValueChange={(v) =>
                          patchTrigger({ event: v as Overlay["trigger"]["event"] })
                        }
                        disabled={!canConfigure}
                      >
                        <SelectTrigger data-testid="select-overlay-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="page_load">
                            <div>
                              <div className="font-medium">Page Load</div>
                              <div className="text-xs text-muted-foreground">Fires as soon as the page finishes loading</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="time_delay">
                            <div>
                              <div className="font-medium">Time Delay</div>
                              <div className="text-xs text-muted-foreground">Waits a set number of milliseconds before showing</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="scroll_depth">
                            <div>
                              <div className="font-medium">Scroll Depth</div>
                              <div className="text-xs text-muted-foreground">Shows after the visitor scrolls past a % of the page</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="exit_intent">
                            <div>
                              <div className="font-medium">Exit Intent</div>
                              <div className="text-xs text-muted-foreground">Triggers when the cursor moves toward closing the tab</div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {sheetDraft.trigger.event === "scroll_depth"
                          ? "Scroll threshold (%)"
                          : "Delay (ms)"}
                      </Label>
                      <Input
                        type="number"
                        value={sheetDraft.trigger.delay ?? ""}
                        onChange={(e) =>
                          patchTrigger({
                            delay: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder={sheetDraft.trigger.event === "scroll_depth" ? "50" : "2000"}
                        disabled={!canConfigure}
                        data-testid="input-overlay-delay"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Frequency</Label>
                      <Select
                        value={sheetDraft.frequency}
                        onValueChange={(v) => patchOverlay({ frequency: v as Overlay["frequency"] })}
                        disabled={!canConfigure}
                      >
                        <SelectTrigger data-testid="select-overlay-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="once">
                            <div>
                              <div className="font-medium">Once per visitor</div>
                              <div className="text-xs text-muted-foreground">Shown once, then hidden forever for that browser</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="session">
                            <div>
                              <div className="font-medium">Once per session</div>
                              <div className="text-xs text-muted-foreground">Resets each time the visitor closes the browser tab</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="always">
                            <div>
                              <div className="font-medium">Every page visit</div>
                              <div className="text-xs text-muted-foreground">Shown on every visit, no dismissal memory</div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Page targeting</Label>
                      <Select
                        value={pagesIsAll ? "all" : "specific"}
                        onValueChange={(v) =>
                          patchOverlay({
                            targeting: {
                              ...sheetDraft.targeting,
                              pages: v === "all" ? "all" : [],
                            },
                          })
                        }
                        disabled={!canConfigure}
                      >
                        <SelectTrigger data-testid="select-overlay-pages">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All pages</SelectItem>
                          <SelectItem value="specific">Specific pages</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!pagesIsAll && (
                    <div className={`space-y-2 ${!canConfigure ? "pointer-events-none opacity-70" : ""}`}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Include on</Label>
                          <PageTargetingChips
                            pages={pagesArray}
                            onChange={(pages) =>
                              patchOverlay({
                                targeting: {
                                  ...sheetDraft.targeting,
                                  pages,
                                },
                              })
                            }
                            portalContainer={sheetContainer}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Exclude from</Label>
                          <PageTargetingChips
                            pages={excludePagesArray}
                            onChange={(exclude_pages) =>
                              patchOverlay({
                                targeting: {
                                  ...sheetDraft.targeting,
                                  exclude_pages,
                                },
                              })
                            }
                            portalContainer={sheetContainer}
                          />
                        </div>
                      </div>
                      {pageConflicts.length > 0 && (
                        <p
                          className="text-xs text-amber-600 dark:text-amber-400"
                          data-testid="text-page-targeting-conflict"
                        >
                          Conflict:{" "}
                          {pageConflicts.map((c) => `"${c}"`).join(", ")}{" "}
                          {pageConflicts.length === 1 ? "is" : "are"} in both Include and Exclude
                          (Exclude wins)
                        </p>
                      )}
                    </div>
                  )}

                  <div className={`border-t pt-4 space-y-4 ${!canConfigure ? "pointer-events-none opacity-70" : ""}`}>
                    <p className="text-sm font-medium text-muted-foreground">Geo targeting <span className="font-normal">(all optional)</span></p>
                    <SearchableMultiSelect
                      label="Countries"
                      options={COUNTRY_OPTIONS}
                      value={geo.countries ?? []}
                      onChange={(v) => patchGeo({ countries: v })}
                      searchPlaceholder="Search countries..."
                      testIdPrefix="overlay-countries"
                      emptyMessage="No countries found"
                      portalContainer={sheetContainer}
                    />
                    <SearchableMultiSelect
                      label="Exclude countries"
                      options={COUNTRY_OPTIONS}
                      value={geo.exclude_countries ?? []}
                      onChange={(v) => patchGeo({ exclude_countries: v })}
                      searchPlaceholder="Search countries..."
                      testIdPrefix="overlay-exclude-countries"
                      emptyMessage="No countries found"
                      portalContainer={sheetContainer}
                    />
                    <SearchableMultiSelect
                      label="Regions / states"
                      options={REGION_OPTIONS}
                      value={geo.regions ?? []}
                      onChange={(v) => patchGeo({ regions: v })}
                      searchPlaceholder="Search regions..."
                      testIdPrefix="overlay-regions"
                      emptyMessage="No regions found"
                      allowFreeText
                      portalContainer={sheetContainer}
                    />
                  </div>
                </div>
              )}
            </TabsContent>

          </Tabs>

          <div className="px-6 py-4 border-t flex justify-end gap-2 shrink-0">
            <Button
              variant="ghost"
              onClick={requestCloseSheet}
              data-testid="button-cancel-sheet"
            >
              <IconX size={16} />
              Cancel
            </Button>
            <Button
              onClick={saveSheet}
              disabled={sheetSaveDisabled}
              title={
                !canMutate
                  ? "You need overlays_edit_content or overlays_configure"
                  : sheetBlockingError || undefined
              }
              data-testid="button-save-sheet"
            >
              {sheetSaving ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconCheck size={16} />
              )}
              {isNewOverlay
                ? "Create"
                : canEditContent && canConfigure && contentDirty && configDirty
                  ? "Save all"
                  : canEditContent && contentDirty && !(canConfigure && configDirty)
                    ? "Save content"
                    : canConfigure && configDirty
                      ? "Save conditions"
                      : "Save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {showYmlEditor && canConfigure && (
        <Suspense fallback={null}>
          <OverlaysYmlEditorPanel
            onClose={() => setShowYmlEditor(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/overlays"] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
