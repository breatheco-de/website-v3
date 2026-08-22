import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { McpCodeBlock, McpCopyButton, McpSetupSteps } from "@/components/mcp/McpSetupUi";
import {
  buildClaudeCodeCli,
  buildClaudeDesktopConfig,
  buildHttpMcpConfig,
  getMcpServerUrl,
  getPublicConnectorUrl,
  isLocalOrigin,
  resolveCloudConnectorUrl,
  type McpSetupTabId,
} from "@/components/mcp/mcpUrlHelpers";

export interface McpAgentSetupTabsProps {
  /** Initial tab when the control mounts. */
  defaultTab?: McpSetupTabId;
  /** Controlled tab value (optional). */
  value?: McpSetupTabId;
  onValueChange?: (tab: McpSetupTabId) => void;
  /**
   * When set, hide the agent tab list and show only this agent's setup steps.
   * Use after the user already chose an agent (e.g. Solve with AI → MCP required).
   */
  onlyTab?: McpSetupTabId;
  className?: string;
}

type SetupSnippets = {
  httpMcpConfig: string;
  claudeDesktopConfig: string;
  claudeCodeCli: string;
  cloudConnectorUrl: string | null;
  localDev: boolean;
};

function CursorSetup({ httpMcpConfig }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Open <span className="text-foreground font-medium">Cursor Settings → MCP</span> (or edit{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.cursor/mcp.json</code>).
        </li>
        <li>Add this server entry (URL only — OAuth handles login):</li>
      </McpSetupSteps>
      <McpCodeBlock code={httpMcpConfig} testId="text-mcp-config-cursor" />
      <p className="text-xs text-muted-foreground">
        Cursor should open the OAuth consent page on first connect. Approve access, then reload MCP if tools do not
        appear. For local use, keep{" "}
        <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">tsx mcp-server/index.ts</code> running
        (Replit: start the <span className="text-foreground font-medium">MCP Server</span> workflow).
      </p>
    </div>
  );
}

function ClaudeCodeSetup({ claudeCodeCli, httpMcpConfig }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>In a terminal with the Claude Code CLI installed, add the HTTP MCP server:</li>
      </McpSetupSteps>
      <McpCodeBlock code={claudeCodeCli} testId="text-mcp-config-claude-code" />
      <p className="text-xs text-muted-foreground">
        Complete the OAuth browser flow when prompted. Or place this JSON under your Claude Code MCP config / project{" "}
        <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">.mcp.json</code>, then restart the
        session.
      </p>
      <McpCodeBlock code={httpMcpConfig} testId="text-mcp-config-claude-code-json" />
    </div>
  );
}

function ClaudeDesktopSetup({ claudeDesktopConfig }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Edit{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          (macOS) or the Windows equivalent under{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">%APPDATA%\Claude\</code>.
        </li>
        <li>Merge this config, then fully quit and reopen Claude Desktop:</li>
      </McpSetupSteps>
      <McpCodeBlock code={claudeDesktopConfig} testId="text-mcp-config-claude-desktop" />
      <p className="text-xs text-muted-foreground">
        Claude Desktop will use OAuth against this server — no API key in the JSON. Approve the consent page when it
        opens.
      </p>
    </div>
  );
}

function ClaudeAiSetup({ cloudConnectorUrl, localDev }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Claude.ai needs a <span className="text-foreground font-medium">public</span> URL (not localhost). Deploy the
          site and set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">SITE_URL</code> /{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PUBLIC_URL</code> to that origin.
        </li>
        <li>
          Go to <span className="text-foreground font-medium">Claude.ai → Settings → Connectors</span> and click{" "}
          <span className="text-foreground font-medium">+</span>.
        </li>
        <li>Paste this connector URL (no token — OAuth registers the client):</li>
      </McpSetupSteps>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
          {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
        </code>
        {cloudConnectorUrl && <McpCopyButton text={cloudConnectorUrl} testId="button-copy-claude-ai-url" />}
      </div>
      {!cloudConnectorUrl && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Set <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">SITE_URL</code> in your environment so
          cloud agents can reach this MCP server.
        </p>
      )}
      {cloudConnectorUrl && localDev && (
        <p className="text-xs text-muted-foreground">
          Using your configured site URL for the connector (Claude.ai cannot use localhost).
        </p>
      )}
      <McpSetupSteps>
        <li>Approve access on the consent page when prompted.</li>
        <li>
          Use the connector from the <span className="text-foreground font-medium">+</span> button in a chat.
        </li>
      </McpSetupSteps>
    </div>
  );
}

function ChatGptSetup({ cloudConnectorUrl }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          ChatGPT needs a <span className="text-foreground font-medium">public</span> MCP endpoint (same as Claude.ai).
          Deploy the site first if you are on localhost.
        </li>
        <li>
          In ChatGPT, open <span className="text-foreground font-medium">Settings → Connectors</span> (or Apps /
          Developer mode, depending on your plan) and add a custom MCP / connector.
        </li>
        <li>Use this server URL and complete OAuth when ChatGPT prompts you:</li>
      </McpSetupSteps>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
          {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
        </code>
        {cloudConnectorUrl && <McpCopyButton text={cloudConnectorUrl} testId="button-copy-chatgpt-url" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Availability depends on your ChatGPT plan and whether remote MCP connectors are enabled for your workspace.
      </p>
    </div>
  );
}

function GrokSetup({ cloudConnectorUrl, localDev }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Grok needs a <span className="text-foreground font-medium">public</span> URL (not localhost). Deploy the site
          and set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">SITE_URL</code> /{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PUBLIC_URL</code> to that origin.
        </li>
        <li>
          Go to{" "}
          <a
            href="https://grok.com/connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground font-medium underline underline-offset-2"
          >
            grok.com/connectors
          </a>
          .
        </li>
        <li>
          Click <span className="text-foreground font-medium">New Connector</span>, then select{" "}
          <span className="text-foreground font-medium">Custom</span>.
        </li>
        <li>Paste this MCP server URL (no token — OAuth registers the client):</li>
      </McpSetupSteps>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
          {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
        </code>
        {cloudConnectorUrl && <McpCopyButton text={cloudConnectorUrl} testId="button-copy-grok-url" />}
      </div>
      {!cloudConnectorUrl && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Set <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">SITE_URL</code> in your environment so
          cloud agents can reach this MCP server.
        </p>
      )}
      {cloudConnectorUrl && localDev && (
        <p className="text-xs text-muted-foreground">
          Using your configured site URL for the connector (Grok cannot use localhost).
        </p>
      )}
      <McpSetupSteps>
        <li>Complete OAuth when Grok prompts you.</li>
        <li>Grok will discover the tools and make them available in the next chat.</li>
      </McpSetupSteps>
    </div>
  );
}

