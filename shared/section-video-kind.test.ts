import { describe, expect, it } from "vitest";
import { detectSectionVideoKind } from "./section-video-kind";

describe("detectSectionVideoKind", () => {
  it("detects YouTube URLs", () => {
    expect(
      detectSectionVideoKind({
        data: { video: { url: "https://www.youtube.com/watch?v=abc" } },
      }),
    ).toEqual({ hasYoutube: true, hasFileVideo: false });
  });

  it("detects uploaded file videos", () => {
    expect(
      detectSectionVideoKind({
        data: { video: { url: "/media/demo.mp4" } },
      }),
    ).toEqual({ hasYoutube: false, hasFileVideo: true });
  });

  it("returns neither when there is no video", () => {
    expect(detectSectionVideoKind({ data: { title: "Hello" } })).toEqual({
      hasYoutube: false,
      hasFileVideo: false,
    });
  });
});
