import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  IconServer,
  IconChevronDown,
  IconChevronRight,
  IconSearch,
  IconPlug,
  IconCode,
  IconAlertCircle,
  IconArrowRight,
  IconPencil,
  IconRobot,
  IconUser,
} from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PrivateHistoryBackButton } from "@/components/private/PrivateHistoryBackButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { McpAgentSetupTabs, MCP_AGENT_SETUP_LABELS } from "@/components/mcp/McpAgentSetupTabs";
import { McpAgentConnectCards } from "@/components/mcp/McpAgentConnectCard";
import { McpSetupAgentIcon } from "@/components/mcp/McpSetupAgentIcon";
import { McpSetupRoleMultiSelect } from "@/components/mcp/McpSetupRoleTabs";
import {
  isLocalOrigin,
  type McpSetupTabId,
} from "@/components/mcp/mcpUrlHelpers";
import { useDebugAuth } from "@/hooks/useDebugAuth";

const ROLE_FILTER_ALL = "all";

type McpTab = "connection" | "tools";
type SetupPhase = "role" | "agent" | "steps";

function SetupSelectionCard({
  label,
  value,
  icon,
  onEdit,
  editTestId,
  valueTestId,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  onEdit: () => void;
  editTestId: string;
  valueTestId: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-card border border-card-border bg-muted/40 px-4 py-3 min-w-[12rem] flex-1 sm:flex-initial"
      data-testid={`card-setup-${label.toLowerCase()}`}
    >
      {icon ? <div className="shrink-0 [&_svg]:h-6 [&_svg]:w-6 [&_img]:h-6 [&_img]:w-6">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className="text-base font-semibold text-foreground truncate"
          data-testid={valueTestId}
        >
          {value}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        data-testid={editTestId}
      >
        <IconPencil className="h-4 w-4" />
      </Button>
    </div>
  );
}

const MCP_TABS: {
  id: McpTab;
  href: string;
  label: string;
  Icon: typeof IconPlug;
}[] = [
  { id: "connection", href: "/private/mcp-server/connection", label: "Connection", Icon: IconPlug },
  { id: "tools", href: "/private/mcp-server/tools", label: "Tools", Icon: IconCode },
];

function resolveMcpTab(pathname: string): McpTab | null {
  if (pathname === "/private/mcp-server/connection") return "connection";
  if (pathname === "/private/mcp-server/tools") return "tools";
  return null;
}

interface McpReadiness {
  siteUrlConfigured: boolean;
  mcpServerSecretConfigured: boolean;
  mcpReachable: boolean;
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
  description?: string;
  allowedTools: string[];
  /** True for MCP swarm / agent roles (vs staff human roles). */
  agentic?: boolean;
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

function ConnectionPanel({
  mySetupRoles,
  siteUrlMissing,
  mcpSecretMissing,
}: {
  mySetupRoles: McpRoleFilter[];
  siteUrlMissing: boolean;
  mcpSecretMissing: boolean;
}) {
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("role");
  const [roleChosen, setRoleChosen] = useState(false);
  /** Confirmed role ids for connector setup (one URL each). */
  const [setupRoleIds, setSetupRoleIds] = useState<string[]>([]);
  /** Draft multi-select before confirming roles. */
  const [pendingRoleIds, setPendingRoleIds] = useState<string[]>([]);
  const [setupAgentId, setSetupAgentId] = useState<McpSetupTabId | null>(null);
  /** Draft selection in the agent dropdown before "Choose Agent". */
  const [pendingAgentId, setPendingAgentId] = useState<McpSetupTabId | null>(null);

  const localDev = isLocalOrigin(window.location.origin);
  const selectedSetupRoles = useMemo(
    () =>
      (roleChosen ? setupRoleIds : pendingRoleIds)
        .map((id) => mySetupRoles.find((r) => r.id === id))
        .filter((r): r is McpRoleFilter => Boolean(r)),
    [roleChosen, setupRoleIds, pendingRoleIds, mySetupRoles],
  );
  const confirmedSetupRoles = useMemo(
    () =>
      setupRoleIds
        .map((id) => mySetupRoles.find((r) => r.id === id))
        .filter((r): r is McpRoleFilter => Boolean(r)),
    [setupRoleIds, mySetupRoles],
  );
  const roleLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of mySetupRoles) map[r.id] = r.label;
    return map;
  }, [mySetupRoles]);
  const agentLabel =
    setupAgentId != null
      ? MCP_AGENT_SETUP_LABELS.find((a) => a.id === setupAgentId)?.label ?? setupAgentId
      : null;
  const pendingAgentLabel =
    pendingAgentId != null
      ? MCP_AGENT_SETUP_LABELS.find((a) => a.id === pendingAgentId)?.label ?? pendingAgentId
      : null;
  const roleSummaryLabel =
    confirmedSetupRoles.length === 0
      ? null
      : confirmedSetupRoles.length === 1
        ? confirmedSetupRoles[0].label
        : `${confirmedSetupRoles.length} roles`;

  function handleConfirmRole() {
    if (pendingRoleIds.length === 0) return;
    setSetupRoleIds(pendingRoleIds);
    setRoleChosen(true);
    setSetupAgentId(null);
    setPendingAgentId(null);
    setSetupPhase("agent");
  }

  function handleChangeRole() {
    setSetupAgentId(null);
    setPendingAgentId(null);
    setPendingRoleIds(setupRoleIds);
    setSetupPhase("role");
  }

  function handleConfirmAgent() {
    if (!pendingAgentId) return;
    setSetupAgentId(pendingAgentId);
    setSetupPhase("steps");
  }

  function handleChangeAgent() {
    setPendingAgentId(setupAgentId);
    setSetupAgentId(null);
    setSetupPhase("agent");
  }

  return (
    <Card data-testid="panel-mcp-connection">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <IconPlug className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-base">Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          This MCP server exposes the site&apos;s content system to AI agents via the{" "}
          <span className="font-medium text-foreground">Model Context Protocol</span>. An agent can
          list pages, read and update sections, manage SEO metadata, browse the component registry,
          and inspect its own permissions — all without leaving its chat interface.
        </p>

        {(siteUrlMissing || mcpSecretMissing) && (
          <div className="space-y-2">
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
        )}

        <div className="space-y-3" data-testid="mcp-setup-wizard">
          <p className="text-sm font-medium text-foreground">Which agent you want to connect?</p>

          {setupPhase === "role" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select the agent roles to connect. Each role gets its own connector URL in the next steps.
              </p>
              <McpSetupRoleMultiSelect
                value={pendingRoleIds}
                onValueChange={setPendingRoleIds}
                roles={mySetupRoles}
              />
              <Button
                type="button"
                disabled={pendingRoleIds.length === 0}
                onClick={handleConfirmRole}
                data-testid="button-choose-mcp-role"
                className="shrink-0"
              >
                {pendingRoleIds.length > 1 ? "Choose these Roles" : "Choose this Role"}
              </Button>
              {selectedSetupRoles.length === 1 && (
                <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-setup-role-hint">
                  <span className="text-foreground font-medium">{selectedSetupRoles[0].label}</span>
                  {" — "}
                  {selectedSetupRoles[0].description?.trim()
                    ? selectedSetupRoles[0].description
                    : "No description set for this role."}
                  {" "}
                  ({selectedSetupRoles[0].allowedTools.length} tools
                  {selectedSetupRoles[0].allowedTools.length <= 3 ? " — limited connector" : ""}).
                  Agents use this description to choose the connector. You must be assigned this role
                  (OAuth will refuse otherwise).
                </p>
              )}
              {selectedSetupRoles.length > 1 && (
                <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-setup-role-hint-multi">
                  {selectedSetupRoles.length} role connectors — your agent will need one connection per URL.
                  OAuth will refuse any role you are not assigned.
                </p>
              )}
              {pendingRoleIds.length === 0 && mySetupRoles.length > 0 && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Pick at least one agent role. Each role filters tools to that connector.
                </p>
              )}
              {localDev && pendingRoleIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Local note: role URLs filter tools by that role and allow mutates after{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">agent_session</code>{" "}
                  start with an exact{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">provider/model</code>
                  {" "}(pass{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">agent_session_id</code>
                  {" "}on every write).
                </p>
              )}
            </div>
          )}

          {setupPhase === "agent" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <SetupSelectionCard
                  label="Role"
                  value={roleSummaryLabel ?? "—"}
                  onEdit={handleChangeRole}
                  editTestId="button-change-setup-role"
                  valueTestId="text-setup-role-summary"
                />
              </div>
              {confirmedSetupRoles.length === 1 && (
                <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-setup-role-hint">
                  <span className="text-foreground font-medium">{confirmedSetupRoles[0].label}</span>
                  {" — "}
                  {confirmedSetupRoles[0].description?.trim()
                    ? confirmedSetupRoles[0].description
                    : "No description set for this role."}
                  {" "}
                  ({confirmedSetupRoles[0].allowedTools.length} tools
                  {confirmedSetupRoles[0].allowedTools.length <= 3 ? " — limited connector" : ""}).
                  Agents use this description to choose the connector. You must be assigned this role
                  (OAuth will refuse otherwise).
                </p>
              )}
              {confirmedSetupRoles.length > 1 && (
                <ul className="text-xs text-muted-foreground space-y-1" data-testid="text-setup-roles-list">
                  {confirmedSetupRoles.map((r) => (
                    <li key={r.id}>
                      <span className="text-foreground font-medium">{r.label}</span>
                      {" — "}
                      {r.allowedTools.length} tools
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground">
                Choose which AI app you&apos;re connecting.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={pendingAgentId ?? undefined}
                  onValueChange={(v) => setPendingAgentId(v as McpSetupTabId)}
                >
                  <SelectTrigger
                    className="w-full sm:max-w-xs"
                    data-testid="select-mcp-setup-agent"
                  >
                    {pendingAgentId ? (
                      <span className="flex items-center gap-2 truncate">
                        <McpSetupAgentIcon agentId={pendingAgentId} />
                        <span>{pendingAgentLabel}</span>
                      </span>
                    ) : (
                      <SelectValue placeholder="Select an agent" />
                    )}
                  </SelectTrigger>
                  <SelectContent data-testid="select-mcp-setup-agent-content">
                    {MCP_AGENT_SETUP_LABELS.map(({ id, label }) => (
                      <SelectItem
                        key={id}
                        value={id}
                        data-testid={`select-mcp-setup-agent-${id}`}
                      >
                        <span className="flex items-center gap-2">
                          <McpSetupAgentIcon agentId={id} />
                          {label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={!pendingAgentId}
                  onClick={handleConfirmAgent}
                  data-testid="button-choose-mcp-agent"
                  className="shrink-0"
                >
                  Choose Agent
                </Button>
              </div>
            </div>
          )}

          {setupPhase === "steps" && setupAgentId && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SetupSelectionCard
                  label="Role"
                  value={roleSummaryLabel ?? "—"}
                  onEdit={handleChangeRole}
                  editTestId="button-change-setup-role"
                  valueTestId="text-setup-role-summary"
                />
                <IconArrowRight
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden
                  data-testid="icon-setup-wizard-arrow"
                />
                <SetupSelectionCard
                  label="Agent"
                  value={agentLabel ?? "—"}
                  icon={<McpSetupAgentIcon agentId={setupAgentId} />}
                  onEdit={handleChangeAgent}
                  editTestId="button-change-setup-agent"
                  valueTestId="text-setup-agent-summary"
                />
                <McpAgentConnectCards
                  agentId={setupAgentId}
                  roleIds={setupRoleIds}
                  roleLabels={roleLabels}
                />
              </div>
              <McpAgentSetupTabs
                onlyTab={setupAgentId}
                roleIds={setupRoleIds}
                roleLabels={roleLabels}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ToolsPanel({
  isLoading,
  mcpUnreachable,
  allTools,
  filteredTools,
  roles,
  roleFilter,
  setRoleFilter,
  search,
  setSearch,
  selectedRole,
  query,
}: {
  isLoading: boolean;
  mcpUnreachable: boolean;
  allTools: McpTool[];
  filteredTools: McpTool[];
  roles: McpRoleFilter[];
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  selectedRole: McpRoleFilter | undefined;
  query: string;
}) {
  return (
    <Card data-testid="panel-mcp-tools">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <IconCode className="h-5 w-5 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">
            Available tools
            {!isLoading && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {roleFilter || query
                  ? `(${filteredTools.length} of ${allTools.length})`
                  : `(${allTools.length} total)`}
              </span>
            )}
          </CardTitle>
        </div>
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
              {(() => {
                const humanRoles = roles.filter((r) => !r.agentic);
                const agentRoles = roles.filter((r) => r.agentic);
                return (
                  <>
                    {humanRoles.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground">
                          Human roles
                        </SelectLabel>
                        {humanRoles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            <span className="inline-flex items-center gap-1.5">
                              <IconUser className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              {role.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {agentRoles.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground">
                          Agent Roles
                        </SelectLabel>
                        {agentRoles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            <span className="inline-flex items-center gap-1.5">
                              <IconRobot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              {role.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </>
                );
              })()}
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
      </CardHeader>
      <CardContent className="space-y-5">
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
            Tools unavailable until the MCP server is reachable — see the alert above, then fix
            setup on the Connection tab.
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
      </CardContent>
    </Card>
  );
}

export default function McpServerPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveMcpTab(pathname);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const { roles: myRoleIds } = useDebugAuth();

  useEffect(() => {
    if (pathname === "/private/mcp-server" || pathname === "/private/mcp-server/") {
      setLocation("/private/mcp-server/connection");
    }
  }, [pathname, setLocation]);

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
  const mySetupRoles = useMemo(
    () => roles.filter((r) => r.agentic && myRoleIds.includes(r.id)),
    [roles, myRoleIds],
  );
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

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Redirecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-24 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <PrivateHistoryBackButton data-testid="button-mcp-server-back" />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <IconServer className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-mcp-server-title">
                  MCP Server
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect any MCP-compatible AI agent to read and modify this website&apos;s content
                directly.
              </p>
            </div>
          </div>

          <ToggleButtonBar
            className="shrink-0"
            value={activeTab}
            onValueChange={(id) => {
              const tab = MCP_TABS.find((t) => t.id === id);
              if (!tab) return;
              setLocation(tab.href);
            }}
            listTestId="mcp-server-tablist"
            listClassName="flex"
          >
            {MCP_TABS.map(({ id, label, Icon }) => (
              <ToggleButtonBarTrigger
                key={id}
                value={id}
                data-testid={`tab-mcp-${id}`}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </ToggleButtonBarTrigger>
            ))}
          </ToggleButtonBar>
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
                in a second terminal. On VPS production,{" "}
                <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">
                  scripts/start-production.sh
                </code>{" "}
                should start it automatically with the website.
              </p>
            </AlertDescription>
          </Alert>
        )}

        <div role="tabpanel">
          {activeTab === "connection" && (
            <ConnectionPanel
              mySetupRoles={mySetupRoles}
              siteUrlMissing={siteUrlMissing}
              mcpSecretMissing={mcpSecretMissing}
            />
          )}
          {activeTab === "tools" && (
            <ToolsPanel
              isLoading={isLoading}
              mcpUnreachable={mcpUnreachable}
              allTools={allTools}
              filteredTools={filteredTools}
              roles={roles}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              search={search}
              setSearch={setSearch}
              selectedRole={selectedRole}
              query={query}
            />
          )}
        </div>
      </div>
    </div>
  );
}
