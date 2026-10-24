/** One numbered, collapsible step in a Settings setup-instructions dialog (wrap in a single Accordion). */

import type { ReactNode } from "react";
import { IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function SetupStep({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <AccordionItem value={`step-${n}`} data-testid={`setup-step-${n}`}>
      <AccordionTrigger className="gap-2 py-3 hover:no-underline">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {n}
        </span>
        <span className="flex-1 text-left text-sm font-medium text-foreground">{title}</span>
        {done !== undefined &&
          (done ? (
            <span className="flex items-center gap-1 text-xs font-normal text-status-online">
              <IconCircleCheck className="h-4 w-4" /> Done
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <IconCircleDashed className="h-4 w-4" /> To do
            </span>
          ))}
      </AccordionTrigger>
      <AccordionContent className="pb-4 pl-8 text-sm text-muted-foreground leading-relaxed">{children}</AccordionContent>
    </AccordionItem>
  );
}

export function GtmVariablesTable({ keys }: { keys: readonly string[] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border" data-testid="table-gtm-variables">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-1.5 font-medium">Name it</th>
            <th className="px-3 py-1.5 font-medium">Data Layer Variable Name</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-t">
              <td className="px-3 py-1.5 font-mono">DLV - {key}</td>
              <td className="px-3 py-1.5 font-mono text-foreground">{key}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreateThemChip() {
  return (
    <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
      Create them
    </span>
  );
}
