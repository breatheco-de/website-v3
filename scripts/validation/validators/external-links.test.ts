import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dump } from "js-yaml";
import type { ContentFile, ValidationContext } from "../shared/types";
import { externalLinksValidator } from "./external-links";
import { applyCheckResult, LINK_STATUS_FILENAME, type LinkStatusRecord } from "../../../server/link-check/status-store";
import { _resetLinkIndexStateForTests, rebuildLinkIndex } from "../../../server/link-index";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-10-20T00:00:00.000Z");
const at = (d: number) => new Date(t0.getTime() + d * DAY);

const COURSE_REPORT = "https://www.coursereport.com/research/coding-bootcamp-market-sizing-2025";
const MAKE_IT_REAL = "https://makeitreal.camp/programa-becas-de-bootcamp-proinnovate-2024/";
const COVER = "https://storage.googleapis.com/breathecode-prod-images/media/portada.jpg";
const KEEPCODING = "https://keepcoding.io/becas-bootcamps/";
const BLOCKED = "https://www.linkedin.com/in/someone";
const VERIFIED = "https://verified.example/page";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function twice(result: Parameters<typeof applyCheckResult>[1]): LinkStatusRecord {
  return applyCheckResult(applyCheckResult(undefined, result, at(0)), result, at(4));
}

function fixture(): { context: ValidationContext; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-links-"));
  dirs.push(root);
  const content = [
    `Según [Course Report](${COURSE_REPORT}), y [otra vez](${COURSE_REPORT}).`,
    `![Portada](${COVER})`,
    `[Make It Real](${MAKE_IT_REAL}) [KeepCoding](${KEEPCODING}) [LinkedIn](${BLOCKED}) [ok](${VERIFIED})`,
  ].join("\n");
  const dir = path.join(root, "blog", "como-pagar-bootcamp-programacion");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "es.yml");
  fs.writeFileSync(filePath, dump({ title: "Cómo pagar", content, sections: [] }));

  const gone = { status: "gone" as const, reason: "not_found" as const, http_status: 404 };
  const urls: Record<string, LinkStatusRecord> = {
    [COURSE_REPORT]: twice(gone),
    [COVER]: applyCheckResult(undefined, gone, at(4)),
    [MAKE_IT_REAL]: twice({ status: "unreachable", reason: "unreachable", error: "ERR_TLS_CERT_ALTNAME_INVALID" }),
    [KEEPCODING]: twice({ status: "ok", http_status: 200 }),
    [BLOCKED]: twice({ status: "unknown", http_status: 999 }),
    [VERIFIED]: { ...twice(gone), verified_ok: { by: "staff", at: at(5).toISOString(), reason: "works" } },
  };
  fs.writeFileSync(path.join(root, LINK_STATUS_FILENAME), JSON.stringify({ version: 1, updated_at: "x", urls }));

  _resetLinkIndexStateForTests();
  rebuildLinkIndex({}, root, {
    "blog/como-pagar-bootcamp-programacion/es": [COURSE_REPORT, COVER],
    "blog/otro-post/es": [COURSE_REPORT],
  });

  const file: ContentFile = {
    slug: "como-pagar-bootcamp-programacion",
    title: "Cómo pagar",
    type: "blog",
    locale: "es",
    filePath,
    entryFields: { title: "Cómo pagar", content },
  };
  return {
    root,
    context: {
      contentFiles: [file],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
      contentRoot: root,
    } as ValidationContext,
  };
}

describe("externalLinksValidator", () => {
  it("reports confirmed dead links once per URL, own-storage images as errors, and stays quiet otherwise", async () => {
    const { context } = fixture();
    const result = await externalLinksValidator.run(context);

    expect(result.errors.map((e) => [e.code, e.externalLink?.url])).toEqual([["OWN_MEDIA_GONE", COVER]]);
    expect(result.warnings.map((w) => [w.code, w.externalLink?.url])).toEqual([
      ["EXTERNAL_LINK_GONE", COURSE_REPORT],
      ["EXTERNAL_LINK_UNREACHABLE", MAKE_IT_REAL],
    ]);

    const gone = result.warnings[0]!;
    expect(gone.externalLink).toMatchObject({
      field_paths: ["content"],
      reason: "not_found",
      gone_streak: 2,
      other_entries_using_url: 1,
      archive_lookup: `https://web.archive.org/web/${COURSE_REPORT}`,
    });
    expect(gone.message).toContain("Also used on 1 other page.");
  });

  it("reports nothing when no link has a saved status yet", async () => {
    const { context, root } = fixture();
    fs.rmSync(path.join(root, LINK_STATUS_FILENAME));
    const result = await externalLinksValidator.run(context);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
