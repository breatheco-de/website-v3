import { describe, expect, it } from "vitest";
import {
  assessSlugLocaleMatch,
  slugLocaleAckKey,
  slugLocaleMismatchHint,
  slugLocaleMismatchWarningMessage,
  SLUG_LOCALE_MISMATCH_CODE,
} from "./slug-locale-heuristic";

describe("assessSlugLocaleMatch", () => {
  it("flags English function words on Spanish locale", () => {
    const r = assessSlugLocaleMatch("how-to-learn-python", "es");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(SLUG_LOCALE_MISMATCH_CODE);
      expect(r.markers).toEqual(expect.arrayContaining(["how", "to"]));
      expect(r.expectedLocale).toBe("es");
      expect(r.inferredOpposite).toBe("en");
    }
  });

  it("flags Spanish function words on English locale", () => {
    const r = assessSlugLocaleMatch("como-aprender-python", "en");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.markers).toEqual(["como"]);
      expect(r.expectedLocale).toBe("en");
      expect(r.inferredOpposite).toBe("es");
    }
  });

  it("passes tech-only / brand tokens", () => {
    expect(assessSlugLocaleMatch("python-api", "es").ok).toBe(true);
    expect(assessSlugLocaleMatch("chatgpt-bootcamp", "es").ok).toBe(true);
    expect(assessSlugLocaleMatch("4geeks", "en").ok).toBe(true);
  });

  it("passes matching-locale function words", () => {
    expect(assessSlugLocaleMatch("como-aprender-python", "es").ok).toBe(true);
    expect(assessSlugLocaleMatch("how-to-learn-python", "en").ok).toBe(true);
  });

  it("flags single-token function words", () => {
    expect(assessSlugLocaleMatch("the", "es").ok).toBe(false);
    expect(assessSlugLocaleMatch("para", "en").ok).toBe(false);
    expect(assessSlugLocaleMatch("para", "es").ok).toBe(true);
  });

  it("returns ok for empty, unknown locale, and blank tokens", () => {
    expect(assessSlugLocaleMatch("", "es").ok).toBe(true);
    expect(assessSlugLocaleMatch("---", "en").ok).toBe(true);
    expect(assessSlugLocaleMatch("how-to", "fr").ok).toBe(true);
    expect(assessSlugLocaleMatch("how-to", "pt").ok).toBe(true);
  });

  it("dedupes markers and is case-insensitive", () => {
    const r = assessSlugLocaleMatch("How-To-How-Learn", "es");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.markers).toEqual(["how", "to"]);
    }
  });
});

describe("slugLocale helpers", () => {
  it("builds staff hint and agent message", () => {
    const r = assessSlugLocaleMatch("how-to", "es");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(slugLocaleMismatchHint(r)).toContain("English");
      expect(slugLocaleMismatchHint(r)).toContain("Spanish");
      expect(slugLocaleMismatchWarningMessage("how-to", r)).toContain("how-to");
      expect(slugLocaleMismatchWarningMessage("how-to", r)).toContain("markers:");
    }
  });

  it("ack key normalizes locale and slug", () => {
    expect(slugLocaleAckKey("ES", " How-To ")).toBe("es:how-to");
  });
});
