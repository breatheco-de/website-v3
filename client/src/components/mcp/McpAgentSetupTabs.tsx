import { useMemo, type ReactNode } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useMcpCloudConnectors } from "@/components/mcp/McpAgentConnectCard";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import {
  McpConnectorUrlList,
  McpExpandableConfig,
  McpSetupSteps,
} from "@/components/mcp/McpSetupUi";
import {
  buildClaudeCodeCli,
  buildClaudeCodeCliForRoles,
  buildClaudeDesktopConfig,
  buildClaudeDesktopConfigForRoles,
  buildHttpMcpConfig,
  buildHttpMcpConfigForRoles,
  getMcpServerUrl,
  isLocalOrigin,
  type McpRoleConnector,
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
  /**
   * Role connectors to configure. Prefer `roleIds` (+ optional labels).
   * Legacy single `roleId` still works.
   */
  roleIds?: string[];
  /** Optional labels keyed by role id (falls back to the id). */
  roleLabels?: Record<string, string>;
  /** @deprecated Prefer `roleIds`. Single CMS role id for `/mcp/role/:id`. */
  roleId?: string | null;
  className?: string;
}

type SetupSnippets = {
  connectors: McpRoleConnector[];
  cloudConnectors: { roleId: string; label: string; url: string | null }[];
  httpMcpConfig: string;
  claudeDesktopConfig: string;
  claudeCodeCli: string;
  localDev: boolean;
  multi: boolean;
};

function normalizeRoleIds(
  roleIds: string[] | undefined,
  roleId: string | null | undefined,
): string[] {
  if (roleIds && roleIds.length > 0) return roleIds;
  if (roleId) return [roleId];
  return [];
}

function CursorSetup({ connectors, httpMcpConfig, multi }: SetupSnippets) {
  const rows = connectors.map((c) => ({
    roleId: c.roleId,
    label: c.label,
    url: c.url,
    configSnippet: buildHttpMcpConfig(c.url, c.roleId),
  }));

  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Open <span className="text-foreground font-medium">Cursor Settings → MCP</span> (or edit{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.cursor/mcp.json</code>).
        </li>
        <li>
          {multi
            ? "Add a server entry for each connection URL below (OAuth handles login):"
            : "Add this server entry (URL only — OAuth handles login):"}
        </li>
      </McpSetupSteps>
      <McpConnectorUrlList connectors={rows} testId="list-mcp-urls-cursor" />
      <McpExpandableConfig
        code={httpMcpConfig}
        label={multi ? "Show full config JSON (all roles)" : "Show config JSON"}
        hideLabel="Hide config JSON"
        testId="text-mcp-config-cursor"
      />
      <p className="text-xs text-muted-foreground">
        Cursor should open the OAuth consent page on first connect. Approve access, then reload MCP if tools do not
        appear. For local use, keep{" "}
        <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">tsx mcp-server/index.ts</code> running.
      </p>
    </div>
  );
}

function GenericSetup({ connectors, httpMcpConfig, multi }: SetupSnippets) {
  const rows = connectors.map((c) => ({
    roleId: c.roleId,
    label: c.label,
    url: c.url,
    configSnippet: buildHttpMcpConfig(c.url, c.roleId),
  }));

  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          Open your AI app&apos;s <span className="text-foreground font-medium">MCP / connectors</span>{" "}
          settings (wording varies by product).
        </li>
        <li>
          {multi
            ? "Add a custom HTTP MCP server for each of the following connection URLs (OAuth handles login):"
            : "Add a custom HTTP MCP server with this URL (OAuth handles login):"}
        </li>
      </McpSetupSteps>
      <McpConnectorUrlList connectors={rows} testId="list-mcp-urls-generic" />
      <McpExpandableConfig
        code={httpMcpConfig}
        label={multi ? "Show full config JSON (all roles)" : "Show config JSON"}
        hideLabel="Hide config JSON"
        testId="text-mcp-config-generic"
      />
      <p className="text-xs text-muted-foreground">
        Complete the OAuth consent page when prompted, then reload tools if they do not appear. Use a named agent
        above when your app has a dedicated guide.
      </p>
    </div>
  );
}

function ClaudeCodeSetup({ connectors, claudeCodeCli, httpMcpConfig, multi }: SetupSnippets) {
  const rows = connectors.map((c) => ({
    roleId: c.roleId,
    label: c.label,
    url: c.url,
    configSnippet: buildClaudeCodeCli(c.url, c.roleId),
  }));

  return (
    <div className="space-y-4">
      <McpSetupSteps>
        <li>
          {multi
            ? "In a terminal with the Claude Code CLI installed, add each HTTP MCP server:"
            : "In a terminal with the Claude Code CLI installed, add the HTTP MCP server:"}
        </li>
      </McpSetupSteps>
      <McpConnectorUrlList
        connectors={rows}
        expandLabel="Show CLI"
        collapseLabel="Hide CLI"
        testId="list-mcp-urls-claude-code"
      />
      <McpExpandableConfig
        code={claudeCodeCli}
        label={multi ? "Show all CLI commands" : "Show CLI command"}
        hideLabel="Hide CLI"
        testId="text-mcp-config-claude-code"
      />
      <p className="text-xs text-muted-foreground">
        Complete the OAuth browser flow when prompted. Or place this JSON under your Claude Code MCP config / project{" "}
        <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">.mcp.json</code>, then restart the
        session.
      </p>
      <McpExpandableConfig
        code={httpMcpConfig}
        label={multi ? "Show full config JSON (all roles)" : "Show config JSON"}
        hideLabel="Hide config JSON"
        testId="text-mcp-config-claude-code-json"
      />
    </div>
  );
}

