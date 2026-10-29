/**
 * Code-seeded MCP swarm roles (agentic). Synced into the user-store roles map
 * with agentic: true — hidden from Security Roles list, still assignable on Users.
 */

import type { CapabilityName } from "./capabilities.js";

export interface AgenticCapabilityGrant {
  name: CapabilityName;
  contentTypes?: string[] | "*";
  databases?: string[] | "*";
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
  "proposal_reviewer",
  "publisher",
] as const;

export type AgenticSwarmRoleId = (typeof AGENTIC_SWARM_ROLE_IDS)[number];

export const AGENTIC_SWARM_ROLES_BY_ID: Record<AgenticSwarmRoleId, AgenticSwarmRoleDef> = {
  swarm_orchestrator: {
    label: "Swarm Orchestrator",
    description:
      "Plans, inspects, and may file proposals — read entries, playbooks, and metrics. Not for apply/reject, page writes, or go-live.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "metrics_view" },
      { name: "proposals_create" },
    ],
  },
  copy_editor: {
    label: "Copy Editor",
    description:
      "Draft and locale body copy; may read private databases and file and withdraw proposals — not layout, SEO meta, database row edits, apply/reject, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "databases_view" },
      { name: "content_edit_text", contentTypes: "*" },
      { name: "content_create_variant", contentTypes: "*" },
      { name: "content_edit_variant", contentTypes: "*" },
      { name: "proposals_create" },
    ],
  },
  seo_specialist: {
    label: "SEO Specialist",
    description:
      "Per-entry SEO and clusters, including a page's old addresses (redirects) on its drafts; may read private databases and file and withdraw proposals — not live redirects, page structure, database row edits, apply/reject, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "databases_view" },
      { name: "seo_edit", contentTypes: "*" },
      { name: "read_redirects" },
      { name: "proposals_create" },
    ],
  },
  layout_editor: {
    label: "Layout Editor",
    description:
      "Sections and shared-layout shell; may file and withdraw proposals — not body SEO, apply/reject, or go-live.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_edit_structure", contentTypes: "*" },
      { name: "proposals_create" },
    ],
  },
  translator: {
    label: "Translator",
    description:
      "Locale variants and translation writes; may read private databases and file and withdraw proposals — not structure, SEO, database row edits, apply/reject, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "databases_view" },
      { name: "content_edit_text", contentTypes: "*" },
      { name: "content_create_variant", contentTypes: "*" },
      { name: "content_edit_variant", contentTypes: "*" },
      { name: "proposals_create" },
    ],
  },
  media_editor: {
    label: "Media Editor",
    description:
      "Gallery upload and media fields; may file and withdraw proposals — not copy, SEO, apply/reject, or publish.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "media_upload" },
      { name: "content_edit_media", contentTypes: "*" },
      { name: "proposals_create" },
    ],
  },
  proposal_reviewer: {
    label: "Proposal Reviewer",
    description:
      "List and decide proposals (apply/reject/accept/close/blockers) and read private databases for context. Approve can change live or draft content that was already proposed. Not for creating proposals, withdrawing, attaching drafts, editing page copy/layout, or editing database rows.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "databases_view" },
      { name: "proposals_review" },
    ],
  },
  publisher: {
    label: "Publisher",
    description:
      "Promote drafts, go-live with SEO diagnostics (including a page's old addresses on its drafts), and full proposal lifecycle — not live redirects, layout, or body rewrites.",
    capabilities: [
      { name: "content_view", contentTypes: "*" },
      { name: "content_promote_variant", contentTypes: "*" },
      { name: "seo_edit", contentTypes: "*" },
      { name: "read_redirects" },
      { name: "proposals_create" },
      { name: "proposals_review" },
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
  { parent: "swarm_orchestrator", child: "proposal_reviewer" },
  { parent: "copy_editor", child: "publisher" },
  { parent: "seo_specialist", child: "publisher" },
  { parent: "layout_editor", child: "publisher" },
  { parent: "translator", child: "publisher" },
  { parent: "media_editor", child: "publisher" },
  { parent: "proposal_reviewer", child: "publisher" },
];

export function isAgenticSwarmRoleId(roleId: string): boolean {
  return (AGENTIC_SWARM_ROLE_IDS as readonly string[]).includes(roleId);
}
