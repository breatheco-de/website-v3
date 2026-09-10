/**
 * Store product Audience editor — offer + personas (avatar nested).
 * Offer and personas render as read-only cards; pencil opens the editor.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Info,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Quote,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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

function personaDisplayName(p: PersonaDraft, idx: number): string {
  return p.label.trim() || p.role.trim() || `Persona ${idx + 1}`;
}

function personaInitials(p: PersonaDraft, idx: number): string {
  const name = personaDisplayName(p, idx);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function isPersonaReady(p: PersonaDraft): boolean {
  return (
    Boolean(p.id.trim()) &&
    Boolean(p.role.trim()) &&
    linesToList(p.avatar.fears).length >= 1 &&
    Boolean(p.avatar.internal_dialogue.trim()) &&
    linesToList(p.avatar.objections).length >= 1
  );
}

type OfferDraft = {
  oneLiner: string;
  whoFor: string;
  whoNot: string;
};

function isOfferSet(offer: OfferDraft): boolean {
  return Boolean(offer.oneLiner.trim() || offer.whoFor.trim());
}

function offerFromApi(offer?: {
  one_liner?: string;
  who_its_for?: string;
  who_its_not_for?: string;
}): OfferDraft {
  return {
    oneLiner: offer?.one_liner ?? "",
    whoFor: offer?.who_its_for ?? "",
    whoNot: offer?.who_its_not_for ?? "",
  };
}

function personaFromApi(
  p: NonNullable<NonNullable<AudienceResponse["audience"]>["personas"]>[number],
): PersonaDraft {
  return {
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
  };
}

function OfferReadOnlyCard({
  offer,
  onEdit,
}: {
  offer: OfferDraft;
  onEdit: () => void;
}) {
  const whoNot = offer.whoNot.trim();

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        "ring-1 ring-border/60",
      )}
      data-testid="offer-card"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent"
        aria-hidden
      />

      <div className="relative p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                "bg-primary/15 text-primary",
                "ring-2 ring-background shadow-sm",
              )}
              aria-hidden
            >
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold leading-tight">Offer (Producto)</h3>
              <p className="text-sm text-muted-foreground">Who this product is for</p>
            </div>
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            aria-label="Edit offer"
            data-testid="button-edit-offer"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3" data-testid="offer-readonly">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              One-liner
            </p>
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {offer.oneLiner.trim() || "—"}
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-border/80 bg-background/50 p-3 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <UserRound className="h-3 w-3" aria-hidden />
              Who it&apos;s for
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {offer.whoFor.trim() || "—"}
            </p>
          </div>

          {whoNot ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/50 p-3 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <UserX className="h-3 w-3" aria-hidden />
                Who it&apos;s not for
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{whoNot}</p>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SaveAudienceButton({
  isPending,
  onConfirm,
  testId = "button-save-audience",
  confirmTestId = "button-confirm-save-audience",
  size = "default",
}: {
  isPending: boolean;
  onConfirm: () => void;
  testId?: string;
  confirmTestId?: string;
  size?: "default" | "sm";
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size={size} disabled={isPending} data-testid={testId}>
          {isPending ? "Saving…" : "Save audience"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save audience?</AlertDialogTitle>
          <AlertDialogDescription>
            This updates who the product is for and how buyers think. It does not change page copy,
            funnels, or publish anything.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid={confirmTestId}>
            Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OfferEditor({
  offer,
  onChange,
  onCancel,
  showCancel,
  isSaving,
  onSave,
}: {
  offer: OfferDraft;
  onChange: (next: OfferDraft) => void;
  onCancel: () => void;
  showCancel: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-primary/30 bg-card p-4 space-y-3 shadow-sm ring-1 ring-primary/20"
      data-testid="offer-editor"
    >
      <div className="flex justify-between gap-2 items-center">
        <h3 className="text-sm font-medium">Editing Offer (Producto)</h3>
      </div>
      <div className="space-y-2">
        <Label htmlFor="offer-one-liner">One-liner</Label>
        <Input
          id="offer-one-liner"
          value={offer.oneLiner}
          onChange={(e) => onChange({ ...offer, oneLiner: e.target.value })}
          data-testid="input-offer-one-liner"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="offer-who-for">Who it&apos;s for</Label>
        <Textarea
          id="offer-who-for"
          value={offer.whoFor}
          onChange={(e) => onChange({ ...offer, whoFor: e.target.value })}
          className="min-h-[64px]"
          data-testid="input-offer-who-for"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="offer-who-not">Who it&apos;s not for (optional)</Label>
        <Input
          id="offer-who-not"
          value={offer.whoNot}
          onChange={(e) => onChange({ ...offer, whoNot: e.target.value })}
          data-testid="input-offer-who-not"
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showCancel && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            data-testid="button-cancel-offer"
          >
            Cancel
          </Button>
        )}
        <SaveAudienceButton
          size="sm"
          isPending={isSaving}
          onConfirm={onSave}
          testId="button-save-audience-offer"
          confirmTestId="button-confirm-save-audience-offer"
        />
      </div>
    </div>
  );
}

function PersonaReadOnlyCard({
  persona,
  index,
  onEdit,
  onRemove,
}: {
  persona: PersonaDraft;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = personaDisplayName(persona, index);
  const fears = linesToList(persona.avatar.fears);
  const objections = linesToList(persona.avatar.objections);
  const ready = isPersonaReady(persona);
  const dialogue = persona.avatar.internal_dialogue.trim();
  const aspirational = persona.avatar.aspirational_identity.trim();

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        "ring-1 ring-border/60",
      )}
      data-testid={`persona-card-${index}`}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent"
        aria-hidden
      />

      <div className={cn("relative p-5", expanded && "space-y-4")}>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex items-start gap-3 min-w-0 flex-1 text-left rounded-md -m-1 p-1 hover:bg-muted/40 transition-colors"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
            data-testid={`button-toggle-persona-${index}`}
          >
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                "bg-primary/15 text-primary font-semibold text-sm tracking-wide",
                "ring-2 ring-background shadow-sm",
              )}
              aria-hidden
            >
              {personaInitials(persona, index)}
            </div>
            <div className="min-w-0 space-y-1 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-semibold leading-tight truncate">{name}</h4>
                <Badge
                  variant={ready ? "default" : "secondary"}
                  className="text-[10px] uppercase tracking-wide"
                >
                  {ready ? "Ready" : "Incomplete"}
                </Badge>
              </div>
              {persona.role.trim() && persona.label.trim() && (
                <p className="text-sm text-muted-foreground truncate">{persona.role}</p>
              )}
              {persona.id.trim() && (
                <p className="font-mono text-[11px] text-muted-foreground/80 truncate">
                  {persona.id}
                </p>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground mt-1.5 transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              aria-label={`Edit ${name}`}
              data-testid={`button-edit-persona-${index}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              aria-label={`Remove ${name}`}
              data-testid={`button-remove-persona-${index}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {expanded && (
          <>
            {(persona.industry_or_context.trim() ||
              persona.demographics.trim() ||
              persona.buying_behavior.trim()) && (
              <div className="flex flex-wrap gap-1.5">
                {persona.industry_or_context.trim() && (
                  <Badge variant="outline" className="font-normal text-xs">
                    {persona.industry_or_context}
                  </Badge>
                )}
                {persona.demographics.trim() && (
                  <Badge variant="outline" className="font-normal text-xs">
                    {persona.demographics}
                  </Badge>
                )}
                {persona.buying_behavior.trim() && (
                  <Badge variant="outline" className="font-normal text-xs">
                    {persona.buying_behavior}
                  </Badge>
                )}
              </div>
            )}

            {dialogue && (
              <blockquote className="relative rounded-lg border border-border/70 bg-muted/40 px-4 py-3 pl-10">
                <Quote
                  className="absolute left-3 top-3 h-4 w-4 text-primary/50"
                  aria-hidden
                />
                <p className="text-sm italic leading-relaxed text-foreground/90">{dialogue}</p>
                <p className="mt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Internal dialogue
                </p>
              </blockquote>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-dashed border-border/80 bg-background/50 p-3 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Fears
                </p>
                {fears.length > 0 ? (
                  <ul className="space-y-1.5">
                    {fears.map((fear) => (
                      <li key={fear} className="flex gap-2 text-sm leading-snug">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/70" />
                        <span>{fear}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None yet</p>
                )}
              </div>

              <div className="rounded-lg border border-dashed border-border/80 bg-background/50 p-3 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <MessageCircle className="h-3 w-3" aria-hidden />
                  Objections
                </p>
                {objections.length > 0 ? (
                  <ul className="space-y-1.5">
                    {objections.map((obj) => (
                      <li key={obj} className="flex gap-2 text-sm leading-snug">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None yet</p>
                )}
              </div>
            </div>

            {aspirational && (
              <div className="rounded-lg bg-primary/10 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
                  Aspires to be
                </p>
                <p className="text-sm font-medium text-foreground mt-0.5">{aspirational}</p>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function PersonaEditor({
  persona,
  index,
  onChange,
  onCancel,
  onRemove,
  isSaving,
  onSave,
}: {
  persona: PersonaDraft;
  index: number;
  onChange: (next: PersonaDraft) => void;
  onCancel: () => void;
  onRemove: () => void;
  isSaving: boolean;
  onSave: () => void;
}) {
  const update = (patch: Partial<PersonaDraft>) => onChange({ ...persona, ...patch });
  const updateAvatar = (patch: Partial<PersonaDraft["avatar"]>) =>
    onChange({ ...persona, avatar: { ...persona.avatar, ...patch } });

  return (
    <div
      className="rounded-xl border border-primary/30 bg-card p-4 space-y-3 shadow-sm ring-1 ring-primary/20"
      data-testid={`persona-editor-${index}`}
    >
      <div className="flex justify-between gap-2 items-center">
        <p className="text-sm font-medium">
          Editing {personaDisplayName(persona, index)}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove persona"
          data-testid={`button-remove-persona-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Id {persona.idLocked ? "(locked)" : ""}</Label>
          <Input
            value={persona.id}
            disabled={persona.idLocked}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="career-changer"
            data-testid={`input-persona-id-${index}`}
          />
        </div>
        <div className="space-y-1">
          <Label>Label</Label>
          <Input
            value={persona.label}
            onChange={(e) => update({ label: e.target.value })}
            data-testid={`input-persona-label-${index}`}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Role</Label>
          <Input
            value={persona.role}
            onChange={(e) => update({ role: e.target.value })}
            data-testid={`input-persona-role-${index}`}
          />
        </div>
        <div className="space-y-1">
          <Label>Industry / context</Label>
          <Input
            value={persona.industry_or_context}
            onChange={(e) => update({ industry_or_context: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Demographics</Label>
          <Input
            value={persona.demographics}
            onChange={(e) => update({ demographics: e.target.value })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Buying behavior (optional)</Label>
          <Input
            value={persona.buying_behavior}
            onChange={(e) => update({ buying_behavior: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        <p className="text-xs font-medium">Avatar (emotional)</p>
        <div className="space-y-1">
          <Label>Fears (one per line)</Label>
          <Textarea
            value={persona.avatar.fears}
            onChange={(e) => updateAvatar({ fears: e.target.value })}
            className="min-h-[56px]"
          />
        </div>
        <div className="space-y-1">
          <Label>Internal dialogue</Label>
          <Textarea
            value={persona.avatar.internal_dialogue}
            onChange={(e) => updateAvatar({ internal_dialogue: e.target.value })}
            className="min-h-[56px]"
          />
        </div>
        <div className="space-y-1">
          <Label>Objections (one per line)</Label>
          <Textarea
            value={persona.avatar.objections}
            onChange={(e) => updateAvatar({ objections: e.target.value })}
            className="min-h-[56px]"
          />
        </div>
        <div className="space-y-1">
          <Label>Aspirational identity (optional)</Label>
          <Input
            value={persona.avatar.aspirational_identity}
            onChange={(e) => updateAvatar({ aspirational_identity: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          data-testid={`button-cancel-persona-${index}`}
        >
          Cancel
        </Button>
        <SaveAudienceButton
          size="sm"
          isPending={isSaving}
          onConfirm={onSave}
          testId={`button-save-audience-persona-${index}`}
          confirmTestId={`button-confirm-save-audience-persona-${index}`}
        />
      </div>
    </div>
  );
}

export function ProductAudiencePanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [oneLiner, setOneLiner] = useState("");
  const [whoFor, setWhoFor] = useState("");
  const [whoNot, setWhoNot] = useState("");
  const [editingOffer, setEditingOffer] = useState(false);
  const [personas, setPersonas] = useState<PersonaDraft[]>([]);
  /** Indices currently open in the form editor (new personas start here). */
  const [editingIndices, setEditingIndices] = useState<Set<number>>(new Set());

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
    const nextOffer = offerFromApi(data.audience?.offer);
    setOneLiner(nextOffer.oneLiner);
    setWhoFor(nextOffer.whoFor);
    setWhoNot(nextOffer.whoNot);
    // Empty offer starts in the editor; saved offer shows the read-only card.
    setEditingOffer(!isOfferSet(nextOffer));
    setPersonas((data.audience?.personas ?? []).map(personaFromApi));
    setEditingIndices(new Set());
  }, [data]);

  const offerDraft: OfferDraft = { oneLiner, whoFor, whoNot };
  const savedOffer = offerFromApi(data?.audience?.offer);
  const savedOfferSet = isOfferSet(savedOffer);
  const showOfferEditor = editingOffer || !savedOfferSet;

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
      setEditingOffer(false);
      setEditingIndices(new Set());
      toast({ title: "Audience saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save audience", description: err.message, variant: "destructive" });
    },
  });

  type ProposePersonaResponse =
    | {
        status: "persona";
        persona: {
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
        };
      }
    | { status: "none"; reason?: string };

  const proposeMutation = useMutation({
    mutationFn: async (): Promise<ProposePersonaResponse> => {
      if (!oneLiner.trim() || !whoFor.trim()) {
        throw new Error("Fill the offer first (one-liner and who it’s for).");
      }
      const res = await apiRequest("POST", "/api/ai/generate-persona", {
        slug,
        offer: {
          one_liner: oneLiner.trim(),
          who_its_for: whoFor.trim(),
          ...(whoNot.trim() ? { who_its_not_for: whoNot.trim() } : {}),
        },
        existingPersonas: personas
          .filter((p) => p.id.trim() || p.role.trim())
          .map((p) => ({
            id: p.id.trim() || `draft-${p.role.trim().slice(0, 24) || "persona"}`,
            ...(p.label.trim() ? { label: p.label.trim() } : {}),
            role: p.role.trim() || p.label.trim() || p.id.trim() || "Untitled",
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
      });
      const json = (await res.json()) as ProposePersonaResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to propose persona");
      return json;
    },
    onSuccess: (data) => {
      if (data.status === "none") {
        toast({
          title: "No other personas found to be added",
          description: data.reason?.trim() || undefined,
        });
        return;
      }
      const p = data.persona;
      setPersonas((prev) => {
        const nextIdx = prev.length;
        setEditingIndices((eds) => new Set(eds).add(nextIdx));
        return [
          ...prev,
          {
            id: p.id,
            label: p.label ?? "",
            role: p.role,
            industry_or_context: p.industry_or_context ?? "",
            demographics: p.demographics ?? "",
            buying_behavior: p.buying_behavior ?? "",
            idLocked: false,
            avatar: {
              fears: (p.avatar.fears ?? []).join("\n"),
              internal_dialogue: p.avatar.internal_dialogue ?? "",
              objections: (p.avatar.objections ?? []).join("\n"),
              aspirational_identity: p.avatar.aspirational_identity ?? "",
            },
          },
        ];
      });
      toast({ title: "Persona proposed — review and save" });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not propose persona",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const startEditing = (idx: number) => {
    setEditingIndices((prev) => new Set(prev).add(idx));
  };

  const removePersona = (idx: number) => {
    setPersonas((prev) => prev.filter((_, i) => i !== idx));
    setEditingIndices((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i === idx) continue;
        next.add(i > idx ? i - 1 : i);
      }
      return next;
    });
  };

  const cancelOfferEdit = () => {
    const restored = offerFromApi(data?.audience?.offer);
    setOneLiner(restored.oneLiner);
    setWhoFor(restored.whoFor);
    setWhoNot(restored.whoNot);
    setEditingOffer(false);
  };

  const cancelPersonaEdit = (idx: number) => {
    const current = personas[idx];
    if (!current) return;

    // Brand-new / unsaved persona: discard it entirely.
    if (!current.idLocked) {
      removePersona(idx);
      return;
    }

    const saved = (data?.audience?.personas ?? []).find((p) => p.id === current.id);
    if (saved) {
      const restored = personaFromApi(saved);
      setPersonas((prev) => prev.map((p, i) => (i === idx ? restored : p)));
    }
    setEditingIndices((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  const addPersona = () => {
    setPersonas((prev) => {
      const nextIdx = prev.length;
      setEditingIndices((eds) => new Set(eds).add(nextIdx));
      return [...prev, emptyPersona()];
    });
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading audience…</p>;
  }

  const status = data?.status ?? "missing";

  return (
    <div className="space-y-4" data-testid="product-audience-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold">Audience</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label="About Audience"
                  data-testid="button-audience-info"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-80 space-y-2 text-sm"
                data-testid="popover-audience-info"
              >
                <p className="font-medium text-foreground">How Audience works</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This is the product brief: a short offer and the buyer personas funnel landings
                  can target. It is stored with the product, not on each page.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  To use this product on a funnel landing you need a one-liner, who it&apos;s for,
                  and at least one persona with fears, internal dialogue, and objections filled in.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  After you create a persona, its id stays fixed so pages that already point at it
                  keep working. You also can&apos;t strip the audience down below what live pages
                  still need while those pages are bound to it.
                </p>
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none text-xs text-primary hover:underline">
                    Under the hood
                  </summary>
                  <div className="mt-1.5 space-y-1 font-mono leading-snug">
                    <p>programs/{slug}/_product.yml → offer, personas[].avatar</p>
                    <p>
                      Minimal: offer.one_liner, offer.who_its_for, ≥1 persona with fears, dialogue,
                      objections
                    </p>
                  </div>
                </details>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-sm text-muted-foreground">
            What you sell and who you sell it to. Funnel pages pick product+persona pairs. Saving
            here does not change page copy or publish anything.
          </p>
        </div>
        {status !== "complete" && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={status === "missing" ? "destructive" : "secondary"}
              data-testid="badge-audience-status"
            >
              {status}
            </Badge>
          </div>
        )}
      </div>

      {showOfferEditor ? (
        <OfferEditor
          offer={offerDraft}
          onChange={(next) => {
            setOneLiner(next.oneLiner);
            setWhoFor(next.whoFor);
            setWhoNot(next.whoNot);
          }}
          onCancel={cancelOfferEdit}
          showCancel={savedOfferSet}
          isSaving={saveMutation.isPending}
          onSave={() => saveMutation.mutate()}
        />
      ) : (
        <OfferReadOnlyCard offer={offerDraft} onEdit={() => setEditingOffer(true)} />
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Personas</h3>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={proposeMutation.isPending}
                  onClick={() => {
                    if (!oneLiner.trim() || !whoFor.trim()) {
                      toast({
                        title: "Fill the offer first",
                        description: "Add a one-liner and who it’s for before proposing a persona.",
                        variant: "destructive",
                      });
                      return;
                    }
                    proposeMutation.mutate();
                  }}
                  data-testid="button-propose-persona"
                >
                  {proposeMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Propose Persona
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-center">
                Suggest another distinct buyer using the offer and existing personas. Does not save
                until you click Save audience in the editor.
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addPersona}
              data-testid="button-add-persona"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add persona
            </Button>
          </div>
        </div>

        {personas.length === 0 && (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
            No personas yet. Add at least one (with avatar fears, internal dialogue, and objections)
            before this product can join funnel landings.
          </p>
        )}

        <div className="space-y-4">
          {personas.map((p, idx) =>
            editingIndices.has(idx) ? (
              <PersonaEditor
                key={p.idLocked ? p.id : `new-${idx}`}
                persona={p}
                index={idx}
                onChange={(next) =>
                  setPersonas((prev) => prev.map((x, i) => (i === idx ? next : x)))
                }
                onCancel={() => cancelPersonaEdit(idx)}
                onRemove={() => removePersona(idx)}
                isSaving={saveMutation.isPending}
                onSave={() => saveMutation.mutate()}
              />
            ) : (
              <PersonaReadOnlyCard
                key={p.idLocked ? p.id : `new-${idx}`}
                persona={p}
                index={idx}
                onEdit={() => startEditing(idx)}
                onRemove={() => removePersona(idx)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
