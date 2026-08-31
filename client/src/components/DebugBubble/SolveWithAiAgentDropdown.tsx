import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { IconChevronDown, IconSparkles } from "@tabler/icons-react";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import {
  SOLVE_WITH_AI_MENU,
  type SolveWithAiAgentId,
} from "./solveWithAiPrompt";
import { SolveWithAiAgentIcon } from "./SolveWithAiAgentIcon";

export type SolveWithAiAgentSelectPayload = {
  agentId: SolveWithAiAgentId;
  setupTab: McpSetupTabId;
  prompt: string;
  label: string;
  prefillUrlPrefix?: string;
};

export interface SolveWithAiAgentDropdownProps {
  label: string;
  prompt: string;
  disabled?: boolean;
  onAgentSelect: (payload: SolveWithAiAgentSelectPayload) => void;
  testId?: string;
  buttonVariant?: "default" | "outline" | "secondary";
  className?: string;
}

export function SolveWithAiAgentDropdown({
  label,
  prompt,
  disabled = false,
  onAgentSelect,
  testId = "solve-with-ai-agent",
  buttonVariant = "default",
  className,
}: SolveWithAiAgentDropdownProps) {
  const { toast } = useToast();

  async function handleSelect(agentId: SolveWithAiAgentId) {
    const item = SOLVE_WITH_AI_MENU.find((m) => m.id === agentId);
    if (!item || !prompt.trim()) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast({
        title: "Prompt copied",
        description: "Connect MCP in the next dialog, then confirm to open your AI agent.",
      });
    } catch {
      toast({
        title: "Could not copy prompt",
        description: "Allow clipboard access, or copy again from the confirmation dialog.",
        variant: "destructive",
      });
    }
    onAgentSelect({
      agentId: item.id,
      setupTab: item.setupTab,
      prompt,
      label: item.label,
      prefillUrlPrefix: item.prefillUrlPrefix,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={buttonVariant}
          disabled={disabled || !prompt.trim()}
          className={cn(className)}
          data-testid={`button-${testId}`}
        >
          <IconSparkles className="h-4 w-4" />
          {label}
          <IconChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        // Above DialogContent (z-[10000]) so the menu is not trapped under the modal layer.
        className="z-[10001] w-48"
        data-testid={`menu-${testId}`}
      >
        {SOLVE_WITH_AI_MENU.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="gap-2 text-[13px]"
            onSelect={() => void handleSelect(item.id)}
            data-testid={`menu-${testId}-${item.id}`}
          >
            <SolveWithAiAgentIcon agentId={item.id} />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
