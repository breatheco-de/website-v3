export type DetectKind = "empty" | "project" | "dirty";

export interface DetectResult {
  kind: DetectKind;
  root: string;
  issues?: string[];
}

export interface CliFlags {
  production: boolean;
  agenticInstallation: boolean;
  noMcpTunnel: boolean;
  /** Positional: `weblify token` */
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
  wantAgent: boolean;
  agentChoice: AgentChoice;
  noMcpTunnel: boolean;
  command: "token" | null;
}
