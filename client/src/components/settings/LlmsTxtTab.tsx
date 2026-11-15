import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
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
  IconInfoCircle,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createVariableWidgetPlugin } from "@/lib/cm-variable-highlight";
import { cn } from "@/lib/utils";

/** Job input slots in LLMS_TXT_REGENERATE_PROMPT (not CMS Variables). */
const PROMPT_INPUT_SLOT_RE =
  /\{\{(company_profile|site_facts|products|pages|previous_llms_txt)\}\}/g;

const PROMPT_INPUT_SLOT_INFO =
  "Filled when the regenerate job runs, from data we already have on the site (company profile, facts, products, pages, and the previous template). Not a CMS variable — just a slot in this prompt.";

function PromptInputSlotInfo() {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          title="About this prompt input"
          data-testid="button-llms-prompt-slot-info"
        >
          <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-64 p-3 text-xs text-muted-foreground z-[10001]"
      >
        {PROMPT_INPUT_SLOT_INFO}
      </PopoverContent>
    </Popover>
  );
}

function PromptWithInputHighlights({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(PROMPT_INPUT_SLOT_RE.source, "g");
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    parts.push(
      <span
        key={`slot-${i++}-${match.index}`}
        className="inline-flex items-center gap-0.5 align-middle"
      >
        <code className="rounded bg-amber-500/15 px-1 py-0.5 text-[11px] text-foreground border border-amber-500/25">
          {token}
        </code>
        <PromptInputSlotInfo />
      </span>,
    );
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return <>{parts}</>;
}

export interface LlmsTxtSettingsResponse {
  has_template: boolean;
  enabled: boolean;
  serving: boolean;
  template: string | null;
  template_mtime_ms: number | null;
  markdown: string | null;
  prompt: string;
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
  const [promptOpen, setPromptOpen] = useState(false);
  const baselineMtimeMs = useRef<number | null>(null);
  const regenerateStartedAt = useRef<number>(0);

  const { data, isLoading, refetch } = useQuery<LlmsTxtSettingsResponse>({
    queryKey: ["/api/settings/llms-txt"],
    refetchInterval: regenerating ? REGENERATE_POLL_MS : false,
  });

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

  const runRegenerate = async () => {
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
        push_skipped?: boolean;
        push_error?: string | null;
      };
      if (!res.ok) {
        throw new Error(json.error || "Failed to update serving");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/llms-txt"] });
      toast({
        title: enabled ? "Now serving" : "Stopped serving",
        description: json.push_skipped
          ? `Saved locally. Content push skipped: ${json.push_error || "sync disabled"}.`
          : enabled
            ? "Public /llms.txt is live again."
            : "Public /llms.txt returns 404. The template file is kept.",
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
              onClick={() => void setServingEnabled(true)}
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
            {hasTemplate ? "Regenerate" : "Generate & serve"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Public agents read <code className="text-xs">/llms.txt</code> when serving is on and a
          template exists. Stop serving turns the public URL off without deleting the template;
          Serve turns it back on.
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
            <p>Use Generate &amp; serve, or wait if a public request already queued a job.</p>
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
                Template file: <code>llms.template.md</code> in the site content root. Serving flag:{" "}
                <code>settings.yml → llms_txt.enabled</code> (default on).
              </li>
              <li>
                Job: <code>llms_txt_regenerate</code> (Sidequest / OpenRouter). Enqueue only from
                Regenerate/Generate or a public 404 while enabled and missing. Prompt lives in code (
                <code>regenerate-prompt.ts</code>).
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
              Regenerate overwrites <code className="text-xs">llms.template.md</code> and the public
              file updates as soon as the job finishes. There is no draft — visitors will see the new
              version when it is ready.
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

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent
          className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
          data-testid="dialog-llms-prompt"
        >
          <DialogHeader>
            <DialogTitle>Regenerate prompt</DialogTitle>
            <DialogDescription>
              Read-only copy from code (<code className="text-xs">regenerate-prompt.ts</code>).
              Highlighted slots are job inputs (see the info icon next to each).
            </DialogDescription>
          </DialogHeader>
          <pre
            className="flex-1 min-h-0 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono"
            data-testid="text-llms-prompt-body"
          >
            <PromptWithInputHighlights text={data?.prompt ?? ""} />
          </pre>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!data?.prompt) return;
                const ok = await copyText(data.prompt);
                toast({
                  title: ok ? "Prompt copied" : "Copy failed",
                  variant: ok ? "default" : "destructive",
                });
              }}
              data-testid="button-copy-llms-prompt"
            >
              <IconCopy className="h-4 w-4 mr-1.5" />
              Copy prompt
            </Button>
            <Button size="sm" onClick={() => setPromptOpen(false)} data-testid="button-close-llms-prompt">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
