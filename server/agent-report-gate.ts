/**
 * MCP agent report quality gate: heuristics first, then cheap LLM when unsure.
 * Fail-open on AI timeout/error. Kill-switch: AGENT_REPORT_AI_GATE=0 skips AI only.
 */

import {
  AGENT_WHY_MIN_LENGTH,
  composeAgentReportDisplay,
  deriveSimpleChanges,
  evaluateReportHeuristics,
  sanitizeHighlights,
  sanitizeWhy,
  type AgentSimpleChange,
  type FieldUpdateLike,
  type StructuredAgentReport,
} from "@shared/agent-report-structured";
import { DEFAULT_COMPLETION_MODEL, getLLMService } from "./ai/LLMService";
import { child } from "./logger";

const log = child({ module: "agent-report-gate" });

export const AGENT_REPORT_AI_TIMEOUT_MS = 2000;

export type AgentReportGateMode = "mutate_with_updates" | "mutate_structural" | "complete";

export type AgentReportGateInput = {
  why: unknown;
  highlights?: unknown;
  mode: AgentReportGateMode;
  updates?: FieldUpdateLike[];
  /** When true, skip AI even if unsure (tests / kill-switch). */
  skipAi?: boolean;
};

export type AgentReportGateOk = {
  ok: true;
  why: string;
  highlights: string[];
  simple_changes: AgentSimpleChange[];
  report: string;
  structured: StructuredAgentReport;
};

export type AgentReportGateFail = {
  ok: false;
  code: "report_required" | "report_too_short" | "report_quality";
  error: string;
  missing: string[];
};

function aiGateDisabled(): boolean {
  const v = process.env.AGENT_REPORT_AI_GATE;
  if (v === undefined || v === "") return false;
  return v === "0" || v.toLowerCase() === "false" || v.toLowerCase() === "off";
}

async function judgeWithAi(opts: {
  why: string;
  highlights: string[];
  mode: AgentReportGateMode;
  fieldPaths: string[];
}): Promise<{ ok: boolean; missing: string[] }> {
  const service = getLLMService();
  const systemPrompt =
    "You judge whether a staff-facing agent change report has enough substance. " +
    "Pass if why states a real goal/outcome and highlights (when present) name concrete deltas " +
    "(links added, field values, hub joined). Fail process-only boilerplate or vague 'updated section'. " +
    "Respond only via the JSON schema.";

  const userPrompt = JSON.stringify({
    mode: opts.mode,
    why: opts.why,
    highlights: opts.highlights,
    field_paths: opts.fieldPaths.slice(0, 40),
  });

  const result = await service.adaptContentStructured(systemPrompt, userPrompt, {
    model: DEFAULT_COMPLETION_MODEL,
    temperature: 0,
    maxTokens: 200,
    schemaName: "agent_report_gate",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        missing: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["ok", "missing"],
    },
  });

  const content = result.content as { ok?: unknown; missing?: unknown };
  const ok = content.ok === true;
  const missing = Array.isArray(content.missing)
    ? content.missing.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : ok
      ? []
      : ["Report needs more concrete detail for staff."];
  return { ok, missing };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("agent_report_ai_timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Validate + optionally AI-judge structured agent report.
 * On AI failure/timeout: accept (fail-open).
 */
export async function gateAgentReport(input: AgentReportGateInput): Promise<AgentReportGateOk | AgentReportGateFail> {
  const why = sanitizeWhy(input.why);
  const highlights = sanitizeHighlights(input.highlights);
  const updates = input.updates ?? [];
  const simple_changes =
    input.mode === "mutate_with_updates" ? deriveSimpleChanges(updates) : [];

  if (!why) {
    return {
      ok: false,
      code: "report_required",
      error: "why required: explain the ticket/goal in plain English.",
      missing: ["Provide why: the ticket/goal in plain English."],
    };
  }
  if (why.length < AGENT_WHY_MIN_LENGTH) {
    return {
      ok: false,
      code: "report_too_short",
      error: `why must be at least ${AGENT_WHY_MIN_LENGTH} characters.`,
      missing: [`why must be at least ${AGENT_WHY_MIN_LENGTH} characters.`],
    };
  }

  const verdict = evaluateReportHeuristics({
    why,
    highlights,
    mode: input.mode,
    updates,
  });

  if (verdict.status === "fail") {
    return {
      ok: false,
      code: "report_quality",
      error: verdict.missing.join(" "),
      missing: verdict.missing,
    };
  }

  let aiRejected = false;
  let aiMissing: string[] = [];

  if (
    verdict.status === "unsure" &&
    !input.skipAi &&
    !aiGateDisabled()
  ) {
    try {
      const judged = await withTimeout(
        judgeWithAi({
          why,
          highlights,
          mode: input.mode,
          fieldPaths: updates.map((u) => u.field_path).filter(Boolean),
        }),
        AGENT_REPORT_AI_TIMEOUT_MS,
      );
      if (!judged.ok) {
        aiRejected = true;
        aiMissing =
          judged.missing.length > 0
            ? judged.missing
            : verdict.missing.length > 0
              ? verdict.missing
              : ["Report needs more concrete detail for staff."];
      }
    } catch (err) {
      log.warn({ err }, "[agent-report-gate] AI judge failed or timed out — fail-open");
    }
  }

  if (aiRejected) {
    return {
      ok: false,
      code: "report_quality",
      error: aiMissing.join(" "),
      missing: aiMissing,
    };
  }

  const structured: StructuredAgentReport = { why, highlights, simple_changes };
  return {
    ok: true,
    why,
    highlights,
    simple_changes,
    report: composeAgentReportDisplay(structured),
    structured,
  };
}
