import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UrlRemovalCheck } from "@shared/url-removal";

const h = vi.hoisted(() => ({ removal: null as UrlRemovalCheck | null }));
vi.mock("./url-removal-check", () => ({
  assessUrlRemoval: async () => h.removal,
  liveAdsOf: () => [],
  pausedAdsOf: () => [],
}));

import { deleteContentEntry } from "./content-editor";
import { contentIndex } from "./content-index";
import { getFolder } from "./content-types";

const tmpDirs: string[] = [];

function setup(destLocales: string[]) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-delete-redirect-"));
  tmpDirs.push(root);
  const typeDir = path.join(root, getFolder("page"));
  const old = path.join(typeDir, "old-page");
  const dest = path.join(typeDir, "new-page");
  fs.mkdirSync(old, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(old, "es.yml"), "slug: old-page\nmeta:\n  redirects:\n    - /es/older-page\n", "utf-8");
  for (const l of destLocales) fs.writeFileSync(path.join(dest, `${l}.yml`), "slug: new-page\n", "utf-8");

  vi.spyOn(contentIndex, "resolveBaseSlug").mockImplementation((s) => s);
  vi.spyOn(contentIndex, "getContentFolderPath").mockImplementation((_ct, s) => path.join(typeDir, s));
  vi.spyOn(contentIndex, "loadCommonData").mockReturnValue(null);
  vi.spyOn(contentIndex, "getRedirects").mockReturnValue([]);
  vi.spyOn(contentIndex, "refresh").mockImplementation(() => {});
  vi.spyOn(contentIndex, "upsertEntry").mockImplementation(() => {});

  h.removal = {
    action: "delete",
    contentType: "page",
    slug: "old-page",
    locales: [
      {
        locale: "es",
        url: "/es/old-page",
        ads: { live: [], paused: [], checked: true, sources: [] },
        age_hours: 48,
        redirect_required_for_agents: true,
      },
    ],
    ab_lock: null,
    live_ads: 0,
    paused_ads: 0,
    ads_checked: true,
  };
  return { root, old, dest, rootName: path.relative(process.cwd(), root) };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("deleteContentEntry redirects and agent rule", () => {
  it("refuses an agent delete of a page live 24h or more without a destination or reason", async () => {
    const { old, rootName } = setup(["es"]);
    const r = await deleteContentEntry({ type: "page", slug: "old-page", contentRootName: rootName, callerIsAgent: true });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("redirect_destination_required");
    expect(fs.existsSync(old)).toBe(true);

    const withReason = await deleteContentEntry({
      type: "page",
      slug: "old-page",
      contentRootName: rootName,
      callerIsAgent: true,
      noRedirectReason: "Offer withdrawn for legal reasons",
    });
    expect(withReason.success).toBe(true);
    expect(fs.existsSync(old)).toBe(false);
  });

  it("adds the deleted URL and its old addresses to the destination page, same locale", async () => {
    const { old, dest, rootName } = setup(["es"]);
    const r = await deleteContentEntry({
      type: "page",
      slug: "old-page",
      contentRootName: rootName,
      redirectTo: { contentType: "page", slug: "new-page" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(fs.existsSync(old)).toBe(false);
    const doc = yaml.load(fs.readFileSync(path.join(dest, "es.yml"), "utf-8")) as { meta: { redirects: string[] } };
    expect(doc.meta.redirects).toEqual(["/es/old-page", "/es/older-page"]);
    expect(r.data.redirects_added?.map((a) => a.from)).toEqual(["/es/old-page", "/es/older-page"]);
  });

  it("deletes nothing when the destination lacks the locale", async () => {
    const { old, dest, rootName } = setup(["en"]);
    const r = await deleteContentEntry({
      type: "page",
      slug: "old-page",
      contentRootName: rootName,
      redirectTo: { contentType: "page", slug: "new-page" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("redirect_destination_missing_locale");
    expect(fs.existsSync(old)).toBe(true);
    expect(fs.readFileSync(path.join(dest, "en.yml"), "utf-8")).not.toContain("redirects");
  });
});
