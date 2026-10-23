import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type IdeaSeoTarget = {
  main_keyword: string;
  cluster:
    | { mode: "join"; pillar_path: string }
    | { mode: "hub"; members: Array<{ contentType: string; slug: string }> }
    | { mode: "standalone"; reason: string };
  kw_monthly_volume?: number;
  kw_difficulty?: number;
};

type ClusterMode = IdeaSeoTarget["cluster"]["mode"];

type SeoOverviewClusters = {
  clusters: Array<{ pillarUrl: string; clusterCount: number; keyword?: string | null }>;
};

const REASON_MIN = 40;
const STANDALONE_LABELS = new Set(["fast_decay_news", "broken_url"]);

/** "" → undefined (not set); otherwise a whole number within range, or null when invalid. */
function parseMetricInput(raw: string, max?: number): number | undefined | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return undefined;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return max != null && n > max ? null : n;
}

function TargetStat({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: ReactNode | null;
  sub?: ReactNode;
  testId: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5" data-testid={testId}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      {value != null ? (
        <dd className="text-sm font-medium text-foreground">{value}</dd>
      ) : (
        <dd className="text-sm text-status-away">Not set</dd>
      )}
      {sub ? <dd className="text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function clusterStat(c: IdeaSeoTarget["cluster"]): { value: ReactNode; sub: ReactNode } {
  if (c.mode === "join") {
    return { value: <span className="break-all font-mono font-normal">{c.pillar_path}</span>, sub: "Joins this hub" };
  }
  if (c.mode === "hub") {
    return {
      value: "This page becomes a hub",
      sub: `Members: ${c.members.map((m) => `${m.contentType}/${m.slug}`).join(", ")}`,
    };
  }
  return { value: "No cluster", sub: `Why: ${c.reason}` };
}

function parseMembers(raw: string): Array<{ contentType: string; slug: string }> {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [contentType, ...rest] = s.split("/");
      return { contentType: contentType.trim(), slug: rest.join("/").trim() };
    })
    .filter((m) => m.contentType && m.slug);
}

