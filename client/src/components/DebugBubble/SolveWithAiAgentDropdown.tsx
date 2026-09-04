import React, { useState, type ComponentType, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { ENTRY_ACTIVITY_WINDOW_DAYS } from "@shared/event-log-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntryActivityDialog } from "@/components/pipeline/EntryActivityBadge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { IconChevronDown, IconSparkles } from "@tabler/icons-react";
import { AlertTriangle, Bot, Loader2 } from "lucide-react";
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

export type AskActivityStep = "activity" | "agents";

const gateBadgeClass =
  "mx-0.5 h-5 px-1.5 py-0 text-[10px] font-semibold tabular-nums align-middle shadow-none";

/** Staff copy for the activity gate (2C: soften zero) — plain string for tests/a11y. */
export function formatAskActivityGateCopy(
  writeCount: number,
  windowDays: number,
): string {
  if (writeCount > 0) {
    return `There have been ${writeCount} write${writeCount === 1 ? "" : "s"} on this entry in the past ${windowDays} days. Make sure it is not already improved or fixed.`;
  }
  return `No recent writes on this entry in the past ${windowDays} days. Go ahead and ask the agent to help you.`;
}

/** Activity gate copy with highlighted write-count and window badges. */
export function AskActivityGateCopy({
  writeCount,
  windowDays,
  testId,
}: {
  writeCount: number;
  windowDays: number;
  testId?: string;
}) {
  const daysBadge = (
    <Badge
      variant="secondary"
      className={cn(gateBadgeClass, "bg-muted text-foreground border-border")}
      data-testid={testId ? `${testId}-days-badge` : undefined}
    >
      {windowDays} days
    </Badge>
  );

  const writesBadge = (
    <Badge
      variant="secondary"
      className={cn(gateBadgeClass, "bg-muted text-foreground border-border")}
      data-testid={testId ? `${testId}-writes-badge` : undefined}
    >
      {writeCount} write{writeCount === 1 ? "" : "s"}
    </Badge>
  );

  const body =
    writeCount > 0 ? (
      <>
        There have been {writesBadge} on this entry in the past {daysBadge}. Make
        sure it is not already improved or fixed.
      </>
    ) : (
      <>
        No recent writes on this entry in the past {daysBadge}. Go ahead and ask
        the agent to help you.
      </>
    );

  return (
    <div className="flex items-start gap-2.5" data-testid={testId}>
      <AlertTriangle
        className="h-8 w-8 shrink-0 text-status-away mt-0.5"
        aria-hidden
        data-testid={testId ? `${testId}-warning-icon` : undefined}
      />
      <p className="text-sm text-muted-foreground leading-snug min-w-0">{body}</p>
    </div>
  );
}

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
  /**
   * When set, Ask opens a 2-step activity gate before the agent list.
   * Omit for the flat agent menu (4B).
   */
  entryKey?: string;
  /** Preloaded write count; when omitted with entryKey, fetched on menu open. */
  writeCount?: number;
  windowDays?: number;
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
  entryKey,
  writeCount: writeCountProp,
  windowDays = ENTRY_ACTIVITY_WINDOW_DAYS,
}: SolveWithAiAgentDropdownProps) {
  const { toast } = useToast();
  const compact = size === "sm";
  const visibleLabel = label.trim();
  const useActivityGate = Boolean(entryKey?.trim());
  const trimmedEntryKey = entryKey?.trim() ?? "";

  const [menuOpen, setMenuOpen] = useState(false);
  const [step, setStep] = useState<AskActivityStep>("activity");
  const [activityOpen, setActivityOpen] = useState(false);

  const needsCountFetch = useActivityGate && writeCountProp === undefined;
  const countQuery = useQuery({
    queryKey: ["/api/admin/entry-activity-count", trimmedEntryKey, windowDays],
    enabled: menuOpen && needsCountFetch && Boolean(trimmedEntryKey),
    queryFn: async () => {
      const params = new URLSearchParams({ entry: trimmedEntryKey });
      const res = await apiFetch(`/api/admin/entry-activity-count?${params}`);
      if (!res.ok) throw new Error("Failed to load write count");
      return (await res.json()) as { writeCount: number; windowDays: number };
    },
  });

  const writeCount =
    writeCountProp !== undefined
      ? writeCountProp
      : countQuery.data?.writeCount ?? 0;

  function handleMenuOpenChange(next: boolean) {
    setMenuOpen(next);
    if (!next) {
      setStep("activity");
    }
  }

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

  function openCheckActivity() {
    setMenuOpen(false);
    setActivityOpen(true);
  }

  const agentItems = (
    <>
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
    </>
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
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
          className={cn("z-[10001]", useActivityGate ? "w-72 p-0" : "w-48")}
          data-testid={`menu-${testId}`}
          data-step={useActivityGate ? step : "agents"}
        >
          {useActivityGate && step === "activity" ? (
            <div className="p-3 space-y-3" data-testid={`menu-${testId}-activity-step`}>
              {needsCountFetch && countQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading…
                </div>
              ) : needsCountFetch && countQuery.isError ? (
                <p className="text-xs text-muted-foreground leading-snug">
                  Could not load write count. You can still check activity, then ask an agent.
                </p>
              ) : (
                <AskActivityGateCopy
                  writeCount={writeCount}
                  windowDays={windowDays}
                  testId={`menu-${testId}-activity-copy`}
                />
              )}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid={`menu-${testId}-check-activity`}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    openCheckActivity();
                  }}
                >
                  Check activity
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  data-testid={`menu-${testId}-continue`}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    setStep("agents");
                  }}
                >
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                  Ask Agent to Help
                </Button>
              </div>
            </div>
          ) : (
            agentItems
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {useActivityGate ? (
        <EntryActivityDialog
          entryKey={trimmedEntryKey}
          open={activityOpen}
          onOpenChange={setActivityOpen}
          testIdPrefix={`${testId}-activity`}
          windowDays={windowDays}
        />
      ) : null}
    </>
  );
}
