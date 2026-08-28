import { allowedToolNames } from "@shared/mcp-tool-catalog";
import * as userStore from "../user-store";
import type { CapabilityGrant } from "../user-store";
import { DEFAULT_COMPLETION_MODEL, getLLMService } from "./LLMService";

export interface GenerateRoleDescriptionInput {
  id?: string;
  label: string;
  capabilities: CapabilityGrant[];
}

export interface GenerateRoleDescriptionResult {
  description: string;
}

export interface RolePeerSummary {
  id: string;
  label: string;
  description: string;
  allowedTools: string[];
  overlap: number;
}

const SYSTEM_PROMPT = `You write short MCP connector descriptions for AI agents choosing which /mcp/role/{id} session to open.

Rules:
- Return ONLY plain text (2–4 sentences). No markdown, no bullet lists, no code fences, no title line.
- Explain what this role connector is FOR and what it is NOT for.
- When similar roles are provided, contrast this role vs the closest ones so agents pick the right connector quickly.
- Reference only tools/capabilities implied by the allowed tool list — do not invent tools.
- Use plain English. Be specific about scope (read-only vs writes, SEO-only vs structure edits, etc.).
- Mention /mcp/role/{id} at most once if helpful.`;

export function toolOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).length;
}

export function selectTopPeers(
  draftTools: string[],
  allRoles: Record<string, userStore.RoleDefinition>,
  excludeId: string | undefined,
  limit = 3,
): RolePeerSummary[] {
  const peers: RolePeerSummary[] = [];

  for (const [id, role] of Object.entries(allRoles)) {
    if (excludeId && id === excludeId) continue;
    const allowedTools = allowedToolNames(role.capabilities ?? []);
    peers.push({
      id,
      label: role.label,
      description: role.description?.trim() ?? "",
      allowedTools,
      overlap: toolOverlap(draftTools, allowedTools),
    });
  }

  return peers
    .sort((a, b) => b.overlap - a.overlap || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function stripCodeFences(content: string): string {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

/** Keep prompts small — long tool dumps can cause timeouts or empty completions. */
export function formatToolSummary(tools: string[], maxShow = 12): string {
  if (tools.length === 0) return "(none)";
  if (tools.length <= maxShow) return tools.join(", ");
  const head = tools.slice(0, maxShow).join(", ");
  return `${head}, … (+${tools.length - maxShow} more)`;
}

function validateCapabilities(capabilities: unknown): CapabilityGrant[] {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error("capabilities must be a non-empty array");
  }
  const valid: CapabilityGrant[] = [];
  for (const cap of capabilities) {
    if (!cap || typeof cap !== "object" || typeof (cap as CapabilityGrant).name !== "string") {
      throw new Error("Each capability must have a 'name' string field");
    }
    const name = (cap as CapabilityGrant).name;
    if (!userStore.ALL_CAPABILITIES.includes(name)) {
      throw new Error(`Unknown capability: ${name}`);
    }
    valid.push({
      name,
      contentTypes: (cap as CapabilityGrant).contentTypes,
    });
  }
  return valid;
}

function buildUserPrompt(input: {
  id?: string;
  label: string;
  allowedTools: string[];
  capabilities: CapabilityGrant[];
  peers: RolePeerSummary[];
}): string {
  const parts = [
    `Role label: "${input.label}"`,
    input.id ? `Role id: ${input.id} (MCP path: /mcp/role/${input.id})` : "Role id: (new role — id not set yet)",
    "",
    "Capabilities (grants):",
    ...input.capabilities.map((g) => {
      const scope =
        g.contentTypes === "*"
          ? "*"
          : Array.isArray(g.contentTypes)
            ? g.contentTypes.join(", ")
            : "*";
      return `- ${g.name}${g.contentTypes !== undefined ? ` (content types: ${scope})` : ""}`;
    }),
    "",
    `Allowed MCP tools (${input.allowedTools.length}):`,
    formatToolSummary(input.allowedTools),
  ];

  if (input.peers.length > 0) {
    parts.push("", "Similar existing roles (for contrast — do not copy verbatim):");
    for (const peer of input.peers) {
      parts.push(
        "",
        `- ${peer.id} ("${peer.label}") — ${peer.allowedTools.length} tools, ${peer.overlap} overlapping tools`,
      );
      if (peer.description) {
        parts.push(`  Current description: ${peer.description}`);
      }
    }
  }

  parts.push(
    "",
    "Write the agent-facing description for the role being edited (first role above).",
  );

  return parts.join("\n");
}

export async function generateRoleDescription(
  input: GenerateRoleDescriptionInput,
): Promise<GenerateRoleDescriptionResult> {
  const label = input.label?.trim();
  if (!label) {
    throw new Error("label must be a non-empty string");
  }

  const capabilities = validateCapabilities(input.capabilities);
  const allowedTools = allowedToolNames(capabilities);
  const excludeId = input.id?.trim() || undefined;
  const peers = selectTopPeers(allowedTools, userStore.getAllRoles(), excludeId);

  const llm = getLLMService();
  const userPrompt = buildUserPrompt({
    id: excludeId,
    label,
    allowedTools,
    capabilities,
    peers,
  });
  const llmOptions = {
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 1024,
  };

  let raw: string;
  try {
    raw = await llm.complete(userPrompt, llmOptions);
  } catch (firstErr) {
    const message = firstErr instanceof Error ? firstErr.message : "";
    if (message.includes("Empty response from LLM")) {
      raw = await llm.complete(userPrompt, {
        ...llmOptions,
        model: DEFAULT_COMPLETION_MODEL,
        maxTokens: 2048,
      });
    } else {
      throw firstErr;
    }
  }

  const description = stripCodeFences(raw);
  if (!description) {
    throw new Error("AI returned an empty description");
  }

  return { description };
}
