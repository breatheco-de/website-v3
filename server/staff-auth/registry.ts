import type { AuthConnector, AuthConnectorPublic } from "./types";
import { githubAuthConnector } from "./connectors/github";

const connectors: AuthConnector[] = [githubAuthConnector];

export function getAuthConnectors(): AuthConnectorPublic[] {
  return connectors
    .filter((c) => c.isConfigured())
    .map(({ id, label }) => ({ id, label }));
}

export function getAuthConnector(id: string): AuthConnector | null {
  return connectors.find((c) => c.id === id) ?? null;
}
