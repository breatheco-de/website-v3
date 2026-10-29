import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { fallbackRedirectMiddleware, findNormalizedSlugMatch, redirectMiddleware } from "./redirects";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-slug-key-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    ["how-to:", "  directory: how-to", "  url_pattern:", "    en: /en/how-to/:slug", "    es: /es/how-to/:slug", ""].join("\n"),
  );
  write(root, "how-to/How-to-Install-Javascript/_common.yml", "slug: how-to-install-javascript\n");
  write(root, "how-to/How-to-Install-Javascript/en.yml", "slug: how-to-install-javascript\ntitle: Install\n");
  write(root, "how-to/How-to-Install-Javascript/es.yml", "slug: como-instalar-javascript\ntitle: Instalar\n");
  write(root, "how-to/javascript-empty-array/en.yml", "title: Empty array\n");
  write(root, "how-to/javascript-empty-array/es.yml", "slug: array-vacio-javascript\ntitle: Array vacío\n");
  write(
    root,
    "custom-redirects.yml",
    ["redirects:", "  - from: /en/how-to/javascript_empty_array", "    to: /en/apply", "    status: 301", ""].join("\n"),
  );
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

function run(ci: ContentIndex, urlPath: string): { location: string | null; status: number | null; passed: boolean } {
  let location: string | null = null;
  let status: number | null = null;
  let passed = false;
  const req = { path: urlPath, originalUrl: urlPath, headers: { host: "4geeks.com" }, cookies: {}, hostname: "4geeks.com" } as any;
  const res = {
    locals: { site: { contentIndex: ci, contentRoot: ci.contentRoot } },
    cookie: () => {},
    redirect: (s: number, to: string) => {
      status = s;
      location = to;
    },
  } as any;
  // Same order as server/index.ts: "before" redirects, then the fallback chain.
  redirectMiddleware(req, res, () => {
    fallbackRedirectMiddleware(req, res, () => {
      passed = true;
    });
  });
  return { location, status, passed };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("public spelling variants", () => {
  it("does not treat a mixed-case folder address as a second live URL", () => {
    const ci = makeSite();
    expect(ci.isKnownUrl("/en/how-to/how-to-install-javascript")).toBe(true);
    expect(ci.isKnownUrl("/en/how-to/How-to-Install-Javascript")).toBe(false);
  });

  it("301s the old mixed-case address to the lowercase official one", () => {
    const ci = makeSite();
    expect(run(ci, "/en/how-to/How-to-Install-Javascript")).toMatchObject({
      status: 301,
      location: "/en/how-to/how-to-install-javascript",
    });
  });

  it("301s underscore and accented spellings", () => {
    const ci = makeSite();
    expect(findNormalizedSlugMatch("/en/how-to/how_to_install_javascript", ci)?.canonicalUrl).toBe(
      "/en/how-to/how-to-install-javascript",
    );
    expect(findNormalizedSlugMatch("/es/how-to/Array-Vacío-JavaScript", ci)?.canonicalUrl).toBe(
      "/es/how-to/array-vacio-javascript",
    );
  });

  it("leaves exact live URLs alone", () => {
    const ci = makeSite();
    expect(run(ci, "/en/how-to/how-to-install-javascript")).toMatchObject({ passed: true, location: null });
  });

  it("lets a staff redirect win over the normalized match", () => {
    const ci = makeSite();
    expect(run(ci, "/en/how-to/javascript_empty_array")).toMatchObject({ status: 301, location: "/en/apply" });
  });

  it("does not redirect another language's address or an unknown slug", () => {
    const ci = makeSite();
    expect(findNormalizedSlugMatch("/en/how-to/array-vacio-javascript", ci)).toBeNull();
    expect(run(ci, "/en/how-to/does-not-exist")).toMatchObject({ passed: true, location: null });
  });
});
