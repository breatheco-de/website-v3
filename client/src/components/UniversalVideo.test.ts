import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { track } from "@/lib/tracking";
import {
  buildYouTubeEmbedUrl,
  isLocalVideo,
  shouldEmitVideoStart,
  shouldPlayYouTubeInline,
  shouldShowMutedOverlay,
  videoProgressMilestones,
  videoReachedEnd,
  fileProgressStep,
  filePlaybackRestarted,
  UniversalVideo,
} from "./UniversalVideo";

vi.mock("@/lib/tracking", () => ({
  track: vi.fn(),
}));

vi.mock("@/components/UniversalImage", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));

describe("shouldShowMutedOverlay", () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });
  it("shows for local autoplay with overlay object", () => {
    expect(
      shouldShowMutedOverlay({
        url: "https://cdn.example.com/clip.mp4",
        autoplay: true,
        overlay_on_muted: { title: "Hi" },
      }),
    ).toBe(true);
  });

  it("shows for empty overlay object (presence is the switch)", () => {
    expect(
      shouldShowMutedOverlay({
        url: "/media/intro.webm",
        autoplay: true,
        overlay_on_muted: {},
      }),
    ).toBe(true);
  });

  it("shows for YouTube autoplay with overlay", () => {
    expect(
      shouldShowMutedOverlay({
        url: "https://www.youtube.com/watch?v=abc123",
        autoplay: true,
        overlay_on_muted: { title: "Hi" },
      }),
    ).toBe(true);
  });

  it("hides when autoplay is off", () => {
    expect(
      shouldShowMutedOverlay({
        url: "https://cdn.example.com/clip.mp4",
        autoplay: false,
        overlay_on_muted: { title: "Hi" },
      }),
    ).toBe(false);
  });

  it("hides when overlay object is missing", () => {
    expect(
      shouldShowMutedOverlay({
        url: "https://cdn.example.com/clip.mp4",
        autoplay: true,
        overlay_on_muted: null,
      }),
    ).toBe(false);
    expect(
      shouldShowMutedOverlay({
        url: "https://cdn.example.com/clip.mp4",
        autoplay: true,
      }),
    ).toBe(false);
  });
});

describe("isLocalVideo", () => {
  it("detects common extensions", () => {
    expect(isLocalVideo("a.mp4")).toBe(true);
    expect(isLocalVideo("a.webm")).toBe(true);
    expect(isLocalVideo("https://youtube.com/watch?v=1")).toBe(false);
  });
});

describe("UniversalVideo muted overlay markup", () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });
  it("renders the overlay card for local muted autoplay", () => {
    const html = renderToStaticMarkup(
      createElement(UniversalVideo, {
        url: "https://cdn.example.com/clip.mp4",
        autoplay: true,
        overlay_on_muted: {
          title: "Tu video ya ha comenzado",
          subtitle: "Haga clic para escuchar",
        },
      }),
    );
    expect(html).toContain('data-testid="video-muted-overlay"');
    expect(html).toContain("Tu video ya ha comenzado");
    expect(html).toContain("Haga clic para escuchar");
    expect(html).not.toContain(" controls");
  });

  it("starts a muted counting YouTube player when autoplay has no listen card", () => {
    const html = renderToStaticMarkup(
      createElement(UniversalVideo, {
        url: "https://www.youtube.com/watch?v=abc123xyz",
        autoplay: true,
      }),
    );
    expect(html).toContain('data-testid="video-inline-youtube"');
    expect(html).not.toContain('data-testid="video-preview"');
    expect(html).toContain("www.youtube.com/embed");
    expect(html).toContain("enablejsapi=1");
    expect(html).toContain("mute=1");
    expect(html).not.toContain("loop=1");
    expect(html).not.toContain("playlist=");
    expect(html).not.toContain("youtube-nocookie.com");
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps a YouTube thumbnail when autoplay is off", () => {
    const html = renderToStaticMarkup(
      createElement(UniversalVideo, {
        url: "https://www.youtube.com/watch?v=abc123xyz",
        autoplay: false,
      }),
    );
    expect(html).toContain('data-testid="video-preview"');
    expect(html).not.toContain("enablejsapi");
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps the muted YouTube card on the privacy domain without the API", () => {
    const html = renderToStaticMarkup(
      createElement(UniversalVideo, {
        url: "https://www.youtube.com/watch?v=abc123xyz",
        autoplay: true,
        overlay_on_muted: { title: "Tu video ya ha comenzado" },
      }),
    );
    expect(html).toContain('data-testid="video-muted-overlay"');
    expect(html).toContain("youtube-nocookie.com");
    expect(html).toContain("mute=1");
    expect(html).not.toContain("loop=1");
    expect(html).not.toContain("playlist=");
    expect(html).not.toContain("enablejsapi");
    expect(html).not.toContain("www.youtube.com/embed");
    expect(track).not.toHaveBeenCalled();
  });

  it("skips overlay markup when autoplay is off even with overlay config", () => {
    const html = renderToStaticMarkup(
      createElement(UniversalVideo, {
        url: "https://cdn.example.com/clip.mp4",
        autoplay: false,
        overlay_on_muted: { title: "Tu video ya ha comenzado" },
      }),
    );
    expect(html).not.toContain('data-testid="video-muted-overlay"');
    expect(html).toContain('data-testid="video-placeholder"');
    expect(track).not.toHaveBeenCalled();
  });
});

