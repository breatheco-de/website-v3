/**
 * Cascade helpers when deleting relation targets (e.g. authors → blog.authors).
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { getContentTypeConfig, getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { contentIndex } from "./content-index";
import { child } from "./logger";

const log = child({ module: "relation-delete" });

export const DEFAULT_ORG_AUTHOR_SLUG = "4geeks-academy";

export type DependentAuthorPost = {
  contentType: string;
  slug: string;
  authors: string[];
  wouldBeEmpty: boolean;
};

export type RelationDeletePreview = {
  blocked: string[];
  dependents: DependentAuthorPost[];
  needs_reassignment: DependentAuthorPost[];
  default_author_slug: string;
};

function readCommonAuthors(
  contentRoot: string,
  contentType: string,
  slug: string,
): string[] {
  const folder = getFolder(contentType, contentRoot);
  const commonPath = path.join(contentRoot, folder, slug, "_common.yml");
  if (!fs.existsSync(commonPath)) return [];
  try {
    const data = (yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) || {};
    const raw = data.authors;
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw === "string" && raw.trim()) return [raw.trim()];
    return [];
  } catch {
    return [];
  }
}

function writeCommonAuthors(
  contentRoot: string,
  contentType: string,
  slug: string,
  authors: string[],
  author?: string,
): void {
  const folder = getFolder(contentType, contentRoot);
  const commonPath = path.join(contentRoot, folder, slug, "_common.yml");
  let data: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    data = (yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) || {};
  }
  data.authors = authors;
  fs.writeFileSync(commonPath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
  markFileAsModified(commonPath, author, undefined, contentRoot);
}

/** List blog posts that reference any of the author slugs being deleted. */
export function previewAuthorDeleteCascade(
  authorSlugs: string[],
  contentRoot?: string,
): RelationDeletePreview {
  const root = contentRoot ?? getDefaultContentRoot();
  const config = getContentTypeConfig("authors", root);
  const protectedSlugs = new Set(config?.protected_slugs || [DEFAULT_ORG_AUTHOR_SLUG]);
  const blocked = authorSlugs.filter((s) => protectedSlugs.has(s));
  const deleting = new Set(authorSlugs.filter((s) => !protectedSlugs.has(s)));

  const dependents: DependentAuthorPost[] = [];
  if (deleting.size === 0) {
    return {
      blocked,
      dependents,
      needs_reassignment: [],
      default_author_slug: DEFAULT_ORG_AUTHOR_SLUG,
    };
  }

  const blogFolder = getFolder("blog", root);
  const blogDir = path.join(root, blogFolder);
  if (!fs.existsSync(blogDir)) {
    return {
      blocked,
      dependents,
      needs_reassignment: [],
      default_author_slug: DEFAULT_ORG_AUTHOR_SLUG,
    };
  }

  for (const entry of fs.readdirSync(blogDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const authors = readCommonAuthors(root, "blog", entry.name);
    if (!authors.some((a) => deleting.has(a))) continue;
    const remaining = authors.filter((a) => !deleting.has(a));
    dependents.push({
      contentType: "blog",
      slug: entry.name,
      authors,
      wouldBeEmpty: remaining.length === 0,
    });
  }

  return {
    blocked,
    dependents,
    needs_reassignment: dependents.filter((d) => d.wouldBeEmpty),
    default_author_slug: DEFAULT_ORG_AUTHOR_SLUG,
  };
}

/**
 * Apply cascade: remove deleted author slugs from blog.authors.
 * `reassignments` maps blog slug → replacement author slug[] when the post would become empty.
 * Defaults missing reassignments to [defaultAuthorSlug].
 */
export function applyAuthorDeleteCascade(
  authorSlugs: string[],
  opts: {
    contentRoot?: string;
    author?: string;
    reassignments?: Record<string, string[]>;
    defaultAuthorSlug?: string;
  } = {},
): { updated: string[]; errors: Array<{ slug: string; error: string }> } {
  const root = opts.contentRoot ?? getDefaultContentRoot();
  const defaultAuthor = opts.defaultAuthorSlug || DEFAULT_ORG_AUTHOR_SLUG;
  const preview = previewAuthorDeleteCascade(authorSlugs, root);
  const deleting = new Set(authorSlugs.filter((s) => !preview.blocked.includes(s)));
  const updated: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const dep of preview.dependents) {
    try {
      let next = dep.authors.filter((a) => !deleting.has(a));
      if (next.length === 0) {
        const reassigned = opts.reassignments?.[dep.slug];
        next =
          Array.isArray(reassigned) && reassigned.length > 0
            ? reassigned.map(String).filter(Boolean)
            : [defaultAuthor];
      }
      writeCommonAuthors(root, "blog", dep.slug, next, opts.author);
      updated.push(dep.slug);
    } catch (err) {
      errors.push({
        slug: dep.slug,
        error: err instanceof Error ? err.message : String(err),
      });
      log.warn({ err, slug: dep.slug }, "[relation-delete] cascade failed");
    }
  }

  try {
    contentIndex.invalidateCommonFields("blog");
  } catch {
    /* ignore */
  }

  return { updated, errors };
}

export function isProtectedContentSlug(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  const config = getContentTypeConfig(contentType, contentRoot);
  return !!config?.protected_slugs?.includes(slug);
}
