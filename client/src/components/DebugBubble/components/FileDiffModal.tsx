import { useEffect, useState } from "react";
import { FileDiff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TextDiffView } from "@/components/ui/text-diff-view";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";

interface FileStatusResponse {
  exists: boolean;
  localSha: string | null;
  remoteSha: string | null;
  hasConflict: boolean;
  status: "synced" | "local-only" | "remote-only" | "modified" | "conflict";
  localContent?: string;
  remoteContent?: string;
  error?: string;
}

const STATUS_LABELS: Record<FileStatusResponse["status"], string> = {
  synced: "In sync",
  "local-only": "Local only",
  "remote-only": "Remote only",
  modified: "Modified",
  conflict: "Conflict",
};

interface FileDiffModalProps {
  filePath: string | null;
  onOpenChange: (open: boolean) => void;
}

export function FileDiffModal({ filePath, onOpenChange }: FileDiffModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState<FileStatusResponse | null>(null);
  const formatSitePath = useFormatSitePath();

  useEffect(() => {
    if (!filePath) {
      setFileStatus(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setFileStatus(null);

    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;

    fetch(`/api/github/file-status?file=${encodeURIComponent(filePath)}`, {
      headers,
      signal: ac.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as FileStatusResponse;
        if (!res.ok) throw new Error(data.error || "Failed to load file status");
        setFileStatus(data);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Failed to load diff");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [filePath]);

  return (
    <Dialog open={filePath !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <FileDiff className="h-5 w-5 flex-shrink-0" />
            <span className="font-mono text-sm truncate" title={filePath ?? ""}>
              {filePath ? formatSitePath(filePath) : ""}
            </span>
            {fileStatus && (
              <Badge
                variant={
                  fileStatus.status === "conflict"
                    ? "destructive"
                    : fileStatus.status === "synced"
                      ? "secondary"
                      : "outline"
                }
                className="flex-shrink-0"
              >
                {STATUS_LABELS[fileStatus.status]}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Remote version vs your local version. Green lines exist only locally, red lines only on remote.
          </DialogDescription>
        </DialogHeader>

        <TextDiffView
          before={fileStatus?.remoteContent ?? ""}
          after={fileStatus?.localContent ?? ""}
          loading={loading}
          error={error}
          emptyMessage="No differences between local and remote."
        />
      </DialogContent>
    </Dialog>
  );
}
