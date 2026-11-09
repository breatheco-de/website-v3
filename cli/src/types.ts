export type DetectKind = "empty" | "project" | "dirty" | "needs_sites_yml";

export interface DetectResult {
  kind: DetectKind;
  root: string;
  issues?: string[];
  /** Present when kind is `needs_sites_yml` — existing `site_*` directories. */
  siteFolders?: string[];
}

export interface CliFlags {
  production: boolean;
  agenticInstallation: boolean;
  noMcpTunnel: boolean;
  /** Positional: `caxton-cms token` */
  command: "token" | null;
  name?: string;
  slug?: string;
  agent?: "local" | "cloud";
  yes: boolean;
  help: boolean;
  debug: boolean;
}

export type AgentChoice = "local" | "cloud" | null;

export interface ResolvedConfig {
  projectRoot: string;
  packageRoot: string;
  isProduction: boolean;
  detect: DetectResult;
  displayName?: string;
  contentSlug?: string;
  /** When kind was needs_sites_yml — entries to write (prompted before agent). */
  sitesYmlEntries?: { domain: string; contentFolder: string }[];
  wantAgent: boolean;
  agentChoice: AgentChoice;
  noMcpTunnel: boolean;
  command: "token" | null;
  /** From `--yes` / `-y` — non-interactive defaults when creating sites.yml. */
  yes: boolean;
}
