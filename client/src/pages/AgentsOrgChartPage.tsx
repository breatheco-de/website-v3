import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import {
  IconClipboardList,
  IconInfoCircle,
  IconLoader2,
  IconScale,
  IconSearch,
  IconThumbUp,
  IconWebhook,
} from "@tabler/icons-react";
import { Geekchart } from "geekchart";
import "geekchart/fonts.css";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import {
  AGENTIC_SWARM_EDGES,
  AGENTIC_SWARM_ROLE_IDS,
  type AgenticSwarmRoleId,
} from "@shared/agentic-swarm-roles";
import { Button } from "@/components/ui/button";
import { PrivateHistoryBackButton } from "@/components/private/PrivateHistoryBackButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { AgentIcon } from "@/components/pipeline/AgentIcon";
import { formatAgentLabel, type AgentId } from "@/components/pipeline/agentIcons";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import {
  AGENTS_PROPOSALS_BASE,
  ProposalDetailPanel,
  ProposalListPanel,
} from "@/pages/ProposalsPage";
import { AgentsRulesPanel } from "@/pages/AgentsRulesPanel";
import { AgentsOutcomesPanel } from "@/components/agents/AgentsOutcomesPanel";
import { EventWebhooksPanel } from "@/components/pipeline/EventWebhooksDialog";
import {
  AGENTS_OUTCOMES_BASE,
  AGENTS_WEBHOOKS_HREF,
  resolveAgentsTab,
  type AgentsTab,
} from "@/lib/agents-tab";

interface CapabilityGrant {
  name: string;
  contentTypes?: string[] | "*";
  databases?: string[] | "*";
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

const AGENTS_TABS: {
  id: AgentsTab;
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "orgchart", href: "/private/agents/orgchart", label: "Org Chart", Icon: Bot },
  { id: "proposals", href: AGENTS_PROPOSALS_BASE, label: "Proposals", Icon: IconClipboardList },
  { id: "outcomes", href: AGENTS_OUTCOMES_BASE, label: "Outcomes", Icon: IconThumbUp },
  { id: "rules", href: "/private/agents/rules", label: "Rules", Icon: IconScale },
  { id: "webhooks", href: AGENTS_WEBHOOKS_HREF, label: "Webhooks", Icon: IconWebhook },
];

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

/**
 * Live role labels + tool counts; hierarchy from AGENTIC_SWARM_*.
 * Short captions only (geekchart authoring): full descriptions live in the
 * toolkit cards below. Orchestrator/publisher get DESIGN 5.1 path/accent roles.
 */
function buildSwarmMermaid(roles: Record<string, RoleDefinition>): string {
  // LR: hub → specialists → publisher reads left-to-right (TD stacked as one tall column).
  const lines: string[] = ["flowchart LR"];
  const present = new Set<AgenticSwarmRoleId>();
  for (const id of AGENTIC_SWARM_ROLE_IDS) {
    const role = roles[id];
    if (!role?.agentic) continue;
    present.add(id);
    const tools = allowedToolNames(role.capabilities ?? []);
    const count = tools.length;
    const label = escapeMermaidLabel(role.label || id);
    const countLine = `${count} tool${count === 1 ? "" : "s"}`;
    const roleClass =
      id === "swarm_orchestrator" ? ":::path" : id === "publisher" ? ":::accent" : "";
    lines.push(`  ${id}["${label}<br/>${countLine}"]${roleClass}`);
  }
  for (const { parent, child } of AGENTIC_SWARM_EDGES) {
    if (!present.has(parent) || !present.has(child)) continue;
    lines.push(`  ${parent} --> ${child}`);
  }
  return lines.join("\n");
}

function AgentsProposalsInfoPopover() {
  const [advanced, setAdvanced] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="How proposals work"
          data-testid="button-agents-proposals-info"
        >
          <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] max-h-[min(28rem,70vh)] overflow-y-auto space-y-2 text-sm text-muted-foreground leading-relaxed"
      >
        <p className="font-medium text-foreground">How proposals work</p>
        <p>
          Suggested entry changes wait for Approve or Reject (preview drafts first). Handoff notes stay
          open when an agent hits a wall — leave them open as a reminder, or Close with a reason (that
          does not change the live site). Needs changes mean not ready to approve — use that for polish;
          Reject only when the idea must not ship.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-xs text-muted-foreground"
          data-testid="button-agents-proposals-info-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </Button>
        {advanced ? (
          <div
            className="space-y-1 text-xs text-muted-foreground"
            data-testid="panel-agents-proposals-info-advanced"
          >
            <p>
              Stored in per-site SQLite (data/&lt;site&gt;/app.db). Exact fingerprint blocks clones;
              similar open proposals need confirm_distinct. One open proposal per draft variant.
            </p>
            <p>
              Notes default to no auto-retry on linked issues. Close reasons: wont_fix, fixed_elsewhere,
              tracked_elsewhere, other. Apply/Reject are four-eyes; Close is not. MCP must claim before
              clearing no_auto_retry.
            </p>
            <p>Issue panels only list proposals linked to that issue. This page lists everything.</p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
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
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-card px-4 py-3"
      data-testid="swarm-orchestrator-logos"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <AgentIcon agentId={agentId} size="lg" className="h-7 w-7 transition-opacity duration-300" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Swarm Orchestrator</p>
          <p className="text-xs text-muted-foreground">{formatAgentLabel(agentId)}</p>
        </div>
      </div>
      <p className="max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-right">
        Any frontier agent can be your orchestrator — ChatGPT, Claude, Claude Code, Grok, Grok bot, and
        most other popular labs. Pick the one you already use.
      </p>
    </div>
  );
}

