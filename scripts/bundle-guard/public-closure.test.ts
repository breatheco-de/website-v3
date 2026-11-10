import { describe, expect, it } from "vitest";
import { checkPublicClosure, formatHit, type BundleChunk } from "./public-closure";

function chunk(fileName: string, opts: Partial<BundleChunk> = {}): BundleChunk {
  return {
    fileName,
    isEntry: false,
    facadeModuleId: null,
    imports: [],
    moduleIds: [],
    sizeBytes: 100,
    ...opts,
  };
}

const entry = (imports: string[]) =>
  chunk("index.js", { isEntry: true, facadeModuleId: "/app/client/src/main.tsx", imports });

describe("checkPublicClosure", () => {
  it("passes a clean closure and leaves admin-only chunks out", () => {
    const report = checkPublicClosure([
      entry(["utils.js"]),
      chunk("utils.js", { imports: ["class-utils.js"], moduleIds: ["/app/client/src/lib/utils.ts"] }),
      chunk("class-utils.js", { moduleIds: ["/app/node_modules/clsx/dist/clsx.mjs"] }),
      chunk("charts.js", { moduleIds: ["/app/node_modules/recharts/es6/index.js"], sizeBytes: 400_000 }),
      chunk("PageStats.js", { imports: ["charts.js"] }),
    ]);
    expect(report.errors).toEqual([]);
    expect(report.files.sort()).toEqual(["class-utils.js", "index.js", "utils.js"]);
    expect(report.rawBytes).toBe(300);
  });

  it("fails when a shared chunk pulls an admin library into a public page", () => {
    const report = checkPublicClosure([
      entry([]),
      chunk("page.js", {
        facadeModuleId: "/app/client/src/pages/page.tsx",
        imports: ["utils.js"],
      }),
      chunk("utils.js", { imports: ["charts.js"] }),
      chunk("charts.js", {
        moduleIds: [
          "/app/node_modules/clsx/dist/clsx.mjs",
          "/app/node_modules/recharts/es6/index.js",
          "/app/node_modules/victory-vendor/es/d3-scale.js",
        ],
      }),
    ]);
    expect(report.roots.sort()).toEqual(["index.js", "page.js"]);
    expect(report.errors).toHaveLength(1);
    const [hit] = report.errors;
    expect(hit).toMatchObject({ label: "Recharts", chunk: "charts.js", moreModules: 1 });
    expect(hit!.via).toEqual(["page.js", "utils.js", "charts.js"]);
    expect(hit!.otherModules).toEqual(["/app/node_modules/clsx/dist/clsx.mjs"]);
    expect(formatHit(hit!)).toContain("reached via page.js -> utils.js -> charts.js");
    expect(formatHit(hit!)).toContain("other modules in that chunk: /app/node_modules/clsx/dist/clsx.mjs");
  });

  it("only warns for libraries that are still public", () => {
    const report = checkPublicClosure([
      entry(["dist.js"]),
      chunk("dist.js", { moduleIds: ["/app/node_modules/@codemirror/view/dist/index.js"] }),
    ]);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => w.label)).toEqual(["CodeMirror"]);
  });

  it("ignores chunks reached only through dynamic imports", () => {
    const report = checkPublicClosure([
      entry([]),
      chunk("framer.js", { moduleIds: ["/app/node_modules/framer-motion/dist/es/index.mjs"] }),
    ]);
    expect(report.errors).toEqual([]);
    expect(report.files).toEqual(["index.js"]);
  });
});