function ClaudeDesktopSetup({ connectors, claudeDesktopConfig, multi }: SetupSnippets) {
  const rows = connectors.map((c) => ({
    roleId: c.roleId,
    label: c.label,
    url: c.url,
    configSnippet: buildClaudeDesktopConfig(c.url, c.roleId),
  }));

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
        <li>
          {multi
            ? "Merge a server entry for each connection URL below, then fully quit and reopen Claude Desktop:"
            : "Merge this config, then fully quit and reopen Claude Desktop:"}
        </li>
      </McpSetupSteps>
      <McpConnectorUrlList connectors={rows} testId="list-mcp-urls-claude-desktop" />
      <McpExpandableConfig
        code={claudeDesktopConfig}
        label={multi ? "Show full config JSON (all roles)" : "Show config JSON"}
        hideLabel="Hide config JSON"
        testId="text-mcp-config-claude-desktop"
      />
      <p className="text-xs text-muted-foreground">
        Claude Desktop will use OAuth against this server — no API key in the JSON. Approve the consent page when it
        opens.
      </p>
    </div>
  );
}

function CloudMultiConnectorSetup({
  product,
  cloudConnectors,
  localDev,
  stepsBefore,
  stepsAfter,
  copyTestPrefix,
}: {
  product: string;
  cloudConnectors: SetupSnippets["cloudConnectors"];
  localDev: boolean;
  stepsBefore: ReactNode;
  stepsAfter?: ReactNode;
  copyTestPrefix: string;
}) {
  const multi = cloudConnectors.length > 1;
  const anyUrl = cloudConnectors.some((c) => c.url);

  return (
    <div className="space-y-4">
      <McpSetupSteps>
        {stepsBefore}
        <li>
          {multi
            ? "Add a custom connector (HTTP MCP server) for each of the following connection URLs:"
            : "Paste this connector URL (no token — OAuth registers the client):"}
        </li>
      </McpSetupSteps>
      <McpConnectorUrlList
        connectors={cloudConnectors}
        testId={`list-mcp-urls-${copyTestPrefix}`}
      />
      {!anyUrl && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Set <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">SITE_URL</code> in your environment so
          cloud agents can reach this MCP server.
        </p>
      )}
      {anyUrl && localDev && (
        <p className="text-xs text-muted-foreground">
          Using your configured site URL for the connector ({product} cannot use localhost).
        </p>
      )}
      {stepsAfter ? <McpSetupSteps>{stepsAfter}</McpSetupSteps> : null}
    </div>
  );
}

function ClaudeAiSetup({ cloudConnectors, localDev }: SetupSnippets) {
  return (
    <CloudMultiConnectorSetup
      product="Claude.ai"
      cloudConnectors={cloudConnectors}
      localDev={localDev}
      copyTestPrefix="claude-ai"
      stepsBefore={
        <>
          <li>
            Claude.ai needs a <span className="text-foreground font-medium">public</span> URL (not localhost). Deploy the
            site and set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">SITE_URL</code> /{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PUBLIC_URL</code> to that origin.
          </li>
          <li>
            Go to <span className="text-foreground font-medium">Claude.ai → Customize → Connectors</span> and choose{" "}
            <span className="text-foreground font-medium">Add custom connector</span>.
          </li>
        </>
      }
      stepsAfter={
        <>
          <li>Approve access on the consent page when prompted.</li>
          <li>
            Use each connector from the <span className="text-foreground font-medium">+</span> button in a chat.
          </li>
        </>
      }
    />
  );
}

function ChatGptSetup({ cloudConnectors, localDev }: SetupSnippets) {
  return (
    <CloudMultiConnectorSetup
      product="ChatGPT"
      cloudConnectors={cloudConnectors}
      localDev={localDev}
      copyTestPrefix="chatgpt"
      stepsBefore={
        <>
          <li>
            ChatGPT needs a <span className="text-foreground font-medium">public</span> MCP endpoint (same as Claude.ai).
            Deploy the site first if you are on localhost.
          </li>
          <li>
            In ChatGPT, turn on <span className="text-foreground font-medium">Developer mode</span> under{" "}
            <span className="text-foreground font-medium">Settings → Security and login</span> (workspace plans may need
            an admin to allow it).
          </li>
          <li>
            Open the{" "}
            <a
              href="https://chatgpt.com/plugins"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground font-medium underline underline-offset-2"
            >
              Plugins
            </a>{" "}
            page, click <span className="text-foreground font-medium">+</span>, then{" "}
            <span className="text-foreground font-medium">Add custom MCP server</span>.
          </li>
        </>
      }
      stepsAfter={
        <li>
          Availability depends on your ChatGPT plan and whether remote MCP connectors are enabled for your workspace.
          Complete OAuth when ChatGPT prompts you for each connector.
        </li>
      }
    />
  );
}

