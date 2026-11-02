import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSiteContext } from "../lib/content.js";
import { assertSafeSegment } from "../lib/sanitize.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { SITE_PARAM_DESC } from "../lib/entry-helpers.js";
import { ok, fail, actionRequired, type NextAction } from "../lib/respond.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

function internalHeaders(mcpToken?: string, site?: string): Record<string, string> {
  return buildLoopbackHeaders(mcpToken, { site });
}

function api(path: string): string {
  return `http://127.0.0.1:${MAIN_SERVER_PORT}${path}`;
}

type Finding = {
  code: string;
  severity: "error" | "warning";
  viewport: string;
  section_path: string | null;
  section_type?: string;
  message: string;
  evidence?: Record<string, unknown>;
};

const FINDING_FIX_HINTS: Record<string, string> = {
  horizontal_overflow: "Something is wider than the viewport (usually mobile): shorten long words/URLs, pick a variant with fewer columns, or reduce items.",
  color_edge_without_padding: "Two different backgrounds meet with content touching the edge: give the colored section vertical padding (paddingY) or use the neighbor's background.",
  heading_order: "Headings skip a level: adjust the section's heading level or pick a variant whose title fits the outline.",
  multiple_h1: "More than one H1: only the first hero should own the H1.",
  empty_section: "The section rendered (almost) nothing: fill required fields or remove it.",
  broken_image: "An image failed to load: replace the src with a gallery image (get_or_set_media_to_gallery).",
  tight_gap: "Adjacent sections with the same background have almost no space between them: add padding or alternate backgrounds.",
  measurements_missing: "The preview never finished rendering: a section may crash; check get_entry_content and the component YAML.",
  learned_rule: "Approved pages on this site consistently do this differently: follow the rule or explain why this page is an exception.",
};

