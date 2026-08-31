import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GitHubConnectSetup } from "@/hooks/useGitHubUserConnection";

export type GitHubConnectErrorState = {
  message: string;
  code?: string | null;
};

interface GitHubConnectErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: GitHubConnectErrorState | null;
  setup: GitHubConnectSetup | null | undefined;
  onRetry: () => void;
}

function RepoList({ repos }: { repos: string[] }) {
  if (repos.length === 0) return null;
  return (
    <ul className="list-disc pl-4 space-y-0.5 font-mono text-xs">
      {repos.map((repo) => (
        <li key={repo}>
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1"
          >
            {repo}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function WriteAccessChecklist({
  setup,
}: {
  setup: GitHubConnectSetup | null | undefined;
}) {
  const repos = setup?.contentRepos ?? [];
  const installUrl = setup?.appInstallUrl;
  const appSlug = setup?.appSlug;

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Setup checklist</p>
      <ol className="list-decimal pl-4 space-y-2">
        <li>
          Open the GitHub App{" "}
          {appSlug ? (
            <span className="font-medium text-foreground">{appSlug}</span>
          ) : (
            "(Caxton CMS)"
          )}{" "}
          and set repository permission{" "}
          <span className="font-medium text-foreground">
            Contents: Read and write
          </span>
          .
        </li>
        <li>
          <span className="font-medium text-foreground">
            Install the app on your organization
          </span>{" "}
          and grant access to the content repo
          {repos.length === 1 ? "" : "s"} below.
          {installUrl ? (
            <>
              {" "}
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1"
                data-testid="link-github-app-install"
              >
                Install GitHub App
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </>
          ) : null}
          {repos.length > 0 ? (
            <div className="mt-1.5">
              <RepoList repos={repos} />
            </div>
          ) : null}
        </li>
        <li>
          Connect with a GitHub account that has{" "}
          <span className="font-medium text-foreground">write access</span> to
          at least one of those repos.
        </li>
        <li>
          On the authorize screen, grant access to the organization if GitHub
          asks.
        </li>
        <li>
          If the org uses SAML SSO, open{" "}
          <span className="font-medium text-foreground">
            GitHub → Settings → Applications
          </span>{" "}
          and authorize the app for the org.
        </li>
        <li>
          Click <span className="font-medium text-foreground">Try again</span>{" "}
          below to reconnect.
        </li>
      </ol>
    </div>
  );
}

export function GitHubConnectErrorDialog({
  open,
  onOpenChange,
  error,
  setup,
  onRetry,
}: GitHubConnectErrorDialogProps) {
  const showWriteAccessSteps =
    error?.code === "no_content_repo_write" ||
    error?.code === "no_content_repo_configured";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="dialog-github-connect-error"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <X className="h-5 w-5 shrink-0" />
            GitHub Connect failed
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4 pt-1">
              {error?.message ? (
                <p className="text-sm text-muted-foreground">{error.message}</p>
              ) : null}
              {showWriteAccessSteps ? (
                <WriteAccessChecklist setup={setup} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Check that the GitHub App is configured and installed, then try
                  connecting again. Ask an org admin if the problem persists.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={onRetry}
            data-testid="button-github-connect-retry"
          >
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
