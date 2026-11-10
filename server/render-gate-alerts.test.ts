import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRenderGateAlerts } from "./system-alerts";
import {
  readRenderGateState,
  setRenderGateDataDirForTests,
  writeRenderGateState,
  type RenderGateState,
} from "./render-gate-state";

function state(result: RenderGateState["result"], failing: RenderGateState["failing"] = []): RenderGateState {
  return {
    result,
    deploy_sha: "abcdef1234567890",
    run_url: "https://github.com/org/repo/actions/runs/1",
    checked_at: "2026-11-10T00:00:00.000Z",
    counts: { landing: { total: 115, empty: failing.length ? 115 : 0 } },
    failing,
    empty_paths: failing.length ? ["/landing/a", "/landing/b"] : [],
  };
}

const LANDINGS_EMPTY = [{ type: "landing", total: 115, empty: 115, share: 1 }];

afterEach(() => setRenderGateDataDirForTests(null));

describe("collectRenderGateAlerts", () => {
  it("raises a critical alert when the check stopped a deploy", async () => {
    const [alert] = await collectRenderGateAlerts(state("failed", LANDINGS_EMPTY));
    expect(alert).toMatchObject({ severity: "critical", code: "render_gate_failed", title: "Deploy stopped before going live" });
    expect(alert!.message).toContain("100% of landing pages (115/115) rendered empty. The live site is unchanged.");
    expect(alert!.message).toContain("/landing/a");
    expect(alert!.message).toContain("abcdef1");
  });

  it("raises a warning when the deploy went live with the check overridden", async () => {
    const [alert] = await collectRenderGateAlerts(state("skipped_by_override", LANDINGS_EMPTY));
    expect(alert).toMatchObject({ severity: "warning", code: "render_gate_skipped" });
  });

  it("raises nothing when the check passed or no file exists", async () => {
    expect(await collectRenderGateAlerts(state("passed"))).toEqual([]);
    expect(await collectRenderGateAlerts(null)).toEqual([]);
  });

  it("reads the file the deploy wrote, and a later pass clears the alert", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-gate-"));
    setRenderGateDataDirForTests(dir);
    expect(readRenderGateState()).toBeNull();
    writeRenderGateState(state("failed", LANDINGS_EMPTY));
    expect(await collectRenderGateAlerts()).toHaveLength(1);
    writeRenderGateState(state("passed"));
    expect(await collectRenderGateAlerts()).toEqual([]);
    fs.writeFileSync(path.join(dir, "render-gate.json"), "{not json");
    expect(await collectRenderGateAlerts()).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
