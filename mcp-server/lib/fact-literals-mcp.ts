/**
 * MCP envelopes for sync fact-literal warnings (exact catalog match on live selling pages).
 */
import type { McpWarning } from "./respond.js";

type FactLiteralWarningRow = {
  message?: string;
  field_path?: string;
  literal?: string;
  variables?: string[];
};

function asRows(raw: unknown): FactLiteralWarningRow[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is FactLiteralWarningRow => !!v && typeof v === "object")
    : [];
}

/** Non-blocking live-edit warnings returned as `fact_literal_warnings`. */
export function factLiteralWarnings(raw: unknown): McpWarning[] {
  return asRows(raw)
    .filter((w) => typeof w.message === "string" && w.message.trim())
    .map((w) => ({
      code: "fact_literal_prefer_variable",
      message:
        `${w.message}` +
        (typeof w.field_path === "string" && w.field_path
          ? ` — field_path: ${w.field_path}`
          : "") +
        (Array.isArray(w.variables) && w.variables[0]
          ? ` Suggested token: {{ ${w.variables[0]} }}.`
          : "") +
        " Saved; prefer the variable so visitors see the right region.",
    }));
}
