import { describe, it, expect, vi, afterEach } from "vitest";
import { runInSaveBatch } from "./save-batch-context";
import { emitEntryEventsFromFileChange } from "./emit-entry-events";
import * as eventStore from "./event-store";

describe("save-batch suppress", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips pipeline emit for hub member marks", () => {
    const emitSpy = vi.spyOn(eventStore, "emitEvent").mockReturnValue({
      id: 1,
      type: "entry_locale_saved",
      site: "site_test",
      resource: {},
      attribution: [],
      payload: {},
      published: false,
      created_at: Date.now(),
    });

    const emitted = runInSaveBatch({ suppressPipelineEmit: true, reason: "hub_seo_rewrite" }, () =>
      emitEntryEventsFromFileChange({
        filePath: "site_test/pages/home/en.yml",
        prevRaw: "sections: []\n",
        nextRaw: "sections:\n  - id: a\n",
        author: "test",
      }),
    );

    expect(emitted).toEqual([]);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
