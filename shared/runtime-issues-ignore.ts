import { z } from "zod";
import { normalizeRuntimePath } from "./runtime-issues";

const ignoreRuleBase = {
  id: z.string(),
  label: z.string().optional(),
  addedAt: z.number(),
};

export const ignoreRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("exact"),
    path: z.string(),
  }),
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("locales"),
    locales: z.array(z.string()).min(1),
    rest: z.string(),
  }),
  z.object({
    ...ignoreRuleBase,
    kind: z.literal("slug_list"),
    locales: z.array(z.string()).optional(),
    parent: z.string(),
    slugs: z.array(z.string()).min(1),
  }),
]);

export type IgnoreRule = z.infer<typeof ignoreRuleSchema>;

export const ignoreRuleInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exact"),
    path: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("locales"),
    locales: z.array(z.string()).min(1),
    rest: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("slug_list"),
    locales: z.array(z.string()).optional(),
    parent: z.string(),
    slugs: z.array(z.string()).min(1),
    label: z.string().optional(),
  }),
]);

export type IgnoreRuleInput = z.infer<typeof ignoreRuleInputSchema>;

export const ignoreStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  rules: z.array(ignoreRuleSchema),
});

export type IgnoreState = z.infer<typeof ignoreStateSchema>;

export function emptyIgnoreState(): IgnoreState {
  return { version: 1, updatedAt: Date.now(), rules: [] };
}

/** Seeded once per site when no matching rule exists (junk paths from client bugs). */
export const BUILTIN_IGNORE_RULE_INPUTS: IgnoreRuleInput[] = [
  {
    kind: "slug_list",
    parent: "/en/career-programs",
    slugs: ["null", "inline", "undefined"],
    label: "Junk program slugs (null/inline)",
  },
  {
    kind: "slug_list",
    parent: "/es/programas-de-carrera",
    slugs: ["null", "inline", "undefined"],
    label: "Junk program slugs (null/inline)",
  },
  {
    kind: "exact",
    path: "/en/null",
    label: "Junk locale path (null)",
  },
  {
    kind: "exact",
    path: "/es/null",
    label: "Junk locale path (null)",
  },
  {
    kind: "exact",
    path: "/es/inline",
    label: "Junk locale path (inline)",
  },
  {
    kind: "exact",
    path: "/landing/inline",
    label: "Junk landing path (inline layout variant)",
  },
];

export function newIgnoreRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ign_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Locale prefix plus a non-empty remainder (`/us/page` → `{ locale: "us", rest: "/page" }`). */
export function splitLocalePrefix(path: string): { locale: string; rest: string } | null {
  const p = normalizeRuntimePath(path);
  const m = p.match(/^\/([a-z]{2})(\/.+)$/i);
  if (!m?.[1] || !m[2]) return null;
  return { locale: m[1].toLowerCase(), rest: m[2] };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))).sort();
}

function normalizeParent(parent: string): string {
  const n = normalizeRuntimePath(parent);
  return n === "/" ? "/" : n;
}

export function ignoreRuleIdentity(rule: IgnoreRuleInput | IgnoreRule): string {
  if (rule.kind === "exact") return `exact:${normalizeRuntimePath(rule.path)}`;
  if (rule.kind === "locales") {
    return `locales:${uniqueSorted(rule.locales).join(",")}:${normalizeRuntimePath(rule.rest)}`;
  }
  const locales = uniqueSorted(rule.locales ?? []);
  const slugs = uniqueSorted(rule.slugs);
  return `slug_list:${locales.join(",")}:${normalizeParent(rule.parent)}:${slugs.join(",")}`;
}

export function hydrateIgnoreRule(input: IgnoreRuleInput, now = Date.now()): IgnoreRule {
  const label = input.label?.trim() || undefined;
  if (input.kind === "exact") {
    return {
      id: newIgnoreRuleId(),
      kind: "exact",
      path: normalizeRuntimePath(input.path),
      label,
      addedAt: now,
    };
  }
  if (input.kind === "locales") {
    return {
      id: newIgnoreRuleId(),
      kind: "locales",
      locales: uniqueSorted(input.locales),
      rest: normalizeRuntimePath(input.rest).startsWith("/")
        ? normalizeRuntimePath(input.rest)
        : `/${normalizeRuntimePath(input.rest).replace(/^\//, "")}`,
      label,
      addedAt: now,
    };
  }
  return {
    id: newIgnoreRuleId(),
    kind: "slug_list",
    locales: input.locales?.length ? uniqueSorted(input.locales) : undefined,
    parent: normalizeParent(input.parent),
    slugs: uniqueSorted(input.slugs),
    label,
    addedAt: now,
  };
}

