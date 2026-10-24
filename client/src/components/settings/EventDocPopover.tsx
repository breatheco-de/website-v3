import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventDoc } from "@/lib/tracking-event-docs";

/** Event name badge that opens what the event means, when it fires and when it doesn't. */
export function EventDocPopover({ name }: { name: string }) {
  const doc = eventDoc(name);
  const badge = (
    <Badge variant="secondary" className="font-mono text-xs">
      {name}
    </Badge>
  );
  if (!doc) return badge;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`What ${name} means`}
          data-testid={`button-event-doc-${name.replace(/\s+/g, "-")}`}
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 space-y-3 text-sm" data-testid={`popover-event-doc-${name.replace(/\s+/g, "-")}`}>
        <div className="space-y-1">
          <p className="font-mono text-xs text-muted-foreground">{name}</p>
          <p className="text-foreground leading-relaxed">{doc.summary}</p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">When it fires</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
            {doc.fires.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>

        {doc.notFired && doc.notFired.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Doesn&apos;t fire</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {doc.notFired.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {doc.fields && doc.fields.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Key fields</p>
            <dl className="space-y-1 text-xs">
              {doc.fields.map((f) => (
                <div key={f.name}>
                  <dt className="inline font-mono text-foreground">{f.name}</dt>
                  <dd className="inline text-muted-foreground"> — {f.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-xs text-primary hover:underline">
            Read more (advanced)
          </summary>
          <p className="mt-1.5 font-mono leading-snug">{doc.source}</p>
        </details>
      </PopoverContent>
    </Popover>
  );
}
