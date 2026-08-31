import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateImages,
  generateImagesStream,
  isNMustBeOneRejection,
  isUnsupportedAspectRatioRejection,
} from "./LLMService";

const GEMINI_N4_REJECT =
  'No endpoint providers support both of your preferences: aspect_ratio "16:9", output_format "webp", n "4". Available providers that support your selected model: Google: n: must be exactly 1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

describe("isNMustBeOneRejection", () => {
  it("matches Gemini exact phrasing", () => {
    expect(isNMustBeOneRejection(GEMINI_N4_REJECT)).toBe(true);
  });

  it("matches legacy patterns", () => {
    expect(isNMustBeOneRejection("n > 1 not supported")).toBe(true);
    expect(isNMustBeOneRejection("only support single image")).toBe(true);
  });
});

describe("isUnsupportedAspectRatioRejection", () => {
  it("matches when aspect_ratio is listed", () => {
    expect(isUnsupportedAspectRatioRejection(GEMINI_N4_REJECT)).toBe(true);
  });
});

describe("generateImages", () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevBase = process.env.OPENROUTER_BASE_URL;
  const prevImageModel = process.env.LLM_IMAGE_MODEL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
    process.env.LLM_IMAGE_MODEL = "google/gemini-2.5-flash-image";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = prevBase;
    if (prevImageModel === undefined) delete process.env.LLM_IMAGE_MODEL;
    else process.env.LLM_IMAGE_MODEL = prevImageModel;
  });

  function parseBodies(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      return JSON.parse(String(init.body)) as Record<string, unknown>;
    });
  }

  it("never sends output_format", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ b64_json: "YWJj", media_type: "image/png" }],
      }),
    );

    await generateImages({ prompt: "a cat", n: 1 });

    const bodies = parseBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("output_format");
    expect(bodies[0].n).toBe(1);
  });

  it("on n must be exactly 1 runs four sequential n=1 calls without aspect_ratio", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(GEMINI_N4_REJECT, 400))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "a", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "b", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "c", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "d", media_type: "image/png" }] }),
      );

    const result = await generateImages({
      prompt: "logo",
      n: 4,
      aspect_ratio: "16:9",
    });

    expect(result.candidates.map((c) => c.b64)).toEqual(["a", "b", "c", "d"]);
    const bodies = parseBodies();
    expect(bodies).toHaveLength(5);
    expect(bodies[0]).toMatchObject({ n: 4, aspect_ratio: "16:9" });
    expect(bodies[0]).not.toHaveProperty("output_format");
    for (let i = 1; i < 5; i++) {
      expect(bodies[i].n).toBe(1);
      expect(bodies[i]).not.toHaveProperty("aspect_ratio");
      expect(bodies[i]).not.toHaveProperty("output_format");
    }
  });

  it("returns partial candidates when a later sequential call fails", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(GEMINI_N4_REJECT, 400))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "one", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "two", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(textResponse("rate limited", 429));

    const result = await generateImages({
      prompt: "logo",
      n: 4,
      aspect_ratio: "16:9",
    });

    expect(result.candidates.map((c) => c.b64)).toEqual(["one", "two"]);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 reject + 2 ok + 1 fail (stop)
  });

  it("retries without aspect_ratio when only aspect is rejected", async () => {
    const aspectOnly =
      'No endpoint providers support aspect_ratio "16:9" for this model';
    fetchMock
      .mockResolvedValueOnce(textResponse(aspectOnly, 400))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { b64_json: "x1", media_type: "image/png" },
            { b64_json: "x2", media_type: "image/png" },
          ],
        }),
      );

    const result = await generateImages({
      prompt: "scene",
      n: 2,
      aspect_ratio: "16:9",
    });

    expect(result.candidates).toHaveLength(2);
    const bodies = parseBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].aspect_ratio).toBe("16:9");
    expect(bodies[1]).not.toHaveProperty("aspect_ratio");
    expect(bodies[1].n).toBe(2);
  });
});

describe("generateImagesStream", () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevBase = process.env.OPENROUTER_BASE_URL;
  const prevImageModel = process.env.LLM_IMAGE_MODEL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
    process.env.LLM_IMAGE_MODEL = "google/gemini-2.5-flash-image";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = prevBase;
    if (prevImageModel === undefined) delete process.env.LLM_IMAGE_MODEL;
    else process.env.LLM_IMAGE_MODEL = prevImageModel;
  });

  it("emits a burst of candidates from a multi-n success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { b64_json: "a", media_type: "image/png" },
          { b64_json: "b", media_type: "image/png" },
        ],
      }),
    );
    const seen: string[] = [];
    await generateImagesStream({ prompt: "x", n: 2 }, (c) => {
      seen.push(c.b64);
    });
    expect(seen).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emits sequentially and stops with partial on later failure", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(GEMINI_N4_REJECT, 400))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "one", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ b64_json: "two", media_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(textResponse("rate limited", 429));

    const seen: string[] = [];
    const result = await generateImagesStream(
      { prompt: "logo", n: 4, aspect_ratio: "16:9" },
      (c) => {
        seen.push(c.b64);
      },
    );
    expect(seen).toEqual(["one", "two"]);
    expect(result.candidates.map((c) => c.b64)).toEqual(["one", "two"]);
  });
});
