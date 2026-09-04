import { useMemo } from "react";
import { Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import YamlEditor from "@/components/editing/YamlEditor";
import {
  ASK_AGENT_PROMPT_FIXTURES,
  askAgentPromptFilename,
  getAskAgentTemplate,
  renderAskAgentPrompt,
  type AskAgentPromptId,
} from "@shared/ask-agent-prompts";
import "@/lib/askAgentPrompts";

interface AskAgentPromptViewerPanelProps {
  id: AskAgentPromptId;
  onClose: () => void;
}

export function AskAgentPromptViewerPanel({ id, onClose }: AskAgentPromptViewerPanelProps) {
  const { toast } = useToast();
  const tpl = useMemo(() => getAskAgentTemplate(id), [id]);
  const fm = tpl.frontmatter;

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({
        title: `Could not copy ${label.toLowerCase()}`,
        description: "Allow clipboard access and try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col"
      data-testid="ask-agent-prompt-viewer-panel"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="min-w-0 flex-1">
          <h2
            className="text-sm font-medium truncate leading-tight"
            data-testid="text-ask-agent-prompt-title"
          >
            {fm.title}
          </h2>
          <p
            className="text-[11px] text-muted-foreground truncate font-mono leading-tight"
            data-testid="text-ask-agent-prompt-path"
          >
            {askAgentPromptFilename(id)}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          data-testid="button-close-ask-agent-prompt-viewer"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <YamlEditor
          value={tpl.raw}
          readOnly
          highlightActiveLine={false}
          className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        />
      </div>

      <div className="flex items-center justify-end p-3 border-t gap-2 flex-wrap">
        <Button variant="outline" onClick={onClose} data-testid="button-close-ask-agent-prompt-footer">
          Close
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void copyText("Sample", renderAskAgentPrompt(id, ASK_AGENT_PROMPT_FIXTURES[id]))
          }
          data-testid="button-copy-ask-agent-prompt-sample"
        >
          <Copy className="h-4 w-4 mr-2" />
          Copy sample
        </Button>
        <Button
          onClick={() => void copyText("Template", tpl.raw)}
          data-testid="button-copy-ask-agent-prompt-template"
        >
          <Copy className="h-4 w-4 mr-2" />
          Copy template
        </Button>
      </div>
    </div>
  );
}
