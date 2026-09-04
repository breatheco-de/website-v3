import {
  askAgentPromptFilename,
  getAskAgentTemplate,
  renderAskAgentPrompt,
  type AskAgentPromptId,
} from "@shared/ask-agent-prompts";

/** Build the meta prompt that asks an agent to polish another Ask Agent template. */
export function buildPolishAskAgentPrompt(targetId: AskAgentPromptId): string {
  if (targetId === "polish-ask-agent-prompt") {
    throw new Error("Cannot polish the polish template via this helper");
  }
  const tpl = getAskAgentTemplate(targetId);
  const fm = tpl.frontmatter;
  return renderAskAgentPrompt("polish-ask-agent-prompt", {
    target_id: fm.id,
    target_title: fm.title,
    target_path: `shared/ask-agent-prompts/${askAgentPromptFilename(targetId)}`,
    target_used_when: fm.used_when.trim(),
    target_intention: fm.intention.trim(),
    target_success: fm.success_looks_like.trim(),
    target_failure_modes: fm.failure_modes.map((m) => `  - ${m}`).join("\n"),
    target_raw: tpl.raw.trimEnd(),
    max_chars: String(fm.max_chars),
  });
}
