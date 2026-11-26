import {
  LEGACY_CONNECTION_TOKEN_OWNER,
  validateConnectionOwnerUsername,
} from "../../../shared/connection-token-owner.js";
import {
  legacyWeblifyLocalExists,
  readConnectionOwner,
  writeConnectionOwner,
} from "./connection-token.js";
import { askText, askYesNo, canPrompt } from "../prompts.js";

export interface ResolveOwnerOpts {
  projectRoot: string;
  /** From `--user` */
  userFlag?: string;
  /** Non-interactive defaults (--yes) still require --user when no owner file. */
  yes?: boolean;
}

/**
 * Resolve and persist `.local/connection-owner`.
 * Interactive: prompt (default current owner or offer legacy weblify-local).
 * Non-interactive: require --user when owner file missing.
 */
export async function resolveAndPersistConnectionOwner(
  opts: ResolveOwnerOpts,
): Promise<string> {
  const { projectRoot, userFlag, yes } = opts;
  const existing = readConnectionOwner(projectRoot);

  if (userFlag?.trim()) {
    const v = validateConnectionOwnerUsername(userFlag);
    if (!v.ok) throw new Error(v.error);
    writeConnectionOwner(projectRoot, v.username);
    return v.username;
  }

  if (!canPrompt()) {
    if (existing) return existing;
    throw new Error(
      "Connection-token owner username required. Pass --user <name> (or run interactively). See docs/local-connection-token.md",
    );
  }

  if (!existing && legacyWeblifyLocalExists(projectRoot)) {
    const reuse = await askYesNo(
      `Reuse existing local bootstrap user "${LEGACY_CONNECTION_TOKEN_OWNER}"?`,
      true,
    );
    if (reuse) {
      writeConnectionOwner(projectRoot, LEGACY_CONNECTION_TOKEN_OWNER);
      return LEGACY_CONNECTION_TOKEN_OWNER;
    }
  }

  const fallback = existing || undefined;
  let answer = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    answer = await askText(
      "Local staff username for this connection token? (local only — not production)",
      fallback,
    );
    const v = validateConnectionOwnerUsername(answer || fallback || "");
    if (v.ok) {
      writeConnectionOwner(projectRoot, v.username);
      return v.username;
    }
    console.error(`  ${v.error}`);
  }
  throw new Error("Could not set a valid connection-token owner username.");
}
