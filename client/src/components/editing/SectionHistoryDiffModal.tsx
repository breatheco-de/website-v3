import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { FileDiff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextDiffView } from "@/components/ui/text-diff-view";
import {
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "@shared/templateVars";
import { sectionMatchesId } from "@shared/sectionIdentity";

function extractSectionObject(
  pageYaml: string,
  opts: { sectionId?: string | null; sectionIndex: number },
): unknown | undefined {
  const { escaped, map } = escapeTemplateVars(pageYaml);
  const rawParsed = yaml.load(escaped);
  const parsed = (rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed) as
    | Record<string, unknown>
    | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const sections = parsed.sections;
  if (!Array.isArray(sections)) return undefined;

  let section: unknown;
  if (opts.sectionId) {
    // With a stable id: never fall back to index (wrong slot = wrong component).
    section = sections.find(
      (s) => s && typeof s === "object" && sectionMatchesId(s as Record<string, unknown>, opts.sectionId),
    );
  } else if (opts.sectionIndex >= 0 && opts.sectionIndex < sections.length) {
    section = sections[opts.sectionIndex];
  }
  return section;
}

function dumpSectionYaml(section: unknown | undefined): string {
  if (section === undefined) return "";
  const { escaped, map } = escapeObjectVars(section);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return unescapeYamlDump(dumped, map);
}

async function fetchFileAt(filePath: string, sha: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(
    `/api/git/file-at?file=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(sha)}`,
    { signal },
  );
  if (!res.ok) return null;
  return res.text();
}

export interface SectionHistoryDiffTarget {
  filePath: string;
  headSha: string;
  parentSha?: string | null;
  sectionId?: string | null;
  sectionIndex: number;
  subject?: string;
}

interface SectionHistoryDiffModalProps {
  target: SectionHistoryDiffTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function SectionHistoryDiffModal({ target, onOpenChange }: SectionHistoryDiffModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");

  useEffect(() => {
    if (!target) {
      setBefore("");
      setAfter("");
      setError(null);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setBefore("");
    setAfter("");

    const opts = { sectionId: target.sectionId, sectionIndex: target.sectionIndex };

    (async () => {
      try {
        const headText = await fetchFileAt(target.filePath, target.headSha, ac.signal);
        if (ac.signal.aborted) return;
        if (headText == null) {
          throw new Error("Could not load section at this commit");
        }
        const afterYaml = dumpSectionYaml(extractSectionObject(headText, opts));

        let beforeYaml = "";
        if (target.parentSha) {
          const parentText = await fetchFileAt(target.filePath, target.parentSha, ac.signal);
          if (ac.signal.aborted) return;
          if (parentText != null) {
            beforeYaml = dumpSectionYaml(extractSectionObject(parentText, opts));
          }
        }

        setBefore(beforeYaml);
        setAfter(afterYaml);
      } catch (e: unknown) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Failed to load section diff");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [target]);

  const shortSha = target?.headSha.slice(0, 7) ?? "";
  const parentLabel = target?.parentSha ? target.parentSha.slice(0, 7) : "none";

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <FileDiff className="h-5 w-5 flex-shrink-0" />
            <span className="truncate">
              Section diff · <code className="text-sm font-mono">{shortSha}</code>
            </span>
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              Parent ({parentLabel}) → this commit. Green lines were added; red lines were removed.
              Only this section is compared, not the full page file.
            </span>
            {target?.subject ? (
              <span className="block truncate text-foreground/80" title={target.subject}>
                {target.subject}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <TextDiffView
          before={before}
          after={after}
          loading={loading}
          error={error}
          emptyMessage={
            after
              ? "No differences for this section versus its parent commit."
              : "Section did not exist at this commit."
          }
        />
      </DialogContent>
    </Dialog>
  );
}
