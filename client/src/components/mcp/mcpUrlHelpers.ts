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

export type McpRoleConnector = {
  roleId: string;
  label: string;
  url: string;
};

/** Build local MCP URLs for one or more role connectors. */
export function getMcpRoleConnectors(
  roles: { id: string; label: string }[],
): McpRoleConnector[] {
  return roles.map((r) => ({
    roleId: r.id,
    label: r.label,
    url: getMcpServerUrl(r.id),
  }));
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

/** Merge several role connectors into one mcpServers JSON blob. */
export function buildHttpMcpConfigForRoles(connectors: McpRoleConnector[]): string {
  const mcpServers: Record<string, { url: string }> = {};
  for (const c of connectors) {
    mcpServers[mcpServerConfigKey(c.roleId)] = { url: c.url };
  }
  return JSON.stringify({ mcpServers }, null, 2);
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

export function buildClaudeDesktopConfigForRoles(connectors: McpRoleConnector[]): string {
  const mcpServers: Record<string, { type: string; url: string }> = {};
  for (const c of connectors) {
    mcpServers[mcpServerConfigKey(c.roleId)] = { type: "http", url: c.url };
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

export function buildClaudeCodeCli(mcpUrl: string, roleId?: string | null): string {
  const key = mcpServerConfigKey(roleId);
  return `claude mcp add --transport http ${key} ${mcpUrl}`;
}

/** One CLI add line per role connector. */
export function buildClaudeCodeCliForRoles(connectors: McpRoleConnector[]): string {
  return connectors.map((c) => buildClaudeCodeCli(c.url, c.roleId)).join("\n");
}

export type McpSetupTabId =
  | "cursor"
  | "claude-code"
  | "claude-desktop"
  | "claude-ai"
  | "chatgpt"
  | "grok"
  | "perplexity"
  | "copilot"
  | "generic";

export const MCP_SETUP_TAB_IDS: McpSetupTabId[] = [
  "cursor",
  "claude-code",
  "claude-desktop",
  "claude-ai",
  "chatgpt",
  "grok",
  "perplexity",
  "copilot",
  "generic",
];

/** Cloud agents whose connector settings page we can open directly. */
export const MCP_AGENT_CONNECT_TARGETS: Partial<
  Record<McpSetupTabId, { product: string; pageUrl: string }>
> = {
  "claude-ai": { product: "Claude", pageUrl: "https://claude.ai/customize/connectors" },
  chatgpt: { product: "ChatGPT", pageUrl: "https://chatgpt.com/plugins" },
  grok: { product: "Grok", pageUrl: "https://grok.com/connectors" },
};

/** Name shown in the agent's connector list. */
export function mcpConnectorDisplayName(roleLabel: string): string {
  return `4Geeks CMS (${roleLabel})`;
}

/**
 * Link that opens the agent's connector settings. Claude.ai accepts a prefilled
 * "Add custom connector" dialog; ChatGPT and Grok only open their connectors page.
 */
export function buildAgentConnectUrl(
  agentId: McpSetupTabId,
  connector?: { name: string; url: string | null },
): string | null {
  const target = MCP_AGENT_CONNECT_TARGETS[agentId];
  if (!target) return null;
  if (agentId === "claude-ai" && connector?.url) {
    const params = new URLSearchParams({
      modal: "add-custom-connector",
      connectorName: connector.name,
      connectorUrl: connector.url,
    });
    return `${target.pageUrl}?${params.toString()}`;
  }
  return target.pageUrl;
}

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

/** Resolve public cloud URLs for each role (null entries when SITE_URL missing in local). */
export function resolveCloudConnectorUrls(
  opts: {
    siteUrl?: string | null;
    siteDomain?: string | null;
    localDev: boolean;
  },
  roles: { id: string; label: string }[],
): { roleId: string; label: string; url: string | null }[] {
  return roles.map((r) => {
    const path = mcpPath(r.id);
    const publicUrl =
      typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    return {
      roleId: r.id,
      label: r.label,
      url: resolveCloudConnectorUrl({
        ...opts,
        publicUrl,
        roleId: r.id,
      }),
    };
  });
}
