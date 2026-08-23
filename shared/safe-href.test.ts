import { describe, expect, it } from "vitest";
import {
  buildCareerProgramPath,
  coerceProgramSlug,
  isCssLikeHref,
  isJunkRuntimeNotFoundPath,
  isNonNavigableHref,
  isReservedContentSlug,
} from "./safe-href";

describe("safe-href", () => {
  it("detects CSS-like hrefs", () => {
    expect(isCssLikeHref("linear-gradient(to bottom, red, blue)")).toBe(true);
    expect(isCssLikeHref("hsl(210 100% 50% / 0.05)")).toBe(true);
    expect(isCssLikeHref("/en/career-programs/full-stack")).toBe(false);
  });

  it("flags reserved slugs", () => {
    expect(isReservedContentSlug("inline")).toBe(true);
    expect(isReservedContentSlug("null")).toBe(true);
    expect(isReservedContentSlug("full-stack")).toBe(false);
  });

  it("blocks non-navigable hrefs", () => {
    expect(isNonNavigableHref("inline")).toBe(true);
    expect(isNonNavigableHref("linear-gradient(red, blue)")).toBe(true);
    expect(isNonNavigableHref("/en/home")).toBe(false);
  });

  it("coerces program slug with content fallback", () => {
    expect(coerceProgramSlug(null, "ai-engineering")).toBe("ai-engineering");
    expect(coerceProgramSlug("inline", "ai-engineering")).toBe("ai-engineering");
    expect(coerceProgramSlug("null", undefined)).toBeNull();
  });

  it("builds career program paths", () => {
    expect(buildCareerProgramPath("en", "full-stack")).toBe("/en/career-programs/full-stack");
    expect(buildCareerProgramPath("es", "full-stack")).toBe("/es/programas-de-carrera/full-stack");
    expect(buildCareerProgramPath("en", "inline")).toBeNull();
  });

  it("detects junk runtime 404 paths", () => {
    expect(
      isJunkRuntimeNotFoundPath(
        "/en/location/linear-gradient(rgba(0, 128, 255, 0.05), rgba(0, 0, 0, 0))",
      ),
    ).toBe(true);
    expect(isJunkRuntimeNotFoundPath("/en/career-programs/null")).toBe(true);
    expect(isJunkRuntimeNotFoundPath("/en/career-programs/full-stack")).toBe(false);
  });
});
