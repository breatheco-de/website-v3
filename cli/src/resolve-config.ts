import path from "path";
import { getPackageRoot, getProjectRoot, isProductionMode, resetPathCaches } from "../../shared/paths.js";
import { detectProject } from "./detect.js";
import { resolveSitesYmlEntries } from "./commands/ensure-sites-yml.js";
import { askAgentChoice, askText, askYesNo, canPrompt } from "./prompts.js";
import type { CliFlags, ResolvedConfig } from "./types.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "site";
}

/**
 * Precedence: flags > answers > defaults > refuse.
 */
export async function resolveConfig(flags: CliFlags): Promise<ResolvedConfig> {
  resetPathCaches();
  if (flags.production) {
    process.env.NODE_ENV = "production";
  }

  const projectRoot = getProjectRoot();
  const packageRoot = getPackageRoot();
  const isProduction = isProductionMode(process.argv) || flags.production;
  const detect = detectProject(projectRoot);

  let displayName = flags.name;
  let contentSlug = flags.slug;
  let wantAgent = false;
  let agentChoice = flags.agent ?? null;
  let sitesYmlEntries: ResolvedConfig["sitesYmlEntries"];

  if (detect.kind === "empty" && !isProduction) {
    if (!displayName) {
      if (!canPrompt() && !flags.yes) {
        throw new Error("Creating a site requires --name (or an interactive terminal).");
      }
      displayName = canPrompt()
        ? await askText("Site display name", "My Site")
        : "My Site";
    }
    if (!contentSlug) {
      contentSlug = slugify(displayName);
      if (canPrompt() && !flags.slug) {
        contentSlug = (await askText("Content folder slug (site_<slug>)", contentSlug)) || contentSlug;
      }
    }
    contentSlug = contentSlug.replace(/^site_/, "");
  }

  if ((detect.kind === "empty" || detect.kind === "needs_sites_yml") && isProduction) {
    throw new Error(
      detect.kind === "needs_sites_yml"
        ? "Production mode will not create sites.yml on the server. Add sites.yml locally, then deploy the folder."
        : "Production mode will not create a new site on the server. Create the project locally, then deploy the folder.",
    );
  }

  if (detect.kind === "dirty") {
    throw new Error((detect.issues ?? ["Invalid project directory"]).join("\n"));
  }

  // Partial config for sites.yml prompting (before agent questions).
  const partial: ResolvedConfig = {
    projectRoot,
    packageRoot,
    isProduction,
    detect,
    displayName,
    contentSlug: contentSlug?.replace(/^site_/, ""),
    wantAgent: false,
    agentChoice: null,
    noMcpTunnel: flags.noMcpTunnel,
    command: flags.command,
    yes: flags.yes,
  };

  if (detect.kind === "needs_sites_yml" && !isProduction && !flags.command) {
    sitesYmlEntries = await resolveSitesYmlEntries(partial);
  }

  const skipInteractive =
    isProduction || (!canPrompt() && detect.kind === "project");

  // Agent prompts only for bare `npx caxton-cms` (start site). Skip for commands like `token`.
  if (!isProduction && detect.kind !== "dirty" && !flags.command) {
    if (flags.agenticInstallation) {
      wantAgent = true;
    } else if (skipInteractive) {
      wantAgent = false;
    } else if (canPrompt()) {
      wantAgent = await askYesNo(
        "Want an agent (Cursor / Claude Code / Claude.ai) to help install and configure this site?",
        true,
      );
    }

    if (wantAgent && !agentChoice) {
      if (flags.noMcpTunnel) {
        agentChoice = "local";
      } else if (canPrompt()) {
        agentChoice = await askAgentChoice();
      } else {
        agentChoice = "local";
      }
    }
  }

  if (isProduction && flags.agenticInstallation) {
    console.warn("Ignoring --agentic-installation in production (dev-only).");
  }

  return {
    ...partial,
    sitesYmlEntries,
    wantAgent: wantAgent && !isProduction,
    agentChoice: isProduction ? null : agentChoice,
  };
}

export { path };
