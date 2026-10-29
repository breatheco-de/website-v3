import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import {
  LiveUrlRedirectHijackBanner,
  privateRedirectsInspectHref,
} from "@/components/DebugBubble/components/seoRedirectHijack";
import {
  normalizeRedirectInput,
  previewRedirectBlock,
  type RedirectPreviewResult,
} from "@/components/DebugBubble/components/seoRedirectsPreview";

type Block = { message: string; href: string };

export interface SeoRedirectsTabProps {
  redirects: string[];
  /** This page's public path in the current language (redirect destination). */
  pagePath: string | null;
  locale: string;
  isVariantContext: boolean;
  /** Called with the saved list after an add or remove succeeds. */
  onRedirectsChanged: (redirects: string[]) => void;
  liveUrlHijacked: boolean;
  hijackDest?: string;
  hijackSource?: string;
}

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...getSessionHeaders() };
  const token = getDebugToken();
  if (token) headers["X-Debug-Token"] = token;
  return headers;
}

async function testUrl(url: string, locale: string): Promise<RedirectPreviewResult | null> {
  const res = await fetch(
    `/api/debug/redirects/test?url=${encodeURIComponent(url)}&locale=${encodeURIComponent(locale)}`,
    { headers: jsonHeaders() },
  );
  if (!res.ok) return null;
  return (await res.json()) as RedirectPreviewResult;
}

function BlockMessage({ block, testId }: { block: Block; testId: string }) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:text-red-300 space-y-1"
      data-testid={testId}
    >
      <p>{block.message}</p>
      <a
        href={block.href}
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors"
        data-testid={`${testId}-link`}
      >
        Open in Redirects page
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

