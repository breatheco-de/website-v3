/**
 * Result of the deploy's page render check (scripts/prebuild-html-cache.ts), kept in
 * data/render-gate.json. data/ is linked from persistent storage, so the release that
 * is live (the previous one when the check stops a deploy) reads what the deploy wrote.
 */
import fs from "fs";
import path from "path";
import { getProjectRoot } from "@shared/paths";

export type RenderGateState = {
  result: "passed" | "failed" | "skipped_by_override";
  deploy_sha: string | null;
  run_url: string | null;
  checked_at: string;
  counts: Record<string, { total: number; empty: number }>;
  failing: Array<{ type: string; total: number; empty: number; share: number }>;
  empty_paths: string[];
};

let dataDirOverride: string | null = null;

/** Tests: point the state file at a temp dir. */
export function setRenderGateDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
}

export function renderGateStatePath(): string {
  return path.join(dataDirOverride ?? path.join(getProjectRoot(), "data"), "render-gate.json");
}

export function writeRenderGateState(state: RenderGateState): void {
  try {
    const file = renderGateStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("[render-gate] could not write state", err);
  }
}

export function readRenderGateState(): RenderGateState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(renderGateStatePath(), "utf-8")) as RenderGateState;
    return parsed && typeof parsed.result === "string" ? parsed : null;
  } catch {
    return null;
  }
}
