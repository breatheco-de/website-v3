import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "../../../server/content-types";
import { isLiveRequestField, templatesOnlyReferenceLiveFields } from "./liveFields";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "live-fields-"));
  fs.writeFileSync(
    path.join(root, "content-types.yml"),
    `workshop:
  directory: workshop
  url_pattern:
    en: /en/workshop/:slug
  editor:
    title:
      type: text
    seats_checkins:
      type: live_request
      request:
        url: https://example.com/checkin
`,
    "utf-8",
  );
  resetRegistry(root);
});

afterEach(() => {
  resetRegistry(root);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("isLiveRequestField", () => {
  it("matches live_request fields and their nested paths only", () => {
    expect(isLiveRequestField("workshop", "seats_checkins", root)).toBe(true);
    expect(isLiveRequestField("workshop", "seats_checkins.0.name", root)).toBe(true);
    expect(isLiveRequestField("workshop", "title", root)).toBe(false);
    expect(isLiveRequestField("workshop", "missing", root)).toBe(false);
    expect(isLiveRequestField(undefined, "seats_checkins", root)).toBe(false);
  });
});

describe("templatesOnlyReferenceLiveFields", () => {
  it("is true only when every leftover template binds a live_request field", () => {
    expect(
      templatesOnlyReferenceLiveFields("{{ entry.seats_checkins }} seats", "workshop", root),
    ).toBe(true);
    expect(
      templatesOnlyReferenceLiveFields(
        "{{ entry.seats_checkins }} | {{ entry.title }}",
        "workshop",
        root,
      ),
    ).toBe(false);
    expect(templatesOnlyReferenceLiveFields("{{ global.brand }}", "workshop", root)).toBe(false);
    expect(templatesOnlyReferenceLiveFields("No templates", "workshop", root)).toBe(false);
  });
});
