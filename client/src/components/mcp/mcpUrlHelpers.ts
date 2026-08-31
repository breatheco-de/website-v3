export function isLocalOrigin(origin: string): boolean {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
}

function mcpPath(roleId?: string | null): string {
  if (roleId) return `/mcp/role/${roleId}`;
  return "/mcp";
}

/** Config key for mcpServers / CLI (unique per role for multi-connector hosts). */
export function mcpServerConfigKey(roleId?: string | null): string {
  return roleId ? `4geeks-cms-${roleId}` : "4geeks-cms";
}

/** Direct MCP process URL (port 3001 on local; same origin elsewhere via proxy). */
export function getMcpServerUrl(roleId?: string | null): string {
  const origin = window.location.origin;
  const path = mcpPath(roleId);
  if (isLocalOrigin(origin)) {
    return `${origin.replace(/:\d+$/, ":3001")}${path}`;
  }
  return `${origin}${path}`;
}

/** Prefer main-app proxied URL for cloud agents (works when MCP is behind the site). */
export function getPublicConnectorUrl(roleId?: string | null): string {
  return `${window.location.origin}${mcpPath(roleId)}`;
}

export function buildHttpMcpConfig(mcpUrl: string, roleId?: string | null): string {
  const key = mcpServerConfigKey(roleId);
  return JSON.stringify(
    {
      mcpServers: {
        [key]: {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeDesktopConfig(mcpUrl: string, roleId?: string | null): string {
  const key = mcpServerConfigKey(roleId);
  return JSON.stringify(
    {
      mcpServers: {
        [key]: {
          type: "http",
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeCodeCli(mcpUrl: string, roleId?: string | null): string {
  const key = mcpServerConfigKey(roleId);
  return `claude mcp add --transport http ${key} ${mcpUrl}`;
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
  roleId?: string | null;
}): string | null {
  const path = mcpPath(opts.roleId);
  const fromEnv = opts.siteUrl?.replace(/\/$/, "");
  if (fromEnv) return `${fromEnv}${path}`;
  const domain = opts.siteDomain?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain && !domain.includes("localhost") && !domain.includes("127.0.0.1")) {
    return `https://${domain}${path}`;
  }
  if (!opts.localDev) return opts.publicUrl;
  return null;
}
