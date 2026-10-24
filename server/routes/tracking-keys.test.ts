import { describe, expect, it } from "vitest";
import { trackingKeysCsv } from "./tracking-keys";

describe("trackingKeysCsv", () => {
  it("lists current and retired product / persona codes with the site", () => {
    const csv = trackingKeysCsv("site_x", {
      products: [
        {
          slug: "ai-engineering",
          content_type: "program",
          product_id: "program-ai-engineering",
          name: "AI Engineering",
          key: "aie",
          active: true,
          personas: [
            { id: "the-career-changer", name: "The Career Changer, \"CC\"", key: "cc" },
            { id: "no-key", name: "No key" },
          ],
          retired: [{ key: "old", type: "persona", id: "gone", name: "Gone", retired_at: "2026-10-01T00:00:00.000Z" }],
        },
      ],
    });
    expect(csv.trim().split("\n")).toEqual([
      "site,code,type,id,name,product,status",
      "site_x,aie,product,ai-engineering,AI Engineering,ai-engineering,current",
      'site_x,cc,persona,the-career-changer,"The Career Changer, ""CC""",ai-engineering,current',
      "site_x,old,persona,gone,Gone,ai-engineering,retired 2026-10-01",
    ]);
  });
});
