export function isLocalOrigin(origin: string): boolean {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
}

/** Direct MCP process URL (port 3001 on local; same origin elsewhere via proxy). */
export function getMcpServerUrl(): string {
  const origin = window.location.origin;
  if (isLocalOrigin(origin)) {
    return `${origin.replace(/:\d+$/, ":3001")}/mcp`;
  }
  return `${origin}/mcp`;
}

/** Prefer main-app proxied URL for cloud agents (works when MCP is behind the site). */
export function getPublicConnectorUrl(): string {
  return `${window.location.origin}/mcp`;
}

export function buildHttpMcpConfig(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "4geeks-cms": {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeDesktopConfig(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "4geeks-cms": {
          type: "http",
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeCodeCli(mcpUrl: string): string {
  return `claude mcp add --transport http 4geeks-cms ${mcpUrl}`;
}

export type McpSetupTabId =
  | "cursor"
  | "claude-code"
  | "claude-desktop"
  | "claude-ai"
  | "chatgpt"
  | "grok"
  | "perplexity"
  | "copilot";

export const MCP_SETUP_TAB_IDS: McpSetupTabId[] = [
  "cursor",
  "claude-code",
  "claude-desktop",
  "claude-ai",
  "chatgpt",
  "grok",
  "perplexity",
  "copilot",
];

export function resolveCloudConnectorUrl(opts: {
  siteUrl?: string | null;
  siteDomain?: string | null;
  localDev: boolean;
  publicUrl: string;
}): string | null {
  const fromEnv = opts.siteUrl?.replace(/\/$/, "");
  if (fromEnv) return `${fromEnv}/mcp`;
  const domain = opts.siteDomain?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain && !domain.includes("localhost") && !domain.includes("127.0.0.1")) {
    return `https://${domain}/mcp`;
  }
  if (!opts.localDev) return opts.publicUrl;
  return null;
}
