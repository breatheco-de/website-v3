import { useMemo, useState } from "react";
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
import { useDebugAuth } from "@/hooks/useDebugAuth";

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
}

export function McpRequiredForAiModal({
  open,
  onOpenChange,
  defaultTab = "cursor",
  agentId = "copy-prompt",
  agentLabel = "AI Agent",
  prompt = "",
  prefillUrlPrefix,
}: McpRequiredForAiModalProps) {
  const { toast } = useToast();
  const { roles: myRoleIds } = useDebugAuth();
  /** Default All roles for Solve-with-AI; optional focused connector. */
  const [setupRoleId, setSetupRoleId] = useState<string | null>(null);

  const { data } = useQuery<{
    roles?: { id: string; label: string; description?: string; allowedTools: string[] }[];
  }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
    enabled: open,
  });

  const mySetupRoles = useMemo(
    () => (data?.roles ?? []).filter((r) => myRoleIds.includes(r.id)),
    [data?.roles, myRoleIds],
  );

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
            {mySetupRoles.length > 0 && (
              <McpSetupRoleTabs
                value={setupRoleId}
                onValueChange={setSetupRoleId}
                roles={mySetupRoles}
                listTestId="tabs-mcp-required-setup-role"
              />
            )}
          </div>
          {open ? (
            <McpAgentSetupTabs
              key={`${defaultTab}-${setupRoleId ?? "all"}`}
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
