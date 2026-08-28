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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { ChevronDown } from "lucide-react";

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
    setOrg({ ...data.organization, founders: data.organization.founders.map((f) => ({ ...f })) });
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
              <Link href="/private/settings?tab=brand" className="underline underline-offset-2 text-foreground">
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
            <Field label="Type" value={org.type} onChange={(v) => setOrg({ ...org, type: v })} disabled={!canEdit} testId="input-org-type" />
            <Field label="Name" value={org.name} onChange={(v) => setOrg({ ...org, name: v })} disabled={!canEdit} testId="input-org-name" />
            <Field label="URL" value={org.url} onChange={(v) => setOrg({ ...org, url: v })} disabled={!canEdit} testId="input-org-url" className="sm:col-span-2" />
            <Field label="Founding date" value={org.founding_date} onChange={(v) => setOrg({ ...org, founding_date: v })} disabled={!canEdit} testId="input-org-founding" />
            <Field
              label="Contact type"
              value={org.contact_point.contact_type}
              onChange={(v) => setOrg({ ...org, contact_point: { ...org.contact_point, contact_type: v } })}
              disabled={!canEdit}
              testId="input-org-contact-type"
            />
            <Field
              label="Contact email"
              value={org.contact_point.email}
              onChange={(v) => setOrg({ ...org, contact_point: { ...org.contact_point, email: v } })}
              disabled={!canEdit}
              testId="input-org-contact-email"
            />
            <Field
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            <Field
              label="Rating"
              value={org.aggregate_rating.rating_value}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, rating_value: v } })}
              disabled={!canEdit}
              testId="input-org-rating"
            />
            <Field
              label="Review count"
              value={org.aggregate_rating.review_count}
              onChange={(v) => setOrg({ ...org, aggregate_rating: { ...org.aggregate_rating, review_count: v } })}
              disabled={!canEdit}
              testId="input-org-reviews"
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
            <Field label="Type" value={website.type} onChange={(v) => setWebsite({ ...website, type: v })} disabled={!canEdit} testId="input-web-type" />
            <Field label="Name" value={website.name} onChange={(v) => setWebsite({ ...website, name: v })} disabled={!canEdit} testId="input-web-name" />
            <Field label="URL" value={website.url} onChange={(v) => setWebsite({ ...website, url: v })} disabled={!canEdit} testId="input-web-url" className="sm:col-span-2" />
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
            <Link href="/private/settings?tab=brand" className="underline underline-offset-2">
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
