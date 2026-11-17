/**
 * Drift guards for micro-events.ts files in component registries (fixtures + site when present).
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  MICRO_EVENT_SOURCES,
  MICRO_FORBIDDEN_EVENTS,
  isForbiddenMicroEvent,
  isMicroEventName,
  isMicroEventSource,
  parseMicroEventsExport,
} from "./micro-events";

const ROOTS = [
  path.join(process.cwd(), "fixtures/ci/content-4geeks-com/component-registry"),
  path.join(process.cwd(), "site_4geeks-com/component-registry"),
  path.join(process.cwd(), "shared/component-registry"),
];

function findMicroEventsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMicroEventsFiles(full));
    else if (entry.name === "micro-events.ts") out.push(full);
  }
  return out;
}

function extractExport(content: string): unknown {
  const match = content.match(/export\s+const\s+microEvents\s*[^=]*=\s*(\{[\s\S]*\});?\s*$/m);
  if (!match) throw new Error("missing export const microEvents");
  return Function(`"use strict"; return (${match[1]})`)();
}

describe("micro-events drift", () => {
  const files = ROOTS.flatMap(findMicroEventsFiles);

  it("finds at least the ai_flex_path map in fixtures", () => {
    expect(files.some((f) => f.includes(`${path.sep}ai_flex_path${path.sep}`))).toBe(true);
  });

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    it(`${rel} only declares allowed Micro events/sources`, () => {
      const raw = extractExport(fs.readFileSync(file, "utf8"));
      const parsed = parseMicroEventsExport(raw);
      expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
      if (!parsed.ok) return;
      for (const rows of Object.values(parsed.map)) {
        for (const row of rows) {
          expect(isMicroEventName(row.event)).toBe(true);
          expect(isMicroEventSource(row.source)).toBe(true);
          expect(isForbiddenMicroEvent(row.event)).toBe(false);
          expect(MICRO_FORBIDDEN_EVENTS).not.toContain(row.event as never);
          expect(MICRO_EVENT_SOURCES).toContain(row.source);
        }
      }
    });

    it(`${rel} section-tracking / universal-video / track evidence`, () => {
      const raw = extractExport(fs.readFileSync(file, "utf8")) as Record<
        string,
        Array<{ event: string; source: string }>
      >;
      const componentDir = path.dirname(file);
      const type = path.basename(path.dirname(componentDir));
      const clientDir = path.join(process.cwd(), "client/src/components", type);
      const variantFiles =
        fs.existsSync(clientDir)
          ? fs
              .readdirSync(clientDir, { recursive: true })
              .filter((f) => String(f).endsWith(".tsx"))
              .map((f) => ({
                rel: String(f),
                src: fs.readFileSync(path.join(clientDir, String(f)), "utf8"),
              }))
          : [];
      const hasUniversalVideo = variantFiles.some((f) => f.src.includes("UniversalVideo"));
      const allSrc = variantFiles.map((f) => f.src).join("\n");

      for (const [key, rows] of Object.entries(raw)) {
        if (key !== "*") {
          const knownVariant =
            variantFiles.some((f) => f.rel.includes(key) || f.src.includes(`"${key}"`) || f.src.includes(`'${key}'`)) ||
            fs.existsSync(path.join(componentDir, "schema.yml")) &&
              fs.readFileSync(path.join(componentDir, "schema.yml"), "utf8").includes(key);
          // Soft: variant key should be * or appear in schema/variants; still allow unknown for unfinished maps
          expect(knownVariant || key === "*").toBe(true);
        }
        for (const row of rows) {
          if (row.source === "universal-video") {
            expect(hasUniversalVideo).toBe(true);
          }
          if (row.source === "track") {
            expect(allSrc.includes(`track("${row.event}"`) || allSrc.includes(`track('${row.event}'`)).toBe(
              true,
            );
          }
          // section-tracking is global — no local track("cta_click") required
          expect(row.event).not.toMatch(/add_to_cart|click_begin_checkout|begin_checkout|purchase/);
        }
      }
    });
  }

  it("ai_flex_path micro map excludes payment Ecommerce events", () => {
    const file = files.find((f) => f.includes(`${path.sep}ai_flex_path${path.sep}`));
    expect(file).toBeTruthy();
    const raw = extractExport(fs.readFileSync(file!, "utf8")) as Record<
      string,
      Array<{ event: string }>
    >;
    const events = Object.values(raw).flat().map((r) => r.event);
    expect(events).toContain("cta_click");
    expect(events.some((e) => ["add_to_cart", "click_begin_checkout", "purchase"].includes(e))).toBe(
      false,
    );
  });
});
