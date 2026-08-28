import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function handleSelect(agentId: SolveWithAiAgentId) {
    const item = SOLVE_WITH_AI_MENU.find((m) => m.id === agentId);
    if (!item || !prompt.trim()) return;
    setMenuOpen(false);
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
    <div ref={menuRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant={buttonVariant}
        disabled={disabled || !prompt.trim()}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
        data-testid={`button-${testId}`}
      >
        <IconSparkles className="h-4 w-4" />
        {label}
        <IconChevronDown className="h-4 w-4 opacity-70" />
      </Button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-1 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {SOLVE_WITH_AI_MENU.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
              onClick={() => void handleSelect(item.id)}
              data-testid={`menu-${testId}-${item.id}`}
            >
              <SolveWithAiAgentIcon agentId={item.id} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
