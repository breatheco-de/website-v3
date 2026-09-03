import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { McpAgentSetupTabs } from "@/components/mcp/McpAgentSetupTabs";
import { McpSetupRoleTabs } from "@/components/mcp/McpSetupRoleTabs";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import {
  buildSolveWithAiPrefillUrl,
  type SolveWithAiAgentId,
} from "@/components/DebugBubble/solveWithAiPrompt";
import { SolveWithAiAgentIcon } from "@/components/DebugBubble/SolveWithAiAgentIcon";
import { IconPlug } from "@tabler/icons-react";
import { useToast } from "@/hooks/use-toast";
import {
  AGENTIC_SWARM_ROLE_IDS,
  AGENTIC_SWARM_ROLES_BY_ID,
  type AgenticSwarmRoleId,
} from "@shared/agentic-swarm-roles";

const DEFAULT_AGENT_ROLE_ID: AgenticSwarmRoleId = "swarm_orchestrator";

export interface McpRequiredForAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Setup tab to show first (remounts tabs when this changes while open). */
  defaultTab?: McpSetupTabId;
  /** Agent used for the confirm button icon (matches Solve with AI menu). */
  agentId?: SolveWithAiAgentId;
  /** Agent display name for the confirm button (e.g. Claude.ai). */
  agentLabel?: string;
  /** Fix prompt already copied; used when confirming opens a prefilled chat. */
  prompt?: string;
  /** Prefill URL prefix ending with `q=`; omit for copy-prompt-only flow. */
  prefillUrlPrefix?: string;
  /**
   * Agentic swarm role for the connector URL (`/mcp/role/:id`).
   * Defaults to Swarm Orchestrator; organic SEO flows pass `seo_specialist`.
   */
  defaultRoleId?: AgenticSwarmRoleId;
}

function resolveAgentRoleId(roleId: string | undefined): AgenticSwarmRoleId {
  if (roleId && (AGENTIC_SWARM_ROLE_IDS as readonly string[]).includes(roleId)) {
    return roleId as AgenticSwarmRoleId;
  }
  return DEFAULT_AGENT_ROLE_ID;
}

export function McpRequiredForAiModal({
  open,
  onOpenChange,
  defaultTab = "cursor",
  agentId = "copy-prompt",
  agentLabel = "AI Agent",
  prompt = "",
  prefillUrlPrefix,
  defaultRoleId = DEFAULT_AGENT_ROLE_ID,
}: McpRequiredForAiModalProps) {
  const { toast } = useToast();
  const [setupRoleId, setSetupRoleId] = useState<string>(
    () => resolveAgentRoleId(defaultRoleId),
  );

  useEffect(() => {
    if (!open) return;
    setSetupRoleId(resolveAgentRoleId(defaultRoleId));
  }, [open, defaultRoleId]);

  /** Prefer live labels from the store when available; fall back to code pack. */
  const { data } = useQuery<{
    roles?: { id: string; label: string; description?: string; allowedTools: string[] }[];
  }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
    enabled: open,
  });

  const agentSetupRoles = useMemo(() => {
    const byId = new Map((data?.roles ?? []).map((r) => [r.id, r]));
    return AGENTIC_SWARM_ROLE_IDS.map((id) => {
      const live = byId.get(id);
      return {
        id,
        label: live?.label || AGENTIC_SWARM_ROLES_BY_ID[id].label,
      };
    });
  }, [data?.roles]);

  const confirmLabel = prefillUrlPrefix
    ? `Fix with ${agentLabel}`
    : "Copy prompt & close";

  async function handleConfirm() {
    if (prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        /* already copied earlier; ignore */
      }
    }

    if (prefillUrlPrefix && prompt) {
      window.open(
        buildSolveWithAiPrefillUrl(prefillUrlPrefix, prompt),
        "_blank",
        "noopener,noreferrer",
      );
      toast({
        title: `Opening ${agentLabel}`,
        description: "Prompt is on your clipboard — paste if the chat did not prefill.",
      });
    } else {
      toast({
        title: "Prompt on clipboard",
        description: "Paste it into your MCP-connected agent when ready.",
      });
    }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-mcp-required-for-ai"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPlug className="h-5 w-5 text-foreground" />
            MCP server required
          </DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              The fix prompt is on your clipboard. Connect this site&apos;s MCP server in your AI agent
              before continuing — otherwise it cannot read or update content.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-foreground">
              Setup for {agentLabel}
            </p>
            <McpSetupRoleTabs
              value={setupRoleId}
              onValueChange={(id) => {
                if (id) setSetupRoleId(id);
              }}
              roles={agentSetupRoles}
              includeAllOption={false}
              placeholder="Select an agent role"
              listTestId="tabs-mcp-required-setup-role"
            />
          </div>
          {open ? (
            <McpAgentSetupTabs
              key={`${defaultTab}-${setupRoleId}`}
              onlyTab={defaultTab}
              roleId={setupRoleId}
            />
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-mcp-required-for-ai"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => void handleConfirm()}
            data-testid="button-confirm-fix-with-ai"
          >
            <SolveWithAiAgentIcon
              agentId={agentId}
              className="text-primary-foreground"
            />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