function GrokSetup({ cloudConnectors, localDev }: SetupSnippets) {
  return (
    <CloudMultiConnectorSetup
      product="Grok"
      cloudConnectors={cloudConnectors}
      localDev={localDev}
      copyTestPrefix="grok"
      stepsBefore={
        <>
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
            <span className="text-foreground font-medium">Custom</span> — once per URL below.
          </li>
        </>
      }
      stepsAfter={
        <>
          <li>Complete OAuth when Grok prompts you.</li>
          <li>Grok will discover the tools and make them available in the next chat.</li>
        </>
      }
    />
  );
}

function PerplexitySetup({ cloudConnectors, localDev }: SetupSnippets) {
  return (
    <CloudMultiConnectorSetup
      product="Perplexity"
      cloudConnectors={cloudConnectors}
      localDev={localDev}
      copyTestPrefix="perplexity"
      stepsBefore={
        <>
          <li>
            Perplexity needs a <span className="text-foreground font-medium">public</span> MCP endpoint (same as Claude.ai
            / ChatGPT). Deploy the site first if you are on localhost.
          </li>
          <li>
            In Perplexity, open connectors / custom MCP settings (wording varies by plan).
          </li>
        </>
      }
      stepsAfter={
        <li>
          Complete OAuth when prompted for each connector. If your Perplexity plan does not support remote MCP yet, use
          Cursor or Claude Code with the same server URLs instead.
        </li>
      }
    />
  );
}

function CopilotSetup({ cloudConnectors, localDev }: SetupSnippets) {
  return (
    <CloudMultiConnectorSetup
      product="Copilot"
      cloudConnectors={cloudConnectors}
      localDev={localDev}
      copyTestPrefix="copilot"
      stepsBefore={
        <>
          <li>
            Microsoft Copilot needs a <span className="text-foreground font-medium">public</span> MCP endpoint when
            connecting from the cloud. Deploy the site first if you are on localhost.
          </li>
          <li>
            In Copilot (or Copilot Studio / developer connectors, depending on your plan), add a custom MCP connector for
            each URL below.
          </li>
        </>
      }
      stepsAfter={
        <li>
          Complete OAuth when prompted. Availability depends on your Microsoft plan and whether remote MCP connectors are
          enabled.
        </li>
      }
    />
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
  generic: GenericSetup,
};

/** Shared agent picker labels (wizard agent phase + tab bar). */
export const MCP_AGENT_SETUP_LABELS: { id: McpSetupTabId; label: string }[] = [
  { id: "cursor", label: "Cursor" },
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "claude-ai", label: "Claude.ai" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "grok", label: "Grok" },
  { id: "perplexity", label: "Perplexity" },
  { id: "copilot", label: "Copilot" },
  { id: "generic", label: "Generic MCP" },
];

export function McpAgentSetupTabs({
  defaultTab = "cursor",
  value,
  onValueChange,
  onlyTab,
  roleIds: roleIdsProp,
  roleLabels,
  roleId = null,
  className,
}: McpAgentSetupTabsProps) {
  const roleIds = normalizeRoleIds(roleIdsProp, roleId);
  const localDev = isLocalOrigin(window.location.origin);

  const connectors: McpRoleConnector[] = useMemo(
    () =>
      roleIds.map((id) => ({
        roleId: id,
        label: roleLabels?.[id] ?? id,
        url: getMcpServerUrl(id),
      })),
    [roleIds, roleLabels],
  );

  const httpMcpConfig = buildHttpMcpConfigForRoles(connectors);
  const claudeDesktopConfig = buildClaudeDesktopConfigForRoles(connectors);
  const claudeCodeCli = buildClaudeCodeCliForRoles(connectors);

  const cloudConnectors = useMcpCloudConnectors(roleIds, roleLabels);

  const snippets: SetupSnippets = {
    connectors,
    cloudConnectors,
    httpMcpConfig,
    claudeDesktopConfig,
    claudeCodeCli,
    localDev,
    multi: connectors.length > 1,
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
      <ToggleButtonBarList className="w-full" data-testid="tabs-mcp-agent-setup-list">
        {MCP_AGENT_SETUP_LABELS.map(({ id, label }) => (
          <ToggleButtonBarTrigger key={id} value={id} data-testid={`tab-setup-${id}`}>
            {label}
          </ToggleButtonBarTrigger>
        ))}
      </ToggleButtonBarList>

      {MCP_AGENT_SETUP_LABELS.map(({ id }) => {
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
