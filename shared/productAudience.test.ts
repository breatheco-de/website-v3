import { describe, expect, it } from "vitest";
import {
  audienceStatus,
  isMinimalProductAudience,
  parseProductAudience,
} from "./productAudience";

const minimalPersona = {
  id: "career-changer",
  role: "Career changer",
  avatar: {
    fears: ["Wasting money"],
    internal_dialogue: "Can I really switch careers?",
    objections: ["Too expensive"],
  },
};

const minimalOffer = {
  one_liner: "Learn to code with mentors",
  who_its_for: "People switching into tech",
};

describe("parseProductAudience", () => {
  it("parses offer and personas", () => {
    const a = parseProductAudience({
      offer: minimalOffer,
      personas: [minimalPersona],
    });
    expect(a?.offer.one_liner).toBe(minimalOffer.one_liner);
    expect(a?.personas[0]?.id).toBe("career-changer");
    expect(a?.personas[0]?.avatar.fears).toEqual(["Wasting money"]);
  });

  it("returns null for empty", () => {
    expect(parseProductAudience({})).toBeNull();
    expect(parseProductAudience(null)).toBeNull();
  });
});

describe("isMinimalProductAudience", () => {
  it("requires offer fields and one minimal persona", () => {
    expect(isMinimalProductAudience({ offer: minimalOffer, personas: [minimalPersona] })).toBe(
      true,
    );
    expect(
      isMinimalProductAudience({
        offer: { one_liner: "x", who_its_for: "" },
        personas: [minimalPersona],
      }),
    ).toBe(false);
    expect(
      isMinimalProductAudience({
        offer: minimalOffer,
        personas: [{ ...minimalPersona, avatar: { ...minimalPersona.avatar, fears: [] } }],
      }),
    ).toBe(false);
  });
});

describe("audienceStatus", () => {
  it("returns missing / minimal / complete", () => {
    expect(audienceStatus(null)).toBe("missing");
    expect(audienceStatus({ offer: minimalOffer, personas: [minimalPersona] })).toBe("minimal");
    expect(
      audienceStatus({
        offer: { ...minimalOffer, who_its_not_for: "Kids" },
        personas: [
          {
            ...minimalPersona,
            industry_or_context: "Any",
            avatar: {
              ...minimalPersona.avatar,
              aspirational_identity: "A confident developer",
            },
          },
        ],
      }),
    ).toBe("complete");
  });
});
