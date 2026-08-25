import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconServer,
  IconChevronDown,
  IconChevronRight,
  IconSearch,
  IconPlug,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { McpAgentSetupTabs } from "@/components/mcp/McpAgentSetupTabs";
import { McpCopyButton } from "@/components/mcp/McpSetupUi";
import {
  getMcpServerUrl,
} from "@/components/mcp/mcpUrlHelpers";

const ROLE_FILTER_ALL = "all";

interface McpReadiness {
  siteUrlConfigured: boolean;
  mcpServerSecretConfigured: boolean;
  mcpReachable: boolean;
  replitDevDomain?: string | null;
}

interface McpParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

interface McpTool {
  name: string;
  description: string;
  parameters: McpParam[];
}

interface FetchedTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

interface McpRoleFilter {
  id: string;
  label: string;
  allowedTools: string[];
}

function toolFromFetched(t: FetchedTool): McpTool {
  const props = t.inputSchema?.properties || {};
  const required = t.inputSchema?.required || [];
  const parameters: McpParam[] = Object.entries(props).map(([name, prop]) => ({
    name,
    type: prop.type || "string",
    required: required.includes(name),
    description: prop.description || "",
    default: prop.default !== undefined ? String(prop.default) : undefined,
  }));
  return {
    name: t.name,
    description: t.description || "",
    parameters,
  };
}