function PerplexitySetup({ cloudConnectorUrl }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Perplexity needs a <span className="text-foreground font-medium">public</span> MCP endpoint (same as Claude.ai
          / ChatGPT). Deploy the site first if you are on localhost.
        </li>
        <li>
          In Perplexity, open connectors / custom MCP settings (wording varies by plan) and add this server URL:
        </li>
      </McpSetupSteps>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
          {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
        </code>
        {cloudConnectorUrl && <McpCopyButton text={cloudConnectorUrl} testId="button-copy-perplexity-url" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Complete OAuth when prompted. If your Perplexity plan does not support remote MCP yet, use Cursor or Claude Code
        with the same server URL instead.
      </p>
    </div>
  );
}

function CopilotSetup({ cloudConnectorUrl }: SetupSnippets) {
  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Microsoft Copilot needs a <span className="text-foreground font-medium">public</span> MCP endpoint when
          connecting from the cloud. Deploy the site first if you are on localhost.
        </li>
        <li>
          In Copilot (or Copilot Studio / developer connectors, depending on your plan), add a custom MCP connector and
          paste this URL:
        </li>
      </McpSetupSteps>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
          {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
        </code>
        {cloudConnectorUrl && <McpCopyButton text={cloudConnectorUrl} testId="button-copy-copilot-url" />}
      </div>
      {!cloudConnectorUrl && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Set <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">SITE_URL</code> so cloud agents can
          reach this MCP server.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Complete OAuth when prompted. Availability depends on your Microsoft plan and whether remote MCP connectors are
        enabled.
      </p>
    </div>
  );
}

const SETUP_BY_TAB: Record<McpSetupTabId, (snippets: SetupSnippets) => ReactNode> = {
  cursor: CursorSetup,
  "claude-code": ClaudeCodeSetup,
  "claude-desktop": ClaudeDesktopSetup,
  "claude-ai": ClaudeAiSetup,
  chatgpt: ChatGptSetup,
  grok: GrokSetup,
  perplexity: PerplexitySetup,
  copilot: CopilotSetup,
};

const TAB_LABELS: { id: McpSetupTabId; label: string }[] = [
  { id: "cursor", label: "Cursor" },
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "claude-ai", label: "Claude.ai" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "grok", label: "Grok" },
  { id: "perplexity", label: "Perplexity" },
  { id: "copilot", label: "Copilot" },
];

export function McpAgentSetupTabs({
  defaultTab = "cursor",
  value,
  onValueChange,
  onlyTab,
  className,
}: McpAgentSetupTabsProps) {
  const mcpUrl = getMcpServerUrl();
  const publicUrl = getPublicConnectorUrl();
  const localDev = isLocalOrigin(window.location.origin);
  const httpMcpConfig = buildHttpMcpConfig(mcpUrl);
  const claudeDesktopConfig = buildClaudeDesktopConfig(mcpUrl);
  const claudeCodeCli = buildClaudeCodeCli(mcpUrl);

  const { data } = useQuery<{ siteUrl?: string | null }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
  });

  const { data: siteInfo } = useQuery<{ domain?: string }>({
    queryKey: ["/api/site/info"],
    staleTime: 60_000,
  });

  const cloudConnectorUrl = useMemo(
    () =>
      resolveCloudConnectorUrl({
        siteUrl: data?.siteUrl,
        siteDomain: siteInfo?.domain,
        localDev,
        publicUrl,
      }),
    [data?.siteUrl, siteInfo?.domain, localDev, publicUrl],
  );

  const snippets: SetupSnippets = {
    httpMcpConfig,
    claudeDesktopConfig,
    claudeCodeCli,
    cloudConnectorUrl,
    localDev,
  };

  if (onlyTab) {
    const Panel = SETUP_BY_TAB[onlyTab];
    return (
      <div data-testid="tabs-mcp-agent-setup" className={className} data-only-tab={onlyTab}>
        <Panel {...snippets} />
      </div>
    );
  }

  return (
    <Tabs
      {...(value != null
        ? { value, onValueChange: onValueChange ? (v: string) => onValueChange(v as McpSetupTabId) : undefined }
        : {
            defaultValue: defaultTab,
            onValueChange: onValueChange ? (v: string) => onValueChange(v as McpSetupTabId) : undefined,
          })}
      data-testid="tabs-mcp-agent-setup"
      className={className}
    >
      <TabsList className="h-auto flex-wrap justify-start gap-1 w-full">
        {TAB_LABELS.map(({ id, label }) => (
          <TabsTrigger key={id} value={id} data-testid={`tab-setup-${id}`}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      {TAB_LABELS.map(({ id }) => {
        const Panel = SETUP_BY_TAB[id];
        return (
          <TabsContent key={id} value={id} className="mt-4">
            <Panel {...snippets} />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
