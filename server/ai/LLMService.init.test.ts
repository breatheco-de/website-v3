import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OpenAICtor = vi.fn().mockImplementation(function OpenAIMock(this: {
  opts: unknown;
}, opts: unknown) {
  this.opts = opts;
});

vi.mock("openai", () => ({
  default: OpenAICtor,
}));

describe("LLMService init options", () => {
  const prevKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    OpenAICtor.mockClear();
  });

  afterEach(async () => {
    const { reloadLLMConfig } = await import("./LLMService");
    reloadLLMConfig();
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
  });

  it("does not pass dangerouslyAllowBrowser by default", async () => {
    const { getLLMService, reloadLLMConfig } = await import("./LLMService");
    reloadLLMConfig();
    getLLMService();
    expect(OpenAICtor).toHaveBeenCalledTimes(1);
    expect(OpenAICtor.mock.calls[0][0]).not.toHaveProperty("dangerouslyAllowBrowser");
  });

  it("passes dangerouslyAllowBrowser when requested", async () => {
    const { getLLMService, reloadLLMConfig } = await import("./LLMService");
    reloadLLMConfig();
    getLLMService({ dangerouslyAllowBrowser: true });
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({ dangerouslyAllowBrowser: true, apiKey: "test-key" }),
    );
  });

  it("upgrades an existing singleton when browser allow is requested later", async () => {
    const { getLLMService, reloadLLMConfig } = await import("./LLMService");
    reloadLLMConfig();
    getLLMService();
    expect(OpenAICtor).toHaveBeenCalledTimes(1);
    expect(OpenAICtor.mock.calls[0][0]).not.toHaveProperty("dangerouslyAllowBrowser");

    getLLMService({ dangerouslyAllowBrowser: true });
    expect(OpenAICtor).toHaveBeenCalledTimes(2);
    expect(OpenAICtor.mock.calls[1][0]).toEqual(
      expect.objectContaining({ dangerouslyAllowBrowser: true }),
    );
  });
});
