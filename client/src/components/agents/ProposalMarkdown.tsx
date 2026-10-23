import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatProposalMarkdown } from "@/lib/proposal-markdown";
import { cn } from "@/lib/utils";

interface ProposalMarkdownProps {
  text: string;
  className?: string;
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
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {formatProposalMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
