import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LOCATIONS_RELATION_HINT,
  planLocationsHint,
  remainingUnknownLocations,
  renameFormLocationDefaultText,
  renameLocationListText,
  runLandingLocationsMigration,
  type LandingLocationsDeps,
} from "./landing-locations-migration";
import type { ContentTypeEntry } from "./content-types";

const known = new Set(["barcelona-spain", "madrid-spain", "mexicocity-mexico", "miami-usa"]);

describe("landing locations migration plans", () => {
  it("converts a tags Locations field to a link and is idempotent", () => {
    const entry = { editor: { locations: { type: "tags", label: "Locations" }, programs: { type: "relation" } } } as unknown as ContentTypeEntry;
    const plan = planLocationsHint(entry);
    expect(plan?.editor?.locations).toEqual(LOCATIONS_RELATION_HINT);
    expect(plan?.editor?.programs).toEqual({ type: "relation" });
    expect(planLocationsHint({ editor: { locations: LOCATIONS_RELATION_HINT } } as unknown as ContentTypeEntry)).toBeNull();
  });

  it("renames only known wrong page list items whose target exists", () => {
    const raw = "slug: x\nlocations:\n  - madrid-spain\n  - barcelona-espana\n  - 'ciudad-de-mexico'\nprograms:\n  - barcelona-espana\n";
    const res = renameLocationListText(raw, known);
    expect(res.text).toBe(
      "slug: x\nlocations:\n  - madrid-spain\n  - barcelona-spain\n  - 'mexicocity-mexico'\nprograms:\n  - barcelona-espana\n",
    );
    expect(res.renamed).toEqual([
      ["barcelona-espana", "barcelona-spain"],
      ["ciudad-de-mexico", "mexicocity-mexico"],
    ]);
    expect(renameLocationListText(res.text, known).renamed).toEqual([]);
  });

  it("renames a form's location default only inside the location block", () => {
    const raw = [
      "sections:",
      "  - type: hero",
      "    form:",
      "      fields:",
      "        location:",
      "          visible: false",
      "          default: downtown-miami",
      "        plan:",
      "          default: downtown-miami",
    ].join("\n");
    const res = renameFormLocationDefaultText(raw, known);
    expect(res.text.split("\n")[6]).toBe("          default: miami-usa");
    expect(res.text.split("\n")[8]).toBe("          default: downtown-miami");
  });

  it("reports page locations that are still unknown", () => {
    expect(remainingUnknownLocations("locations:\n  - madrid-spain\n  - nowhere\n", known)).toEqual(["nowhere"]);
  });
});

describe("runLandingLocationsMigration", () => {
  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig014-"));
    const page = path.join(root, "landings", "curso-de-ia-espana");
    fs.mkdirSync(page, { recursive: true });
    fs.writeFileSync(path.join(page, "_common.yml"), "locations:\n  - madrid-spain\n  - barcelona-espana\n");
    fs.writeFileSync(path.join(page, "es.yml"), "sections: []\n");
    let entry = { editor: { locations: { type: "tags" } } } as unknown as ContentTypeEntry;
    const pushed: string[][] = [];
    const deps: LandingLocationsDeps = {
      sites: () => [{ name: "site_test", contentRoot: root }],
      pending: () => [],
      markModified: () => {},
      push: async (_site, files) => {
        pushed.push(files);
        return { success: true, commitHash: "abc123" };
      },
      contentType: () => entry,
      updateContentType: (_root, update) => {
        entry = { ...entry, ...update } as ContentTypeEntry;
      },
      folder: () => "landings",
      knownLocations: () => known,
    };
    return { root, deps, pushed, page };
  }

  it("dry run writes nothing", async () => {
    const { deps, pushed, page } = setup();
    const res = await runLandingLocationsMigration({ dryRun: true, deps, log: () => {}, error: () => {} });
    expect(res).toEqual({ failed: false, changed: 2 });
    expect(pushed).toEqual([]);
    expect(fs.readFileSync(path.join(page, "_common.yml"), "utf-8")).toContain("barcelona-espana");
  });

  it("applies, pushes once, and a second run finds nothing", async () => {
    const { deps, pushed, page } = setup();
    expect(await runLandingLocationsMigration({ dryRun: false, deps, log: () => {}, error: () => {} })).toEqual({
      failed: false,
      changed: 2,
    });
    expect(pushed).toEqual([["site_test/content-types.yml", "site_test/landings/curso-de-ia-espana/_common.yml"]]);
    expect(fs.readFileSync(path.join(page, "_common.yml"), "utf-8")).toContain("barcelona-spain");
    expect(await runLandingLocationsMigration({ dryRun: false, deps, log: () => {}, error: () => {} })).toEqual({
      failed: false,
      changed: 0,
    });
    expect(pushed).toHaveLength(1);
  });

  it("fails when the push returns no SHA", async () => {
    const { deps } = setup();
    deps.push = async () => ({ success: true });
    const res = await runLandingLocationsMigration({ dryRun: false, deps, log: () => {}, error: () => {} });
    expect(res.failed).toBe(true);
  });
});
