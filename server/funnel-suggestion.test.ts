import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
}));

vi.mock("./content-types", () => ({
  getFolder: (ct: string) => ct,
}));

vi.mock("./site-config", () => ({
  getDefaultContentRoot: () => "site_test",
}));

import {
  deleteFunnelSuggestion,
  isFunnelSuggestionStale,
  parseFunnelSuggestionDoc,
  readFunnelSuggestion,
  writeFunnelSuggestion,
} from "./funnel-suggestion";

describe("funnel-suggestion", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-sug-"));
    fs.mkdirSync(path.join(tmp, "blog", "hello"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips write/read/delete", () => {
    const doc = {
      stage: "awareness" as const,
      products: [{ product: "ai-engineering", persona: "the-career-changer" }],
      confidence: {
        stage: 0.9,
        bindings: [{ product: "ai-engineering", persona: "the-career-changer", score: 0.8 }],
      },
      model: "jev-test",
      decision_id: "funnel.classify",
      based_on_funnel: {},
      created_at: "2026-11-19T00:00:00.000Z",
      created_by: "staff@test.com",
    };
    writeFunnelSuggestion("blog", "hello", doc, tmp, "staff@test.com");
    const read = readFunnelSuggestion("blog", "hello", tmp);
    expect(read).toMatchObject({
      stage: "awareness",
      products: [{ product: "ai-engineering", persona: "the-career-changer" }],
      model: "jev-test",
    });
    expect(deleteFunnelSuggestion("blog", "hello", tmp, "staff@test.com").deleted).toBe(true);
    expect(readFunnelSuggestion("blog", "hello", tmp)).toBeNull();
  });

  it("detects stale when live funnel moved", () => {
    const doc = parseFunnelSuggestionDoc({
      stage: "awareness",
      products: [{ product: "ai-engineering" }],
      confidence: { stage: 0.5, bindings: [] },
      model: "m",
      decision_id: "funnel.classify",
      based_on_funnel: {},
      created_at: "2026-11-19T00:00:00.000Z",
      created_by: "x",
    });
    expect(doc).not.toBeNull();
    expect(isFunnelSuggestionStale(doc!, { stage: "decision", products: "all" })).toBe(true);
    expect(isFunnelSuggestionStale(doc!, {})).toBe(false);
  });
});
