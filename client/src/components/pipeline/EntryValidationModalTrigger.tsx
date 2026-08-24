import { useCallback, useRef, useState, type MouseEvent } from "react";
import { IconClipboardList } from "@tabler/icons-react";
import { PageErrorsModal } from "@/components/DebugBubble/components/PageErrorsModal";
import type { PageDiagnostics } from "@/components/DebugBubble/types";
import { McpRequiredForAiModal } from "@/components/mcp/McpRequiredForAiModal";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import type { SolveWithAiAgentId } from "@/components/DebugBubble/solveWithAiPrompt";
import { useContentTypes } from "@/hooks/useContentTypes";
import { entryKeyToPageUrl } from "@/lib/entryKeyToPageUrl";
import { fetchPageDiagnostics } from "@/lib/fetchPageDiagnostics";
import { parseEntryKey } from "@/lib/parseEntryKey";
import { cn } from "@/lib/utils";

type EntryValidationModalTriggerProps = {
  entryKey: string;
  /** When the pipeline event already carries a canonical URL, prefer it over pattern resolution. */
  pageUrl?: string;
  label?: string;
  className?: string;
};

export function EntryValidationModalTrigger({
  entryKey,
  pageUrl,
  label = "View validation issues",
  className,
}: EntryValidationModalTriggerProps) {
  const contentTypes = useContentTypes();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageDiagnostics, setPageDiagnostics] = useState<PageDiagnostics | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  const [mcpRequiredForAiOpen, setMcpRequiredForAiOpen] = useState(false);
  const [mcpRequiredSetupTab, setMcpRequiredSetupTab] = useState<McpSetupTabId>("cursor");
  const [mcpRequiredAgentId, setMcpRequiredAgentId] = useState<SolveWithAiAgentId>("copy-prompt");
  const [mcpRequiredAgentLabel, setMcpRequiredAgentLabel] = useState("AI Agent");
  const [mcpRequiredPrompt, setMcpRequiredPrompt] = useState("");
  const [mcpRequiredPrefillPrefix, setMcpRequiredPrefillPrefix] = useState<string | undefined>();

  const resolveUrl = useCallback(() => {
    if (pageUrl) return pageUrl;
    return entryKeyToPageUrl(entryKey, contentTypes);
  }, [contentTypes, entryKey, pageUrl]);

  const loadDiagnostics = useCallback(async () => {
    const url = resolveUrl();
    if (!url) {
      setError("Could not resolve a page URL for this entry.");
      setPageDiagnostics(null);
      return;
    }

    lastUrlRef.current = url;
    const variant = parseEntryKey(entryKey)?.variant ?? null;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPageDiagnostics(url, variant);
      setPageDiagnostics(data);
    } catch (err) {
      setPageDiagnostics(null);
      setError(err instanceof Error ? err.message : "Failed to load validation issues");
    } finally {
      setLoading(false);
    }
  }, [entryKey, resolveUrl]);

  const handleOpen = async (event: MouseEvent) => {
    event.preventDefault();
    setOpen(true);
    await loadDiagnostics();
  };

  const handleRefresh = async () => {
    await loadDiagnostics();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-primary hover:underline",
          className,
        )}
      >
        {label}
        <IconClipboardList className="h-3 w-3" />
      </button>
      <PageErrorsModal
        open={open}
        onOpenChange={setOpen}
        pageDiagnostics={pageDiagnostics}
        pageUrl={pageDiagnostics?.url ?? lastUrlRef.current ?? undefined}
        loading={loading}
        error={error}
        onRefreshDiagnostics={handleRefresh}
        onSolveWithAi={({ agentId, setupTab, label: agentLabel, prompt, prefillUrlPrefix }) => {
          setOpen(false);
          setMcpRequiredAgentId(agentId);
          setMcpRequiredSetupTab(setupTab);
          setMcpRequiredAgentLabel(agentLabel);
          setMcpRequiredPrompt(prompt);
          setMcpRequiredPrefillPrefix(prefillUrlPrefix);
          setMcpRequiredForAiOpen(true);
        }}
      />
      <McpRequiredForAiModal
        open={mcpRequiredForAiOpen}
        onOpenChange={setMcpRequiredForAiOpen}
        defaultTab={mcpRequiredSetupTab}
        agentId={mcpRequiredAgentId}
        agentLabel={mcpRequiredAgentLabel}
        prompt={mcpRequiredPrompt}
        prefillUrlPrefix={mcpRequiredPrefillPrefix}
      />
    </>
  );
}