export function registerDesignTools(mcp: McpServer, mcpToken?: string, grants?: CatalogGrant[]): void {
  // get_page_recipe
  mcp.tool(
    "get_page_recipe",
    "Start here when designing or restructuring a page. Returns how this site's best layouts are put together, learned from component insights " +
      "(weighted by staff approval, GA4 performance vs expected, relevance to your content type/funnel stage, and locale): " +
      "skeleton slots (presence, required, 2–3 type/variant/background/spacing options with example pages), top layouts, variant pairings, " +
      "out-of-flow add-ons, and learned layout rules. Low-sample scopes fall back to a site-wide recipe (fallback: 'site_wide'). " +
      "For an entry attached to a shared template (or a shared-layout type) returns mode 'fields': the template owns sections — fill the bound fields instead. " +
      "Then call get_component_variant for chosen slots, preview with create_page_demo, and check with review_page_render. Requires content_view.",
    {
      contentType: z.string().optional().describe("Content type of the page you are building, e.g. 'landing'. Recommended."),
      intent: z.string().optional().describe("Insights intent (settings.yml page_intents), e.g. 'bootcamp'."),
      stage: z.enum(["awareness", "consideration", "decision", "post-enrollment"]).optional().describe("Funnel stage of the page (funnel.stage)."),
      locale: z.string().optional().describe("Locale you are building (pages in other locales weigh 0.2)."),
      slug: z.string().optional().describe("Existing entry slug: attached template entries return fields-mode."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, intent, stage, locale, slug, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      try {
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (slug) assertSafeSegment(slug, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }
      const params = new URLSearchParams();
      if (contentType) params.set("contentType", contentType);
      if (intent) params.set("intent", intent);
      if (stage) params.set("stage", stage);
      if (locale) params.set("locale", locale);
      if (slug) params.set("slug", slug);
      try {
        const res = await fetch(api(`/api/private/component-insights/recipe?${params}`), {
          headers: internalHeaders(mcpToken, siteResult.domain),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) return fail(String(json.error ?? `Failed to build recipe (${res.status})`), { http_status: res.status });

        if (json.mode === "fields") {
          return ok(json, {
            warnings: [
              {
                code: "template_owns_sections",
                message: `Sections come from the shared template (${String(json.template_file ?? "template file")}), used by ${String(json.attached_pages ?? "all attached")} pages. Fill the bound fields on this entry; do not add or reorder sections here. Changing the layout affects every attached page.`,
              },
            ],
            next_actions: [
              {
                tool: "get_entry_fields",
                priority: "recommended",
                reason: "Fill the entry fields listed under fields[].field — each is rendered in the listed template sections.",
                args_hint: { contentType, ...(slug ? { slug } : {}), ...(site ? { site } : {}) },
              },
              ...(slug
                ? [
                    {
                      tool: "review_page_render",
                      priority: "optional" as const,
                      reason: "Still useful on template entries: long titles, missing images and unfilled placeholders show up in screenshots.",
                      args_hint: { source: "entry", contentType, slug, ...(locale ? { locale } : {}), ...(site ? { site } : {}) },
                    },
                  ]
                : []),
              {
                tool: "explain_site",
                priority: "optional",
                reason: "Changing the template layout goes through a template proposal (or a staff-approved detach of this entry). Topic 'design' explains both paths.",
                args_hint: { topic: "design" },
              },
            ],
          });
        }

        const sample = (json.sample ?? {}) as Record<string, number>;
        const firstSlot = (Array.isArray(json.slots) ? json.slots : [])[0] as { options?: Array<{ type: string; variant: string }> } | undefined;
        const firstOpt = firstSlot?.options?.[0];
        return ok(json, {
          warnings: [
            ...(json.fallback === "site_wide"
              ? [
                  {
                    code: "recipe_site_wide_fallback",
                    message: `Only ${sample.scoped_layouts ?? 0} layouts match this scope (need 3); showing the site-wide recipe. Treat it as a starting point and lean on review_page_render screenshots to fine-tune.`,
                  },
                ]
              : []),
            ...((sample.approved ?? 0) === 0
              ? [
                  {
                    code: "recipe_no_approved_layouts",
                    message: "No staff-approved layouts in this sample yet; weights come from performance and usage only, and learned rules stay suggestions.",
                  },
                ]
              : []),
            ...(JSON.stringify(json.slots ?? []).includes("off_theme_background")
              ? [
                  {
                    code: "recipe_off_theme_backgrounds",
                    message:
                      "Some example pages use colors outside the theme (shown as off_theme_background, background: null). Do not copy them; pick a theme background ID instead (agents cannot write off-theme colors).",
                  },
                ]
              : []),
            {
              code: "recipe_is_guidance",
              message: "Recipes describe what works on this site; they are not validators. Theme IDs, text limits and the render-review publish gate still apply.",
            },
          ],
          next_actions: [
            {
              tool: "get_component_variant",
              priority: "recommended",
              reason: "Fetch fields + a worked example for each slot option you pick (check content_shape matches your content).",
              args_hint: firstOpt ? { componentType: firstOpt.type, variant: firstOpt.variant } : {},
            },
            {
              tool: "create_page_demo",
              priority: "optional",
              reason: "Try the assembled sections as a throwaway page before writing a draft.",
              args_hint: {},
            },
            {
              tool: "review_page_render",
              priority: "recommended",
              reason: "After writing the draft, screenshot desktop + mobile and fix layout findings before publish (required for agents on new/restructured pages).",
              args_hint: { source: "entry", ...(contentType ? { contentType } : {}) },
            },
          ],
        });
      } catch (e) {
        return fail(`Failed to build recipe: ${(e as Error).message}`);
      }
    },
  );

  // create_page_demo
  mcp.tool(
    "create_page_demo",
    "Create a disposable multi-section page preview (no entry, no publish) to try a layout before writing it to a draft. " +
      "Pass yaml = a sections array (or { sections: [...] }); every section is validated against its registry schema. " +
      "Returns hash + preview_url (/private/page-preview). Then call review_page_render { source: 'demo', hash } for screenshots and layout findings. " +
      "For pages you already drafted, skip this and review the entry directly. Wiped on redeploy. Requires content_view.",
    {
      yaml: z.string().describe("YAML: an array of section objects (or { sections: [...] }), same shape as entry sections."),
      locale: z.string().optional().describe("Locale for template variables and dynamic sections (default en)."),
      title: z.string().optional().describe("Optional label for humans opening the preview."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ yaml, locale, title, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      try {
        const res = await fetch(api("/api/page-demos"), {
          method: "POST",
          headers: internalHeaders(mcpToken, siteResult.domain),
          body: JSON.stringify({ yaml, ...(locale ? { locale } : {}), ...(title ? { title } : {}) }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(typeof json.error === "string" ? json.error : `Failed to create page demo (${res.status})`, {
            property_path: json.property_path,
            details: json.details,
            http_status: res.status,
          });
        }
        const hash = String(json.hash ?? "");
        return ok(
          {
            hash,
            preview_url: json.preview_url,
            path: json.path,
            section_count: json.section_count,
            fingerprint: json.fingerprint,
          },
          {
            warnings: [
              { code: "demo_not_a_publish", message: "No content YAML was written; nothing is live. Write the sections to a draft (create_entry / replace_entry_sections) when the layout is right." },
              { code: "demo_world_readable_with_url", message: "Anyone with preview_url can view it (hash is the secret). No secrets or private PII." },
              { code: "demo_wiped_on_redeploy", message: "Stored under .cache/page-demos/; deleted on every production redeploy." },
            ],
            side_effects: [
              {
                kind: "write_demo_file",
                summary: "Wrote ephemeral page demo YAML",
                ...(typeof json.path === "string" ? { paths: [json.path] } : {}),
              },
            ],
            next_actions: [
              {
                tool: "review_page_render",
                priority: "recommended",
                reason: "Screenshot the demo on desktop + mobile and get layout findings before committing to this structure.",
                args_hint: { source: "demo", hash, ...(site ? { site } : {}) },
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to create page demo: ${(e as Error).message}`);
      }
    },
  );

  // review_page_render
  mcp.tool(
    "review_page_render",
    "Render a page in a real browser (Cloudflare) on desktop 1440px and mobile 390px, keep full-page screenshots, and measure layout problems: " +
      "horizontal overflow, colored edges with no padding, heading order, multiple H1, empty sections, broken images, tight gaps (+ learned site rules when available). " +
      "Component layout traits (overlays, self-padded variants) suppress false positives. " +
      "source 'entry' reviews a live page, draft or variant (pass variant for drafts) and writes findings to the validation issue store (validator render-review, category design); " +
      "source 'demo' reviews a create_page_demo hash (findings returned only). Async: returns job_id — poll get_render_review. " +
      "Agents must have a fresh review (matching layout) before publish_draft / promote_variant on new or restructured entry-owned pages. Requires content_view.",
    {
      source: z.enum(["entry", "demo"]).describe("'entry' for a page/draft/variant, 'demo' for a create_page_demo hash."),
      contentType: z.string().optional().describe("source=entry: content type, e.g. 'landing'."),
      slug: z.string().optional().describe("source=entry: entry slug."),
      locale: z.string().optional().describe("source=entry: locale (default en)."),
      variant: z.string().optional().describe("source=entry: draft/variant slug (e.g. 'draft'). Omit for the live page."),
      hash: z.string().optional().describe("source=demo: hash from create_page_demo."),
      viewports: z.array(z.enum(["desktop", "mobile"])).optional().describe("Default both."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ source, contentType, slug, locale, variant, hash, viewports, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      let body: Record<string, unknown>;
      try {
        if (source === "demo") {
          if (!hash || !/^[a-f0-9]{32}$/.test(hash)) return fail("source=demo requires hash (32 hex chars from create_page_demo).");
          body = { source: "demo", hash };
        } else {
          if (!contentType || !slug) return fail("source=entry requires contentType and slug.");
          assertSafeSegment(contentType, "contentType");
          assertSafeSegment(slug, "slug");
          if (variant) assertSafeSegment(variant, "variant");
          body = { source: "entry", content_type: contentType, slug, locale: locale || "en", ...(variant ? { variant } : {}) };
        }
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const res = await fetch(api("/api/render-reviews"), {
          method: "POST",
          headers: internalHeaders(mcpToken, siteResult.domain),
          body: JSON.stringify({ ...body, ...(viewports?.length ? { viewports } : {}) }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (res.status === 503 && json.code === "render_review_unavailable") {
          return actionRequired(
            {
              success: false,
              action_required: "render_review_unavailable",
              code: "render_review_unavailable",
              message: String(json.error ?? "Render review is unavailable on this host."),
              warnings: [
                {
                  code: "render_review_unavailable",
                  message:
                    "Reviews need Cloudflare Browser Rendering credentials and a public SITE_URL on the host. While unavailable, publish_draft / promote_variant proceed with a render_review_unavailable warning instead of blocking.",
                },
              ],
              side_effects: [],
            },
            [
              {
                tool: "run_entry_diagnostics",
                priority: "recommended",
                reason: "Without screenshots, still run diagnostics (design validators: theme IDs, layout traits) on the draft.",
                args_hint: source === "entry" ? { slug, contentType, ...(site ? { site } : {}) } : {},
              },
            ],
          );
        }
        if (!res.ok) return fail(String(json.error ?? `Failed to start review (${res.status})`), { http_status: res.status });
        return ok(
          {
            job_id: json.job_id,
            status: json.status,
            viewports: json.viewports,
            retry_after_seconds: json.retry_after_seconds ?? 20,
          },
          {
            warnings: [
              { code: "review_takes_time", message: "Each viewport is a paced Cloudflare render (shared rate limit); expect 20–90s." },
              { code: "review_not_a_publish", message: "Reviews never change content or publish; they only record findings and screenshots." },
            ],
            side_effects: [
              {
                kind: "render_review_job",
                summary:
                  source === "entry"
                    ? "Started a review; on completion writes render-review issues for this entry to the validation store and records the layout fingerprint used by the publish gate"
                    : "Started a review of a page demo (findings returned only; nothing stored on entries)",
                paths: [`.cache/render-reviews/${String(json.job_id ?? "")}/`],
              },
            ],
            next_actions: [
              {
                tool: "get_render_review",
                priority: "required",
                reason: "Poll until status is completed, then fix error findings.",
                args_hint: { job_id: json.job_id, ...(site ? { site } : {}) },
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to start render review: ${(e as Error).message}`);
      }
    },
  );

  // get_render_review
  mcp.tool(
    "get_render_review",
    "Poll a review_page_render job. When completed returns findings grouped by section (code, severity, viewport, section_path, message, fix hint) and screenshot sizes. " +
      "include_images: true attaches downscaled full-page screenshots; crop_section: N attaches that section only (larger, for detail). Requires content_view.",
    {
      job_id: z.string().describe("job_id from review_page_render."),
      include_images: z.boolean().optional().describe("Attach downscaled full-page WebP screenshots (one per viewport)."),
      crop_section: z.number().int().min(0).optional().describe("Attach a crop of this section index instead of full pages."),
      viewport: z.enum(["desktop", "mobile"]).optional().describe("Limit attached images to one viewport."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ job_id, include_images, crop_section, viewport, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      if (!/^[a-f0-9]{24}$/.test(job_id)) return fail("Invalid job_id.");
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      try {
        const res = await fetch(api(`/api/render-reviews/${job_id}`), { headers: internalHeaders(mcpToken, siteResult.domain) });
        const job = (await res.json()) as Record<string, unknown>;
        if (!res.ok) return fail(String(job.error ?? `Review not found (${res.status})`), { http_status: res.status });
        const status = String(job.status);
        if (status === "queued" || status === "running") {
          return ok(
            { job_id, status, retry_after_seconds: 15 },
            {
              next_actions: [
                { tool: "get_render_review", priority: "required", reason: "Still rendering; poll again shortly.", args_hint: { job_id, ...(site ? { site } : {}) } },
              ],
            },
          );
        }
        if (status === "failed") {
          return fail(`Render review failed: ${String(job.error ?? "unknown error")}`, {
            job_id,
            status,
            next_actions: [
              {
                tool: "review_page_render",
                priority: "recommended",
                reason: "Retry once (rate limits / transient Cloudflare errors). If it fails again, the page may not render — check the entry YAML.",
                args_hint: (job.source as Record<string, unknown>) ?? {},
              },
            ],
          });
        }

        const findings = (Array.isArray(job.findings) ? job.findings : []) as Finding[];
        const bySection = new Map<string, Finding[]>();
        for (const f of findings) {
          const key = f.section_path ?? "page";
          bySection.set(key, [...(bySection.get(key) ?? []), f]);
        }
        const sections = [...bySection.entries()].map(([section_path, list]) => ({
          section_path,
          section_type: list.find((f) => f.section_type)?.section_type ?? null,
          findings: list.map((f) => ({
            code: `RENDER_${f.code.toUpperCase()}`,
            severity: f.severity,
            viewport: f.viewport,
            message: f.message,
            fix_hint: FINDING_FIX_HINTS[f.code] ?? null,
            ...(f.evidence ? { evidence: f.evidence } : {}),
          })),
        }));
        const errors = findings.filter((f) => f.severity === "error").length;
        const warnings = findings.length - errors;
        const src = (job.source ?? {}) as Record<string, unknown>;
        const isEntry = src.source === "entry";
        const entryArgs = isEntry
          ? {
              slug: src.slug,
              contentType: src.contentType,
              locale: src.locale,
              ...(src.variant ? { variant: src.variant } : {}),
              ...(site ? { site } : {}),
            }
          : {};

        const next_actions: NextAction[] = [];
        if (errors > 0) {
          next_actions.push({
            tool: isEntry ? "update_fields" : "create_page_demo",
            priority: "required",
            reason: isEntry
              ? "Fix error findings on the draft (padding, variant, content), then re-run review_page_render."
              : "Adjust the demo YAML to fix error findings, then review the new hash.",
            args_hint: entryArgs,
          });
        }
        if (isEntry && errors === 0) {
          next_actions.push({
            tool: "run_entry_diagnostics",
            priority: "recommended",
            reason: "Check the design validators (theme IDs, rich-text styles, layout traits, learned rules) alongside this review before publishing.",
            args_hint: { slugs: [src.slug], categories: ["design"], freshness: "hard", ...(site ? { site } : {}) },
          });
        }
        if (isEntry && errors === 0 && src.variant) {
          next_actions.push({
            tool: "publish_draft",
            priority: "optional",
            reason: "Layout reviewed with no errors — publish (or promote_variant for an existing live page) once the user confirms.",
            args_hint: { contentType: src.contentType, slug: src.slug, variantSlug: src.variant, ...(site ? { site } : {}) },
          });
        }
        if (!include_images && crop_section === undefined) {
          next_actions.push({
            tool: "get_render_review",
            priority: "optional",
            reason: "Look at the screenshots (include_images) or zoom into a flagged section (crop_section).",
            args_hint: { job_id, include_images: true },
          });
        }

        const issueStore = (job.issue_store ?? {}) as Record<string, unknown>;
        const result = ok(
          {
            job_id,
            status,
            fingerprint: job.fingerprint ?? null,
            summary: { errors, warnings, dropped_by_layout_traits: job.dropped_by_traits ?? 0 },
            sections,
            images: job.images ?? [],
            issue_store: issueStore,
          },
          {
            warnings: [
              ...(isEntry && issueStore.written !== true
                ? [{ code: "issues_not_stored", message: `Findings were not written to the issue store: ${String(issueStore.reason ?? "unknown")}. The review still counts for the publish gate.` }]
                : []),
              ...(job.images && (job.images as Array<{ cropped?: boolean }>).some((i) => i.cropped)
                ? [{ code: "screenshot_cropped", message: "Page is taller than the capture limit; the bottom is not in the screenshot (measurements still cover the whole page)." }]
                : []),
            ],
            next_actions,
          },
        );

        const wantImages = include_images || crop_section !== undefined;
        if (!wantImages) return result;
        const vps = (viewport ? [viewport] : ((job.viewports as string[]) ?? ["desktop", "mobile"])) as string[];
        const blocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
        for (const vp of vps) {
          const q = new URLSearchParams({ viewport: vp });
          if (crop_section !== undefined) q.set("section_index", String(crop_section));
          const imgRes = await fetch(api(`/api/render-reviews/${job_id}/image?${q}`), {
            headers: internalHeaders(mcpToken, siteResult.domain),
          });
          if (!imgRes.ok) continue;
          blocks.push({ type: "image", data: Buffer.from(await imgRes.arrayBuffer()).toString("base64"), mimeType: "image/webp" });
        }
        return { content: [...result.content, ...blocks] } as unknown as typeof result;
      } catch (e) {
        return fail(`Failed to read render review: ${(e as Error).message}`);
      }
    },
  );
}
