import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetSettings } from "./settings";
import { getGscBigQueryConfigStatus } from "./gsc-bigquery-client";

describe("getGscBigQueryConfigStatus", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-bq-"));
    resetSettings(tmp);
  });

  afterEach(() => {
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports not configured when disabled", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    resetSettings(tmp);
    const status = getGscBigQueryConfigStatus(tmp);
    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.warnings.some((w) => /disabled/i.test(w))).toBe(true);
  });

  it("reports configured when enabled with project and dataset", () => {
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      `search_console:
  bigquery:
    enabled: true
    project_id: my-proj
    dataset_id: searchconsole
`,
      "utf-8",
    );
    resetSettings(tmp);
    const status = getGscBigQueryConfigStatus(tmp);
    expect(status.configured).toBe(true);
    expect(status.settings.project_id).toBe("my-proj");
  });
});
