import { z } from "zod";
import { errorLogFingerprint, normalizeErrorLogMessage } from "./error-log-fingerprint";

const ignoreRuleBase = {
  id: z.string(),
  label: z.string().optional(),
  addedAt: z.number(),
};

export const errorLogIgnoreRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("identity"),
    level: z.enum(["error", "warn"]).optional(),
    module: z.string().optional(),
    message: z.string(),
    errName: z.string().nullable().optional(),
  }),
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("status_message"),
    message: z.string(),
    status: z.number(),
    level: z.enum(["error", "warn"]).optional(),
    module: z.string().optional(),
  }),
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("fingerprint"),
    level: z.enum(["error", "warn"]),
    module: z.string(),
    /** Pre-normalized message shape (or raw — hydrated to normalized). */
    messageNormalized: z.string(),
  }),
]);

export type ErrorLogIgnoreRule = z.infer<typeof errorLogIgnoreRuleSchema>;

export const errorLogIgnoreRuleInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("identity"),
    level: z.enum(["error", "warn"]).optional(),
    module: z.string().optional(),
    message: z.string(),
    errName: z.string().nullable().optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("status_message"),
    message: z.string(),
    status: z.number(),
    level: z.enum(["error", "warn"]).optional(),
    module: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("fingerprint"),
    level: z.enum(["error", "warn"]),
    module: z.string(),
    message: z.string().optional(),
    messageNormalized: z.string().optional(),
    label: z.string().optional(),
  }),
]);

export type ErrorLogIgnoreRuleInput = z.infer<typeof errorLogIgnoreRuleInputSchema>;

export const errorLogIgnoreStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  rules: z.array(errorLogIgnoreRuleSchema),
});

export type ErrorLogIgnoreState = z.infer<typeof errorLogIgnoreStateSchema>;

export function emptyErrorLogIgnoreState(): ErrorLogIgnoreState {
  return { version: 1, updatedAt: Date.now(), rules: [] };
}

