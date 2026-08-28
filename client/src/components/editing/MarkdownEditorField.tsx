import { useState, useRef, useEffect, useMemo } from "react";
import { FileCode, List, Maximize2, Minimize2, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import type { Element as HastElement } from "hast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Geekchart } from "geekchart";
import {
  normalizeMathDelimiters,
  remarkMathOptions,
  rehypeKatexOptions,
} from "@shared/markdown-math";
import "./prose-preview.css";
import "geekchart/fonts.css";

/** Text content of a hast node, same idea as server/markdown-enhance.ts's collectText. */
function collectHastText(node: HastElement | undefined): string {
  if (!node) return "";
  return node.children
    .map((child) => {
      if (child.type === "text") return child.value;
      if (child.type === "element") return collectHastText(child);
      return "";
    })
    .join("");
}

function isMermaidCodeNode(node: HastElement | undefined): boolean {
  if (!node || node.tagName !== "code") return false;
  const cls = node.properties?.className;
  const classes = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? [cls] : [];
  return classes.includes("language-mermaid");
}

/** Same `speed=N` fence-meta parsing as server/markdown-enhance.ts's rehypeGeekchart. */
function speedFromMeta(node: HastElement | undefined): number | undefined {
  const meta = String((node?.data as { meta?: string } | undefined)?.meta ?? "");
  const match = /\bspeed=([0-9]*\.?[0-9]+)/.exec(meta);
  return match ? Number(match[1]) : undefined;
}

/**
 * A mermaid fence in the preview: the chart as the article column shows it,
 * plus the renderer's own warnings for the writer — including a second,
 * unseen render at the phone column width, which is the only way to learn
 * that a chart will be "about N screens tall on a phone" (DESIGN 1.7)
 * before it is published.
 */
function ChartPreview({ source, speed }: { source: string; speed?: number }) {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [phoneWarnings, setPhoneWarnings] = useState<string[]>([]);
  const all = [...warnings, ...phoneWarnings];
  return (
    <figure className="geekchart">
      <Geekchart
        source={source}
        play="once"
        speed={speed}
        display={612}
        onRender={(info) => setWarnings(info.warnings)}
      />
      <div style={{ display: "none" }} aria-hidden="true">
        <Geekchart
          source={source}
          motion={false}
          display={358}
          onRender={(info) => setPhoneWarnings(info.warnings.filter((w) => w.startsWith("1.7")))}
        />
      </div>
      {all.length > 0 && (
        <ul className="mt-2 text-xs text-muted-foreground list-disc pl-4">
          {all.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}

interface TocPreviewItem {
  text: string;
  level: number;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTocFromMarkdown(markdown: string): TocPreviewItem[] {
  const lines = markdown.split("\n");
  const items: TocPreviewItem[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      items.push({
        level: match[1].length,
        text: stripInlineMarkdown(match[2].trim()),
      });
    }
  }

  return items;
}

interface MarkdownEditorFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** When set, shows a TOC on/off toggle next to Edit Markdown */
  showToc?: boolean;
  onShowTocChange?: (showToc: boolean) => void;
  "data-testid"?: string;
}

export function MarkdownEditorField({
  value,
  onChange,
  label = "Content",
  showToc,
  onShowTocChange,
  "data-testid": testId,
}: MarkdownEditorFieldProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const tocItems = extractTocFromMarkdown(value);
  const charCount = value.length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const tocToggleEnabled = typeof onShowTocChange === "function";
  const tocActive = showToc === true;

  const previewLines = value.split("\n").filter((l) => l.trim().length > 0).slice(0, 6);

  return (
    <>
      <div
        className="rounded-md border border-input bg-background"
        data-testid={testId || "markdown-editor-field"}
      >
        <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <div className="flex items-center gap-2">
            {tocToggleEnabled && (
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="markdown-toc-toggle"
                  className="text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer"
                >
                  Table of Contents
                </Label>
                <Switch
                  id="markdown-toc-toggle"
                  checked={tocActive}
                  onCheckedChange={onShowTocChange}
                  data-testid="toggle-show-toc"
                />
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              data-testid="button-edit-markdown"
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit Markdown
            </Button>
          </div>
        </div>

        <div className="px-3 py-3 space-y-3">
          {previewLines.length > 0 ? (
            <div className="space-y-1">
              {previewLines.map((line, i) => (
                <p
                  key={i}
                  className="truncate text-xs text-muted-foreground font-mono leading-relaxed"
                >
                  {line}
                </p>
              ))}
              {value.split("\n").filter((l) => l.trim()).length > 6 && (
                <p className="text-xs text-muted-foreground/60 italic">
                  ...and more
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No content yet</p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="text-xs font-normal">
              {charCount.toLocaleString()} chars
            </Badge>
            <Badge variant="secondary" className="text-xs font-normal">
              {wordCount.toLocaleString()} words
            </Badge>
            {tocItems.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                <List className="mr-1 h-3 w-3" />
                {tocItems.length} heading{tocItems.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {tocItems.length > 0 && (
            <div
              className={cn(
                "relative rounded-md border border-border bg-muted/20 p-2.5",
              )}
            >
              {tocToggleEnabled && !tocActive && (
                <Badge
                  variant="destructive"
                  className="absolute top-2 right-2 z-10 text-[10px] font-medium px-1.5 py-0"
                  data-testid="badge-toc-hidden"
                >
                  TOC is hidden
                </Badge>
              )}
              <div className={cn(tocToggleEnabled && !tocActive && "opacity-50")}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider pr-24">
                  Table of Contents
                </p>
                <ul className="space-y-0.5">
                  {tocItems.map((item, i) => (
                    <li
                      key={i}
                      className="text-xs text-muted-foreground"
                      style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                    >
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <MarkdownEditorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

interface MarkdownEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}

function MarkdownEditorModal({
  open,
  onOpenChange,
  value,
  onChange,
}: MarkdownEditorModalProps) {
  const [draft, setDraft] = useState(value);
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  const handleSave = () => {
    onChange(draft);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = draft.substring(0, start) + "  " + draft.substring(end);
      setDraft(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const charCount = draft.length;
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const hasChanges = draft !== value;
  const previewMarkdown = useMemo(() => normalizeMathDelimiters(draft), [draft]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col p-0 gap-0"
        style={{ maxWidth: "95vw", width: "95vw", height: "90vh", maxHeight: "90vh" }}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="flex-none border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <DialogTitle className="flex items-center gap-2">
                <FileCode className="h-5 w-5" />
                Markdown Editor
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs font-normal">
                  {charCount.toLocaleString()} chars
                </Badge>
                <Badge variant="secondary" className="text-xs font-normal">
                  {wordCount.toLocaleString()} words
                </Badge>
                {hasChanges && (
                  <Badge variant="outline" className="text-xs font-normal text-destructive border-destructive/40">
                    Unsaved changes
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                data-testid="button-toggle-preview"
              >
                {showPreview ? (
                  <>
                    <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
                    Hide Preview
                  </>
                ) : (
                  <>
                    <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
                    Show Preview
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-none border-b border-border bg-muted/20 px-4 py-2 space-y-1.5 text-sm text-muted-foreground">
          <p>
            Math uses{" "}
            <code className="text-xs bg-muted px-1 rounded text-foreground">\(...\)</code>{" "}
            inline and{" "}
            <code className="text-xs bg-muted px-1 rounded text-foreground">\[...\]</code>{" "}
            for display (LaTeX). Prices stay as{" "}
            <code className="text-xs bg-muted px-1 rounded text-foreground">$99</code>
            {" "}— a single <code className="text-xs bg-muted px-1 rounded">$</code> is not math.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-foreground font-medium">
              Read more (advanced)
            </summary>
            <ul className="mt-2 list-disc pl-5 font-mono space-y-1">
              <li>shared/markdown-math.ts</li>
              <li>server/markdown-enhance.ts</li>
              <li>
                Published articles: KaTeX HTML from the server enhance cache (same family as
                Shiki). This preview runs KaTeX in-browser.
              </li>
            </ul>
          </details>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className={cn("flex flex-col min-h-0", showPreview ? "w-1/2 border-r border-border" : "w-full")}>
            <div className="flex-none px-3 py-1.5 border-b border-border bg-muted/20">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Markdown
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleTabKey}
              className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none"
              spellCheck={false}
              data-testid="textarea-markdown-editor"
            />
          </div>

          {showPreview && (
            <div className="flex w-1/2 flex-col min-h-0">
              <div className="flex-none px-3 py-1.5 border-b border-border bg-muted/20">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Preview
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-6 prose-preview">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, [remarkMath, remarkMathOptions]]}
                    rehypePlugins={[[rehypeKatex, rehypeKatexOptions]]}
                    components={{
                      // Draw ```mermaid fences live instead of showing them as code.
                      // node.data.meta carries the fence info string (e.g. "speed=0.7"),
                      // same as server/markdown-enhance.ts reads from the fenced block.
                      code: ({ className, children, node, ...props }) => {
                        if (isMermaidCodeNode(node)) {
                          const source = collectHastText(node).trim();
                          return <ChartPreview source={source} speed={speedFromMeta(node)} />;
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                      // Mermaid fences render as <figure>, not <pre><code>; unwrap the
                      // <pre> wrapper in that case so the figure is not nested inside it.
                      pre: ({ children, node, ...props }) => {
                        const codeChild = node?.children.find(
                          (c): c is HastElement => c.type === "element" && c.tagName === "code",
                        );
                        if (isMermaidCodeNode(codeChild)) {
                          return <>{children}</>;
                        }
                        return <pre {...props}>{children}</pre>;
                      },
                    }}
                  >
                    {previewMarkdown}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-none border-t border-border px-4 py-3">
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Press Ctrl+S to save, Esc to cancel
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
                data-testid="button-markdown-cancel"
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                data-testid="button-markdown-save"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
