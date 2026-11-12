import { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconDeviceFloppy,
  IconFileCode,
  IconInfoCircle,
  IconLoader2,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "wouter";
import { Braces, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { TemplateCodeInput } from "@/components/editing/TemplateCodeInput";
import { VariableDetailModal } from "@/components/editing/VariableDetailModal";

const SchemaOrgYmlEditorPanel = lazy(() => import("@/components/editing/SchemaOrgYmlEditorPanel"));

export interface SchemaOrgEditorResponse {
  path: string;
  other_keys: string[];
  organization: {
    type: string;
    name: string;
    url: string;
    description: string;
    description_es: string;
    founding_date: string;
    founders: Array<{ name: string }>;
    area_served: string[];
    knows_language: string[];
    contact_point: { contact_type: string; email: string };
    address: { address_country: string };
    aggregate_rating: {
      rating_value: string;
      review_count: string;
      best_rating: string;
      worst_rating: string;
    };
    logo: string;
  };
  website: {
    type: string;
    name: string;
    url: string;
    description: string;
    description_es: string;
    default_social_image: string;
  };
}

export function SchemaOrgTab() {
  const { toast } = useToast();
  const { hasCapability, isValidated } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");

  const { data, isLoading } = useQuery<SchemaOrgEditorResponse>({
    queryKey: ["/api/admin/schema-org"],
    enabled: isValidated === true,
  });

  const [org, setOrg] = useState<SchemaOrgEditorResponse["organization"] | null>(null);
  const [website, setWebsite] = useState<SchemaOrgEditorResponse["website"] | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingWeb, setSavingWeb] = useState(false);
  const [ymlOpen, setYmlOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!data) return;
    setOrg({
      ...data.organization,
      founders: data.organization.founders.map((f) => ({ ...f })),
      area_served: [...(data.organization.area_served ?? [])],
      knows_language: [...(data.organization.knows_language ?? [])],
    });
    setWebsite({ ...data.website });
  }, [data]);

  async function saveOrganization() {
    if (!org) return;
    setSavingOrg(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/schema-org", { organization: org });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.setQueryData(["/api/admin/schema-org"], result);
      toast({ title: "Organization schema saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSavingOrg(false);
    }
  }

  async function saveWebsite() {
    if (!website) return;
    setSavingWeb(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/schema-org", { website });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.setQueryData(["/api/admin/schema-org"], result);
      toast({ title: "Website schema saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSavingWeb(false);
    }
  }

  if (isLoading || !data || !org || !website) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="tab-panel-schema-org">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-3">
          <CardTitle className="text-base">How Schema.org works here</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit}
            onClick={() => setYmlOpen(true)}
            className="shrink-0"
            data-testid="button-edit-schema-org-yml"
          >
            <IconFileCode className="h-4 w-4 mr-1.5" />
            Edit schema-org.yml
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Global Organization and Website definitions live in{" "}
            <code className="font-mono text-xs">schema-org.yml</code>. Pages emit JSON-LD from leading{" "}
            <code className="font-mono text-xs">schema_org</code> sections (plus FAQ / Article / Breadcrumb).
            This tab edits the shared templates — not per-page sections (see Debug Bubble SEO → Schema for a read-only preview).
          </p>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1" data-testid="banner-schema-brand">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <IconInfoCircle className="h-3.5 w-3.5" />
              Dual write path
            </p>
            <p>
              Social links (<code className="font-mono">organization.same_as</code>), logos, brand title, and{" "}
              <code className="font-mono">website.default_social_image</code> are edited under{" "}
              <Link href="/private/settings/brand" className="underline underline-offset-2 text-foreground">
                General → Brand
              </Link>
              . Saving here does not change those Brand fields.
            </p>
          </div>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-schema-read-more">
                Read more (advanced)
                <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1 text-xs font-mono">
              <p>schema-org.yml</p>
              <p>server/schema-org.ts</p>
              <p>server/schema-components/</p>
              <p>shared/component-registry/schema_org/v1.0/</p>
              <p>client/src/components/DebugBubble/components/SeoModal.tsx</p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Organization</CardTitle>
          <Button size="sm" disabled={!canEdit || savingOrg} onClick={saveOrganization} data-testid="button-save-organization">
            {savingOrg ? <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" /> : <IconDeviceFloppy className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <VariableField label="Type" value={org.type} onChange={(v) => setOrg({ ...org, type: v })} disabled={!canEdit} testId="input-org-type" />
            <VariableField label="Name" value={org.name} onChange={(v) => setOrg({ ...org, name: v })} disabled={!canEdit} testId="input-org-name" />
            <VariableField label="URL" value={org.url} onChange={(v) => setOrg({ ...org, url: v })} disabled={!canEdit} testId="input-org-url" className="sm:col-span-2" />
            <VariableField label="Founding date" value={org.founding_date} onChange={(v) => setOrg({ ...org, founding_date: v })} disabled={!canEdit} testId="input-org-founding" />
            <VariableField
              label="Contact type"
              value={org.contact_point.contact_type}
              onChange={(v) => setOrg({ ...org, contact_point: { ...org.contact_point, contact_type: v } })}
              disabled={!canEdit}
              testId="input-org-contact-type"
            />
            <VariableField
              label="Contact email"
              value={org.contact_point.email}
              onChange={(v) => setOrg({ ...org, contact_point: { ...org.contact_point, email: v } })}
              disabled={!canEdit}
              testId="input-org-contact-email"
            />
            <VariableField
              label="Address country"
              value={org.address.address_country}
              onChange={(v) => setOrg({ ...org, address: { address_country: v } })}
              disabled={!canEdit}
              testId="input-org-country"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (en)</label>
            <Textarea
              value={org.description}
              onChange={(e) => setOrg({ ...org, description: e.target.value })}
              disabled={!canEdit}
              rows={3}
              data-testid="input-org-description"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (es)</label>
            <Textarea
              value={org.description_es}
              onChange={(e) => setOrg({ ...org, description_es: e.target.value })}
              disabled={!canEdit}
              rows={3}
              data-testid="input-org-description-es"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Founders</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canEdit}
                onClick={() => setOrg({ ...org, founders: [...org.founders, { name: "" }] })}
                data-testid="button-add-founder"
              >
                <IconPlus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
            {org.founders.map((f, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={f.name}
                  onChange={(e) => {
                    const founders = org.founders.map((x, j) => (j === i ? { name: e.target.value } : x));
                    setOrg({ ...org, founders });
                  }}
                  disabled={!canEdit}
                  placeholder="Name"
                  data-testid={`input-org-founder-${i}`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() => setOrg({ ...org, founders: org.founders.filter((_, j) => j !== i) })}
                  data-testid={`button-remove-founder-${i}`}
                >
                  <IconTrash className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <StringListField
            label="Areas served"
            hint="schema.org areaServed — regions where you operate"
            values={org.area_served}
            onChange={(area_served) => setOrg({ ...org, area_served })}
            disabled={!canEdit}
            placeholder="e.g. United States"
            addTestId="button-add-area-served"
            inputTestIdPrefix="input-org-area-served"
            removeTestIdPrefix="button-remove-area-served"
          />
          <StringListField
            label="Languages"
            hint="schema.org knowsLanguage — BCP 47 codes (en, es)"
            values={org.knows_language}
            onChange={(knows_language) => setOrg({ ...org, knows_language })}
            disabled={!canEdit}
            placeholder="e.g. en"
            addTestId="button-add-knows-language"
            inputTestIdPrefix="input-org-knows-language"
            removeTestIdPrefix="button-remove-knows-language"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            <VariableField
              label="Rating"
              value={org.aggregate_rating.rating_value}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, rating_value: v } })}
              disabled={!canEdit}
              testId="input-org-rating"
              placeholder="{{ global.global_review_rating }}"
            />
            <VariableField
              label="Review count"
              value={org.aggregate_rating.review_count}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, review_count: v } })}
              disabled={!canEdit}
              testId="input-org-reviews"
              placeholder="{{ global.global_review_count }}"
            />
            <Field
              label="Best"
              value={org.aggregate_rating.best_rating}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, best_rating: v } })}
              disabled={!canEdit}
              testId="input-org-best"
            />
            <Field
              label="Worst"
              value={org.aggregate_rating.worst_rating}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, worst_rating: v } })}
              disabled={!canEdit}
              testId="input-org-worst"
            />
          </div>
          {org.logo && (
            <p className="text-xs text-muted-foreground truncate">
              Logo (from Brand / YAML): <span className="font-mono">{org.logo}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Website</CardTitle>
          <Button size="sm" disabled={!canEdit || savingWeb} onClick={saveWebsite} data-testid="button-save-website">
            {savingWeb ? <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" /> : <IconDeviceFloppy className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <VariableField label="Type" value={website.type} onChange={(v) => setWebsite({ ...website, type: v })} disabled={!canEdit} testId="input-web-type" />
            <VariableField label="Name" value={website.name} onChange={(v) => setWebsite({ ...website, name: v })} disabled={!canEdit} testId="input-web-name" />
            <VariableField label="URL" value={website.url} onChange={(v) => setWebsite({ ...website, url: v })} disabled={!canEdit} testId="input-web-url" className="sm:col-span-2" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (en)</label>
            <Textarea
              value={website.description}
              onChange={(e) => setWebsite({ ...website, description: e.target.value })}
              disabled={!canEdit}
              rows={3}
              data-testid="input-web-description"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (es)</label>
            <Textarea
              value={website.description_es}
              onChange={(e) => setWebsite({ ...website, description_es: e.target.value })}
              disabled={!canEdit}
              rows={3}
              data-testid="input-web-description-es"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Default social image is managed in{" "}
            <Link href="/private/settings/brand" className="underline underline-offset-2">
              Brand
            </Link>
            {website.default_social_image ? (
              <>
                : <span className="font-mono break-all">{website.default_social_image}</span>
              </>
            ) : (
              " (not set)."
            )}
          </p>
        </CardContent>
      </Card>

      {data.other_keys.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Other schema keys</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Legacy or advanced keys in schema-org.yml. Edit via the YAML panel below.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.other_keys.map((key) => (
                <Badge key={key} variant="secondary" className="font-mono text-[10px]" data-testid={`chip-schema-key-${key}`}>
                  {key}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {ymlOpen && (
        <Suspense fallback={null}>
          <SchemaOrgYmlEditorPanel
            onClose={() => setYmlOpen(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/schema-org"] });
              setYmlOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function StringListField({
  label,
  hint,
  values,
  onChange,
  disabled,
  placeholder,
  addTestId,
  inputTestIdPrefix,
  removeTestIdPrefix,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  addTestId: string;
  inputTestIdPrefix: string;
  removeTestIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {hint ? <p className="text-[11px] text-muted-foreground/80">{hint}</p> : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...values, ""])}
          data-testid={addTestId}
        >
          <IconPlus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>
      {values.map((value, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => {
              const next = values.map((x, j) => (j === i ? e.target.value : x));
              onChange(next);
            }}
            disabled={disabled}
            placeholder={placeholder}
            data-testid={`${inputTestIdPrefix}-${i}`}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            data-testid={`${removeTestIdPrefix}-${i}`}
          >
            <IconTrash className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  testId,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testId: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-sm"
        data-testid={testId}
      />
    </div>
  );
}

/** One-line template field with site-global variable picker (same pills as section editors). */
function VariableField({
  label,
  value,
  onChange,
  disabled,
  testId,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testId: string;
  placeholder?: string;
  className?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        <div className={disabled ? "pointer-events-none opacity-60 flex-1 min-w-0" : "flex-1 min-w-0"}>
          <TemplateCodeInput
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            testId={testId}
          />
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-7 shrink-0"
          title="Insert site variable"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
          data-testid={`${testId}-insert-variable`}
        >
          <Braces className="h-3.5 w-3.5 text-primary" />
        </Button>
      </div>
      <VariableDetailModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        variableName=""
        inlineDefault=""
        mode="create"
        onCreated={(_name, syntax) => {
          onChange(syntax);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
