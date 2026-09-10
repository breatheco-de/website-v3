import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./LLMService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./LLMService")>();
  return {
    ...actual,
    getLLMService: vi.fn(),
  };
});

import { getLLMService } from "./LLMService";
import {
  buildGeneratePersonaUserPrompt,
  generatePersona,
  parseGeneratePersonaResult,
} from "./generatePersona";

describe("parseGeneratePersonaResult", () => {
  it("accepts a valid persona proposal", () => {
    const result = parseGeneratePersonaResult(
      JSON.stringify({
        status: "persona",
        persona: {
          id: "career-changer",
          label: "Career changer",
          role: "Career switcher into tech",
          avatar: {
            fears: ["Wasting money"],
            internal_dialogue: "Can I really switch careers at my age?",
            objections: ["Too expensive"],
          },
        },
      }),
    );
    expect(result.status).toBe("persona");
    if (result.status === "persona") {
      expect(result.persona.id).toBe("career-changer");
      expect(result.persona.avatar.fears).toEqual(["Wasting money"]);
    }
  });

  it("accepts status none with optional reason", () => {
    const result = parseGeneratePersonaResult(
      JSON.stringify({
        status: "none",
        reason: "Existing personas already cover who it is for.",
      }),
    );
    expect(result).toEqual({
      status: "none",
      reason: "Existing personas already cover who it is for.",
    });
  });

  it("strips markdown fences", () => {
    const result = parseGeneratePersonaResult(
      "```json\n{\"status\":\"none\",\"reason\":\"Enough coverage\"}\n```",
    );
    expect(result.status).toBe("none");
  });

  it("rejects persona missing fears", () => {
    expect(() =>
      parseGeneratePersonaResult(
        JSON.stringify({
          status: "persona",
          persona: {
            id: "x",
            role: "Buyer",
            avatar: {
              fears: [],
              internal_dialogue: "Hmm",
              objections: ["Cost"],
            },
          },
        }),
      ),
    ).toThrow(/invalid persona proposal/i);
  });

  it("rejects empty content", () => {
    expect(() => parseGeneratePersonaResult("   ")).toThrow(/empty persona proposal/i);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGeneratePersonaResult("{not-json")).toThrow(/invalid JSON/i);
  });
});

describe("buildGeneratePersonaUserPrompt", () => {
  it("includes offer and existing personas", () => {
    const prompt = buildGeneratePersonaUserPrompt({
      slug: "full-stack",
      offer: {
        one_liner: "Learn to code",
        who_its_for: "Career changers",
        who_its_not_for: "Experienced seniors",
      },
      existingPersonas: [
        {
          id: "career-changer",
          role: "Career switcher",
          label: "Switcher",
          avatar: {
            fears: ["Debt"],
            internal_dialogue: "Will this work?",
            objections: ["Time"],
          },
        },
      ],
    });
    expect(prompt).toContain("full-stack");
    expect(prompt).toContain("Learn to code");
    expect(prompt).toContain("Career changers");
    expect(prompt).toContain("Experienced seniors");
    expect(prompt).toContain("id=career-changer");
    expect(prompt).toContain("fears: Debt");
  });

  it("notes when no personas exist", () => {
    const prompt = buildGeneratePersonaUserPrompt({
      offer: { one_liner: "Offer", who_its_for: "Buyers" },
      existingPersonas: [],
    });
    expect(prompt).toContain("Existing personas (0)");
    expect(prompt).toContain("(none");
  });
});

describe("generatePersona", () => {
  const completeMock = vi.fn();

  beforeEach(() => {
    completeMock.mockReset();
    vi.mocked(getLLMService).mockReturnValue({
      complete: completeMock,
    } as unknown as ReturnType<typeof getLLMService>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed persona from LLM", async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({
        status: "persona",
        persona: {
          id: "founder",
          role: "Startup founder",
          avatar: {
            fears: ["Hiring the wrong people"],
            internal_dialogue: "I need builders who ship.",
            objections: ["Bootcamp grads are junior"],
          },
        },
      }),
    );

    const result = await generatePersona({
      slug: "full-stack",
      offer: { one_liner: "Hire-ready juniors", who_its_for: "Founders and HR" },
      existingPersonas: [],
    });

    expect(result.status).toBe("persona");
    expect(completeMock).toHaveBeenCalledOnce();
  });

  it("returns none when LLM says coverage is enough", async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({ status: "none", reason: "Already covered." }),
    );

    const result = await generatePersona({
      offer: { one_liner: "Learn to code", who_its_for: "Career changers" },
      existingPersonas: [{ id: "career-changer", role: "Career switcher" }],
    });

    expect(result).toEqual({ status: "none", reason: "Already covered." });
  });

  it("rejects duplicate persona ids against existing", async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({
        status: "persona",
        persona: {
          id: "career-changer",
          role: "Another switcher",
          avatar: {
            fears: ["Failing"],
            internal_dialogue: "Same as before",
            objections: ["Cost"],
          },
        },
      }),
    );

    await expect(
      generatePersona({
        offer: { one_liner: "Learn to code", who_its_for: "Career changers" },
        existingPersonas: [{ id: "career-changer", role: "Career switcher" }],
      }),
    ).rejects.toThrow(/duplicate persona id/i);
  });

  it("throws when offer is incomplete", async () => {
    await expect(
      generatePersona({
        offer: { one_liner: "", who_its_for: "Buyers" },
        existingPersonas: [],
      }),
    ).rejects.toThrow(/one_liner/);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("retries with fallback model after empty LLM response", async () => {
    completeMock
      .mockRejectedValueOnce(new Error("Empty response from LLM (finish_reason=length)"))
      .mockResolvedValueOnce(JSON.stringify({ status: "none", reason: "Enough." }));

    const result = await generatePersona({
      offer: { one_liner: "Offer", who_its_for: "Buyers" },
      existingPersonas: [],
    });

    expect(result.status).toBe("none");
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[1][1]).toMatchObject({
      model: "openai/gpt-4o-mini",
    });
  });
});
