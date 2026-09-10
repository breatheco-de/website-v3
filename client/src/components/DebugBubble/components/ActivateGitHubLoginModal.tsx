import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface ActivateGitHubLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string | null;
  callbackUrl: string | null;
}

const PLACEHOLDER_CALLBACK = "https://YOUR-DOMAIN/api/github/oauth/callback";

type Step = {
  id: string;
  title: string;
  body: ReactNode;
};

function StepCard({
  stepNumber,
  title,
  children,
  defaultOpen = false,
}: {
  stepNumber: number;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border bg-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-2.5 p-3 text-left hover-elevate rounded-md"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground mt-0.5">
            {stepNumber}
          </span>
          <span className="flex-1 min-w-0 text-sm font-medium text-foreground leading-snug">
            {title}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground shrink-0 mt-0.5 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pl-[2.375rem] space-y-2 text-xs text-muted-foreground leading-relaxed">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActivateGitHubLoginModal({
  open,
  onOpenChange,
  siteUrl,
  callbackUrl,
}: ActivateGitHubLoginModalProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const displayCallback = callbackUrl || PLACEHOLDER_CALLBACK;
  const hasPublicAddress = Boolean(siteUrl && callbackUrl);

  const steps: Step[] = [
    {
      id: "public-address",
      title: "Give your site an address the internet can reach",
      body: (
        <>
          <p>
            When someone clicks “Sign in with GitHub,” GitHub needs to send them{" "}
            <span className="text-foreground">back to your site</span> afterward. That only works
            if your site has a real public address — like your live domain, or a tunnel link that
            stays the same.
          </p>
          <p>
            <span className="text-foreground">localhost</span> (or any address that only works on
            your computer) will not work. GitHub cannot reach your laptop.
          </p>
          {!hasPublicAddress && (
            <p className="rounded-md bg-muted/60 px-2 py-1.5 text-foreground">
              This site does not have a public address set yet. Finish that before the later steps
              will stick.
            </p>
          )}
          {hasPublicAddress && siteUrl && (
            <p>
              Current address:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all">
                {siteUrl}
              </code>
            </p>
          )}
        </>
      ),
    },
    {
      id: "create-app",
      title: "Create a GitHub App for this site",
      body: (
        <>
          <p>
            A GitHub App is GitHub’s way of letting a website offer “Sign in with GitHub.” You create
            one in GitHub (under your org or account settings → Developer settings → GitHub Apps).
          </p>
          <p>
            Give it a clear name for this site so you can tell it apart from other apps later. You
            do not need to grant repo access for staff sign-in — this App is only for logging people
            in.
          </p>
        </>
      ),
    },
    {
      id: "callback",
      title: "Tell GitHub where to send people after they sign in",
      body: (
        <>
          <p>
            In the App settings, find the field for the{" "}
            <span className="text-foreground">callback URL</span> (sometimes called “Authorization
            callback URL”). Paste this exact address:
          </p>
          <code className="block rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground break-all">
            {displayCallback}
          </code>
          <p>
            If this still shows a placeholder, go back to step 1 and set a public site address
            first — the callback is built from that address.
          </p>
        </>
      ),
    },
    {
      id: "email",
      title: "Allow the App to read verified email",
      body: (
        <>
          <p>
            Staff can only sign in if GitHub knows they have a{" "}
            <span className="text-foreground">verified email</span>. In the App’s permissions, set
            Email to <span className="text-foreground">Read</span>.
          </p>
          <p>
            Without that, sign-in will fail even if everything else is set up correctly.
          </p>
        </>
      ),
    },
    {
      id: "credentials",
      title: "Save the App’s keys and restart the site",
      body: (
        <>
          <p>
            After you create the App, GitHub shows a Client ID, a Client Secret, and an App slug
            (the short name in the App’s URL). Put those three values into this site’s environment
            settings, then restart so the new values load.
          </p>
          <p>
            Until you restart, the site will still behave as if GitHub sign-in is off.
          </p>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md dark:bg-background">
        <DialogHeader>
          <DialogTitle>Activate GitHub sign-in</DialogTitle>
          <DialogDescription>
            So staff can log in with GitHub, this site needs a public web address and a GitHub App.
            Open each step below for what to do and why.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              stepNumber={index + 1}
              title={step.title}
              defaultOpen={index === 0 && !hasPublicAddress}
            >
              {step.body}
            </StepCard>
          ))}
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground mt-2">
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                !advancedOpen && "-rotate-90",
              )}
            />
            Read more (advanced)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs space-y-2 text-muted-foreground">
            <p>Environment variable names:</p>
            <div className="font-mono space-y-1">
              <p>GITHUB_APP_CLIENT_ID</p>
              <p>GITHUB_APP_CLIENT_SECRET</p>
              <p>GITHUB_APP_SLUG</p>
            </div>
            <p>
              The callback URL is built from{" "}
              <code className="font-mono text-foreground">SITE_URL</code> as{" "}
              <code className="font-mono text-foreground">
                {"{SITE_URL}"}/api/github/oauth/callback
              </code>
              . Temporary tunnel hostnames that change on every restart are a poor callback target —
              use a hostname that stays put.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </DialogContent>
    </Dialog>
  );
}
