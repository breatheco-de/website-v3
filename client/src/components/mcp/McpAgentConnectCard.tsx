import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconExternalLink, IconPlugConnected } from "@tabler/icons-react";
import {
  MCP_AGENT_CONNECT_TARGETS,
  buildAgentConnectUrl,
  isLocalOrigin,
  mcpConnectorDisplayName,
  resolveCloudConnectorUrls,
  type McpSetupTabId,
} from "@/components/mcp/mcpUrlHelpers";

export type McpCloudConnector = { roleId: string; label: string; url: string | null };

/** Public connector URLs per role (null when SITE_URL is missing on localhost). */
export function useMcpCloudConnectors(
  roleIds: string[],
  roleLabels?: Record<string, string>,
): McpCloudConnector[] {
  const localDev = isLocalOrigin(window.location.origin);
  const { data } = useQuery<{ siteUrl?: string | null }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
  });
  const { data: siteInfo } = useQuery<{ domain?: string }>({
    queryKey: ["/api/site/info"],
    staleTime: 60_000,
  });

  return useMemo(
    () =>
      resolveCloudConnectorUrls(
        { siteUrl: data?.siteUrl, siteDomain: siteInfo?.domain, localDev },
        roleIds.map((id) => ({ id, label: roleLabels?.[id] ?? id })),
      ),
    [data?.siteUrl, siteInfo?.domain, localDev, roleIds, roleLabels],
  );
}

function ConnectLink({
  href,
  title,
  hint,
  testId,
}: {
  href: string;
  title: string;
  hint: string;
  testId: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-card border border-primary bg-primary px-4 py-3 min-w-[12rem] flex-1 sm:flex-initial text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid={testId}
    >
      <IconPlugConnected className="h-6 w-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/80">{hint}</p>
        <p className="text-base font-semibold truncate">{title}</p>
      </div>
      <IconExternalLink className="h-4 w-4 shrink-0 text-primary-foreground/80" aria-hidden />
    </a>
  );
}

/**
 * "Connect to Claude / ChatGPT / Grok" boxes for the setup wizard.
 * Renders nothing for agents without a connectors page (Cursor, Claude Code, …).
 */
export function McpAgentConnectCards({
  agentId,
  roleIds,
  roleLabels,
}: {
  agentId: McpSetupTabId;
  roleIds: string[];
  roleLabels?: Record<string, string>;
}) {
  const cloudConnectors = useMcpCloudConnectors(roleIds, roleLabels);
  const target = MCP_AGENT_CONNECT_TARGETS[agentId];
  if (!target) return null;

  const title = `Connect to ${target.product}`;
  const prefills = agentId === "claude-ai";

  if (prefills && cloudConnectors.length > 1) {
    return (
      <>
        {cloudConnectors.map((c) => (
          <ConnectLink
            key={c.roleId}
            href={buildAgentConnectUrl(agentId, { name: mcpConnectorDisplayName(c.label), url: c.url })!}
            title={title}
            hint={c.label}
            testId={`link-mcp-connect-${agentId}-${c.roleId}`}
          />
        ))}
      </>
    );
  }

  const only = cloudConnectors[0];
  const href = buildAgentConnectUrl(
    agentId,
    only ? { name: mcpConnectorDisplayName(only.label), url: only.url } : undefined,
  )!;

  return (
    <ConnectLink
      href={href}
      title={title}
      hint={prefills && only?.url ? "URL filled in" : "Opens connectors"}
      testId={`link-mcp-connect-${agentId}`}
    />
  );
}
