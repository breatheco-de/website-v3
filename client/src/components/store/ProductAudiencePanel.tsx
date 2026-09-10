/**
 * Store product Audience editor — offer + personas (avatar nested).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type PersonaDraft = {
  id: string;
  label: string;
  role: string;
  industry_or_context: string;
  demographics: string;
  buying_behavior: string;
  idLocked: boolean;
  avatar: {
    fears: string;
    internal_dialogue: string;
    objections: string;
    aspirational_identity: string;
  };
};

type AudienceResponse = {
  audience: {
    offer?: {
      one_liner?: string;
      who_its_for?: string;
      who_its_not_for?: string;
    };
    personas?: Array<{
      id: string;
      label?: string;
      role: string;
      industry_or_context?: string;
      demographics?: string;
      buying_behavior?: string;
      avatar: {
        fears: string[];
        internal_dialogue: string;
        objections: string[];
        aspirational_identity?: string;
      };
    }>;
  } | null;
  status: "missing" | "minimal" | "complete";
  education?: { summary: string; advanced_paths: string[] };
};

function emptyPersona(): PersonaDraft {
  return {
    id: "",
    label: "",
    role: "",
    industry_or_context: "",
    demographics: "",
    buying_behavior: "",
    idLocked: false,
    avatar: {
      fears: "",
      internal_dialogue: "",
      objections: "",
      aspirational_identity: "",
    },
  };
}

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function ProductAudiencePanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [oneLiner, setOneLiner] = useState("");
  const [whoFor, setWhoFor] = useState("");
  const [whoNot, setWhoNot] = useState("");
  const [personas, setPersonas] = useState<PersonaDraft[]>([]);

  const { data, isLoading } = useQuery<AudienceResponse>({
    queryKey: [`/api/product/${slug}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/product/${slug}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  useEffect(() => {
    if (!data) return;
    const offer = data.audience?.offer;
    setOneLiner(offer?.one_liner ?? "");
    setWhoFor(offer?.who_its_for ?? "");
    setWhoNot(offer?.who_its_not_for ?? "");
    setPersonas(
      (data.audience?.personas ?? []).map((p) => ({
        id: p.id,
        label: p.label ?? "",
        role: p.role,
        industry_or_context: p.industry_or_context ?? "",
        demographics: p.demographics ?? "",
        buying_behavior: p.buying_behavior ?? "",
        idLocked: true,
        avatar: {
          fears: (p.avatar?.fears ?? []).join("\n"),
          internal_dialogue: p.avatar?.internal_dialogue ?? "",
          objections: (p.avatar?.objections ?? []).join("\n"),
          aspirational_identity: p.avatar?.aspirational_identity ?? "",
        },
      })),
    );
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        content_type: "program",
        replace_personas: true as const,
        offer: {
          one_liner: oneLiner,
          who_its_for: whoFor,
          ...(whoNot.trim() ? { who_its_not_for: whoNot.trim() } : {}),
        },
        personas: personas.map((p) => ({
          id: p.id.trim(),
          ...(p.label.trim() ? { label: p.label.trim() } : {}),
          role: p.role.trim(),
          ...(p.industry_or_context.trim()
            ? { industry_or_context: p.industry_or_context.trim() }
            : {}),
          ...(p.demographics.trim() ? { demographics: p.demographics.trim() } : {}),
          ...(p.buying_behavior.trim() ? { buying_behavior: p.buying_behavior.trim() } : {}),
          avatar: {
            fears: linesToList(p.avatar.fears),
            internal_dialogue: p.avatar.internal_dialogue,
            objections: linesToList(p.avatar.objections),
            ...(p.avatar.aspirational_identity.trim()
              ? { aspirational_identity: p.avatar.aspirational_identity.trim() }
              : {}),
          },
        })),
      };
      const res = await apiRequest("PUT", `/api/product/${slug}`, body);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/product/${slug}`] });
      void queryClient.invalidateQueries({ queryKey: ["/api/ecommerce/product-map"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/ecommerce/products"] });
      void queryClient.invalidateQueries({ queryKey: [`/api/ecommerce/funnel/${slug}`] });
      toast({ title: "Audience saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save audience", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading audience…</p>;
  }

  const status = data?.status ?? "missing";

  return (
    <div className="space-y-4" data-testid="product-audience-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Audience</h2>
          <p className="text-sm text-muted-foreground">
            What you sell and who you sell it to. Funnel pages pick product+persona pairs. Saving
            here does not change page copy or publish anything.
          </p>
        </div>
        <Badge
          variant={status === "missing" ? "destructive" : status === "minimal" ? "secondary" : "default"}
          data-testid="badge-audience-status"
        >
          {status}
        </Badge>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          Read more (advanced)
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 font-mono">
          <p>programs/{slug}/_product.yml → offer, personas[].avatar</p>
          <p>Minimal: offer.one_liner, offer.who_its_for, ≥1 persona with fears, dialogue, objections</p>
          <p>Persona ids are immutable after create. Cannot demote audience while pages bind it.</p>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Offer (Producto)</h3>
        <div className="space-y-2">
          <Label htmlFor="offer-one-liner">One-liner</Label>
          <Input
            id="offer-one-liner"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            data-testid="input-offer-one-liner"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offer-who-for">Who it&apos;s for</Label>
          <Textarea
            id="offer-who-for"
            value={whoFor}
            onChange={(e) => setWhoFor(e.target.value)}
            className="min-h-[64px]"
            data-testid="input-offer-who-for"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offer-who-not">Who it&apos;s not for (optional)</Label>
          <Input
            id="offer-who-not"
            value={whoNot}
            onChange={(e) => setWhoNot(e.target.value)}
            data-testid="input-offer-who-not"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Personas</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPersonas((prev) => [...prev, emptyPersona()])}
            data-testid="button-add-persona"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add persona
          </Button>
        </div>

        {personas.length === 0 && (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
            No personas yet. Add at least one (with avatar fears, internal dialogue, and objections)
            before this product can join funnel landings.
          </p>
        )}

        {personas.map((p, idx) => (
          <div
            key={p.idLocked ? p.id : `new-${idx}`}
            className="rounded-md border p-4 space-y-3"
            data-testid={`persona-editor-${idx}`}
          >
            <div className="flex justify-between gap-2">
              <p className="text-sm font-medium">{p.label || p.role || `Persona ${idx + 1}`}</p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setPersonas((prev) => prev.filter((_, i) => i !== idx))}
                data-testid={`button-remove-persona-${idx}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Id {p.idLocked ? "(locked)" : ""}</Label>
                <Input
                  value={p.id}
                  disabled={p.idLocked}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)),
                    )
                  }
                  placeholder="career-changer"
                  data-testid={`input-persona-id-${idx}`}
                />
              </div>
              <div className="space-y-1">
                <Label>Label</Label>
                <Input
                  value={p.label}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  data-testid={`input-persona-label-${idx}`}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Role</Label>
                <Input
                  value={p.role}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, role: e.target.value } : x)),
                    )
                  }
                  data-testid={`input-persona-role-${idx}`}
                />
              </div>
              <div className="space-y-1">
                <Label>Industry / context</Label>
                <Input
                  value={p.industry_or_context}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, industry_or_context: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Demographics</Label>
                <Input
                  value={p.demographics}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, demographics: e.target.value } : x)),
                    )
                  }
                />
              </div>
            </div>
            <div className="space-y-2 rounded-md bg-muted/30 p-3">
              <p className="text-xs font-medium">Avatar (emotional)</p>
              <div className="space-y-1">
                <Label>Fears (one per line)</Label>
                <Textarea
                  value={p.avatar.fears}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? { ...x, avatar: { ...x.avatar, fears: e.target.value } }
                          : x,
                      ),
                    )
                  }
                  className="min-h-[56px]"
                />
              </div>
              <div className="space-y-1">
                <Label>Internal dialogue</Label>
                <Textarea
                  value={p.avatar.internal_dialogue}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              avatar: { ...x.avatar, internal_dialogue: e.target.value },
                            }
                          : x,
                      ),
                    )
                  }
                  className="min-h-[56px]"
                />
              </div>
              <div className="space-y-1">
                <Label>Objections (one per line)</Label>
                <Textarea
                  value={p.avatar.objections}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? { ...x, avatar: { ...x.avatar, objections: e.target.value } }
                          : x,
                      ),
                    )
                  }
                  className="min-h-[56px]"
                />
              </div>
              <div className="space-y-1">
                <Label>Aspirational identity (optional)</Label>
                <Input
                  value={p.avatar.aspirational_identity}
                  onChange={(e) =>
                    setPersonas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              avatar: { ...x.avatar, aspirational_identity: e.target.value },
                            }
                          : x,
                      ),
                    )
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              disabled={saveMutation.isPending}
              data-testid="button-save-audience"
            >
              {saveMutation.isPending ? "Saving…" : "Save audience"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Save audience?</AlertDialogTitle>
              <AlertDialogDescription>
                This updates who the product is for and how buyers think. It does not change page
                copy, funnels, or publish anything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => saveMutation.mutate()}
                data-testid="button-confirm-save-audience"
              >
                Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
