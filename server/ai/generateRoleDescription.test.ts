import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import type { RoleDefinition } from "../user-store";

vi.mock("./LLMService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./LLMService")>();
  return {
    ...actual,
    getLLMService: vi.fn(),
  };
});

vi.mock("../user-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../user-store")>();
  return {
    ...actual,
    getAllRoles: vi.fn(),
  };
});

import { getLLMService } from "./LLMService";
import * as userStore from "../user-store";
import {
  generateRoleDescription,
  formatToolSummary,
  selectTopPeers,
  toolOverlap,
} from "./generateRoleDescription";

const SEO_CAPS = [{ name: "seo_edit" as const, contentTypes: "*" as const }];
const VIEW_CAPS = [{ name: "content_view" as const, contentTypes: "*" as const }];
const SEO_TOOLS = allowedToolNames(SEO_CAPS);
const VIEW_TOOLS = allowedToolNames(VIEW_CAPS);

describe("toolOverlap", () => {
  it("counts shared tools", () => {
    expect(toolOverlap(SEO_TOOLS, VIEW_TOOLS)).toBeGreaterThan(0);
    expect(toolOverlap(["a", "b"], ["c", "d"])).toBe(0);
    expect(toolOverlap(["a", "b"], ["a", "c"])).toBe(1);
  });
});

describe("formatToolSummary", () => {
  it("truncates long tool lists", () => {
    const tools = Array.from({ length: 20 }, (_, i) => `tool_${i}`);
    const summary = formatToolSummary(tools, 5);
    expect(summary).toContain("tool_0");
    expect(summary).toContain("+15 more");
    expect(summary).not.toContain("tool_19");
  });
});

describe("selectTopPeers", () => {
  const allRoles: Record<string, RoleDefinition> = {
    seo_manager: {
      label: "SEO Manager",
      description: "SEO only",
      capabilities: SEO_CAPS,
    },
    content_viewer: {
      label: "Content Viewer",
      description: "Read only",
      capabilities: VIEW_CAPS,
    },
    metrics_viewer: {
      label: "Metrics Viewer",
      description: "Metrics only",
      capabilities: [{ name: "metrics_view" }],
    },
  };

  it("excludes the role being edited", () => {
    const peers = selectTopPeers(SEO_TOOLS, allRoles, "seo_manager");
    expect(peers.some((p) => p.id === "seo_manager")).toBe(false);
  });

  it("ranks peers by tool overlap descending", () => {
    const peers = selectTopPeers(SEO_TOOLS, allRoles, undefined, 3);
    expect(peers.length).toBeGreaterThan(0);
    for (let i = 1; i < peers.length; i++) {
      expect(peers[i - 1].overlap).toBeGreaterThanOrEqual(peers[i].overlap);
    }
    expect(peers[0].id).toBe("seo_manager");
  });
});

describe("generateRoleDescription", () => {
  const completeMock = vi.fn();

  beforeEach(() => {
    completeMock.mockReset();
    vi.mocked(getLLMService).mockReturnValue({
      complete: completeMock,
    } as unknown as ReturnType<typeof getLLMService>);
    vi.mocked(userStore.getAllRoles).mockReturnValue({
      content_viewer: {
        label: "Content Viewer",
        description: "Read only",
        capabilities: VIEW_CAPS,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed description from LLM", async () => {
    completeMock.mockResolvedValueOnce(
      " SEO-focused connector for meta and redirects. Not for page structure edits. ",
    );

    const result = await generateRoleDescription({
      id: "seo_manager",
      label: "SEO Manager",
      capabilities: SEO_CAPS,
    });

    expect(result.description).toBe(
      "SEO-focused connector for meta and redirects. Not for page structure edits.",
    );
    expect(completeMock).toHaveBeenCalledOnce();
    const userPrompt = completeMock.mock.calls[0][0] as string;
    expect(userPrompt).toContain("seo_manager");
    expect(userPrompt).not.toContain("content_viewer (for contrast");
  });

  it("throws when LLM returns empty text", async () => {
    completeMock.mockResolvedValueOnce("   ");

    await expect(
      generateRoleDescription({
        label: "SEO Manager",
        capabilities: SEO_CAPS,
      }),
    ).rejects.toThrow("AI returned an empty description");
  });

  it("retries with fallback model after empty LLM response", async () => {
    completeMock
      .mockRejectedValueOnce(new Error("Empty response from LLM (finish_reason=length)"))
      .mockResolvedValueOnce("Fallback model description for SEO role.");

    const result = await generateRoleDescription({
      label: "SEO Manager",
      capabilities: SEO_CAPS,
    });

    expect(result.description).toBe("Fallback model description for SEO role.");
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[1][1]).toMatchObject({
      model: "openai/gpt-4o-mini",
      maxTokens: 2048,
    });
  });
});
