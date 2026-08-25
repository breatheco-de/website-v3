import { Database, Globe } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVariableDefinitions } from "@/hooks/useVariables";
import { useQuery } from "@tanstack/react-query";
import { buildPickerMappedFields } from "./expandMappedFields";

interface VariableTypeChooserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  onChoose: (type: "global" | "single") => void;
}

export function VariableTypeChooserModal({
  open,
  onOpenChange,
  contentType,
  onChoose,
}: VariableTypeChooserModalProps) {
  const { data: definitions } = useVariableDefinitions();

  const { data: typeConfig } = useQuery<{
    name: string;
    label: string;
    field_mapping?: Record<string, string | { source: string; default?: string | null }>;
  }>({
    queryKey: [`/api/content-types/${contentType}/config`],
    enabled: open && !!contentType,
  });

  const fieldMapping = typeConfig?.field_mapping || {};
  // Include system aliases (slug, image, …) so chooser samples match the picker.
  const fieldNames = buildPickerMappedFields(fieldMapping).map((f) => f.key);
  const sampleFields = fieldNames.slice(0, 4);

  const globalVarNames = definitions ? Object.keys(definitions).sort() : [];
  const sampleGlobals = globalVarNames
    .slice(0, 4)
    .map((n) => n.replace(/^global\./, ""));

  const label = typeConfig?.label || contentType;

  const handleChoose = (type: "global" | "single") => {
    onChoose(type);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="variable-type-chooser-modal"
      >
        <DialogHeader>
          <DialogTitle>What type of variable?</DialogTitle>
          <DialogDescription>
            Since you are editing the shared template among all {label} entries,
            there are two types of variables to add. Please choose:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2" data-testid="chooser-options-list">
          <button
            type="button"
            className="w-full text-left p-3 rounded-md border transition-colors border-border hover-elevate"
            onClick={() => handleChoose("single")}
            data-testid="chooser-option-single"
          >
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {label} entry variables
                </p>
                <div className="text-sm text-muted-foreground mt-0.5">
                  Each {label.toLowerCase()} has fields that can be rendered into
                  the template
                  {sampleFields.length > 0 && (
                    <>
                      {" "}like{" "}
                      {sampleFields.map((f, i) => (
                        <span key={f}>
                          {i > 0 && ", "}
                          <Badge variant="secondary" className="font-mono text-xs">
                            {f}
                          </Badge>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            className="w-full text-left p-3 rounded-md border transition-colors border-border hover-elevate"
            onClick={() => handleChoose("global")}
            data-testid="chooser-option-global"
          >
            <div className="flex items-start gap-3">
              <Globe className="w-5 h-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Global variables
                </p>
                <div className="text-sm text-muted-foreground mt-0.5">
                  These are shared variables on the entire website, not related
                  to {label.toLowerCase()}
                  {sampleGlobals.length > 0 && (
                    <>
                      , for example{" "}
                      {sampleGlobals.map((g, i) => (
                        <span key={g}>
                          {i > 0 && ", "}
                          <Badge variant="secondary" className="font-mono text-xs">
                            {g}
                          </Badge>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-chooser-cancel"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
