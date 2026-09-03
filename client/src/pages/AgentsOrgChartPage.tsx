import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { IconArrowLeft, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import { Geekchart } from "geekchart";
import "geekchart/fonts.css";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import {
  AGENTIC_SWARM_EDGES,
  AGENTIC_SWARM_ROLE_IDS,
  type AgenticSwarmRoleId,
} from "@shared/agentic-swarm-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentIcon } from "@/components/pipeline/AgentIcon";
import type { AgentId } from "@/components/pipeline/agentIcons";
import { useDebugAuth } from "@/hooks/useDebugAuth";

interface CapabilityGrant {
  name: string;
  contentTypes?: string[] | "*";
}

interface RoleDefinition {
  label: string;
  description?: string;
  capabilities: CapabilityGrant[];
  agentic?: boolean;
}

interface AdminRolesResponse {
  roles: Record<string, RoleDefinition>;
}

/** Logos that cycle on the Swarm Orchestrator strip. */
const ORCHESTRATOR_LOGO_CYCLE: AgentId[] = [
  "claude",
  "grok",
  "chatgpt",
  "gemini",
  "perplexity",
  "mistral",
  "copilot",
  "codex",
];

const LOGO_INTERVAL_MS = 2200;

function escapeMermaidLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/\n+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
}

function buildSwarmMermaid(roles: Record<string, RoleDefinition>): string {
  const lines: string[] = ["flowchart TD"];
  for (const id of AGENTIC_SWARM_ROLE_IDS) {
    const role = roles[id];
    if (!role?.agentic) continue;
    const tools = allowedToolNames(role.capabilities ?? []);
    const count = tools.length;
    const label = escapeMermaidLabel(role.label || id);
    const desc = escapeMermaidLabel(role.description || "");
    const countLine = `${count} tool${count === 1 ? "" : "s"}`;
    const nodeText = desc
      ? `${label}<br/>${desc}<br/>${countLine}`
      : `${label}<br/>${countLine}`;
    lines.push(`  ${id}["${nodeText}"]`);
  }
  for (const { parent, child } of AGENTIC_SWARM_EDGES) {
    if (!roles[parent]?.agentic || !roles[child]?.agentic) continue;
    lines.push(`  ${parent} --> ${child}`);
  }
  return lines.join("\n");
}

function SwarmOrchestratorLogos() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % ORCHESTRATOR_LOGO_CYCLE.length);
    }, LOGO_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);
  const agentId = ORCHESTRATOR_LOGO_CYCLE[index]!;
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
      data-testid="swarm-orchestrator-logos"
    >
      <div className="relative flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <AgentIcon agentId={agentId} size="lg" className="h-7 w-7 transition-opacity duration-300" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Swarm Orchestrator</p>
        <p className="text-xs text-muted-foreground capitalize">{agentId.replace(/-/g, " ")}</p>
      </div>
    </div>
  );
}

export default function AgentsOrgChartPage() {
  const { isValidated } = useDebugAuth();
  const { data: rolesResponse, isLoading } = useQuery<AdminRolesResponse>({
    queryKey: ["/api/admin/roles"],
    enabled: isValidated === true,
  });

  const roles = rolesResponse?.roles ?? {};
  const [capabilityQuery, setCapabilityQuery] = useState("");

  const agenticOrdered = useMemo(() => {
    const list: Array<{ id: AgenticSwarmRoleId; role: RoleDefinition; tools: string[] }> = [];
    for (const id of AGENTIC_SWARM_ROLE_IDS) {
      const role = roles[id];
      if (!role?.agentic) continue;
      list.push({
        id,
        role,
        tools: allowedToolNames(role.capabilities ?? []),
      });
    }
    return list;
  }, [roles]);

  const capabilityFilter = capabilityQuery.trim().toLowerCase();

  const filteredAgentic = useMemo(() => {
    if (!capabilityFilter) {
      return agenticOrdered.map(({ id, role, tools }) => ({
        id,
        role,
        tools,
        matchedTools: tools,
      }));
    }
    return agenticOrdered
      .map(({ id, role, tools }) => ({
        id,
        role,
        tools,
        matchedTools: tools.filter((tool) => tool.toLowerCase().includes(capabilityFilter)),
      }))
      .filter(({ matchedTools }) => matchedTools.length > 0);
  }, [agenticOrdered, capabilityFilter]);

  const mermaidSource = useMemo(() => buildSwarmMermaid(roles), [roles]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <Button variant="ghost" size="icon" asChild data-testid="button-agents-back">
              <Link href="/private/mcp-server">
                <IconArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-agents-title">
                  Agents
                </h1>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Read more (advanced)"
                      data-testid="button-agents-advanced-info"
                    >
                      <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-80 space-y-2 text-xs text-muted-foreground leading-relaxed"
                  >
                    <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
                    <p>
                      Roles live in the same user-store file as staff roles with{" "}
                      <code className="font-mono bg-muted px-1 rounded">agentic: true</code>. They are
                      hidden from Security → Roles but still assignable on Users.
                    </p>
                    <p>
                      Tool counts and card lists come from{" "}
                      <code className="font-mono bg-muted px-1 rounded">allowedToolNames</code> (MCP
                      catalog gates). Org chart hierarchy is fixed in code (
                      <code className="font-mono bg-muted px-1 rounded">
                        shared/agentic-swarm-roles.ts
                      </code>
                      ).
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-sm text-muted-foreground">
                MCP swarm connectors — not staff CMS roles. Assign them on Security → Users to unlock{" "}
                <code className="text-xs font-mono bg-muted px-1 rounded">/mcp/role/…</code>.
              </p>
            </div>
          </div>
        </div>

        <Card data-testid="panel-agents-orgchart">
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Swarm org chart</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SwarmOrchestratorLogos />
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading roles…</p>
            ) : agenticOrdered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No agentic swarm roles yet. Restart the server to seed them from code.
              </p>
            ) : (
              <div className="overflow-x-auto" data-testid="agents-geekchart">
                <figure className="geekchart mx-auto max-w-4xl">
                  <Geekchart source={mermaidSource} play="once" duration={1.2} />
                </figure>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Agent toolkits
            </h2>
            <div className="relative w-full sm:w-64">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search capabilities…"
                value={capabilityQuery}
                onChange={(e) => setCapabilityQuery(e.target.value)}
                className="pl-8"
                data-testid="input-search-agent-capabilities"
              />
            </div>
          </div>
          {capabilityFilter && filteredAgentic.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No capabilities match &ldquo;{capabilityQuery.trim()}&rdquo;.
            </p>
          ) : (
            <div
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
              data-testid="agents-tool-cards"
            >
              {filteredAgentic.map(({ id, role, tools, matchedTools }) => (
                <Card key={id} data-testid={`card-agent-${id}`} className="flex flex-col">
                  <CardHeader className="pb-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{role.label}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                        {capabilityFilter
                          ? `${matchedTools.length} of ${tools.length}`
                          : `${tools.length} tools`}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-normal leading-relaxed">
                      {role.description}
                    </p>
                    <code className="text-[11px] font-mono text-muted-foreground">
                      /mcp/role/{id}
                    </code>
                  </CardHeader>
                  <CardContent className="pt-0 flex-1">
                    <div
                      className="flex flex-wrap gap-1.5 content-start"
                      data-testid={`tag-cloud-tools-${id}`}
                    >
                      {matchedTools.map((tool) => (
                        <Badge
                          key={tool}
                          variant="secondary"
                          className="font-mono text-[10px] font-normal px-1.5 py-0.5"
                          title={tool}
                        >
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
