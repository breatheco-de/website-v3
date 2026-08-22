import type { SVGProps } from "react";
import {
  IconBrandGithubCopilot,
  IconBrandOpenai,
  IconBrandX,
  IconCopy,
} from "@tabler/icons-react";
import type { SolveWithAiAgentId } from "./solveWithAiPrompt";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** Anthropic / Claude-style asterisk mark (no Tabler brand icon). */
function ClaudeMark({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
      {...props}
    >
      <path d="M12.5 2.1 14.2 9l6.9.4-5.4 4.3 1.8 6.7-5.9-3.6-5.9 3.6 1.8-6.7L2 9.4l6.9-.4L10.6 2.1c.3-1.2 2-1.2 2.3 0z" />
    </svg>
  );
}

/** Perplexity-style asterisk (no Tabler brand icon). */
function PerplexityMark({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
      {...props}
    >
      <path d="M12 2.5c.4 0 .7.2.9.5l2.2 3.8 4.3.9c.9.2 1.3 1.2.7 1.9l-2.9 3.2.5 4.4c.1.9-.8 1.6-1.6 1.2L12 16.7l-4.1 1.7c-.8.4-1.7-.3-1.6-1.2l.5-4.4-2.9-3.2c-.6-.7-.2-1.7.7-1.9l4.3-.9L11.1 3c.2-.3.5-.5.9-.5z" />
    </svg>
  );
}

const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

export function SolveWithAiAgentIcon({
  agentId,
  className,
}: {
  agentId: SolveWithAiAgentId;
  className?: string;
}) {
  const cls = cn(iconClass, className);
  switch (agentId) {
    case "claude-ai":
      return <ClaudeMark className={cls} />;
    case "grok":
      return <IconBrandX className={cls} />;
    case "chatgpt":
      return <IconBrandOpenai className={cls} />;
    case "perplexity":
      return <PerplexityMark className={cls} />;
    case "copilot":
      return <IconBrandGithubCopilot className={cls} />;
    case "copy-prompt":
      return <IconCopy className={cls} />;
    default:
      return null;
  }
}
