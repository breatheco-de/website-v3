/**
 * Code-seeded MCP swarm roles (agentic). Synced into the user-store roles map
 * with agentic: true — hidden from Security Roles list, still assignable on Users.
 */

import type { CapabilityName } from "./capabilities.js";

export interface AgenticCapabilityGrant {
  name: CapabilityName;
  contentTypes?: string[] | "*";
}

export interface AgenticSwarmRoleDef {
  label: string;
  description: string;
  capabilities: AgenticCapabilityGrant[];
}

/** Display / Mermaid order: orchestrator → specialists → publisher. */
export const AGENTIC_SWARM_ROLE_IDS = [
  "swarm_orchestrator",
  "copy_editor",
  "seo_specialist",
  "layout_editor",
  "translator",
  "media_editor",
  "publisher",
] as const;

export type AgenticSwarmRoleId = (typeof AGENTIC_SWARM_ROLE_IDS)[number];

export const AGENTIC_SWARM_ROLES_BY_ID: Record<AgenticSwarmRoleId, AgenticSwarmRoleDef> = {
  swarm_orchestrator: {
    label: "Swarm Orchestrator",
    description:
      "Plans and inspects content only — read entries, playbooks, and metrics. Not for writes or go-live.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "metrics_view" },
    ],
  },
  copy_editor: {
    label: "Copy Editor",
    description:
      "Draft and locale body copy — not layout, SEO meta, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_edit_text", contentTypes: "*" },
      { name: "content_create_variant", contentTypes: "*" },
      { name: "content_edit_variant", contentTypes: "*" },
    ],
  },
  seo_specialist: {
    label: "SEO Specialist",
    description:
      "Per-entry SEO and clusters — not page structure or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "seo_edit", contentTypes: "*" },
    ],
  },
  layout_editor: {
    label: "Layout Editor",
    description:
      "Sections and shared-layout shell — not body SEO or go-live.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_edit_structure", contentTypes: "*" },
    ],
  },
  translator: {
    label: "Translator",
    description:
      "Locale variants and translation writes — not structure, SEO, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_edit_text", contentTypes: "*" },
      { name: "content_create_variant", contentTypes: "*" },
      { name: "content_edit_variant", contentTypes: "*" },
    ],
  },
  media_editor: {
    label: "Media Editor",
    description:
      "Gallery upload and media fields — not copy, SEO, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "media_upload" },
      { name: "content_edit_media", contentTypes: "*" },
    ],
  },
  publisher: {
    label: "Publisher",
    description:
      "Promote drafts and go-live with SEO diagnostics — not layout or body rewrites.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_promote_variant", contentTypes: "*" },
      { name: "seo_edit", contentTypes: "*" },
    ],
  },
};

/**
 * Fixed org-chart edges: parent → child.
 * Orchestrator fans out to specialists; each specialist feeds Publisher.
 */
export const AGENTIC_SWARM_EDGES: ReadonlyArray<{
  parent: AgenticSwarmRoleId;
  child: AgenticSwarmRoleId;
}> = [
  { parent: "swarm_orchestrator", child: "copy_editor" },
  { parent: "swarm_orchestrator", child: "seo_specialist" },
  { parent: "swarm_orchestrator", child: "layout_editor" },
  { parent: "swarm_orchestrator", child: "translator" },
  { parent: "swarm_orchestrator", child: "media_editor" },
  { parent: "copy_editor", child: "publisher" },
  { parent: "seo_specialist", child: "publisher" },
  { parent: "layout_editor", child: "publisher" },
  { parent: "translator", child: "publisher" },
  { parent: "media_editor", child: "publisher" },
];

export function isAgenticSwarmRoleId(roleId: string): boolean {
  return (AGENTIC_SWARM_ROLE_IDS as readonly string[]).includes(roleId);
}
