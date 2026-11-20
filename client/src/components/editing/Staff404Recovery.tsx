import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { isDebugModeActive } from "@/hooks/useDebugAuth";
import { useEnterVisualEditMode } from "@/hooks/useEnterVisualEditMode";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import Staff404Layout from "@/components/editing/Staff404Layout";
import type { Staff404Surface } from "@/lib/staff404";

/** Shown on public 404 copy when DebugBubble is active but the page is still in read mode. */
export function Staff404SwitchToEditHint({
  locale = "en",
  contentType,
  slug,
}: {
  locale?: string;
  contentType?: string;
  slug?: string;
}) {
  const editMode = useEditModeOptional();
  const enterVisualEdit = useEnterVisualEditMode();
  const [visible, setVisible] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setVisible(isDebugModeActive() && !!editMode && !editMode.isEditMode);
  }, [editMode, editMode?.isEditMode]);

  if (!visible || !editMode) return null;

  const isEs = locale === "es";

  return (
    <div className="mt-2 text-left" data-testid="staff-404-switch-to-edit">
      <p className="text-sm text-muted-foreground">
        {isEs ? "Puedes " : "You can "}
        <button
          type="button"
          className="underline underline-offset-2 text-foreground hover:text-primary"
          onClick={() => enterVisualEdit({ contentType, slug })}
          data-testid="link-switch-to-edit-mode"
        >
          {isEs ? "cambiar a modo edición" : "switch to edit mode"}
        </button>
        {isEs
          ? " para más información sobre el error. Si esta URL corresponde a un tipo de contenido, se abre la vista previa del staff; si no, te quedas en esta página."
          : " for more information about the error. If this URL maps to a content type, that opens the staff preview; otherwise you stay on this page."}
      </p>
      <div className="mt-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="button-switch-to-edit-advanced"
        >
          {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>
        {showAdvanced && (
          <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">How switch to edit mode works</p>
            <p>
              <code className="text-[11px] font-mono">enterVisualEditMode</code> in{" "}
              <code className="text-[11px] font-mono">client/src/lib/visual-edit-path.ts</code> turns
              on edit mode, then{" "}
              <code className="text-[11px] font-mono">buildPrivatePreviewHref</code> builds{" "}
              <code className="text-[11px] font-mono">/private/preview/{"{type}/{slug}"}</code> when
              type and slug are known.
            </p>
            <p>
              Type/slug come from the 404 page when it already knows them, otherwise{" "}
              <code className="text-[11px] font-mono">detectContentInfo</code> in{" "}
              <code className="text-[11px] font-mono">
                client/src/components/DebugBubble/utils/debugHelpers.ts
              </code>
              . The hook is{" "}
              <code className="text-[11px] font-mono">client/src/hooks/useEnterVisualEditMode.ts</code>.
            </p>
            <p>
              Non-effects: does not fetch the remote database, does not create a missing page. If
              type/slug cannot be inferred, you stay on this URL and staff 404 actions appear.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Staff404Recovery({
  alwaysShow = false,
  surface = "public",
  typeLabel = "page",
  slug,
  contentType,
  listingSharedTemplate = false,
  hasDatabase = false,
  databaseLabel,
  yamlExists = false,
  onEditYaml,
}: {
  alwaysShow?: boolean;
  surface?: Staff404Surface;
  typeLabel?: string;
  slug?: string;
  contentType?: string;
  listingSharedTemplate?: boolean;
  hasDatabase?: boolean;
  databaseLabel?: string;
  yamlExists?: boolean;
  onEditYaml?: () => void;
}) {
  const editMode = useEditModeOptional();
  if (!alwaysShow && !editMode?.isEditMode) return null;

  return (
    <div className="mt-6 w-full" data-testid="staff-404-recovery">
      <Staff404Layout
        surface={surface}
        typeLabel={typeLabel}
        slug={slug}
        contentType={contentType}
        isValidType={surface === "databaseSingle" ? !!contentType : false}
        listingSharedTemplate={listingSharedTemplate}
        hasDatabase={hasDatabase}
        databaseLabel={databaseLabel}
        yamlExists={yamlExists}
        staffOrEditMode
        compact
        onEditYaml={onEditYaml}
      />
    </div>
  );
}