export function IdeaSeoTargetPanel(props: {
  target: IdeaSeoTarget | null | undefined;
  /** Open ideas are editable (proposer / staff); accepted ideas are read-only. */
  editable: boolean;
  locked: boolean;
  /** Idea's declared demand label (review_situations). */
  reviewSituations?: string[];
  /** Locale of the page this idea will create (hub list is filtered to it). */
  locale?: string | null;
  pending: boolean;
  onSave: (target: IdeaSeoTarget) => void;
  /** Rendered inside another card (no own border box). */
  embedded?: boolean;
}) {
  const { target, editable, locked, reviewSituations, locale, pending, onSave, embedded } = props;
  const standaloneAllowed = (reviewSituations ?? []).some((s) => STANDALONE_LABELS.has(s));

  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState<ClusterMode>("join");
  const [pillarPath, setPillarPath] = useState("");
  const [membersRaw, setMembersRaw] = useState("");
  const [reason, setReason] = useState("");
  const [volumeRaw, setVolumeRaw] = useState("");
  const [difficultyRaw, setDifficultyRaw] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!target) return;
    setKeyword(target.main_keyword);
    setVolumeRaw(target.kw_monthly_volume != null ? String(target.kw_monthly_volume) : "");
    setDifficultyRaw(target.kw_difficulty != null ? String(target.kw_difficulty) : "");
    setMode(target.cluster.mode);
    if (target.cluster.mode === "join") setPillarPath(target.cluster.pillar_path);
    if (target.cluster.mode === "hub")
      setMembersRaw(target.cluster.members.map((m) => `${m.contentType}/${m.slug}`).join("\n"));
    if (target.cluster.mode === "standalone") setReason(target.cluster.reason);
  }, [target]);

  const { data: overview } = useQuery<SeoOverviewClusters>({
    queryKey: ["/api/seo/overview"],
    enabled: editable,
  });
  const hubs = useMemo(() => {
    const all = overview?.clusters ?? [];
    const prefix = locale ? `/${locale.toLowerCase()}/` : null;
    return prefix ? all.filter((c) => c.pillarUrl.toLowerCase().startsWith(prefix)) : all;
  }, [overview, locale]);

  const members = parseMembers(membersRaw);
  const volume = parseMetricInput(volumeRaw);
  const difficulty = parseMetricInput(difficultyRaw, 100);
  const canSave =
    !pending &&
    keyword.trim().length > 0 &&
    volume !== null &&
    difficulty !== null &&
    (mode === "join"
      ? pillarPath.trim().length > 0
      : mode === "hub"
        ? members.length > 0
        : standaloneAllowed && reason.trim().length >= REASON_MIN);

  const save = () => {
    const cluster: IdeaSeoTarget["cluster"] =
      mode === "join"
        ? { mode, pillar_path: pillarPath.trim() }
        : mode === "hub"
          ? { mode, members }
          : { mode, reason: reason.trim() };
    onSave({
      main_keyword: keyword.trim(),
      cluster,
      ...(volume != null ? { kw_monthly_volume: volume } : {}),
      ...(difficulty != null ? { kw_difficulty: difficulty } : {}),
    });
  };

  return (
    <div
      className={embedded ? "space-y-2" : "space-y-2 rounded-md border border-card-border bg-muted/20 px-3 py-2.5"}
      data-testid="proposal-idea-seo-target"
    >
      <p className="text-xs text-muted-foreground">
        {locked
          ? "Locked at accept (read-only). The keyword and cluster were copied into the new page's draft."
          : "The search this new page should win and the cluster (topic hub) it joins. Locked when the idea is accepted; the keyword and cluster are copied into the new page."}
      </p>
      {target ? (
        <div className="space-y-1">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 @xl:grid-cols-4">
            <TargetStat
              label="Keyword"
              value={<span className="break-words">{target.main_keyword}</span>}
              testId="meta-idea-seo-keyword"
            />
            <TargetStat label="Cluster" testId="meta-idea-seo-cluster" {...clusterStat(target.cluster)} />
            <TargetStat
              label="Search volume"
              value={target.kw_monthly_volume != null ? `${target.kw_monthly_volume.toLocaleString()}/mo` : null}
              testId="meta-idea-seo-volume"
            />
            <TargetStat
              label="Difficulty"
              value={target.kw_difficulty != null ? `${target.kw_difficulty}/100` : null}
              testId="meta-idea-seo-difficulty"
            />
          </dl>
          {target.kw_monthly_volume == null || target.kw_difficulty == null ? (
            <p className="text-xs text-muted-foreground" data-testid="text-idea-seo-metrics-missing">
              {locked
                ? "This idea was accepted without both numbers. Check the evidence in the idea brief."
                : "Ask the author for both numbers from their keyword research before accepting."}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-status-away" data-testid="text-idea-seo-target-missing">
          No SEO target yet. New pages on SEO-tracked types cannot be accepted without one.
        </p>
      )}

      {editable ? (
        <div className="grid gap-2 @xl:grid-cols-3">
          <div className="space-y-1 @xl:col-span-3">
            <Label htmlFor="idea-seo-keyword" className="text-xs">
              Main keyword
            </Label>
            <Input
              id="idea-seo-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="review ai generated code"
              data-testid="input-idea-seo-keyword"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-seo-volume" className="text-xs">
              Monthly searches
            </Label>
            <Input
              id="idea-seo-volume"
              inputMode="numeric"
              value={volumeRaw}
              onChange={(e) => setVolumeRaw(e.target.value)}
              placeholder="9900"
              aria-invalid={volume === null}
              data-testid="input-idea-seo-volume"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-seo-difficulty" className="text-xs">
              Difficulty (0–100)
            </Label>
            <Input
              id="idea-seo-difficulty"
              inputMode="numeric"
              value={difficultyRaw}
              onChange={(e) => setDifficultyRaw(e.target.value)}
              placeholder="35"
              aria-invalid={difficulty === null}
              data-testid="input-idea-seo-difficulty"
            />
          </div>
          <p className="self-end text-xs text-muted-foreground @xl:pb-2">
            {volume === null || difficulty === null
              ? "Use whole numbers; difficulty goes up to 100."
              : "Copy both from keyword research. Don't estimate."}
          </p>
          <div className="space-y-1">
            <Label htmlFor="idea-seo-mode" className="text-xs">
              Cluster
            </Label>
            <select
              id="idea-seo-mode"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={mode}
              onChange={(e) => setMode(e.target.value as ClusterMode)}
              data-testid="select-idea-seo-mode"
            >
              <option value="join">Join an existing hub</option>
              <option value="hub">This page becomes a hub</option>
              <option value="standalone" disabled={!standaloneAllowed}>
                No hub{standaloneAllowed ? "" : " (news / broken-URL ideas only)"}
              </option>
            </select>
          </div>
          <div className="space-y-1 @xl:col-span-2">
            {mode === "join" ? (
              <>
                <Label htmlFor="idea-seo-hub" className="text-xs">
                  Hub{locale ? ` (${locale})` : ""}
                </Label>
                <select
                  id="idea-seo-hub"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={pillarPath}
                  onChange={(e) => setPillarPath(e.target.value)}
                  data-testid="select-idea-seo-hub"
                >
                  <option value="">Pick a live hub…</option>
                  {pillarPath && !hubs.some((h) => h.pillarUrl === pillarPath) ? (
                    <option value={pillarPath}>{pillarPath}</option>
                  ) : null}
                  {hubs.map((h) => (
                    <option key={h.pillarUrl} value={h.pillarUrl}>
                      {h.pillarUrl}
                      {h.keyword ? ` — ${h.keyword}` : ""} ({h.clusterCount})
                    </option>
                  ))}
                </select>
              </>
            ) : mode === "hub" ? (
              <>
                <Label htmlFor="idea-seo-members" className="text-xs">
                  Posts that will join this hub (one per line, type/slug)
                </Label>
                <Textarea
                  id="idea-seo-members"
                  value={membersRaw}
                  onChange={(e) => setMembersRaw(e.target.value)}
                  placeholder={"blog/some-existing-post"}
                  rows={2}
                  data-testid="textarea-idea-seo-members"
                />
                <p className="text-xs text-muted-foreground">
                  Name at least one existing post that will join this hub.
                </p>
              </>
            ) : (
              <>
                <Label htmlFor="idea-seo-reason" className="text-xs">
                  Why this page needs no hub
                </Label>
                <Textarea
                  id="idea-seo-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  data-testid="textarea-idea-seo-reason"
                />
                <p className="text-xs text-muted-foreground">
                  {reason.trim().length}/{REASON_MIN} characters minimum.
                </p>
              </>
            )}
          </div>
          <div className="@xl:col-span-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canSave}
              onClick={save}
              data-testid="button-save-idea-seo-target"
            >
              Save SEO target
            </Button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setShowAdvanced((v) => !v)}
        data-testid="button-idea-seo-advanced"
      >
        {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
      </button>
      {showAdvanced ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            On the implementing edit, the target is written as <code className="font-mono">seo.main_keyword</code>{" "}
            plus <code className="font-mono">seo.pillar_path</code> (join), <code className="font-mono">seo.is_pillar: true</code>{" "}
            (hub), or <code className="font-mono">seo.pillar_path: null</code> (no hub) into{" "}
            <code className="font-mono">draft.{"{locale}"}.yml</code>. First publish copies it to live and{" "}
            <code className="font-mono">seo-index.json</code>.
          </p>
          <p>
            Volume and difficulty are stored as <code className="font-mono">kw_monthly_volume</code> and{" "}
            <code className="font-mono">kw_difficulty</code> on the idea only. They are not copied into the page;
            the page&apos;s own numbers come from SEO research.
          </p>
          <p>
            Accept checks the hub is live and in the same language, and that no live page or other accepted idea
            already targets the keyword. A renamed hub is followed; a deleted hub stops apply. Edits that change the
            keyword or hub need an override reason. Other languages pick their own keyword and hub when translated.
          </p>
        </div>
      ) : null}
    </div>
  );
}
