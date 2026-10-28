import { describe, expect, it } from "vitest";
import {
  brandTerms,
  buildEvidenceIndex,
  candidateNamesNearCues,
  findEvidenceRow,
  knownNamesInText,
  resolveEvidenceClaims,
  type EvidenceSource,
} from "./evidence-match";
import { THIRD_PARTY_CUE, hasThirdPartyCue } from "./claim-cues";
import type { DatabaseEvidenceConfig } from "@shared/evidence-kinds";

const cfg: DatabaseEvidenceConfig = {
  enabled: true,
  proves: ["press_coverage", "partnership"],
  proof_field: "link_url",
  match_fields: ["organization", "tags", "title"],
};

const ARTICLE = "https://example.com/bahamas-article";

function source(rows: Record<string, unknown>[], site = "site_parent", domain = "parent.com"): EvidenceSource {
  return { site, domain, database: "press_mentions", label: "Press Mentions", config: cfg, rows };
}

const brand = brandTerms(["4Geeks Academy", "4geeks"]);

const rows: Record<string, unknown>[] = [
  {
    locale: "en",
    title: "4Geeks, Harvard, Oxford, and Columbia chosen to deliver AI education by the Government of the Bahamas.",
    organization: "Government of the Bahamas",
    tags: ["Harvard", "Oxford", "Columbia", "4Geeks"],
    link_url: ARTICLE,
  },
  {
    locale: "en",
    title: "Selected by the Bahamas Government for National AI Education",
    organization: "Bahamas Upskilling Project",
    tags: ["The Bahamas"],
  },
  {
    locale: "en",
    title: "Exclusive partner for IDB workforce programs",
    organization: "IDB",
    tags: ["Costa Rica"],
    link_url: "https://example.com/idb",
    _changed_by: { type: "agent", author: "mcp", at: "2026-10-28T00:00:00Z" },
  },
];

describe("evidence cues", () => {
  it("detects relationship phrases in English and Spanish", () => {
    expect(hasThirdPartyCue("4Geeks chosen to deliver AI education alongside Harvard")).toBe(true);
    expect(hasThirdPartyCue("Elegidos por el Gobierno de las Bahamas junto a Oxford")).toBe(true);
    expect(hasThirdPartyCue("The government chose 4Geeks for the program")).toBe(true);
    expect(hasThirdPartyCue("Learn Python, the language Google uses")).toBe(false);
  });

  it("extracts capitalized names in cue sentences, dropping brand and stopwords", () => {
    const names = candidateNamesNearCues(
      "4Geeks chosen to deliver AI education in the Bahamas alongside Harvard, Oxford, and Columbia. Learn Python today.",
      THIRD_PARTY_CUE,
      brand,
    );
    expect(names).toEqual(expect.arrayContaining(["Bahamas", "Harvard", "Oxford", "Columbia"]));
    expect(names).not.toContain("4Geeks");
    expect(names).not.toContain("AI");
    expect(names).not.toContain("Python");
    expect(candidateNamesNearCues("Chosen alongside Harvard.", THIRD_PARTY_CUE, brand)).toEqual(["Harvard"]);
    expect(candidateNamesNearCues("Elegidos por el Gobierno de las Bahamas.", THIRD_PARTY_CUE, brand)).toEqual([
      "Gobierno de las Bahamas",
    ]);
  });
});

describe("evidence index and matching", () => {
  const index = buildEvidenceIndex([source(rows)], brand);

  it("never indexes the brand or short values", () => {
    expect(index.entries.some((e) => e.key === "4geeks")).toBe(false);
    expect(index.entries.some((e) => e.key === "idb")).toBe(false);
  });

  it("matches a name to its sourced row, preferring sourced over unsourced", () => {
    const hit = findEvidenceRow(index, "Harvard");
    expect(hit?.rowStatus).toBe("sourced");
    expect(hit?.ref.link).toBe(ARTICLE);
    expect(findEvidenceRow(index, "the Bahamas")?.rowStatus).toBe("sourced");
  });

  it("reports unsourced and unverified rows", () => {
    expect(findEvidenceRow(index, "Bahamas Upskilling Project")?.rowStatus).toBe("unsourced");
    expect(findEvidenceRow(index, "Costa Rica")?.rowStatus).toBe("unverified");
  });

  it("matches across locales and accents", () => {
    expect(findEvidenceRow(index, "Columbia")).not.toBeNull();
    expect(findEvidenceRow(index, "Góvernment of the Bahamas")?.rowStatus).toBe("sourced");
  });

  it("records the fallback site the row came from", () => {
    const hit = findEvidenceRow(index, "Oxford");
    expect(hit?.ref.site).toBe("site_parent");
    expect(hit?.ref.domain).toBe("parent.com");
  });

  it("finds known names in text", () => {
    expect(knownNamesInText(index, "Partnered with Oxford on AI")).toContain("oxford");
  });
});

describe("resolveEvidenceClaims", () => {
  const index = buildEvidenceIndex([source(rows)], brand);

  it("blocks only new names with no row and no dismissal", () => {
    const { claims, blocking } = resolveEvidenceClaims({
      names: ["Harvard", "MIT University", "Stanford University"],
      index,
      liveText: "",
      dismissals: [{ name: "Stanford University", reason: "example employer only", by: "staff", at: 1 }],
    });
    expect(claims.find((c) => c.name === "Harvard")?.status).toBe("sourced");
    expect(claims.find((c) => c.name === "MIT University")?.status).toBe("no_evidence");
    expect(claims.find((c) => c.name === "Stanford University")?.status).toBe("dismissed");
    expect(blocking).toEqual(["MIT University"]);
  });

  it("names already on the live page are warnings, never blocking", () => {
    const { claims, blocking } = resolveEvidenceClaims({
      names: ["MIT University"],
      index,
      liveText: "We already partner with MIT University.",
      dismissals: [],
    });
    expect(claims[0]?.status).toBe("already_live");
    expect(blocking).toEqual([]);
  });
});
