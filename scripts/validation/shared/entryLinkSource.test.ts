import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { entryLinkSource } from "./entryLinkSource";
import { collectOutboundPathsFromData } from "../../../server/link-extract";

const dirs: string[] = [];

function localeFile(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-link-source-"));
  dirs.push(dir);
  const fp = path.join(dir, "es.yml");
  fs.writeFileSync(fp, body, "utf-8");
  return fp;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("entryLinkSource", () => {
  it("keeps body links and drops shared-template section placeholders", () => {
    const filePath = localeFile(
      "content: |-\n  Ver [ISA](/es/blog/herramientas-ia/como-funciona-isa-bootcamp).\nsections: []\n",
    );
    const entryFields = {
      content: "stale",
      seo: { pillar_path: "/es/curso-de-programacion-desde-cero" },
      sections: [{ type: "breadcrumb", items: [{ url: "/es/{{ entry.category | category }}" }] }],
    };
    const paths = collectOutboundPathsFromData(entryLinkSource({ filePath, entryFields }), "es");
    expect(paths).toEqual([
      "/es/blog/herramientas-ia/como-funciona-isa-bootcamp",
      "/es/curso-de-programacion-desde-cero",
    ]);
  });

  it("falls back to entry-bag sections when the locale file has none", () => {
    const filePath = localeFile("title: Hola\n");
    const entryFields = { sections: [{ type: "hero", cta_url: "/es/aplicar" }] };
    expect(collectOutboundPathsFromData(entryLinkSource({ filePath, entryFields }), "es")).toEqual(["/es/aplicar"]);
  });

  it("uses only the entry bag when the locale file is missing", () => {
    const entryFields = { content: "[x](/es/inicio)" };
    const src = entryLinkSource({ filePath: "/nonexistent/es.yml", entryFields });
    expect(collectOutboundPathsFromData(src, "es")).toEqual(["/es/inicio"]);
  });
});
