import { describe, expect, it } from "vitest";
import {
  isPrivateEmbedPath,
  resolvePrivatePageAccess,
} from "./private-page-access";

describe("isPrivateEmbedPath", () => {
  it("allows capture and component preview frames", () => {
    expect(isPrivateEmbedPath("/private/entry-preview-frame/blog/foo")).toBe(true);
    expect(
      isPrivateEmbedPath("/private/component-showcase/hero/preview"),
    ).toBe(true);
    expect(
      isPrivateEmbedPath("/private/component-showcase/hero/preview/"),
    ).toBe(true);
    expect(
      isPrivateEmbedPath("/private/demo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBe(true);
    expect(
      isPrivateEmbedPath("/private/demo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"),
    ).toBe(true);
  });

  it("does not treat staff admin pages as embeds", () => {
    expect(isPrivateEmbedPath("/private/redirects")).toBe(false);
    expect(isPrivateEmbedPath("/private/component-showcase/hero")).toBe(false);
    expect(isPrivateEmbedPath("/private/preview/page/home")).toBe(false);
    expect(isPrivateEmbedPath("/private/settings")).toBe(false);
    expect(isPrivateEmbedPath("/private/demo/short")).toBe(false);
    expect(isPrivateEmbedPath("/private/demo/not-hex-not-hex-not-hex-not-hex!!")).toBe(false);
  });
});

describe("resolvePrivatePageAccess", () => {
  const base = {
    pathname: "/private/redirects",
    isDebugMode: false,
    isLoading: false,
    isValidated: false as boolean | null,
    hasToken: false,
    hasCachedStaffSession: false,
  };

  it("404s anonymous visitors without debug mode", () => {
    expect(resolvePrivatePageAccess(base)).toBe("deny");
  });

  it("allows debug mode without a staff session", () => {
    expect(resolvePrivatePageAccess({ ...base, isDebugMode: true })).toBe("allow");
  });

  it("allows a validated staff session without debug mode", () => {
    expect(
      resolvePrivatePageAccess({
        ...base,
        hasToken: true,
        isValidated: true,
      }),
    ).toBe("allow");
  });

  it("waits when a cached staff token is still validating", () => {
    expect(
      resolvePrivatePageAccess({
        ...base,
        isLoading: true,
        isValidated: null,
        hasToken: true,
        hasCachedStaffSession: true,
      }),
    ).toBe("pending");
  });

  it("404s immediately when auth is loading but there is no staff token", () => {
    expect(
      resolvePrivatePageAccess({
        ...base,
        isLoading: true,
        isValidated: null,
      }),
    ).toBe("deny");
  });

  it("allows embed frames without debug or login", () => {
    expect(
      resolvePrivatePageAccess({
        ...base,
        pathname: "/private/component-showcase/hero/preview",
      }),
    ).toBe("allow");
  });
});
