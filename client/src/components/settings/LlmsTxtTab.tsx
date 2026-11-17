import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import {
  IconFileText,
  IconLoader2,
  IconRefresh,
  IconChevronDown,
  IconCopy,
  IconCheck,
  IconPlayerStop,
  IconPlayerPlay,
  IconEye,
  IconPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createVariableWidgetPlugin } from "@/lib/cm-variable-highlight";
import { cn } from "@/lib/utils";

const PROMPT_SLOT_IDS = [
  "company_profile",
  "site_facts",
  "products",
  "pages",
  "previous_llms_txt",
] as const;

type PromptSlotId = (typeof PROMPT_SLOT_IDS)[number];

const PROMPT_SLOT_RE =
  /\{\{(company_profile|site_facts|products|pages|previous_llms_txt)\}\}/g;

const DEFAULT_SLOT_INFO: Record<PromptSlotId, string> = {
  company_profile: "Organization facts from schema.org (name, what it does, regions, languages).",
  site_facts: "Approved site figures from Variables (placement rates, ratings, etc.).",
  products: "Products currently for sale (names, EN/ES URLs, descriptions).",
  pages: "Approved marketing pages with titles, URLs, sections, and locales.",
  previous_llms_txt:
    "The current llms.template.md body, so wording stays stable when inputs are unchanged.",
};

const llmsSlotMatcher = new MatchDecorator({
  regexp: PROMPT_SLOT_RE,
  decoration: Decoration.mark({ class: "cm-llms-prompt-slot" }),
});

const llmsSlotHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = llmsSlotMatcher.createDeco(view);
    }
    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = llmsSlotMatcher.createDeco(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export interface LlmsTxtPromptSlot {
  id: string;
  token: string;
  info: string;
}

export interface LlmsTxtSettingsResponse {
  has_template: boolean;
  has_prompt?: boolean;
  enabled: boolean;
  serving: boolean;
  template: string | null;
  template_mtime_ms: number | null;
  markdown: string | null;
  prompt: string | null;
  prompt_slots?: LlmsTxtPromptSlot[];
  public_url: string;
}

const REGENERATE_POLL_MS = 4000;
const REGENERATE_MAX_MS = 3 * 60 * 1000;

type PreviewMode = "public" | "template";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LlmsTxtTab() {
  const { toast } = useToast();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [servingBusy, setServingBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("public");
  const [copiedKey, setCopiedKey] = useState<"public" | "template" | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmServe, setConfirmServe] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptEditorFocused, setPromptEditorFocused] = useState(false);
  const promptEditorRef = useRef<ReactCodeMirrorRef>(null);
  const baselineMtimeMs = useRef<number | null>(null);
  const regenerateStartedAt = useRef<number>(0);

  const { data, isLoading, refetch } = useQuery<LlmsTxtSettingsResponse>({
    queryKey: ["/api/settings/llms-txt"],
    refetchInterval: regenerating ? REGENERATE_POLL_MS : false,
  });

  const promptSlots = useMemo(() => {
    if (data?.prompt_slots?.length) return data.prompt_slots;
    return PROMPT_SLOT_IDS.map((id) => ({
      id,
      token: `{{${id}}}`,
      info: DEFAULT_SLOT_INFO[id],
    }));
  }, [data?.prompt_slots]);

  useEffect(() => {
    if (!promptOpen) return;
    if (!promptDirty) {
      setPromptDraft(data?.prompt ?? "");
    }
  }, [promptOpen, data?.prompt, promptDirty]);

  useEffect(() => {
    if (!regenerating) return;
    const current = data?.template_mtime_ms ?? null;
    const changed =
      baselineMtimeMs.current !== null &&
      current !== null &&
      current !== baselineMtimeMs.current;
    const appeared = baselineMtimeMs.current === null && current !== null;
    const timedOut = Date.now() - regenerateStartedAt.current > REGENERATE_MAX_MS;
    if (changed || appeared || timedOut) {
      setRegenerating(false);
      if (timedOut && !changed && !appeared) {
        toast({
          title: "Still rebuilding",
          description: "The job may still be running. Refresh this tab in a minute.",
        });
      }
    }
  }, [data?.template_mtime_ms, regenerating, toast]);

  useEffect(() => {
    if (!copiedKey) return;
    const t = window.setTimeout(() => setCopiedKey(null), 1500);
    return () => window.clearTimeout(t);
  }, [copiedKey]);

  const templateExtensions = useMemo(
    () => [
      createVariableWidgetPlugin({ readOnly: true }),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { fontSize: "12px", backgroundColor: "transparent" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          lineHeight: "1.45",
        },
        ".cm-content": {
          padding: "12px",
          caretColor: "transparent",
          color: "hsl(var(--foreground))",
        },
      }),
    ],
    [],
  );

  // Insert when the editor has focus (caret or selection both count).
  const canInsertPromptSlot = promptEditorFocused;
  const hasPrompt = !!data?.has_prompt || !!(data?.prompt && data.prompt.trim());

  const promptEditorExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      llmsSlotHighlighter,
      EditorView.theme({
        "&": { fontSize: "12px", backgroundColor: "transparent", minHeight: "280px" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          lineHeight: "1.45",
        },
        ".cm-content": {
          padding: "12px",
          color: "hsl(var(--foreground))",
        },
        ".cm-llms-prompt-slot": {
          backgroundColor: "color-mix(in srgb, #f59e0b 18%, transparent)",
          border: "1px solid color-mix(in srgb, #f59e0b 35%, transparent)",
          borderRadius: "3px",
          padding: "0 2px",
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged || update.selectionSet) {
          setPromptEditorFocused(update.view.hasFocus);
        }
      }),
    ],
    [],
  );

  const insertPromptSlot = (token: string) => {
    const view = promptEditorRef.current?.view;
    if (!view || !canInsertPromptSlot) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: token },
      selection: { anchor: from + token.length },
    });
    setPromptDraft(view.state.doc.toString());
    setPromptDirty(true);
    view.focus();
  };

  const savePrompt = async () => {
    if (!promptDraft.trim()) {
      toast({ title: "Prompt cannot be empty", variant: "destructive" });
      return;
    }
    setPromptSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/llms-txt/prompt", { prompt: promptDraft });
      const json = (await res.json()) as { success?: boolean; error?: string; prompt?: string };
      if (!res.ok) throw new Error(json.error || "Failed to save prompt");
      setPromptDirty(false);
      setPromptDraft(json.prompt ?? promptDraft);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/llms-txt"] });
      toast({ title: "Prompt saved" });
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Failed to save prompt",
        variant: "destructive",
      });
    } finally {
      setPromptSaving(false);
    }
  };

  const runRegenerate = async () => {
    if (!hasPrompt) {
      toast({
        title: "Save a regenerate prompt first",
        description: "Open View prompt, write the instructions, then Save.",
        variant: "destructive",
      });
      return;
    }
    baselineMtimeMs.current = data?.template_mtime_ms ?? null;
    regenerateStartedAt.current = Date.now();
    setRegenerating(true);
    try {
      const res = await apiRequest("POST", "/api/settings/llms-txt/regenerate", {});
      const json = (await res.json()) as {
        success?: boolean;
        queued?: boolean;
        deduped?: boolean;
        busy?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Regenerate failed");
      }
      toast({
        title: json.deduped
          ? "Rebuild already queued"
          : json.busy
            ? "Queue busy — try again"
            : "Rebuild queued",
      });
    } catch (err: unknown) {
      setRegenerating(false);
      const message = err instanceof Error ? err.message : "Failed to enqueue regenerate";
      toast({ title: "Regenerate failed", description: message, variant: "destructive" });
    }
  };

  const handleRegenerateClick = () => {
    if (!hasPrompt) {
      toast({
        title: "Save a regenerate prompt first",
        description: "Open View prompt, write the instructions, then Save.",
        variant: "destructive",
      });
      return;
    }
    if (data?.has_template) {
      setConfirmRegenerate(true);
      return;
    }
    void runRegenerate();
  };

  const setServingEnabled = async (enabled: boolean) => {
    setServingBusy(true);
    try {
      const res = await apiRequest("POST", "/api/settings/llms-txt/serving", { enabled });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Failed to update serving");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/llms-txt"] });
      toast({
        title: enabled ? "Now serving" : "Stopped serving",
        description: enabled
          ? "Public /llms.txt is live. settings.yml is pending Sync."
          : "Public /llms.txt returns 404. The template file is kept. settings.yml is pending Sync.",
      });
      void refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update serving";
      toast({
        title: enabled ? "Serve failed" : "Stop serving failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setServingBusy(false);
      setConfirmStop(false);
      setConfirmServe(false);
    }
  };

  const handleCopy = async (kind: "public" | "template") => {
    const text = kind === "public" ? data?.markdown : data?.template;
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) {
      toast({ title: "Copy failed", variant: "destructive" });
      return;
    }
    setCopiedKey(kind);
  };

  const serving = !!data?.serving;
  const enabled = !!data?.enabled;
  const hasTemplate = !!data?.has_template;
  const markdown = data?.markdown ?? null;
  const template = data?.template ?? null;
  const showPreview = hasTemplate && !!markdown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <IconFileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">llms.txt</CardTitle>
            {!isLoading ? (
              <Badge
                variant={serving ? "default" : "secondary"}
                data-testid="badge-llms-txt-serving"
              >
                {serving ? "Serving" : enabled ? "On — no template" : "Not serving"}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPromptOpen(true)}
            data-testid="button-view-llms-prompt"
          >
            <IconEye className="h-4 w-4 mr-1.5" />
            View prompt
          </Button>
          {enabled && hasTemplate ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmStop(true)}
              disabled={servingBusy || regenerating}
              data-testid="button-stop-serving-llms-txt"
            >
              {servingBusy ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <IconPlayerStop className="h-4 w-4 mr-1.5" />
              )}
              Stop serving
            </Button>
          ) : null}
          {!enabled && hasTemplate ? (
            <Button
              size="sm"
              className="bg-chart-3 text-white border-transparent hover:bg-chart-3/90"
              onClick={() => setConfirmServe(true)}
              disabled={servingBusy || regenerating}
              data-testid="button-start-serving-llms-txt"
            >
              {servingBusy ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <IconPlayerPlay className="h-4 w-4 mr-1.5" />
              )}
              Serve
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={handleRegenerateClick}
            disabled={regenerating || servingBusy}
            data-testid="button-regenerate-llms-txt"
          >
            {regenerating ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconRefresh className="h-4 w-4 mr-1.5" />
            )}
            {hasTemplate ? "Regenerate" : "Generate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Public agents read <code className="text-xs">/llms.txt</code> when serving is on and a
          template exists. Save a regenerate prompt (View prompt) before Generate. Stop serving
          turns the public URL off without deleting the template; Serve turns it back on.
        </p>

        {!serving && hasTemplate && !regenerating ? (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-llms-txt-off-notice">
            Serving is off — preview below is the saved template; public{" "}
            <code className="text-xs">/llms.txt</code> returns 404.
          </p>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !showPreview && !regenerating ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground space-y-2">
            <p>
              No template yet — public <code className="text-xs">/llms.txt</code> returns 404 until
              you generate one.
            </p>
            <p>Use Generate, then Serve when you want it public. A public miss only queues a rebuild if serving is on.</p>
          </div>
        ) : regenerating && !showPreview ? (
          <div
            className="relative rounded-md border border-dashed min-h-[16rem] flex items-center justify-center bg-muted/20"
            data-testid="llms-txt-regenerate-loader"
          >
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-6 w-6 animate-spin" />
              <span>Rebuilding template…</span>
            </div>
          </div>
        ) : (
          <Tabs
            value={previewMode}
            onValueChange={(v) => setPreviewMode(v as PreviewMode)}
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList data-testid="tabs-llms-txt-preview">
                <TabsTrigger value="public" data-testid="tab-llms-txt-public" disabled={regenerating}>
                  Public
                </TabsTrigger>
                <TabsTrigger value="template" data-testid="tab-llms-txt-template" disabled={regenerating}>
                  Template
                </TabsTrigger>
              </TabsList>
              {previewMode === "public" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy("public")}
                  disabled={regenerating}
                  data-testid="button-copy-llms-markdown"
                >
                  {copiedKey === "public" ? (
                    <IconCheck className="h-4 w-4 mr-1.5" />
                  ) : (
                    <IconCopy className="h-4 w-4 mr-1.5" />
                  )}
                  Copy markdown
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy("template")}
                  disabled={!template || regenerating}
                  data-testid="button-copy-llms-template"
                >
                  {copiedKey === "template" ? (
                    <IconCheck className="h-4 w-4 mr-1.5" />
                  ) : (
                    <IconCopy className="h-4 w-4 mr-1.5" />
                  )}
                  Copy template markdown
                </Button>
              )}
            </div>

            <div className="relative" data-testid="llms-txt-preview-shell">
              <TabsContent value="public" className="mt-0">
                <div
                  className={cn(
                    "rounded-md border bg-muted/30 p-4 max-h-[28rem] overflow-auto prose prose-sm dark:prose-invert max-w-none min-h-[16rem]",
                    regenerating && "pointer-events-none select-none invisible",
                  )}
                  data-testid="llms-txt-markdown-preview"
                  aria-busy={regenerating}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown ?? ""}</ReactMarkdown>
                </div>
              </TabsContent>

              <TabsContent value="template" className="mt-0">
                <div
                  className={cn(
                    "rounded-md border bg-muted/30 overflow-hidden min-h-[16rem]",
                    regenerating && "pointer-events-none select-none invisible",
                  )}
                  data-testid="llms-txt-template-preview"
                  aria-busy={regenerating}
                >
                  <CodeMirror
                    value={template ?? ""}
                    height="28rem"
                    extensions={templateExtensions}
                    editable={false}
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLine: false,
                      highlightActiveLineGutter: false,
                      bracketMatching: true,
                    }}
                  />
                </div>
              </TabsContent>

              {regenerating ? (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-md border bg-background"
                  data-testid="llms-txt-regenerate-loader"
                >
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <IconLoader2 className="h-6 w-6 animate-spin" />
                    <span>Rebuilding template…</span>
                  </div>
                </div>
              ) : null}
            </div>
          </Tabs>
        )}

        <div className="border-t pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-sm text-muted-foreground"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span>Read more (advanced)</span>
            <IconChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen ? (
            <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li>
                Template: <code>llms.template.md</code>. Regenerate prompt:{" "}
                <code>llms.regenerate-prompt.md</code>. Both live in the site content root and Sync
                like other content. Serving flag: <code>settings.yml → llms_txt.enabled</code>.
              </li>
              <li>
                Job: <code>llms_txt_regenerate</code> (Sidequest / OpenRouter). Staff Regenerate does
                not turn serving on. Public 404 enqueues only while enabled and missing. Prompt slots
                are job inputs, not CMS Variables.
              </li>
              <li>
                Pages input: content type <code>page</code>, <code>meta.priority ≥ 0.8</code>, not
                noindex; denylist cookies / privacy / terms / sample-page. AI only writes link notes
                and H2 placement.
              </li>
            </ul>
          ) : null}
        </div>
      </CardContent>

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent data-testid="dialog-llms-regenerate-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the current template?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerate overwrites <code className="text-xs">llms.template.md</code>. It does not
              change the Serve setting — if serving is on, the public file updates when the job
              finishes; if it is off, only the saved template changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-llms-regenerate-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-llms-regenerate-confirm"
              onClick={() => {
                setConfirmRegenerate(false);
                void runRegenerate();
              }}
            >
              Replace &amp; regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmStop}
        onOpenChange={(open) => {
          if (servingBusy) return;
          setConfirmStop(open);
        }}
      >
        <AlertDialogContent data-testid="dialog-llms-stop-serving-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop serving llms.txt?</AlertDialogTitle>
            <AlertDialogDescription>
              Turns off <code className="text-xs">llms_txt.enabled</code> in settings. Public{" "}
              <code className="text-xs">/llms.txt</code> returns 404. The template file stays so you
              can Serve again without regenerating.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={servingBusy} data-testid="button-llms-stop-cancel">
              Keep serving
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={servingBusy}
              data-testid="button-llms-stop-confirm"
              onClick={(e) => {
                e.preventDefault();
                void setServingEnabled(false);
              }}
            >
              {servingBusy ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              {servingBusy ? "Stopping…" : "Stop serving"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmServe}
        onOpenChange={(open) => {
          if (servingBusy) return;
          setConfirmServe(open);
        }}
      >
        <AlertDialogContent data-testid="dialog-llms-start-serving-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Start serving llms.txt?</AlertDialogTitle>
            <AlertDialogDescription>
              Turns on <code className="text-xs">llms_txt.enabled</code> in settings. Public{" "}
              <code className="text-xs">/llms.txt</code> will return the compiled template agents
              already see in the Public preview.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={servingBusy} data-testid="button-llms-serve-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-chart-3 text-white border-transparent hover:bg-chart-3/90"
              disabled={servingBusy}
              data-testid="button-llms-serve-confirm"
              onClick={(e) => {
                e.preventDefault();
                void setServingEnabled(true);
              }}
            >
              {servingBusy ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              {servingBusy ? "Serving…" : "Serve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPromptDirty(false);
            setPromptEditorFocused(false);
            setPromptDraft(data?.prompt ?? "");
          }
          setPromptOpen(open);
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col gap-3"
          data-testid="dialog-llms-prompt"
        >
          <DialogHeader className="pr-6 space-y-1.5">
            <DialogTitle>Regenerate prompt</DialogTitle>
            <DialogDescription>
              Write the instructions the rebuild job sends to the model, then Save before you
              Regenerate. Insert input adds a job data slot at the cursor (not a CMS Variable).
            </DialogDescription>
          </DialogHeader>

          {!hasPrompt && !promptDraft.trim() ? (
            <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-llms-prompt-empty">
              No saved prompt yet — write one and Save. Regenerate stays blocked until this file
              exists.
            </p>
          ) : null}

          <div className="flex items-center justify-end">
            <span
              className="inline-flex"
              title={
                canInsertPromptSlot
                  ? undefined
                  : "Select text in the prompt to insert an input"
              }
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canInsertPromptSlot}
                    data-testid="button-llms-prompt-insert"
                  >
                    <IconPlus className="h-4 w-4 mr-1.5" />
                    Insert input
                    <IconChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 z-[10001]">
                  {promptSlots.map((slot) => (
                    <DropdownMenuItem
                      key={slot.id}
                      className="flex cursor-pointer flex-col items-start gap-0.5 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      onSelect={() => insertPromptSlot(slot.token)}
                      data-testid={`menu-llms-prompt-insert-${slot.id}`}
                    >
                      <code className="text-xs">{slot.token}</code>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {slot.info}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>

          <div
            className="flex-1 min-h-0 overflow-hidden rounded-md border bg-muted/30"
            data-testid="llms-prompt-editor"
          >
            <CodeMirror
              ref={promptEditorRef}
              value={promptDraft}
              height="320px"
              extensions={promptEditorExtensions}
              onChange={(value) => {
                setPromptDraft(value);
                setPromptDirty(true);
              }}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: false,
                // Off: {{slots}} look like matched braces and get a second green highlight.
                bracketMatching: false,
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={promptSaving}
              onClick={() => {
                setPromptDirty(false);
                setPromptDraft(data?.prompt ?? "");
                setPromptOpen(false);
              }}
              data-testid="button-cancel-llms-prompt"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={promptSaving || !promptDraft.trim()}
              onClick={() => void savePrompt()}
              data-testid="button-save-llms-prompt"
            >
              {promptSaving ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
