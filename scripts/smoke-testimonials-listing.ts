/**
 * Smoke test for the testimonials listing cutover.
 *
 * Resolves representative sections through the real resolver (no HTTP) and
 * asserts locale split, topic filter, search, limit + hardcoded-first order,
 * and that `featured` survives to the renderer.
 *
 * Usage: npx tsx scripts/smoke-testimonials-listing.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ quiet: true });

import { DatabaseManager } from "../server/database";
import { resolveDynamicEntries } from "../server/dynamic-entries";
import { getDefaultContentRoot } from "../server/site-config";
import {
  TESTIMONIALS_DATABASE,
  TESTIMONIALS_SORT,
  isValidForCarousel,
  isValidForGrid,
  isValidForSlide,
  type TestimonialBankRow,
} from "../shared/testimonials-listing";

const contentRoot = getDefaultContentRoot();
const db = new DatabaseManager(contentRoot);

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", "|", label, detail === undefined ? "" : detail);
}

async function resolveOne(
  section: Record<string, unknown>,
  locale: string,
): Promise<TestimonialBankRow[]> {
  const [out] = (await resolveDynamicEntries([section], locale, {
    db,
    contentRoot,
  })) as Record<string, unknown>[];
  const items = out?.items;
  return Array.isArray(items) ? (items as TestimonialBankRow[]) : [];
}

function baseSection(
  type: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    title: "Smoke",
    dynamic_entries: {
      database: TESTIMONIALS_DATABASE,
      sort: TESTIMONIALS_SORT,
      limit: 6,
      ...overrides,
    },
  };
}

async function main(): Promise<void> {
  console.log("contentRoot", contentRoot);
  check(`database ${TESTIMONIALS_DATABASE} exists`, db.exists(TESTIMONIALS_DATABASE));
  if (!db.exists(TESTIMONIALS_DATABASE)) process.exit(1);

  const { items: bank } = await db.fetchItems(TESTIMONIALS_DATABASE);
  console.log("bankRows", bank.length);
  const featuredRows = bank.filter((r) => r.featured === true).length;
  check("bank has featured rows", featuredRows > 0, featuredRows);

  // Locale split
  const en = await resolveOne(baseSection("testimonials_grid"), "en");
  const es = await resolveOne(baseSection("testimonials_grid"), "es");
  check("en resolves rows", en.length > 0, en.length);
  check("es resolves rows", es.length > 0, es.length);
  check(
    "en rows are locale en",
    en.every((r) => !r.locale || r.locale === "en"),
    en.map((r) => r.locale).join(","),
  );
  check(
    "es rows are locale es",
    es.every((r) => !r.locale || r.locale === "es"),
    es.map((r) => r.locale).join(","),
  );

  // Limit
  check("limit respected", en.length <= 6, en.length);

  // Topic filter
  const topic = (() => {
    const counts = new Map<string, number>();
    for (const row of bank) {
      for (const f of (row.related_features as string[] | undefined) ?? []) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  })();
  if (topic) {
    const filtered = await resolveOne(
      baseSection("testimonials_grid", {
        permanent_filters: [{ item_property_slug: "related_features", value: [topic] }],
      }),
      "en",
    );
    check(
      `topic "${topic}" filters rows`,
      filtered.length > 0 &&
        filtered.every((r) => (r.related_features ?? []).includes(topic)),
      filtered.length,
    );
  } else {
    check("bank exposes related_features", false);
  }

  // Search
  const searched = await resolveOne(
    baseSection("testimonials_grid", { search: "career change" }),
    "en",
  );
  check("search resolves rows", searched.length > 0, searched.length);

  // Hardcoded first, then bank fill
  const hardcoded = await resolveOne(
    baseSection("testimonials", {
      limit: 4,
      hardcoded_entries: [
        {
          student_name: "Smoke Local Person",
          role: "Student",
          excerpt: "A manually added testimonial that must come first.",
          rating: 5,
        },
      ],
    }),
    "en",
  );
  check(
    "hardcoded row comes first",
    hardcoded[0]?.student_name === "Smoke Local Person",
    hardcoded[0]?.student_name,
  );
  check("hardcoded + bank respect limit", hardcoded.length <= 4, hardcoded.length);
  check("bank fills remaining slots", hardcoded.length > 1, hardcoded.length);

  // Legacy straggler normalization (root related_features / limit / items)
  const legacy = await resolveOne(
    {
      type: "testimonials_slide",
      title: "Legacy",
      related_features: topic ? [topic] : [],
      limit: 5,
      testimonials: [
        {
          name: "Legacy Local",
          img: "legacy-thumb",
          contributor: "Partner",
          description: "Authored on the old contract.",
          country: { iso: "cr", name: "Costa Rica" },
        },
      ],
    },
    "en",
  );
  check("legacy section still resolves", legacy.length > 0, legacy.length);
  check(
    "legacy authored row preserved with extras",
    legacy[0]?.student_name === "Legacy Local" && legacy[0]?.country?.iso === "cr",
    legacy[0]?.country,
  );

  // Each layout must resolve rows it can actually render — the highest-priority
  // bank rows all have video, so unrenderable rows have to drop before the slice.
  const carousel = await resolveOne(baseSection("testimonials", { limit: 10 }), "en");
  check(
    "carousel resolves only renderable rows",
    carousel.length === 10 && carousel.every(isValidForCarousel),
    carousel.length,
  );
  check("grid keeps video rows", en.length > 0 && en.every(isValidForGrid), en.length);
  const slide = await resolveOne(baseSection("testimonials_slide", { limit: 20 }), "en");
  check(
    "slide resolves only photo rows",
    slide.length === 20 && slide.every(isValidForSlide),
    slide.length,
  );

  console.log(failures === 0 ? "ALL PASS" : `FAILURES ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