describe("YouTube counting embed", () => {
  it("inline-autoplays when autoplay is on and stays a thumbnail when it is off", () => {
    expect(
      shouldPlayYouTubeInline({
        url: "https://youtu.be/abc123xyz",
        autoplay: true,
      }),
    ).toBe(true);
    expect(
      shouldPlayYouTubeInline({
        url: "https://youtu.be/abc123xyz",
        autoplay: false,
      }),
    ).toBe(false);
  });

  it("uses youtube.com and the JS API only for the player that counts", () => {
    const counting = buildYouTubeEmbedUrl("abc123xyz", {
      counting: true,
      forInline: true,
      autoplay: true,
    });
    expect(counting.startsWith("https://www.youtube.com/embed/abc123xyz")).toBe(true);
    expect(counting).toContain("enablejsapi=1");
    expect(counting).toContain("autoplay=1");
    expect(counting).not.toContain("loop=1");
    expect(counting).not.toContain("playlist=");

    const muted = buildYouTubeEmbedUrl("abc123xyz", {
      muted: true,
      controls: false,
      forInline: true,
    });
    expect(muted).toContain("youtube-nocookie.com");
    expect(muted).not.toContain("enablejsapi");
    expect(muted).not.toContain("autoplay=1");
  });
});

describe("file video events", () => {
  it("counts a file that starts with no card, and not a muted card, YouTube, or other embed", () => {
    expect(shouldEmitVideoStart({ url: "https://cdn.example.com/clip.mp4", overlay_on_muted: { title: "Hi" } })).toBe(false);
    expect(shouldEmitVideoStart({ url: "https://cdn.example.com/clip.mp4" })).toBe(true);
    expect(shouldEmitVideoStart({ url: "https://www.youtube.com/watch?v=abc" })).toBe(false);
    expect(shouldEmitVideoStart({ url: "https://www.youtube.com/watch?v=abc", overlay_on_muted: {} })).toBe(false);
    expect(shouldEmitVideoStart({ url: "https://vimeo.com/123" })).toBe(false);
  });

  it("sends each progress mark once and the end once", () => {
    const sent = new Set<number>();
    expect(videoProgressMilestones(12, sent)).toEqual([10]);
    sent.add(10);
    expect(videoProgressMilestones(50, sent)).toEqual([25, 50]);
    sent.add(25);
    sent.add(50);
    expect(videoProgressMilestones(80, sent)).toEqual([75]);
    sent.add(75);
    expect(videoProgressMilestones(90, sent)).toEqual([]);
    expect(videoReachedEnd(9.8, 10)).toBe(true);
    expect(videoReachedEnd(1, 10)).toBe(false);
  });

  it("skips file progress marks on a scrub and sends them when playback passes them", () => {
    const already = new Set<number>();
    const playing = fileProgressStep({
      lastTime: 1,
      currentTime: 12,
      duration: 100,
      elapsedWallSeconds: 11,
      already,
    });
    expect(playing.emit).toEqual([10]);
    expect(playing.skip).toEqual([]);
    playing.emit.forEach((mark) => already.add(mark));

    const scrub = fileProgressStep({
      lastTime: 12,
      currentTime: 80,
      duration: 100,
      elapsedWallSeconds: 0.25,
      already,
    });
    expect(scrub.emit).toEqual([]);
    expect(scrub.skip).toEqual([25, 50, 75]);
  });

  it("counts another play when the file loops or restarts after the end", () => {
    expect(
      filePlaybackRestarted({
        lastTime: 99.8,
        currentTime: 0.1,
        duration: 100,
        completed: true,
      }),
    ).toBe(true);
    expect(
      filePlaybackRestarted({
        lastTime: 40,
        currentTime: 0,
        duration: 100,
        completed: false,
      }),
    ).toBe(false);
  });
});
