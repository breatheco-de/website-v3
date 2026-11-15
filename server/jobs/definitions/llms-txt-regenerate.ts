import { Job } from "sidequest";
import fs from "fs";
import path from "path";
import { getLLMService } from "../../ai/LLMService";
import {
  buildLlmsTxtInputs,
  fillLlmsTxtPrompt,
  LLMS_TEMPLATE_BASENAME,
} from "../../llms-txt/regenerate-prompt";
import { invalidateLlmsCompiledCache } from "../../llms-txt/compile";
import { markFileAsModified } from "../../sync-state";
import { commitSingleFile } from "../../github";
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
    commitSha?: string;
    bytes?: number;
  }> {
    const contentRoot = payload.contentRoot;
    const siteId = payload.siteId || (contentRoot ? path.basename(contentRoot) : "unknown");

    if (!contentRoot) {
      return { ok: false, reason: "missing_content_root" };
    }

    try {
      const inputs = buildLlmsTxtInputs(contentRoot);
      const userPrompt = fillLlmsTxtPrompt({
        company_profile: inputs.company_profile,
        site_facts: inputs.site_facts,
        products: inputs.products,
        pages: inputs.pages,
        previous_llms_txt: inputs.previous_llms_txt,
      });

      const llm = getLLMService();
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
      markFileAsModified(LLMS_TEMPLATE_BASENAME, "agent", undefined, contentRoot);

      const push = await commitSingleFile({
        filePath: `${folder}/${LLMS_TEMPLATE_BASENAME}`,
        message: "Regenerate llms.template.md for /llms.txt",
        author: "agent",
        contentRoot,
      });

      invalidateLlmsCompiledCache(contentRoot);

      if (!push.success) {
        log.warn({ siteId, error: push.error }, "[LlmsTxtRegenerateJob] wrote local template; content push failed");
        return { ok: true, reason: "written_push_failed", bytes: Buffer.byteLength(body, "utf-8") };
      }

      log.info(
        { siteId, commitSha: push.commitSha, bytes: Buffer.byteLength(body, "utf-8"), reason: payload.reason },
        "[LlmsTxtRegenerateJob] finished",
      );
      return {
        ok: true,
        commitSha: push.commitSha,
        bytes: Buffer.byteLength(body, "utf-8"),
      };
    } catch (err) {
      log.error({ err, siteId }, "[LlmsTxtRegenerateJob] failed");
      throw err;
    }
  }
}
