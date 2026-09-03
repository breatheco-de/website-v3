import type { ComponentType, SVGProps } from "react";
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

type TriggerIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export interface SolveWithAiAgentDropdownProps {
  label?: string;
  prompt: string;
  disabled?: boolean;
  onAgentSelect: (payload: SolveWithAiAgentSelectPayload) => void;
  testId?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost";
  /** Compact control for dense tables. */
  size?: "default" | "sm";
  /** Leading icon on the trigger; defaults to sparkles. */
  icon?: TriggerIcon;
  /** Accessible name when `label` is empty (icon-only). */
  ariaLabel?: string;
  className?: string;
}

export function SolveWithAiAgentDropdown({
  label = "",
  prompt,
  disabled = false,
  onAgentSelect,
  testId = "solve-with-ai-agent",
  buttonVariant = "default",
  size = "default",
  icon: Icon = IconSparkles,
  ariaLabel,
  className,
}: SolveWithAiAgentDropdownProps) {
  const { toast } = useToast();
  const compact = size === "sm";
  const visibleLabel = label.trim();

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
          size={compact ? "sm" : "default"}
          disabled={disabled || !prompt.trim()}
          className={cn(compact && "h-7 px-2 text-xs gap-1", className)}
          data-testid={`button-${testId}`}
          aria-label={visibleLabel ? undefined : (ariaLabel ?? "Agent")}
        >
          <Icon className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          {visibleLabel || null}
          <IconChevronDown className={cn(compact ? "h-3 w-3 opacity-70" : "h-4 w-4 opacity-70")} />
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
