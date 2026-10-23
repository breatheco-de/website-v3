import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { formatProposalMarkdown, isSitePath, remarkSitePaths } from "@/lib/proposal-markdown";
import { cn } from "@/lib/utils";

interface ProposalMarkdownProps {
  text: string;
  className?: string;
}

/** A site-relative path (`/blog/x`) in agent text: menu to open it or copy the URL / path. */
function SitePathLink({ path, children }: { path: string; children: ReactNode }) {
  const { toast } = useToast();
  const fullUrl = () => new URL(path, window.location.origin).href;

  const copy = async (value: string, title: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title, description: value, duration: 2000 });
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline break-all text-left text-primary underline underline-offset-2 hover:opacity-80"
          data-testid="proposal-site-path"
        >
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-sm">
        <DropdownMenuLabel className="break-all font-mono text-xs font-normal text-muted-foreground">{path}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open(fullUrl(), "_blank", "noopener,noreferrer")}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(fullUrl(), "Link copied")}>
          <Link2 className="mr-2 h-4 w-4" />
          Copy full link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(path, "Path copied")}>
          <Copy className="mr-2 h-4 w-4" />
          Copy path
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Agent-written proposal text (briefs, needs-change notes): Markdown with lists, `code`, bold, and links. */
export function ProposalMarkdown({ text, className }: ProposalMarkdownProps) {
  return (
    <div
      className={cn(
        "space-y-2 break-words leading-relaxed",
        "[&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
        "[&_li]:pl-1 [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkSitePaths]}
        components={{
          a: ({ node: _node, href, children, ...props }) =>
            href && isSitePath(href) ? (
              <SitePathLink path={href}>{children}</SitePathLink>
            ) : (
              <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {formatProposalMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
