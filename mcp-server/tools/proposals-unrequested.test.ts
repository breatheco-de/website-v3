import { describe, expect, it } from "vitest";
import { unrequestedFieldsFollowUp } from "./proposals";

const ID = "ffc80865-4430-4a83-95da-61584d048ad7";

describe("unrequestedFieldsFollowUp", () => {
  it("warns and suggests revise_entries for open entries with unrequested fields", () => {
    const out = unrequestedFieldsFollowUp(
      [
        {
          id: ID,
          status: "open",
          entries: [
            {
              contentType: "blog",
              slug: "python",
              locale: "en",
              status: "pending",
              requested_ops: [{ field_path: "content" }, { field_path: "call_to_action" }],
              unrequested_fields: ["funnel", "published_at"],
            },
            { contentType: "blog", slug: "other", locale: "es", status: "pending" },
          ],
        },
      ],
      ID,
      "4geeks.com",
    );
    expect(out?.warnings.map((w) => w.code)).toEqual(["draft_has_unrequested_fields"]);
    expect(out?.warnings[0]!.message).toContain("blog/python (en): funnel, published_at (requested: content, call_to_action)");
    expect(out?.next_actions).toEqual([
      expect.objectContaining({
        tool: "update_proposal",
        args_hint: expect.objectContaining({
          proposal_id: ID,
          action: "revise_entries",
          site: "4geeks.com",
          entries: [expect.objectContaining({ contentType: "blog", slug: "python", locale: "en" })],
        }),
      }),
    ]);
  });

  it("stays quiet for clean, applied, or closed proposals", () => {
    const entry = { contentType: "blog", slug: "python", locale: "en", unrequested_fields: ["funnel"] };
    expect(unrequestedFieldsFollowUp([{ id: ID, status: "open", entries: [{ ...entry, unrequested_fields: [] }] }], ID)).toBeNull();
    expect(unrequestedFieldsFollowUp([{ id: ID, status: "open", entries: [{ ...entry, status: "done" }] }], ID)).toBeNull();
    expect(unrequestedFieldsFollowUp([{ id: ID, status: "finished", entries: [entry] }], ID)).toBeNull();
  });
});
