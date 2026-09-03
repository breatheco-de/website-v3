import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseAskAgentPromptMarkdown } from "./parse";
import { askAgentPromptFilename } from "./registry";
import type { AskAgentPromptId, AskAgentPromptTemplate } from "./types";
import { ASK_AGENT_PROMPT_IDS } from "./types";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function askAgentPromptsDir(): string {
  return DIR;
}

export function loadAskAgentPromptFromDisk(id: AskAgentPromptId): AskAgentPromptTemplate {
  const filePath = path.join(DIR, askAgentPromptFilename(id));
  const raw = fs.readFileSync(filePath, "utf8");
  const tpl = parseAskAgentPromptMarkdown(raw);
  if (tpl.frontmatter.id !== id) {
    throw new Error(`Ask Agent template id mismatch: file ${id}.md has id ${tpl.frontmatter.id}`);
  }
  return tpl;
}

export function loadAllAskAgentPromptsFromDisk(): Map<AskAgentPromptId, AskAgentPromptTemplate> {
  const map = new Map<AskAgentPromptId, AskAgentPromptTemplate>();
  for (const id of ASK_AGENT_PROMPT_IDS) {
    map.set(id, loadAskAgentPromptFromDisk(id));
  }
  return map;
}
