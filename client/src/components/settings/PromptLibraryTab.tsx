import { useState, lazy, Suspense } from "react";
import { Bot } from "lucide-react";
import { IconInfoCircle, IconFileText } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { McpRequiredForAiModal } from "@/components/mcp/McpRequiredForAiModal";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import {
  SolveWithAiAgentDropdown,
  type SolveWithAiAgentSelectPayload,
} from "@/components/DebugBubble/SolveWithAiAgentDropdown";
import type { SolveWithAiAgentId } from "@/components/DebugBubble/solveWithAiPrompt";
import {
  ASK_AGENT_LIBRARY_IDS,
  getAskAgentTemplate,
  type AskAgentPromptId,
} from "@shared/ask-agent-prompts";
import { buildPolishAskAgentPrompt } from "@/lib/polishAskAgentPrompt";
import "@/lib/askAgentPrompts";

const AskAgentPromptViewerPanel = lazy(() =>
  import("./AskAgentPromptViewerPanel").then((m) => ({ default: m.AskAgentPromptViewerPanel })),
);

export function PromptLibraryTab() {
  const [selectedId, setSelectedId] = useState<AskAgentPromptId | null>(null);
  const [mcpRequiredForAiOpen, setMcpRequiredForAiOpen] = useState(false);
  const [mcpRequiredSetupTab, setMcpRequiredSetupTab] = useState<McpSetupTabId>("cursor");
  const [mcpRequiredAgentId, setMcpRequiredAgentId] = useState<SolveWithAiAgentId>("copy-prompt");
  const [mcpRequiredAgentLabel, setMcpRequiredAgentLabel] = useState("AI Agent");
  const [mcpRequiredPrompt, setMcpRequiredPrompt] = useState("");
  const [mcpRequiredPrefillPrefix, setMcpRequiredPrefillPrefix] = useState<string | undefined>();

  function openAskAgent(payload: SolveWithAiAgentSelectPayload) {
    setMcpRequiredAgentId(payload.agentId);
    setMcpRequiredSetupTab(payload.setupTab);
    setMcpRequiredAgentLabel(payload.label);
    setMcpRequiredPrompt(payload.prompt);
    setMcpRequiredPrefillPrefix(payload.prefillUrlPrefix);
    setMcpRequiredForAiOpen(true);
  }

  return (
    <div className="space-y-4" data-testid="prompt-library-tab">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <IconFileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold" data-testid="text-prompt-library-heading">
            Prompt Library
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({ASK_AGENT_LIBRARY_IDS.length} templates)
            </span>
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Read more about Prompt Library"
                data-testid="button-prompt-library-advanced"
              >
                <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-2 text-sm text-muted-foreground">
              <p>
                Files live under{" "}
                <code className="font-mono text-[11px]">shared/ask-agent-prompts/</code>. Open is
                view and copy only — edit templates in the app repo.
              </p>
              <p>
                Ask Agent on a card pastes the meta “polish this template” prompt so an agent can
                improve that one markdown file.
              </p>
              <p>
                Day-to-day swarm behavior (sessions, conventions) comes from{" "}
                <code className="font-mono text-[11px]">mcp-server/agent-conventions.md</code> and{" "}
                <code className="font-mono text-[11px]">bootstrap_agent</code>, not this list.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl" data-testid="text-prompt-library-intro">
          These are the prompts we paste when staff proactively ask an agent for help (Ask Agent /
          Solve with AI). Other prompts that shape how the agent swarm works day to day are not
          listed here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ASK_AGENT_LIBRARY_IDS.map((id) => {
          const { frontmatter: fm } = getAskAgentTemplate(id);
          return (
            <Card key={id} data-testid={`card-ask-agent-prompt-${id}`}>
              <CardHeader className="pb-2 space-y-1">
                <CardTitle className="text-sm font-semibold">{fm.title}</CardTitle>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {fm.id} · v{fm.version}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Where it’s used</p>
                  <p className="text-sm text-foreground mt-0.5 line-clamp-3">{fm.used_when}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">What we ask</p>
                  <p className="text-sm text-foreground mt-0.5 line-clamp-3">{fm.intention}</p>
                </div>
                <div className="flex justify-end gap-2 flex-wrap">
                  <SolveWithAiAgentDropdown
                    label="Ask Agent"
                    icon={Bot}
                    prompt={buildPolishAskAgentPrompt(id)}
                    size="sm"
                    buttonVariant="outline"
                    testId={`polish-ask-agent-prompt-${id}`}
                    onAgentSelect={openAskAgent}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedId(id)}
                    data-testid={`button-open-ask-agent-prompt-${id}`}
                  >
                    Open
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedId && (
        <Suspense fallback={null}>
          <AskAgentPromptViewerPanel id={selectedId} onClose={() => setSelectedId(null)} />
        </Suspense>
      )}

      <McpRequiredForAiModal
        open={mcpRequiredForAiOpen}
        onOpenChange={setMcpRequiredForAiOpen}
        defaultTab={mcpRequiredSetupTab}
        agentId={mcpRequiredAgentId}
        agentLabel={mcpRequiredAgentLabel}
        prompt={mcpRequiredPrompt}
        prefillUrlPrefix={mcpRequiredPrefillPrefix}
      />
    </div>
  );
}