export function newErrorLogIgnoreRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `elig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type ErrorLogIgnoreCandidate = {
  level: "error" | "warn";
  module: string;
  message: string;
  errName?: string | null;
  context?: Record<string, unknown> | null;
};

function contextStatus(context: Record<string, unknown> | null | undefined): number | undefined {
  if (!context || typeof context !== "object") return undefined;
  const raw = context.status ?? (context.err_props as Record<string, unknown> | undefined)?.status;
  return typeof raw === "number" ? raw : undefined;
}

export function errorLogIgnoreRuleIdentity(
  rule: ErrorLogIgnoreRuleInput | ErrorLogIgnoreRule,
): string {
  if (rule.kind === "identity") {
    const err =
      rule.errName === undefined ? "" : rule.errName === null ? "null" : rule.errName;
    return `identity:${rule.level ?? ""}|${rule.module ?? ""}|${rule.message}|${err}`;
  }
  if (rule.kind === "status_message") {
    return `status_message:${rule.level ?? ""}|${rule.module ?? ""}|${rule.message}|${rule.status}`;
  }
  const normalized =
    "messageNormalized" in rule && rule.messageNormalized
      ? rule.messageNormalized
      : normalizeErrorLogMessage(
          "message" in rule && typeof rule.message === "string" ? rule.message : "",
        );
  return `fingerprint:${rule.level}|${rule.module}|${normalized}`;
}

export function hydrateErrorLogIgnoreRule(
  input: ErrorLogIgnoreRuleInput,
  now = Date.now(),
): ErrorLogIgnoreRule {
  const label = input.label?.trim() || undefined;
  const id = newErrorLogIgnoreRuleId();
  if (input.kind === "identity") {
    return {
      id,
      kind: "identity",
      message: input.message,
      level: input.level,
      module: input.module,
      errName: input.errName,
      label,
      addedAt: now,
    };
  }
  if (input.kind === "status_message") {
    return {
      id,
      kind: "status_message",
      message: input.message,
      status: input.status,
      level: input.level,
      module: input.module,
      label,
      addedAt: now,
    };
  }
  const messageNormalized =
    input.messageNormalized?.trim() ||
    normalizeErrorLogMessage(input.message ?? "");
  return {
    id,
    kind: "fingerprint",
    level: input.level,
    module: input.module,
    messageNormalized,
    label,
    addedAt: now,
  };
}

export function validateErrorLogIgnoreRuleInput(
  input: ErrorLogIgnoreRuleInput,
): ErrorLogIgnoreRule | null {
  try {
    const parsed = errorLogIgnoreRuleInputSchema.parse(input);
    if (parsed.kind === "identity") {
      if (!parsed.message.trim()) return null;
      return hydrateErrorLogIgnoreRule(parsed);
    }
    if (parsed.kind === "status_message") {
      if (!parsed.message.trim() || !Number.isFinite(parsed.status)) return null;
      return hydrateErrorLogIgnoreRule(parsed);
    }
    const hasNorm = Boolean(parsed.messageNormalized?.trim());
    const hasMsg = Boolean(parsed.message?.trim());
    if (!parsed.module.trim() || (!hasNorm && !hasMsg)) return null;
    return hydrateErrorLogIgnoreRule(parsed);
  } catch {
    return null;
  }
}

export function errorLogMatchesIgnoreRule(
  candidate: ErrorLogIgnoreCandidate,
  rule: ErrorLogIgnoreRule | ErrorLogIgnoreRuleInput,
): boolean {
  if (rule.kind === "identity") {
    if (candidate.message !== rule.message) return false;
    if (rule.level !== undefined && candidate.level !== rule.level) return false;
    if (rule.module !== undefined && candidate.module !== rule.module) return false;
    if (rule.errName !== undefined) {
      const cand = candidate.errName ?? null;
      if (cand !== rule.errName) return false;
    }
    return true;
  }
  if (rule.kind === "status_message") {
    if (candidate.message !== rule.message) return false;
    if (rule.level !== undefined && candidate.level !== rule.level) return false;
    if (rule.module !== undefined && candidate.module !== rule.module) return false;
    const status = contextStatus(candidate.context);
    if (status === undefined || status !== rule.status) return false;
    return true;
  }
  if (candidate.level !== rule.level || candidate.module !== rule.module) return false;
  const normalized =
    "messageNormalized" in rule && rule.messageNormalized
      ? rule.messageNormalized
      : normalizeErrorLogMessage(
          "message" in rule && typeof (rule as ErrorLogIgnoreRuleInput).message === "string"
            ? ((rule as ErrorLogIgnoreRuleInput & { message?: string }).message ?? "")
            : "",
        );
  return normalizeErrorLogMessage(candidate.message) === normalized;
}

export function errorLogMatchesAnyIgnoreRule(
  candidate: ErrorLogIgnoreCandidate,
  rules: Array<ErrorLogIgnoreRule | ErrorLogIgnoreRuleInput> | undefined | null,
): boolean {
  if (!rules?.length) return false;
  return rules.some((rule) => errorLogMatchesIgnoreRule(candidate, rule));
}

/**
 * Suggest the tightest default rule for a row (staff Ignore button).
 * Prefer identity with errName; else status_message; else identity without errName (message+level+module).
 */
export function suggestDefaultErrorLogIgnoreRule(
  candidate: ErrorLogIgnoreCandidate,
): ErrorLogIgnoreRuleInput {
  const status = contextStatus(candidate.context);
  if (candidate.errName) {
    return {
      kind: "identity",
      level: candidate.level,
      module: candidate.module,
      message: candidate.message,
      errName: candidate.errName,
      label: `${candidate.errName}: ${candidate.message}`.slice(0, 120),
    };
  }
  if (status !== undefined) {
    return {
      kind: "status_message",
      level: candidate.level,
      module: candidate.module,
      message: candidate.message,
      status,
      label: `${candidate.message} (status ${status})`.slice(0, 120),
    };
  }
  return {
    kind: "identity",
    level: candidate.level,
    module: candidate.module,
    message: candidate.message,
    label: `${candidate.level}|${candidate.module}|${candidate.message}`.slice(0, 120),
  };
}

export function suggestFingerprintErrorLogIgnoreRule(
  candidate: ErrorLogIgnoreCandidate,
): ErrorLogIgnoreRuleInput {
  return {
    kind: "fingerprint",
    level: candidate.level,
    module: candidate.module,
    messageNormalized: normalizeErrorLogMessage(candidate.message),
    label: `Fingerprint: ${candidate.level}|${errorLogFingerprint(candidate.module, candidate.message)}`.slice(
      0,
      120,
    ),
  };
}

export function formatErrorLogIgnoreRulePreview(
  rule: ErrorLogIgnoreRule | ErrorLogIgnoreRuleInput,
): string {
  if (rule.kind === "identity") {
    const parts = [
      rule.level,
      rule.module,
      rule.errName === undefined ? null : rule.errName === null ? "(no type)" : rule.errName,
      rule.message,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (rule.kind === "status_message") {
    return [
      rule.level,
      rule.module,
      `status ${rule.status}`,
      rule.message,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const normalized =
    "messageNormalized" in rule && rule.messageNormalized
      ? rule.messageNormalized
      : normalizeErrorLogMessage(
          "message" in rule && typeof rule.message === "string" ? rule.message : "",
        );
  return `fingerprint · ${rule.level}|${rule.module}|${normalized}`;
}

export { normalizeErrorLogMessage, errorLogFingerprint };
