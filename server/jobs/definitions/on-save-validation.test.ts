import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { ContentFile } from "../../../scripts/validation/shared/types";
import { filterContentFilesForEntry, emitValidationSettled } from "./on-save-validation";
import { clearSiteSqliteCacheForTests } from "../../db";
import { resetPipelineDbCache } from "../../pipeline-db/runner";
import { emitEvent, listEvents, clearAllEvents } from "../../events/event-store";

function file(partial: Partial<ContentFile> & Pick<ContentFile, "type" | "slug" | "locale">): ContentFile {
  return {
    title: partial.slug,
    filePath: partial.filePath ?? "",
    ...partial,
  };
}

describe("filterContentFilesForEntry", () => {
  it("includes live locale rows without variant", () => {
    const files = [
      file({ type: "page", slug: "home", locale: "en", filePath: "pages/home/en.yml" }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
  });

  it("includes draft variant rows when no live locale exists", () => {
    const files = [
      file({
        type: "page",
        slug: "draft-page",
        locale: "en",
        variant: "draft",
        filePath: "pages/draft-page/draft.en.yml",
        isDraft: true,
      }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "draft-page",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
  });

  it("excludes draft variant rows when a live locale exists", () => {
    const files = [
      file({ type: "page", slug: "home", locale: "en", filePath: "pages/home/en.yml" }),
      file({
        type: "page",
        slug: "home",
        locale: "en",
        variant: "b",
        filePath: "pages/home/b.en.yml",
      }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.variant).toBeUndefined();
  });
});

describe("emitValidationSettled", () => {
  const site = "site_test-val-settle";

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", site, "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    clearAllEvents(site);
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
  });

  it("closes the writeEventId and any other open writes for the entry", () => {
    const resource = { contentType: "page", slug: "home", locale: "en" };
    const w1 = emitEvent({ site, type: "entry_locale_saved", resource });
    const w2 = emitEvent({ site, type: "entry_locale_saved", resource });

    emitValidationSettled(site, "page/home/en", resource, { skipped: true, reason: "test" }, w1.id);

    const readies = listEvents({ site, type: "validation_results_ready", limit: 10 });
    const parents = readies.map((r) => r.triggeredByEventId).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(parents).toEqual([w1.id, w2.id]);
  });
});
