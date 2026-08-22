import { useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function McpCopyButton({
  text,
  testId = "button-copy-snippet",
}: {
  text: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={handleCopy}
      data-testid={testId}
      className="shrink-0"
    >
      {copied ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
    </Button>
  );
}

export function McpCodeBlock({ code, testId }: { code: string; testId?: string }) {
  return (
    <div className="relative">
      <pre
        className="text-xs font-mono bg-muted px-4 py-3 rounded-md overflow-x-auto text-foreground leading-relaxed whitespace-pre-wrap break-all"
        data-testid={testId}
      >
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <McpCopyButton text={code} />
      </div>
    </div>
  );
}

export function McpSetupSteps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">{children}</ol>;
}
