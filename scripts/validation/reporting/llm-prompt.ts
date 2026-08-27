/**
 * LLM Prompt Reporter
 *
 * Formats validation results as a structured prompt intended to be pasted
 * into a local LLM (e.g. Claude, GPT, Ollama) running on the same machine.
 * File paths are absolute so the LLM can read or edit files directly.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { ValidationRunResult, ValidatorResult } from "../shared/types";

interface SeoConfig {
  intents: Record<string, { label: string; description: string }>;
  focus_features: Record<string, { label: string; description: string }>;
}

function loadSeoConfig(): SeoConfig | null {
  const configPath = path.join(process.cwd(), "4geeks-com", "seo-config.yml");
  if (!fs.existsSync(configPath)) return null;
  try {
    return yaml.load(fs.readFileSync(configPath, "utf-8")) as SeoConfig;
  } catch {
    return null;
  }
}

function getPersona(validatorNames: string[]): string {
  const names = validatorNames.map((n) => n.toLowerCase());
  const hasSeo = names.some((n) => n.includes("seo"));
  const hasRedirect = names.some((n) => n.includes("redirect"));
  const hasSchema = names.some((n) => n.includes("schema") || n.includes("component"));

  const categories = [hasSeo, hasRedirect, hasSchema].filter(Boolean).length;

  if (categories > 1) {
    return "You are a developer maintaining a YAML-based CMS repository for a coding school.";
  }
  if (hasSeo) {
    return "You are an SEO strategist and content specialist working on a YAML-based CMS for a coding bootcamp. You understand funnel stages (awareness → consideration → transaction → post-enrollment), topic clusters, pillar pages, and on-page SEO best practices.";
  }
  if (hasRedirect) {
    return "You are a backend developer responsible for URL routing and redirect management in a YAML-based CMS repository.";
  }
  if (hasSchema) {
    return "You are a frontend developer working on structured data (schema.org) and component configuration in a YAML-based CMS repository.";
  }
  return "You are a developer maintaining a YAML-based CMS repository for a coding school.";
}

const REPO_CONTEXT = `## Repository context
- Content root: /home/runner/workspace/4geeks-com/
- Files use YAML format (.yml)
- Merge chain (each level overrides the parent):
    _common.template.yml  →  {slug}/_common.yml  →  {slug}/{locale}.yml
- Editing rule: fix the most specific locale file unless the change should
  apply to all locales, in which case edit _common.yml instead.
- Never modify _common.template.yml unless explicitly instructed.`;

function buildSeoContextBlock(): string {
  const config = loadSeoConfig();
  if (!config) return "";

  const lines: string[] = ["## SEO content model (for this repository)"];

  lines.push("\n### Funnel intent stages");
  lines.push("Each page declares `seo.intent` — the funnel stage it targets:");
  for (const [key, val] of Object.entries(config.intents)) {
    lines.push(`- \`${key}\` (${val.label}): ${val.description}`);
  }

  lines.push("\n### Topic clusters");
  lines.push(
    "Participation is gated by `seo_monitoring.enabled` on each content type in content-types.yml (omitted = off). " +
    "Hub pages use `seo.is_pillar: true`; members set `seo.pillar_path` to the hub URL (legacy `seo.pillar` still honored). " +
    "`seo.pillar_path: null` opts a page out of clustering. Empty/missing pillar_path on a monitored type is a gap " +
    "(ORPHAN_PAGE / PARTIALLY_SET_CLUSTER in validation)."
  );

  lines.push("\n### Valid focus features");
  lines.push("Pages can declare `seo.focus_features` — an array of keys from this list:");
  for (const [key, val] of Object.entries(config.focus_features)) {
    lines.push(`- \`${key}\`: ${val.description}`);
  }

  return lines.join("\n");
}

const TASK_INSTRUCTION = `## Your task
For every error listed above:
1. Open the file at the exact path shown.
2. Provide the minimal YAML edit that resolves the issue.
3. Show the changed lines with 3–5 lines of surrounding context so the
   location is unambiguous (use a unified-diff style or "before / after" blocks).
4. Do not change anything that is not listed as an error or warning.
5. After all edits, briefly explain why each change fixes the issue.`;

function formatIssues(
  issues: ValidatorResult["errors"],
  label: "Error" | "Warning",
  fixLabel: "Fix" | "Hint",
): string {
  if (issues.length === 0) return "";
  const lines: string[] = [`### ${label}s (${issues.length})`];
  for (const issue of issues) {
    lines.push(`- [${issue.code}] ${issue.message}`);
    if (issue.file) lines.push(`  File: ${issue.file}`);
    if (issue.suggestion) lines.push(`  ${fixLabel}: ${issue.suggestion}`);
  }
  return lines.join("\n");
}

function formatValidatorBlock(v: ValidatorResult): string {
  const blocks: string[] = [
    `## Validator: ${v.name}`,
    v.description,
  ];

  const errorsBlock = formatIssues(v.errors, "Error", "Fix");
  if (errorsBlock) blocks.push(errorsBlock);

  const warningsBlock = formatIssues(v.warnings, "Warning", "Hint");
  if (warningsBlock) blocks.push(warningsBlock);

  return blocks.join("\n\n");
}

export function formatAsLlmPrompt(result: ValidationRunResult): string {
  const failing = result.validators.filter(
    (v) => v.errors.length > 0 || v.warnings.length > 0,
  );

  const totalIssues = failing.reduce(
    (n, v) => n + v.errors.length + v.warnings.length,
    0,
  );

  const validatorNames = result.validators.map((v) => v.name);
  const persona = getPersona(validatorNames);

  const hasSeoContext =
    validatorNames.includes("seo-intent") || validatorNames.includes("seo-cluster");

  const sections: string[] = [
    persona,
    REPO_CONTEXT,
  ];

  if (hasSeoContext) {
    const seoBlock = buildSeoContextBlock();
    if (seoBlock) sections.push(seoBlock);
  }

  sections.push(
    `## Run summary\n- Validators run: ${result.validators.length}\n- Failed: ${result.summary.failed}\n- Warnings: ${result.summary.warnings}\n- Total issues: ${totalIssues}`,
    ...failing.map(formatValidatorBlock),
    TASK_INSTRUCTION,
  );

  return sections.join("\n\n---\n\n");
}

export function formatSingleValidatorAsLlmPrompt(v: ValidatorResult): string {
  const totalIssues = v.errors.length + v.warnings.length;
  const persona = getPersona([v.name]);
  const hasSeoContext = v.name === "seo-intent" || v.name === "seo-cluster";

  const sections: string[] = [
    persona,
    REPO_CONTEXT,
  ];

  if (hasSeoContext) {
    const seoBlock = buildSeoContextBlock();
    if (seoBlock) sections.push(seoBlock);
  }

  sections.push(
    `## Run summary\n- Validator: ${v.name}\n- Errors: ${v.errors.length}\n- Warnings: ${v.warnings.length}\n- Total issues: ${totalIssues}`,
    formatValidatorBlock(v),
    TASK_INSTRUCTION,
  );

  return sections.join("\n\n---\n\n");
}