export function validateIgnoreRuleInput(input: IgnoreRuleInput): IgnoreRule | null {
  try {
    const parsed = ignoreRuleInputSchema.parse(input);
    if (parsed.kind === "exact") {
      const path = normalizeRuntimePath(parsed.path);
      if (!path || path === "/") return null;
      return hydrateIgnoreRule({ ...parsed, path });
    }
    if (parsed.kind === "locales") {
      const locales = uniqueSorted(parsed.locales);
      const rest = parsed.rest.startsWith("/")
        ? normalizeRuntimePath(parsed.rest)
        : normalizeRuntimePath(`/${parsed.rest}`);
      if (!locales.length || !rest.startsWith("/") || rest === "/") return null;
      if (!splitLocalePrefix(`/xx${rest}`)) return null;
      return hydrateIgnoreRule({ ...parsed, locales, rest });
    }
    const slugs = uniqueSorted(parsed.slugs);
    const parent = normalizeParent(parsed.parent);
    if (!slugs.length || parent === "/") return null;
    const locales = parsed.locales?.length ? uniqueSorted(parsed.locales) : undefined;
    return hydrateIgnoreRule({ ...parsed, slugs, parent, locales });
  } catch {
    return null;
  }
}

export function pathMatchesIgnoreRule(path: string, rule: IgnoreRule | IgnoreRuleInput): boolean {
  const normalized = normalizeRuntimePath(path);
  if (rule.kind === "exact") {
    return normalized === normalizeRuntimePath(rule.path);
  }
  if (rule.kind === "locales") {
    const split = splitLocalePrefix(normalized);
    if (!split) return false;
    const rest = normalizeRuntimePath(rule.rest);
    return rule.locales.map((l) => l.toLowerCase()).includes(split.locale) && split.rest === rest;
  }
  let working = normalized;
  if (rule.locales?.length) {
    const split = splitLocalePrefix(normalized);
    if (!split || !rule.locales.map((l) => l.toLowerCase()).includes(split.locale)) return false;
    working = split.rest;
  }
  const segs = working.split("/").filter(Boolean);
  if (segs.length < 2) return false;
  const slug = segs[segs.length - 1]?.toLowerCase() ?? "";
  const parent = `/${segs.slice(0, -1).join("/")}`;
  const slugs = new Set(rule.slugs.map((s) => s.toLowerCase()));
  return parent === normalizeParent(rule.parent) && slugs.has(slug);
}

export function pathMatchesAnyIgnoreRule(
  path: string,
  rules: Array<IgnoreRule | IgnoreRuleInput> | undefined | null,
): boolean {
  if (!rules?.length) return false;
  return rules.some((rule) => pathMatchesIgnoreRule(path, rule));
}

export function previewIgnoreRule(
  rule: IgnoreRule | IgnoreRuleInput,
  allPaths: string[],
): { matchCount: number; samplePaths: string[] } {
  const matches = allPaths.filter((p) => pathMatchesIgnoreRule(p, rule));
  const unique = Array.from(new Set(matches.map(normalizeRuntimePath)));
  return { matchCount: unique.length, samplePaths: unique.slice(0, 8) };
}

export function previewIgnoreRules(
  rules: Array<IgnoreRule | IgnoreRuleInput>,
  allPaths: string[],
): { matchCount: number; samplePaths: string[] } {
  const unique = Array.from(
    new Set(allPaths.map(normalizeRuntimePath).filter((p) => pathMatchesAnyIgnoreRule(p, rules))),
  );
  return { matchCount: unique.length, samplePaths: unique.slice(0, 8) };
}

export function formatIgnoreRulePreview(rule: IgnoreRule | IgnoreRuleInput): string {
  if (rule.kind === "exact") return normalizeRuntimePath(rule.path);
  if (rule.kind === "locales") {
    const locales = uniqueSorted(rule.locales).join(",");
    const rest = rule.rest.startsWith("/") ? rule.rest : `/${rule.rest}`;
    return `/{${locales}}${rest}`;
  }
  const slugs = uniqueSorted(rule.slugs).join(",");
  const parent = normalizeParent(rule.parent);
  if (rule.locales?.length) {
    return `/{${uniqueSorted(rule.locales).join(",")}}${parent}/{${slugs}}`;
  }
  return `${parent}/{${slugs}}`;
}
