/**
 * Content-type keys and database slugs share one namespace for relation /
 * query-options `source`. Kept free of imports from `database` / `query-options`
 * so create paths can call these helpers under pure ESM (no lazy `require`).
 */
import { getAllTypes, getContentTypeConfig } from "./content-types";
import { child } from "./logger";

const log = child({ module: "source-namespace" });

/** Minimal DB surface needed for namespace checks (avoids importing DatabaseManager). */
export type SourceNamespaceDb = {
  exists(name: string): boolean;
  list(): { name: string }[];
};

export type ResolvedSource =
  | { kind: "contentType"; name: string }
  | { kind: "database"; name: string }
  | { kind: "collision"; name: string }
  | { kind: "not_found"; name: string };

/** Exact-name collisions between content-type keys and database slugs. */
export function findSourceNameCollisions(
  contentRoot: string | undefined,
  db: SourceNamespaceDb,
): string[] {
  const dbNames = new Set(db.list().map((d) => d.name));
  return getAllTypes(contentRoot).filter((t) => dbNames.has(t));
}

export function logSourceNameCollisions(
  contentRoot: string | undefined,
  db: SourceNamespaceDb,
): string[] {
  const collisions = findSourceNameCollisions(contentRoot, db);
  if (collisions.length > 0) {
    log.error(
      { collisions },
      "[SourceNamespace] Content type keys collide with database slugs — rename one side so `source` is unambiguous",
    );
  }
  return collisions;
}

export function resolveSourceName(
  name: string,
  contentRoot: string | undefined,
  db: SourceNamespaceDb,
): ResolvedSource {
  if (!name) return { kind: "not_found", name };

  const hasType = !!getContentTypeConfig(name, contentRoot);
  const hasDb = db.exists(name);

  if (hasType && hasDb) return { kind: "collision", name };
  if (hasType) return { kind: "contentType", name };
  if (hasDb) return { kind: "database", name };
  return { kind: "not_found", name };
}

/**
 * Reject creating a name that already exists on the other side of the
 * content-type / database namespace.
 */
export function assertSourceNameAvailable(
  name: string,
  as: "contentType" | "database",
  contentRoot: string | undefined,
  db: SourceNamespaceDb,
): void {
  if (!name) throw new Error("Source name is required");
  if (as === "contentType" && db.exists(name)) {
    throw new Error(
      `Cannot create content type "${name}": a database with the same slug already exists. Content-type keys and database slugs must be unique across both namespaces.`,
    );
  }
  if (as === "database" && getContentTypeConfig(name, contentRoot)) {
    throw new Error(
      `Cannot create database "${name}": a content type with the same key already exists. Content-type keys and database slugs must be unique across both namespaces.`,
    );
  }
}
