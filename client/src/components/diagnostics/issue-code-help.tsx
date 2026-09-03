import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type IssueCodeDefinitionClient = {
  title: string;
  summary?: string;
  suggestion?: string;
  next_actions?: Array<{ tool: string; reason: string; priority?: string }>;
};

export type ValidatorWithIssueCodes = {
  name: string;
  description?: string;
  category?: string;
  issueCodes?: Record<string, IssueCodeDefinitionClient>;
};

export function issueCodeLookupKey(validator: string, code: string): string {
  return `${validator}\0${code}`;
}

export function buildIssueCodeMap(
  validators: ValidatorWithIssueCodes[],
): Map<string, IssueCodeDefinitionClient> {
  const map = new Map<string, IssueCodeDefinitionClient>();
  for (const v of validators) {
    if (!v.issueCodes) continue;
    for (const [code, def] of Object.entries(v.issueCodes)) {
      map.set(issueCodeLookupKey(v.name, code), def);
    }
  }
  return map;
}

export function resolveIssueSuggestionClient(
  map: Map<string, IssueCodeDefinitionClient>,
  validator: string | undefined,
  code: string,
  instanceSuggestion?: string | null,
): string | undefined {
  const trimmed = typeof instanceSuggestion === "string" ? instanceSuggestion.trim() : "";
  if (trimmed) return trimmed;
  if (!validator) return undefined;
  return map.get(issueCodeLookupKey(validator, code))?.suggestion;
}

export function useIssueCodeMap() {
  const { data } = useQuery<{ validators: ValidatorWithIssueCodes[] }>({
    queryKey: ["/api/validation/validators"],
  });
  return useMemo(() => buildIssueCodeMap(data?.validators ?? []), [data?.validators]);
}

type IssueContextPayload = {
  exists: boolean;
  path: string;
  relativePath?: string;
  content: string;
};

function useIssueContext(validator: string | undefined, code: string, enabled: boolean) {
  return useQuery<IssueContextPayload>({
    queryKey: ["/api/admin/validation/issue-context", validator, code],
    enabled: Boolean(enabled && validator && code),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/validation/issue-context?validator=${encodeURIComponent(validator!)}&code=${encodeURIComponent(code)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Failed (${res.status})`);
      }
      return (await res.json()) as IssueContextPayload;
    },
  });
}

export function IssueCodePopover({
  code,
  validator,
  help,
  className,
}: {
  code: string;
  validator?: string;
  help?: IssueCodeDefinitionClient;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const cataloged = Boolean(help?.title && validator);
  const contextQuery = useIssueContext(validator, code, open && cataloged);
  const notes = (contextQuery.data?.content || "").trim();
  const incomplete = !(help?.next_actions && help.next_actions.length > 0);

  if (!cataloged) {
    return <code className={className}>{code}</code>;
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "font-mono text-inherit underline-offset-2 hover:underline cursor-pointer",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            data-testid={`button-issue-code-${code}`}
            aria-label={`Explain ${code}`}
          >
            <code>{code}</code>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 space-y-2 text-xs"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="font-medium text-sm text-foreground">{help!.title}</p>
          {help!.summary?.trim() ? (
            <p className="text-muted-foreground leading-relaxed">{help!.summary}</p>
          ) : (
            <p className="text-muted-foreground leading-relaxed">No platform summary yet</p>
          )}
          {incomplete ? (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
              data-testid="badge-issue-code-incomplete"
            >
              Agent guidance incomplete — add recommended next steps (next_actions) for this code.
            </p>
          ) : null}
          <div className="space-y-1 border-t border-border/60 pt-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Site agent notes</p>
            {contextQuery.isPending ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : notes ? (
              <p className="text-foreground/90 whitespace-pre-wrap line-clamp-6">{notes}</p>
            ) : (
              <p className="text-muted-foreground">No site notes yet</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={() => setEditorOpen(true)}
              data-testid="button-edit-issue-context"
            >
              Edit site agent notes
            </Button>
          </div>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 font-mono text-[10px] text-muted-foreground">
              <p>
                {contextQuery.data?.path ||
                  `validation-issue-context/${validator}/${code}.md`}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </PopoverContent>
      </Popover>
      {validator ? (
        <IssueContextEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          validator={validator}
          code={code}
          initialPath={contextQuery.data?.path}
          initialContent={contextQuery.data?.content ?? ""}
          exists={contextQuery.data?.exists ?? false}
        />
      ) : null}
    </>
  );
}

function IssueContextEditorDialog({
  open,
  onOpenChange,
  validator,
  code,
  initialPath,
  initialContent,
  exists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validator: string;
  code: string;
  initialPath?: string;
  initialContent: string;
  exists: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) setContent(initialContent);
  }, [open, initialContent]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/admin/validation/issue-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validator, code, content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || `Save failed (${res.status})`);
      }
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/validation/issue-context", validator, code],
      });
      toast({
        title: exists ? "Site notes saved" : "Site notes created",
        description: (body as { path?: string }).path || `${validator}/${code}.md`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not save notes",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-base">Site agent notes — {code}</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Extra guidance for agents on this issue type (site policy, preferred tools). Saved only when
          you click Save. Empty notes are omitted from agent payloads.
        </p>
        {initialPath ? (
          <p className="font-mono text-[10px] text-muted-foreground truncate" title={initialPath}>
            {initialPath}
            {!exists ? " (new)" : ""}
          </p>
        ) : null}
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[12rem] font-mono text-xs"
          placeholder="e.g. Never create new pillars on this site — always attach to an existing hub."
          data-testid="textarea-issue-context"
        />
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving} data-testid="button-save-issue-context">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
