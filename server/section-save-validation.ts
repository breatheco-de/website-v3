/**
 * Save-time section validation, component-agnostic: walks a set of edit
 * operations, finds the sections they introduce or rewrite, and runs
 * whatever server hooks each section's component type declares
 * (shared/component-registry/server-hooks.ts). Platform code here knows the
 * edit-operation shapes; what a valid section looks like is each
 * component's own business.
 */
import {
  allComponentServerHooks,
  getComponentServerHooks,
} from "@shared/component-registry/server-hooks";
import type {
  ComponentServerHooks,
  SectionValidationContext,
  SectionValidationVerdict,
} from "@shared/component-registry/_common/server-hooks";
import { listDemoSections } from "./component-section-demos";

export type SectionSaveResult =
  | { ok: true }
  | { ok: false; code: string; message: string; violations: string[] };

const SECTION_FIELD_PATH = /^sections\.\d+\.([A-Za-z0-9_]+)$/;

function buildContext(isMcpAuthor: boolean): SectionValidationContext {
  return {
    isMcpAuthor,
    listDemoSections: (componentType) => listDemoSections(componentType),
  };
}

/** Fold a hook's verdict into the route's rejection shape, or null to accept. */
function toRejection(
  verdict: SectionValidationVerdict,
  hooks: ComponentServerHooks,
  fallbackMessage: string,
): SectionSaveResult | null {
  const violations = Array.isArray(verdict) ? verdict : verdict.violations;
  if (!violations.length) return null;
  const override = Array.isArray(verdict) ? undefined : verdict;
  return {
    ok: false,
    code: override?.code ?? hooks.saveRejection?.code ?? "section_validation",
    message:
      override?.message ?? hooks.saveRejection?.message ?? fallbackMessage,
    violations,
  };
}

export async function validateSectionOperations(
  operations: ReadonlyArray<Record<string, unknown>>,
  opts: { isMcpAuthor: boolean },
): Promise<SectionSaveResult> {
  const ctx = buildContext(opts.isMcpAuthor);
  for (const op of operations) {
    // Every shape a section can enter the edit endpoint through. The real
    // MCP add tool sends {action:"add_item", path:"sections", item:{...}};
    // update_section carries `section`; the simplified single-op format
    // normalizes to `section` upstream but `sectionData` is accepted for
    // safety. Each of these was found the hard way: three probe rounds each
    // caught the old guard reading a pocket the writer ignored while the
    // writer used one the guard ignored.
    const data = (op?.item ?? op?.section ?? op?.sectionData) as
      | Record<string, unknown>
      | undefined;
    if (data && typeof data.type === "string") {
      const hooks = await getComponentServerHooks(data.type);
      if (hooks?.validateSection) {
        const rejection = toRejection(
          await hooks.validateSection(data, ctx),
          hooks,
          `${data.type} section rejected: fix the reported violations and retry`,
        );
        if (rejection) return rejection;
      }
      continue;
    }

    // update_field aimed at one field of one section. The operation alone
    // doesn't say which component type owns that section, so this fans out
    // to every registered hook set; implementations ignore fields that
    // aren't theirs.
    if (op?.action === "update_field" && typeof op.path === "string") {
      const m = SECTION_FIELD_PATH.exec(op.path);
      if (!m) continue;
      for (const hooksPromise of allComponentServerHooks()) {
        const hooks = await hooksPromise;
        if (!hooks.validateFieldUpdate) continue;
        const rejection = toRejection(
          await hooks.validateFieldUpdate(m[1], op.value, ctx),
          hooks,
          "section field update rejected: fix the reported violations and retry",
        );
        if (rejection) return rejection;
      }
    }
  }
  return { ok: true };
}
