/**
 * Site-scoped staff markdown for validation issue codes.
 * Path: {contentRoot}/validation-issue-context/{validator}/{CODE}.md
 */

import fs from "fs";
import path from "path";
import { hasIssueCodeInRegistry } from "../scripts/validation/shared/issueCodeRegistry";

export const ISSUE_CONTEXT_DIR = "validation-issue-context";
export const ISSUE_CONTEXT_MAX_BYTES = 16 * 1024;

const VALIDATOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export type IssueContextRead = {
  exists: boolean;
  /** Relative path including content folder name when provided. */
  path: string;
  /** Relative path under contentRoot only. */
  relativePath: string;
  content: string;
};

export function assertIssueContextIdentity(validator: string, code: string): void {
  if (!VALIDATOR_RE.test(validator)) {
    throw Object.assign(new Error("Invalid validator name"), { status: 400, code: "invalid_validator" });
  }
  if (!CODE_RE.test(code)) {
    throw Object.assign(new Error("Invalid issue code"), { status: 400, code: "invalid_code" });
  }
  if (!hasIssueCodeInRegistry(validator, code)) {
    throw Object.assign(new Error(`No catalog entry for ${validator}/${code}`), {
      status: 404,
      code: "unknown_issue_code",
    });
  }
}

export function issueContextRelativePath(validator: string, code: string): string {
  assertIssueContextIdentity(validator, code);
  return path.posix.join(ISSUE_CONTEXT_DIR, validator, `${code}.md`);
}

export function issueContextAbsPath(contentRoot: string, validator: string, code: string): string {
  const rel = issueContextRelativePath(validator, code);
  const abs = path.resolve(contentRoot, rel);
  const rootAbs = path.resolve(contentRoot);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw Object.assign(new Error("Invalid path"), { status: 400, code: "path_traversal" });
  }
  return abs;
}

export function readIssueContext(
  contentRoot: string,
  validator: string,
  code: string,
  contentFolder?: string,
): IssueContextRead {
  const relativePath = issueContextRelativePath(validator, code);
  const abs = issueContextAbsPath(contentRoot, validator, code);
  const displayPath = contentFolder ? `${contentFolder}/${relativePath}` : relativePath;
  if (!fs.existsSync(abs)) {
    return { exists: false, path: displayPath, relativePath, content: "" };
  }
  const content = fs.readFileSync(abs, "utf-8");
  return { exists: true, path: displayPath, relativePath, content };
}

/** Trimmed non-empty staff context for agents, or undefined. */
export function readStaffContextForAgent(
  contentRoot: string,
  validator: string | undefined | null,
  code: string | undefined | null,
): string | undefined {
  if (!validator || !code) return undefined;
  if (!hasIssueCodeInRegistry(validator, code)) return undefined;
  try {
    const { content } = readIssueContext(contentRoot, validator, code);
    const trimmed = content.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export function writeIssueContext(
  contentRoot: string,
  validator: string,
  code: string,
  content: string,
  contentFolder?: string,
): IssueContextRead {
  if (typeof content !== "string") {
    throw Object.assign(new Error("content is required"), { status: 400, code: "content_required" });
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > ISSUE_CONTEXT_MAX_BYTES) {
    throw Object.assign(
      new Error(`Site notes exceed ${ISSUE_CONTEXT_MAX_BYTES} bytes (got ${bytes})`),
      { status: 400, code: "content_too_large" },
    );
  }
  const abs = issueContextAbsPath(contentRoot, validator, code);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return readIssueContext(contentRoot, validator, code, contentFolder);
}
