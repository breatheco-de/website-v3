import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableMultiCombobox } from "@/components/ui/searchable-multi-combobox";
import { queryClient, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type DatabaseEvidenceConfig,
  type EvidenceKind,
} from "@shared/evidence-kinds";

const LINK_FIELD_GUESS = ["link_url", "url", "source_url", "link", "href"];
const MATCH_FIELD_GUESS = ["organization", "name", "tags", "title", "company"];

/** Database page card: turn a database into proof for named partner / press / award claims. */
export function EvidenceSourceKpiCard({
  dbName,
  config,
  fields,
  fallbackSites,
  canManage,
}: {
  dbName: string;
  config: Record<string, unknown> & { evidence?: DatabaseEvidenceConfig };
  /** Field names on this database's rows. */
  fields: string[];
  /** Sites that fall back to this one and also use its evidence. */
  fallbackSites: string[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const current = config.evidence?.enabled ? config.evidence : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proofField, setProofField] = useState("");
  const [matchFields, setMatchFields] = useState<string[]>([]);
  const [proves, setProves] = useState<string[]>([]);
  const [nestedOpen, setNestedOpen] = useState(false);

  const openDialog = () => {
    setProofField(current?.proof_field ?? LINK_FIELD_GUESS.find((f) => fields.includes(f)) ?? "");
    setMatchFields(current?.match_fields ?? MATCH_FIELD_GUESS.filter((f) => fields.includes(f)));
    setProves(current?.proves ?? []);
    setAdvanced(false);
    setDialogOpen(true);
  };

  const save = async (evidence: DatabaseEvidenceConfig | undefined) => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/databases/${dbName}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, evidence }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/databases", dbName] });
      queryClient.invalidateQueries({ queryKey: [`/api/databases/${dbName}/items`] });
      toast({ title: evidence ? "Evidence source on" : "Evidence source off" });
      return true;
    } catch (err) {
      toast({
        title: "Error saving",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(proofField) && matchFields.length > 0 && proves.length > 0;
  const fieldOptions = fields.map((f) => ({ value: f }));

  return (
    <>
      <Card data-testid="card-evidence-source">
        <CardContent className="pt-4 pb-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Evidence source</span>
            </div>
            <Switch
              checked={Boolean(current)}
              disabled={!canManage || saving}
              onCheckedChange={(on) => (on ? openDialog() : setConfirmOffOpen(true))}
              aria-label="Use this database as evidence"
              data-testid="switch-evidence-source"
            />
          </div>
          <p className="text-sm font-medium">{current ? "On" : "Off"}</p>
          {current ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground text-left disabled:cursor-default"
              onClick={canManage ? openDialog : undefined}
              disabled={!canManage}
              data-testid="button-edit-evidence-source"
            >
              Agents will use this database to validate claims the brand/company makes
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">Rows can prove partner, press or award claims</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => (!nestedOpen ? setDialogOpen(o) : null)}>
        <DialogContent className="max-w-md" data-testid="dialog-evidence-source">
          <DialogHeader>
            <DialogTitle>Use as evidence source</DialogTitle>
            <DialogDescription className="text-left">
              Agents will use these rows as proof when a proposal names a partner, press outlet or award.
              A row counts only if its proof field is filled in, and rows an agent added count only after you verify them.
              This does not change what visitors see.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Proof field</Label>
              <Select value={proofField} onValueChange={setProofField}>
                <SelectTrigger data-testid="select-evidence-proof-field">
                  <SelectValue placeholder="Field with the proof" />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This field must provide a URL, text, PDF link or anything that proves the claims stated on the
                entry, for example: link to the partnership announcement, or to the award, etc.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Statement fields</Label>
              <SearchableMultiCombobox
                values={matchFields}
                onChange={setMatchFields}
                options={fieldOptions}
                allowCustom={false}
                placeholder="Fields with names to match"
                onOpenChange={setNestedOpen}
                testId="combobox-evidence-match-fields"
                mono
              />
              <p className="text-xs text-muted-foreground">
                Which entry properties contain the claims we are stating? The entry.title? entry.description?
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Proves</Label>
              <SearchableMultiCombobox
                values={proves}
                onChange={setProves}
                options={EVIDENCE_KINDS.map((k) => ({ value: k, label: EVIDENCE_KIND_LABELS[k] }))}
                allowCustom={false}
                placeholder="Kinds of claims"
                onOpenChange={setNestedOpen}
                testId="combobox-evidence-proves"
              />
            </div>

            {fallbackSites.length ? (
              <p className="text-xs text-muted-foreground">
                Also used by {fallbackSites.join(", ")}, which fall back to this site.
              </p>
            ) : null}

            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setAdvanced((v) => !v)}
              data-testid="button-evidence-advanced"
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1.5 border-t pt-2 text-xs leading-5 text-muted-foreground">
                <p>
                  Matching ignores the site&apos;s own brand name and values shorter than four characters, and
                  works across languages. A name the proposal claims with no matching row blocks apply until a
                  row with a link exists or staff dismiss the name.
                </p>
                <p>
                  An agent that adds a row or changes its link, match fields, title or excerpt leaves it
                  unverified (stored as a hidden <span className="font-mono">_changed_by</span> stamp). Rows
                  that existed before this was turned on count as trusted.
                </p>
                <p>
                  Saved as <span className="font-mono">evidence</span> in{" "}
                  <span className="font-mono">db/{dbName}/config.yml</span>.
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSave || saving}
              onClick={async () => {
                const okSave = await save({
                  enabled: true,
                  proof_field: proofField,
                  match_fields: matchFields,
                  proves: proves as EvidenceKind[],
                  ...(current?.ignore_values?.length ? { ignore_values: current.ignore_values } : {}),
                });
                if (okSave) setDialogOpen(false);
              }}
              data-testid="button-save-evidence-source"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOffOpen} onOpenChange={setConfirmOffOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-evidence-off">
          <DialogHeader>
            <DialogTitle>Stop using as evidence?</DialogTitle>
            <DialogDescription className="text-left">
              Proposals that name partners, press or awards proven only by this database will be blocked
              until another source proves them
              {fallbackSites.length ? `, here and on ${fallbackSites.join(", ")}` : ""}. The rows themselves
              do not change.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOffOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                const okSave = await save(undefined);
                if (okSave) setConfirmOffOpen(false);
              }}
              data-testid="button-confirm-evidence-off"
            >
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