export function SeoRedirectsTab({
  redirects,
  pagePath,
  locale,
  isVariantContext,
  onRedirectsChanged,
  liveUrlHijacked,
  hijackDest,
  hijackSource,
}: SeoRedirectsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fromInput, setFromInput] = useState("");
  const [allLanguages, setAllLanguages] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ input: string; block: Block | null } | null>(null);
  const [addBlock, setAddBlock] = useState<Block | null>(null);
  const [removeBlock, setRemoveBlock] = useState<Block | null>(null);

  const canEdit = !isVariantContext && !!pagePath;
  const normalizedInput = normalizeRedirectInput(fromInput);

  useEffect(() => {
    setAddBlock(null);
    if (!canEdit || !normalizedInput) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await testUrl(normalizedInput, locale).catch(() => null);
      if (cancelled) return;
      const block = previewRedirectBlock(normalizedInput, pagePath!, result);
      setPreview({
        input: normalizedInput,
        block: block ? { message: block, href: privateRedirectsInspectHref(normalizedInput) } : null,
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedInput, canEdit, locale, pagePath]);

  const previewBlock = preview && preview.input === normalizedInput ? preview.block : null;
  const shownBlock = addBlock ?? previewBlock;

  const refreshRedirectQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects/test"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
  };

  const handleAdd = async () => {
    if (!canEdit || !normalizedInput || adding) return;
    setAdding(true);
    setAddBlock(null);
    try {
      const author = await resolveAuthorName();
      const res = await fetch("/api/debug/redirects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ from: fromInput.trim(), to: pagePath, allLanguages, simple: true, author }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : "Could not add the redirect.";
        if (typeof data.code === "string") {
          setAddBlock({
            message,
            href:
              typeof data.redirects_page_url === "string"
                ? data.redirects_page_url
                : privateRedirectsInspectHref(normalizedInput),
          });
        } else {
          toast({ title: "Failed to add redirect", description: message, variant: "destructive" });
        }
        return;
      }
      const added = typeof data.from === "string" ? data.from : normalizedInput;
      onRedirectsChanged(redirects.includes(added) ? redirects : [...redirects, added]);
      const skipped = Array.isArray(data.warnings)
        ? data.warnings.find((w: { code?: string }) => w?.code === "redirect_languages_skipped")
        : undefined;
      toast({
        title: "Redirect added",
        description: skipped?.message
          ? `${added} now sends visitors here. ${skipped.message}`
          : `${added} now sends visitors here${allLanguages ? " in all languages" : ""}.`,
      });
      setFromInput("");
      setPreview(null);
      refreshRedirectQueries();
    } catch (err) {
      toast({
        title: "Failed to add redirect",
        description: err instanceof Error ? err.message : "Could not add the redirect.",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (from: string) => {
    if (!canEdit || removing) return;
    setRemoving(from);
    setRemoveBlock(null);
    try {
      const result = await testUrl(from, locale);
      const winnerTo = result?.resolvedTo ? normalizeRedirectInput(result.resolvedTo) : "";
      if (!result?.match || !result.source || winnerTo !== normalizeRedirectInput(pagePath!)) {
        setRemoveBlock({
          message: `${from} is not currently sending visitors to this page (another rule wins), so it cannot be removed from here.`,
          href: privateRedirectsInspectHref(from),
        });
        return;
      }
      const author = await resolveAuthorName();
      const res = await fetch("/api/debug/redirects", {
        method: "DELETE",
        headers: jsonHeaders(),
        body: JSON.stringify({ from: result.from ?? from, source: result.source, author }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Could not remove the redirect.");
      }
      onRedirectsChanged(redirects.filter((r) => r !== from));
      toast({
        title: "Redirect removed",
        description: /(?:^|\/)_common\.yml$/.test(result.source)
          ? `${from} no longer redirects here, in any language.`
          : `${from} no longer redirects here.`,
      });
      refreshRedirectQueries();
    } catch (err) {
      toast({
        title: "Failed to remove redirect",
        description: err instanceof Error ? err.message : "Could not remove the redirect.",
        variant: "destructive",
      });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <div>
        <h4 className="text-sm font-semibold">Redirects</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Old addresses that send visitors to this page. Add a path like{" "}
          <code className="font-mono bg-muted px-1 rounded">/old-page</code> and anyone who visits it lands here.
        </p>
      </div>

      {liveUrlHijacked && pagePath && (
        <LiveUrlRedirectHijackBanner livePath={pagePath} destination={hijackDest} sourceLabel={hijackSource} />
      )}

      {isVariantContext && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground"
          data-testid="banner-seo-redirects-variant"
        >
          Redirects apply to the LIVE page. Switch to LIVE to add or remove redirects.
        </div>
      )}

      {redirects.length > 0 ? (
        <div className="min-w-0 space-y-1.5">
          {redirects.map((redirect, idx) => (
            <div
              key={redirect}
              className="flex min-w-0 items-start gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 text-sm font-mono"
              data-testid={`row-redirect-${idx}`}
            >
              <span className="min-w-0 flex-1 break-all text-xs" title={redirect}>{redirect}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleRemove(redirect)}
                  disabled={removing !== null}
                  className="mt-0.5 shrink-0 rounded-sm hover-elevate disabled:opacity-50"
                  aria-label={`Remove redirect ${redirect}`}
                  data-testid={`button-remove-redirect-${idx}`}
                >
                  {removing === redirect ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="text-redirects-empty">
          No old addresses redirect here yet.
        </p>
      )}

      {removeBlock && <BlockMessage block={removeBlock} testId="block-remove-redirect" />}

      {canEdit && (
        <div className="space-y-2" data-testid="form-add-redirect">
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <Input
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              placeholder="/old-page"
              className="h-8 min-w-0 flex-1 font-mono text-xs"
              aria-label="Old path to redirect here"
              data-testid="input-add-redirect"
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 shrink-0"
              disabled={!normalizedInput || adding || !!shownBlock}
              data-testid="button-add-redirect"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add redirect
            </Button>
          </form>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={allLanguages}
              onCheckedChange={(v) => setAllLanguages(v === true)}
              data-testid="checkbox-redirect-all-languages"
            />
            All languages (otherwise only this language)
          </label>
          {shownBlock && <BlockMessage block={shownBlock} testId="block-add-redirect" />}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-redirects-note">
        <Info className="h-3.5 w-3.5 shrink-0" />
        For patterns, 302s or other destinations, use the{" "}
        <a
          href="/private/redirects"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
          data-testid="link-redirects-page"
        >
          Redirects page
        </a>.
      </p>
    </>
  );
}