function ToolCard({ tool }: { tool: McpTool }) {
  const [open, setOpen] = useState(false);
  const hasParams = tool.parameters.length > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {tool.name}
            </code>
            {tool.parameters.filter((p) => p.required).length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {tool.parameters.filter((p) => p.required).length} required param
                {tool.parameters.filter((p) => p.required).length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            {tool.description}
          </p>
        </div>
      </div>

      {hasParams && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 gap-1.5 text-muted-foreground"
              data-testid={`button-toggle-params-${tool.name}`}
            >
              {open ? (
                <IconChevronDown className="w-3.5 h-3.5" />
              ) : (
                <IconChevronRight className="w-3.5 h-3.5" />
              )}
              Parameters ({tool.parameters.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Req.</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map((param, i) => (
                    <tr
                      key={param.name}
                      className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                    >
                      <td className="px-3 py-2 font-mono font-medium">{param.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{param.type}</td>
                      <td className="px-3 py-2">
                        {param.required ? (
                          <span className="text-foreground font-semibold">yes</span>
                        ) : (
                          <span className="text-muted-foreground">no</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {param.description}
                        {param.default !== undefined && (
                          <span className="ml-1 text-muted-foreground/60">
                            (default: <code className="font-mono">{param.default}</code>)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

export default function McpServerPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const mcpUrl = getMcpServerUrl();

  const { data, isLoading, isError } = useQuery<{
    tools: FetchedTool[];
    roles?: McpRoleFilter[];
    siteUrl?: string | null;
    error?: string;
    readiness?: McpReadiness;
  }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
  });

  const readiness = data?.readiness;
  const siteUrlMissing = !isLoading && !isError && readiness ? !readiness.siteUrlConfigured : false;
  const mcpSecretMissing =
    !isLoading && !isError && readiness ? !readiness.mcpServerSecretConfigured : false;
  const mcpUnreachable =
    !isLoading && !isError && readiness ? !readiness.mcpReachable : isError;

  const allTools = useMemo<McpTool[]>(
    () => (data?.tools ?? []).map(toolFromFetched),
    [data],
  );

  const roles = data?.roles ?? [];
  const selectedRole = roles.find((r) => r.id === roleFilter);
  const allowedByRole = useMemo(
    () => (selectedRole ? new Set(selectedRole.allowedTools) : null),
    [selectedRole],
  );

  const query = search.trim().toLowerCase();
  const filteredTools = useMemo(
    () =>
      allTools.filter((tool) => {
        if (allowedByRole && !allowedByRole.has(tool.name)) return false;
        if (!query) return true;
        return (
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query)
        );
      }),
    [allTools, allowedByRole, query],
  );

  return (
    <ScrollArea className="h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-muted shrink-0">
            <IconServer className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">MCP Server</h1>
            <p className="mt-1 text-muted-foreground">
              Connect any MCP-compatible AI agent to read and modify this website&apos;s content
              directly.
            </p>
          </div>
        </div>

        {mcpUnreachable && (
          <Alert variant="destructive" data-testid="alert-mcp-unreachable">
            <IconAlertCircle className="h-4 w-4" />
            <AlertTitle>MCP server is not reachable</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Nothing is answering on the MCP port (default{" "}
                <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                  3001
                </code>
                ). Locally run{" "}
                <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                  npm run mcp
                </code>{" "}
                in a second terminal. On Replit production,{" "}
                <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                  scripts/start-production.sh
                </code>{" "}
                should start it automatically after build.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Getting started */}
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <IconPlug className="w-5 h-5 shrink-0" />
            Getting started
          </h2>

          <p className="text-sm text-muted-foreground leading-relaxed">
            This MCP server exposes the site&apos;s content system to AI agents via the{" "}
            <span className="font-medium text-foreground">Model Context Protocol</span>. An agent can
            list pages, read and update sections, manage SEO metadata, browse the component registry,
            and inspect its own permissions — all without leaving its chat interface.
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Server URL</p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap"
                data-testid="text-mcp-server-url"
              >
                {mcpUrl}
              </code>
              <McpCopyButton text={mcpUrl} testId="button-copy-mcp-url" />
            </div>
            <p className="text-xs text-muted-foreground">
              Auth is <span className="text-foreground font-medium">OAuth 2.0</span> — agents that
              support MCP OAuth will open a browser consent flow (no token in your config). You
              verify identity there via Breathecode login or by pasting a token once. Capabilities
              stay scoped to your roles. A Breathecode{" "}
              <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">Authorization</code>{" "}
              / <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">X-Api-Key</code>{" "}
              header is still accepted as a legacy fallback (e.g. curl).
            </p>

            {siteUrlMissing && (
              <Alert variant="destructive" data-testid="alert-mcp-site-url-missing">
                <IconAlertCircle className="h-4 w-4" />
                <AlertTitle>SITE_URL is not set</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    Set <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">SITE_URL</code>{" "}
                    to this server&apos;s public origin (local:{" "}
                    <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                      http://localhost:3000
                    </code>
                    ; production:{" "}
                    <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                      https://your-deploy-host
                    </code>
                    ). MCP uses it for OAuth issuer / authorize / token / callback URLs. Without it,
                    agents can hit SSL or redirect failures during login.
                  </p>
                  <p>
                    This is <span className="font-medium">not</span> related to multisite. Content
                    sites still come from domains in{" "}
                    <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                      sites.yml
                    </code>
                    . <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">SITE_URL</code>{" "}
                    is only the public URL of this running app for MCP authentication.
                    {readiness?.replitDevDomain
                      ? ` Replit can fall back to https://${readiness.replitDevDomain} in the workspace, but production deploys should set SITE_URL explicitly.`
                      : ""}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {mcpSecretMissing && (
              <Alert variant="destructive" data-testid="alert-mcp-secret-missing">
                <IconAlertCircle className="h-4 w-4" />
                <AlertTitle>MCP_SERVER_SECRET is not set</AlertTitle>
                <AlertDescription>
                  The MCP process exits at startup without{" "}
                  <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                    MCP_SERVER_SECRET
                  </code>{" "}
                  (or legacy{" "}
                  <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                    MCP_API_KEY
                  </code>
                  ). Set it in Secrets /{" "}
                  <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">.env</code>{" "}
                  so production{" "}
                  <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                    start-production.sh
                  </code>{" "}
                  can keep MCP running beside the website.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Setup by agent</p>
            <McpAgentSetupTabs defaultTab="cursor" />
          </div>
        </section>

        {/* Tools list */}
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground">
              Available tools
              {!isLoading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {roleFilter || query
                    ? `(${filteredTools.length} of ${allTools.length})`
                    : `(${allTools.length} total)`}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={roleFilter || undefined}
                onValueChange={(value) =>
                  setRoleFilter(value === ROLE_FILTER_ALL ? "" : value)
                }
                disabled={isLoading || roles.length === 0}
              >
                <SelectTrigger className="w-52" data-testid="select-filter-tools-role">
                  <SelectValue placeholder="Filter tools by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROLE_FILTER_ALL}>All roles</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-64">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search tools…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  data-testid="input-search-tools"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {selectedRole && (
            <p className="text-xs text-muted-foreground">
              Showing tools visible in production{" "}
              <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">tools/list</code>{" "}
              for <span className="text-foreground font-medium">{selectedRole.label}</span>
              {" "}({selectedRole.allowedTools.length} tools). Identity tools are always included.
            </p>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading tools from MCP server…</span>
            </div>
          )}

          {mcpUnreachable && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Tools unavailable until the MCP server is reachable — see the alert under Server URL.
            </p>
          )}

          {!isLoading && !mcpUnreachable && filteredTools.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {query || roleFilter
                ? "No tools match your filters."
                : "No tools found."}
            </p>
          )}

          {!isLoading && !mcpUnreachable && (
            <div className="space-y-2">
              {filteredTools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