function OrgChartPanel() {
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
    <div className="space-y-6">
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
              <figure className="geekchart mx-auto w-full max-w-5xl">
                <Geekchart
                  source={mermaidSource}
                  scene="geeks"
                  play="once"
                  duration={1.2}
                  display={1024}
                />
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
  );
}

export default function AgentsOrgChartPage() {
  const [pathname, setLocation] = useLocation();
  const search = useSearch();
  const params = useParams<{ id?: string }>();
  const activeTab = resolveAgentsTab(pathname, search);
  const { data: siteInfo } = useQuery<{ domain: string }>({ queryKey: ["/api/site/info"] });
  const siteLabel = siteInfo?.domain === "4geeks.com" ? "4Geeks.com" : siteInfo?.domain;

  useEffect(() => {
    if (pathname === "/private/agents" || pathname === "/private/agents/") {
      setLocation("/private/agents/orgchart");
    }
  }, [pathname, setLocation]);

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-24 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <PrivateHistoryBackButton data-testid="button-agents-back" />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-agents-title">
                  Agent Swarm
                </h1>
                {activeTab === "orgchart" ? (
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
                ) : activeTab === "outcomes" ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Read more (advanced)"
                        data-testid="button-agents-outcomes-advanced-info"
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
                        The verdict is stored on the proposal with a history of earlier verdicts. Only a
                        Platform Steward can set, change or clear it, from the proposal page.
                      </p>
                      <p>
                        Not reviewed means finished, rejected or withdrawn with no verdict yet. Proposals
                        the system closed on its own (drafts out of date with no activity, the legacy
                        migration) are left out unless someone reviews them.
                      </p>
                      <p>
                        Agents read the same counts in{" "}
                        <code className="font-mono bg-muted px-1 rounded">list_proposals</code> (
                        <code className="font-mono bg-muted px-1 rounded">stats.by_outcome</code>) but
                        cannot set verdicts.
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : activeTab === "rules" ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Read more (advanced)"
                        data-testid="button-agents-rules-advanced-info"
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
                        Policy is stored per site in{" "}
                        <code className="font-mono bg-muted px-1 rounded">settings.yml</code> under{" "}
                        <code className="font-mono bg-muted px-1 rounded">proposals:</code>. Only a
                        Platform Steward can save.
                      </p>
                      <p>
                        Who may file or decide is still Security → Roles (
                        <code className="font-mono bg-muted px-1 rounded">proposals_create</code> /{" "}
                        <code className="font-mono bg-muted px-1 rounded">proposals_review</code>
                        ).
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : activeTab === "webhooks" || activeTab === "webhook-logs" ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Read more (advanced)"
                        data-testid="button-agents-webhooks-advanced-info"
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
                        Hook config is saved with site content (GitHub) in{" "}
                        <code className="font-mono bg-muted px-1 rounded">event-webhooks.yml</code>.
                      </p>
                      <p>
                        Call history and waiting events stay on this server (site SQLite); history is kept
                        for 48 hours.
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <AgentsProposalsInfoPopover />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {activeTab === "orgchart" ? (
                  <>
                    MCP swarm connectors — not staff CMS roles. Assign them on Security → Users to unlock{" "}
                    <code className="text-xs font-mono bg-muted px-1 rounded">/mcp/role/…</code>.
                  </>
                ) : activeTab === "outcomes" ? (
                  <>
                    How closed proposals{siteLabel ? ` on ${siteLabel}` : ""} turned out, and which still
                    need a verdict.
                  </>
                ) : activeTab === "rules" ? (
                  <>
                    Site policy for withdraw, four-eyes, holds, and claims — not who has which role.
                  </>
                ) : activeTab === "webhooks" ? (
                  <>
                    Notify outside URLs when proposal events fire — every event or every N (max 50).
                    Turning a hook off or changing its URL drops its waiting events. Does not change
                    proposals.
                  </>
                ) : activeTab === "webhook-logs" ? (
                  <>Calls sent to your webhook URLs in the last 48 hours, and whether they worked.</>
                ) : (
                  <>Review and apply agent-suggested entry changes or handoff notes.</>
                )}
              </p>
            </div>
          </div>

          <ToggleButtonBar
            className="shrink-0"
            value={activeTab === "webhook-logs" ? "webhooks" : activeTab}
            onValueChange={(id) => {
              const tab = AGENTS_TABS.find((t) => t.id === id);
              if (!tab) return;
              setLocation(tab.href);
            }}
            listTestId="agents-tablist"
            listClassName="flex"
          >
            {AGENTS_TABS.map(({ id, label, Icon }) => (
              <ToggleButtonBarTrigger
                key={id}
                value={id}
                data-testid={`tab-${id}`}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </ToggleButtonBarTrigger>
            ))}
          </ToggleButtonBar>
        </div>

        <div role="tabpanel">
          {activeTab === "orgchart" && <OrgChartPanel />}
          {activeTab === "proposals" &&
            (params.id ? <ProposalDetailPanel id={params.id} /> : <ProposalListPanel />)}
          {activeTab === "outcomes" &&
            (params.id ? <ProposalDetailPanel id={params.id} /> : <AgentsOutcomesPanel />)}
          {activeTab === "rules" && <AgentsRulesPanel />}
          {activeTab === "webhooks" && <EventWebhooksPanel tab="hooks" />}
          {activeTab === "webhook-logs" && <EventWebhooksPanel tab="logs" />}
        </div>
      </div>
    </div>
  );
}
