import { Job } from "sidequest";
import fs from "fs";
import path from "path";
import { getLLMService } from "../../ai/LLMService";
import {
  buildLlmsTxtInputs,
  fillLlmsTxtPrompt,
  LLMS_TEMPLATE_BASENAME,
  readLlmsTxtPrompt,
} from "../../llms-txt/regenerate-prompt";
import { invalidateLlmsCompiledCache } from "../../llms-txt/compile";
import { notifyContentDirtiesRequeued } from "../../auto-commit";
import { markFileAsModified } from "../../sync-state";
import { child } from "../../logger";

const log = child({ module: "job:llms-txt-regenerate" });

export type LlmsTxtRegeneratePayload = {
  siteId?: string;
  contentRoot?: string;
  reason?: string;
};

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md|txt)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim() + "\n";
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

export class LlmsTxtRegenerateJob extends Job {
  async run(payload: LlmsTxtRegeneratePayload): Promise<{
    ok: boolean;
    reason?: string;
    bytes?: number;
  }> {
    const contentRoot = payload.contentRoot;
    const siteId = payload.siteId || (contentRoot ? path.basename(contentRoot) : "unknown");

    if (!contentRoot) {
      return { ok: false, reason: "missing_content_root" };
    }

    try {
      const promptTemplate = readLlmsTxtPrompt(contentRoot);
      if (!promptTemplate) {
        return { ok: false, reason: "missing_llms_txt_prompt" };
      }

      const inputs = buildLlmsTxtInputs(contentRoot);
      const userPrompt = fillLlmsTxtPrompt(promptTemplate, {
        company_profile: inputs.company_profile,
        site_facts: inputs.site_facts,
        products: inputs.products,
        pages: inputs.pages,
        previous_llms_txt: inputs.previous_llms_txt,
      });

      // Sidequest shares a process with HTML SSR; Node globals can look browser-like to OpenAI.
      const llm = getLLMService({ dangerouslyAllowBrowser: true });
      const result = await llm.complete(userPrompt, {
        temperature: 0.3,
        maxTokens: 4000,
        systemPrompt:
          "You write llms.txt Markdown templates. Return only the file body, no commentary.",
      });

      const body = stripCodeFences(result);
      if (!body.includes("#")) {
        return { ok: false, reason: "llm_output_missing_heading" };
      }

      if (Buffer.byteLength(body, "utf-8") > 6 * 1024) {
        log.warn({ siteId, bytes: Buffer.byteLength(body, "utf-8") }, "[LlmsTxtRegenerateJob] template over soft 5KB target");
      }

      const absPath = path.join(contentRoot, LLMS_TEMPLATE_BASENAME);
      fs.writeFileSync(absPath, body, "utf-8");

      const folder = path.basename(contentRoot);
      const trackedPath = `${folder}/${LLMS_TEMPLATE_BASENAME}`;
      markFileAsModified(LLMS_TEMPLATE_BASENAME, "agent", undefined, contentRoot);
      await notifyContentDirtiesRequeued({ files: [trackedPath], author: "agent" });

      invalidateLlmsCompiledCache(contentRoot);

      log.info(
        { siteId, bytes: Buffer.byteLength(body, "utf-8"), reason: payload.reason },
        "[LlmsTxtRegenerateJob] finished",
      );
      return {
        ok: true,
        bytes: Buffer.byteLength(body, "utf-8"),
      };
    } catch (err) {
      log.error({ err, siteId }, "[LlmsTxtRegenerateJob] failed");
      throw err;
    }
  }
}
