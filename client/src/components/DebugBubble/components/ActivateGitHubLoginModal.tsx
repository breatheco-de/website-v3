import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface ActivateGitHubLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string | null;
  callbackUrl: string | null;
}

const PLACEHOLDER_CALLBACK = "https://YOUR-DOMAIN/api/github/oauth/callback";

export function ActivateGitHubLoginModal({
  open,
  onOpenChange,
  siteUrl,
  callbackUrl,
}: ActivateGitHubLoginModalProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const displayCallback = callbackUrl || PLACEHOLDER_CALLBACK;
  const hasDurableUrl = Boolean(siteUrl && callbackUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md dark:bg-background">
        <DialogHeader>
          <DialogTitle>Activate GitHub sign-in</DialogTitle>
          <DialogDescription>
            Staff GitHub login needs a real public site address and a GitHub App. Localhost will not work for the callback.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal list-inside space-y-2 text-sm text-foreground">
          <li>
            Set a durable public site URL (real domain or stable tunnel hostname — not localhost).
            {!hasDurableUrl && (
              <span className="block mt-1 text-xs text-muted-foreground">
                No public site URL is configured yet. Use a real domain before finishing App setup.
              </span>
            )}
          </li>
          <li>Create a GitHub App for this site.</li>
          <li>
            Set the App callback URL to:
            <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs font-mono break-all">
              {displayCallback}
            </code>
          </li>
          <li>Grant the App Email → Read permission (verified email is required to sign in).</li>
          <li>Add the three GitHub App environment variables, then restart the app.</li>
        </ol>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground mt-3">
            {advancedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Read more (advanced)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs font-mono space-y-1 text-muted-foreground">
            <p>GITHUB_APP_CLIENT_ID</p>
            <p>GITHUB_APP_CLIENT_SECRET</p>
            <p>GITHUB_APP_SLUG</p>
            <p className="pt-1 font-sans">
              Callback is derived from SITE_URL as {"{SITE_URL}"}/api/github/oauth/callback. Rotating trycloudflare URLs are a poor callback target — prefer a stable hostname.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </DialogContent>
    </Dialog>
  );
}
