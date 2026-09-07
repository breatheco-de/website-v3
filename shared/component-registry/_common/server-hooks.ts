/**
 * Server-side hooks a component type may declare. The platform (save route,
 * demo endpoint) calls whatever hooks a component's registry entry exports —
 * it never names a component. A component with no server behavior simply
 * doesn't register; everything here is optional.
 *
 * Implementations live in the component's own registry directory
 * (shared/component-registry/<type>/<version>/server.ts) and are loaded
 * lazily via the manifest in shared/component-registry/server-hooks.ts —
 * a hook module must not be imported at platform module load time (heavy
 * renderers belong behind a dynamic import).
 */

export interface ComponentSaveRejection {
  /** Stable machine-readable error code returned on a 422 (wire contract). */
  code: string;
  /** Human/agent-facing message explaining how to fix and retry. */
  message: string;
}

export interface ComponentServerHooks {
  /**
   * Validate one section of this component's type at save time. Returned
   * strings are violations: any violation rejects the whole save with a 422
   * carrying `saveRejection`. Return [] to accept.
   */
  validateSection?(section: Record<string, unknown>): Promise<string[]>;

  /**
   * Validate a single-field update targeting `sections.<n>.<field>` at save
   * time. Called for every registered component (the platform cannot know
   * which type owns the section from the operation alone), so implementations
   * must return [] for fields that aren't theirs.
   */
  validateFieldUpdate?(field: string, value: unknown): Promise<string[]>;

  /** Rejection envelope used when validateSection/validateFieldUpdate find violations. */
  saveRejection?: ComponentSaveRejection;

  /**
   * Render this component for a demo/preview so the caller (usually an MCP
   * agent) gets the same authoring warnings the editor shows a human.
   */
  previewSection?(
    section: Record<string, unknown>,
  ): Promise<{ warnings?: string[]; error?: string }>;
}
