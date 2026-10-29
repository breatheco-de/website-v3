import { describe, expect, it } from "vitest";
import {
  collectMissingConfirms,
  failBeforeFromOnPageYaml,
  stackedConfirmPayload,
  touchesMetaRedirects,
  validateRedirectUpdateInput,
} from "./redirect-update";

describe("validateRedirectUpdateInput: draft mode (variant)", () => {
  const draft = { from: "/old", content_type: "blog", slug: "post-a", locale: "en", variant: "draft" };

  it("accepts add and delete with from + content_type + slug + locale + variant", () => {
    expect(validateRedirectUpdateInput({ action: "add", ...draft })).toEqual({ ok: true, action: "add", draft: true });
    expect(validateRedirectUpdateInput({ action: "delete", ...draft })).toEqual({ ok: true, action: "delete", draft: true });
    expect(
      validateRedirectUpdateInput({ action: "delete", ...draft, source: "site_x/blog/post-a/draft.en.yml" }),
    ).toMatchObject({ ok: true });
  });

  it("refuses move, regex, missing page args, live-only extras and a foreign source", () => {
    const code = (input: Record<string, unknown>) => {
      const r = validateRedirectUpdateInput(input);
      return r.ok ? null : r.details.code;
    };
    expect(code({ action: "move", ...draft, before_from: "/x" })).toBe("draft_move_not_allowed");
    expect(code({ action: "add", ...draft, from: "/old/(.*)" })).toBe("draft_regex_not_allowed");
    expect(code({ action: "add", from: "/old", variant: "draft" })).toBe("draft_missing_args");
    expect(code({ action: "add", ...draft, to: "/en/new" })).toBe("draft_extras_rejected");
    expect(code({ action: "add", ...draft, removed_entry: { content_type: "blog", slug: "x", locale: "en" } })).toBe(
      "draft_extras_rejected",
    );
    expect(code({ action: "add", ...draft, confirm_overwrite_content: true })).toBe("draft_extras_rejected");
    expect(code({ action: "delete", ...draft, source: "site_x/blog/post-a/en.yml" })).toBe("draft_source_mismatch");
  });

  it("live mode is unchanged and reports draft: false", () => {
    expect(validateRedirectUpdateInput({ action: "add", from: "/old", to: "/en/new" })).toEqual({
      ok: true,
      action: "add",
      draft: false,
    });
  });
});

describe("touchesMetaRedirects", () => {
  it("matches meta.redirects paths and whole meta values carrying redirects", () => {
    expect(touchesMetaRedirects({ field_path: "meta.redirects" })).toBe(true);
    expect(touchesMetaRedirects({ field_path: "meta.redirects.0" })).toBe(true);
    expect(touchesMetaRedirects({ field_path: "meta.redirects[1]" })).toBe(true);
    expect(touchesMetaRedirects({ field_path: "meta", value: { redirects: [] } })).toBe(true);
    expect(touchesMetaRedirects({ field_path: "meta.page_title" })).toBe(false);
    expect(touchesMetaRedirects({ field_path: "meta", value: { page_title: "x" } })).toBe(false);
  });
});

describe("validateRedirectUpdateInput", () => {

  it("fails before_from / move on a page YAML source", () => {
    const move = validateRedirectUpdateInput({
      action: "move",
      from: "/us",
      before_from: "/other",
      source: "site_4geeks-com/pages/home/en.yml",
    });
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.details.code).toBe("move_page_yaml");

    const before = failBeforeFromOnPageYaml("/us", false);
    expect(before?.details.code).toBe("before_from_page_yaml");
    expect(failBeforeFromOnPageYaml("/us", true)).toBeNull();
  });

  it("requires from+to for add and from+source for delete", () => {
    const add = validateRedirectUpdateInput({ action: "add", from: "/a" });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.details.missing).toEqual(["to"]);

    const del = validateRedirectUpdateInput({ action: "delete", from: "/a" });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.details.missing).toEqual(["source"]);
  });

  it("rejects extras that do not belong to the action", () => {
    const del = validateRedirectUpdateInput({
      action: "delete",
      from: "/a",
      source: "site_x/custom-redirects.yml",
      to: "/en/b",
    });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.details.extras_rejected).toContain("to");
  });
});

describe("stacked confirms", () => {
  it("lists both flags when both apply", () => {
    const missing = collectMissingConfirms({
      needsOverwrite: true,
      needsLiveEdit: true,
    });
    expect(missing).toEqual(["confirm_overwrite_content", "confirm_live_edit"]);
            const payload = stackedConfirmPayload(missing);
    expect(payload.action_required).toBe("confirm_flags");
    expect(payload.missing_confirms).toEqual(["confirm_overwrite_content", "confirm_live_edit"]);
    expect(payload.message).toContain("confirm_overwrite_content");
    expect(payload.message).toContain("confirm_live_edit");
  });

  it("does not treat overwrite confirm as live confirm", () => {
    const missing = collectMissingConfirms({
      needsOverwrite: true,
      needsLiveEdit: true,
      confirm_overwrite_content: true,
    });
    expect(missing).toEqual(["confirm_live_edit"]);
  });
});
