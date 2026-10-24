/**
 * Plain-English staff version of a proposal blocker. The technical `body` stays for the agent that
 * fixes the draft; `staff_summary` is what staff read first in the review drawer.
 */

export const STAFF_SUMMARY_MIN = 40;
export const STAFF_SUMMARY_MAX = 700;

export const BLOCKER_STAFF_SUMMARY_HINT =
  `Plain English, ${STAFF_SUMMARY_MIN}-${STAFF_SUMMARY_MAX} chars, 1-4 sentences, for a staff member who has not read the code: ` +
  "what a visitor or Google would see change, what must happen before approving, and who does it (staff or the author). " +
  "No field names, file names, warning codes, snake_case/camelCase/dotted names, or backticks. " +
  "Banned words: op, ops, payload, schema, slug, locale, YAML, JSON, MCP. Say 'language' instead of locale and 'page address' instead of slug. " +
  "Page addresses starting with / are fine. Rejected with blocker_staff_summary_not_plain + problems[] when it reads like code.";

const BANNED_WORDS = [
  "op",
  "ops",
  "payload",
  "payloads",
  "schema",
  "schemas",
  "slug",
  "slugs",
  "locale",
  "locales",
  "yaml",
  "yml",
  "json",
  "mcp",
  "frontmatter",
];

const CAMEL_CASE_ALLOW = new Set(["iphone", "ipad", "ios", "macos", "ebay", "youtube", "linkedin"]);

const DOMAIN_TLDS = new Set(["com", "org", "net", "io", "ai", "co", "es", "dev", "app", "edu", "us", "uk"]);

const FILE_EXT_RE = /\b[\w-]*\.(?:ya?ml|json|tsx?|jsx?|mdx?|csv|html?)\b/gi;
const SNAKE_RE = /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi;
const CAMEL_RE = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const DOTTED_RE = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/g;

/** Page addresses and full URLs are allowed, so strip them before looking for code-style names. */
function stripAddresses(text: string): string {
  return text.replace(/https?:\/\/\S+/g, " ").replace(/(^|[\s("'])\/[^\s)"']*/g, "$1 ");
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export type StaffSummaryCheck = { ok: boolean; problems: string[] };

export function checkStaffSummary(raw: string): StaffSummaryCheck {
  const text = (raw ?? "").trim();
  const problems: string[] = [];

  if (text.length < STAFF_SUMMARY_MIN) {
    problems.push(`too short: ${text.length} characters (min ${STAFF_SUMMARY_MIN})`);
  } else if (text.length > STAFF_SUMMARY_MAX) {
    problems.push(`too long: ${text.length} characters (max ${STAFF_SUMMARY_MAX}); keep it to 1-4 sentences`);
  }
  if (text.includes("`")) problems.push("backticks are not allowed; write the idea in words");

  const scan = stripAddresses(text);

  const files = unique(scan.match(FILE_EXT_RE) ?? []);
  if (files.length) problems.push(`file names: ${files.map((f) => `"${f}"`).join(", ")}`);
  const fileSet = new Set(files.map((f) => f.toLowerCase()));

  const snake = unique(scan.match(SNAKE_RE) ?? []).filter((t) => !/^\d+(?:_\d+)*$/.test(t));
  if (snake.length) problems.push(`code-style names: ${snake.map((t) => `"${t}"`).join(", ")}`);

  const camel = unique(scan.match(CAMEL_RE) ?? []).filter((t) => !CAMEL_CASE_ALLOW.has(t.toLowerCase()));
  if (camel.length) problems.push(`code-style names: ${camel.map((t) => `"${t}"`).join(", ")}`);

  const dotted = unique(scan.match(DOTTED_RE) ?? []).filter((t) => {
    const lower = t.toLowerCase();
    if (lower === "e.g" || lower === "i.e") return false;
    if ([...fileSet].some((f) => f.endsWith(lower))) return false;
    const last = lower.split(".").pop() ?? "";
    return !DOMAIN_TLDS.has(last);
  });
  if (dotted.length) problems.push(`field paths: ${dotted.map((t) => `"${t}"`).join(", ")}`);

  const banned = unique(
    BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(scan)),
  );
  if (banned.length) problems.push(`technical words: ${banned.map((w) => `"${w}"`).join(", ")}`);

  return { ok: problems.length === 0, problems };
}
