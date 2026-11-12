import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FormLocationCardProps {
  contentType: string;
  /** Current `forms.location` (null when the type has not opted in). */
  value: { entry_field?: string; autodetect?: boolean } | null | undefined;
  /** Content type editor hints (to list link fields to `location`). */
  editor: Record<string, { type?: string; source?: string; label?: string }> | null | undefined;
  loading: boolean;
}

const NONE = "__none__";

export function FormLocationCard({ contentType, value, editor, loading }: FormLocationCardProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const entryField = value?.entry_field ?? null;
  const autodetect = value?.autodetect !== false;
  const locationFields = Object.entries(editor ?? {})
    .filter(([, hint]) => hint?.type === "relation" && hint?.source === "location")
    .map(([key, hint]) => ({ key, label: hint.label || key }));

  const save = async (next: { entry_field: string | null; autodetect: boolean }) => {
    setSaving(true);
    try {
      const location = {
        ...(next.entry_field ? { entry_field: next.entry_field } : {}),
        ...(next.autodetect ? {} : { autodetect: false }),
      };
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, {
        forms: Object.keys(location).length ? { location } : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/content-types/${contentType}/config`] });
      toast({
        title: "Form location saved",
        description: next.autodetect
          ? "Forms fall back to detecting the visitor's location when nothing sets one."
          : "Forms on these pages need a location from the form or the page before saving or publishing.",
      });
    } catch (err) {
      toast({
        title: "Failed to update form location",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="card-kpi-form-location">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Form location</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Choose where forms on these pages get their location when the form doesn&apos;t set one. If detection is
          off, pages can&apos;t be saved or published until a form or the page sets a location. Live pages keep working.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Page field</Label>
          <Select
            value={entryField ?? NONE}
            disabled={saving || loading}
            onValueChange={(v) => void save({ entry_field: v === NONE ? null : v, autodetect })}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-form-location-field">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None (forms only)</SelectItem>
              {locationFields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {locationFields.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No page field links to locations yet. Add one (type: link to Locations) in Fields to use it here.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs" htmlFor="switch-form-location-autodetect">
            Allow location detection
          </Label>
          <Switch
            id="switch-form-location-autodetect"
            checked={autodetect}
            disabled={saving || loading}
            onCheckedChange={(checked) => void save({ entry_field: entryField, autodetect: checked })}
            data-testid="switch-form-location-autodetect"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          onClick={() => setAdvanced((v) => !v)}
          data-testid="button-form-location-advanced"
        >
          {advanced ? "Hide advanced details" : "Read more (advanced)"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advanced ? "rotate-180" : ""}`} />
        </button>
        {advanced ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              Setting: <code className="font-mono text-[11px]">content-types.yml</code> →{" "}
              <code className="font-mono text-[11px]">forms.location.entry_field</code> /{" "}
              <code className="font-mono text-[11px]">autodetect</code>.
            </p>
            <p>
              Order: the form&apos;s own <code className="font-mono text-[11px]">fields.location</code>, then the page
              field (in <code className="font-mono text-[11px]">_common.yml</code>), then detection when allowed.
            </p>
            <p>
              Signup accounts can follow the chosen location with{" "}
              <code className="font-mono text-[11px]">form.location.city</code> /{" "}
              <code className="font-mono text-[11px]">form.location.country</code> in Consumer Auth.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
