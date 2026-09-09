import fs from "fs";
import path from "path";
import { ensureSiteScaffold } from "../../../server/site-scaffold.js";
import { contentFolderName, sitesYmlForLocalhost, projectGitignore } from "../resolve-config.js";
import { ensureEnvFile } from "../lib/env-file.js";
import { resetPathCaches } from "../../../shared/paths.js";
import type { ResolvedConfig } from "../types.js";

export async function createProject(config: ResolvedConfig): Promise<void> {
  const { projectRoot, displayName, contentSlug } = config;
  if (!contentSlug || !displayName) {
    throw new Error("Missing name/slug for create");
  }

  const folder = contentFolderName(contentSlug);
  const prev = process.cwd();
  try {
    process.chdir(projectRoot);
    resetPathCaches();
    ensureSiteScaffold({
      contentFolder: folder,
      displayName,
      includeSampleContent: true,
    });
  } finally {
    process.chdir(prev);
    resetPathCaches();
  }

  fs.writeFileSync(path.join(projectRoot, "sites.yml"), sitesYmlForLocalhost(folder));
  const gi = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, projectGitignore());
  }
  ensureEnvFile(projectRoot);

  const createdWith = path.join(projectRoot, ".local", "created-with.json");
  fs.mkdirSync(path.dirname(createdWith), { recursive: true });
  const version = readEngineVersion(config.packageRoot);
  fs.writeFileSync(
    createdWith,
    JSON.stringify({ weblify: version, at: new Date().toISOString() }, null, 2) + "\n",
  );
}

function readEngineVersion(packageRoot: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
