/**
 * Setup instructions for product / persona tracking: what staff must do in GA4 and
 * Tag Manager so the dataLayer keys reach Google Analytics reports and BigQuery.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Accordion } from "@/components/ui/accordion";
import { CreateThemChip, GtmVariablesTable, SetupStep } from "./SetupStep";

const KEYS = ["product", "persona", "product_persona", "funnel_stage", "content_key", "tracking_truncated"];

function firstOpenStep(keysReady?: boolean, dimensionsReady?: boolean): string {
  if (!keysReady) return "step-1";
  if (!dimensionsReady) return "step-2";
  return "step-3";
}

export function ProductPersonaSetupDialog({
  open,
  onOpenChange,
  keysReady,
  dimensionsReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keysReady?: boolean;
  dimensionsReady?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-product-persona-setup">
        <DialogHeader>
          <DialogTitle>See product &amp; persona in Google Analytics</DialogTitle>
          <DialogDescription>
            The site already sends them. Five steps get them into your reports. Nothing on the site breaks while you
            set this up.
          </DialogDescription>
        </DialogHeader>

        <Accordion type="single" collapsible defaultValue={firstOpenStep(keysReady, dimensionsReady)}>
          <SetupStep n={1} title="Give each product and persona a code" done={keysReady}>
            Run migration 009 in Settings → General → Migrations, or add the codes in the Store.
          </SetupStep>

          <SetupStep n={2} title="Add them to Google Analytics" done={dimensionsReady}>
            Click <CreateThemChip /> on this card.
          </SetupStep>

          <SetupStep n={3} title="Create six variables in Tag Manager">
            In Tag Manager, go to Variables → New → Data Layer Variable. Make one per row: give it the name on the left,
            and type the right column exactly in the Data Layer Variable Name field.
            <GtmVariablesTable keys={KEYS} />
          </SetupStep>

          <SetupStep n={4} title="Send them with every event">
            Add the six variables to the Google tag and to each Google Analytics event tag. Then click Submit and
            Publish.
          </SetupStep>

          <SetupStep n={5} title="Check your reports">
            Give it a day, then look for Product and Persona in Google Analytics. Older data won&apos;t have them.
          </SetupStep>
        </Accordion>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Read more (advanced): Tag Manager steps</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
            <li>
              Step 3: web container, Data Layer Version 2 (the default). The name is only a label; the Data Layer
              Variable Name must match the key exactly.
            </li>
            <li>
              Step 4 shortcut: create one Google Tag: Event Settings variable with six parameters (name = key, value ={" "}
              <code>{"{{DLV - <key>}}"}</code>). Attach it to the Google tag under Shared event settings (so page views
              carry it) and to every GA4 Event tag under Event Settings Variable.
            </li>
            <li>Server container: make sure no parameter filter or transformation drops the six keys.</li>
            <li>
              Verify in Preview on a page with a product: the first Data Layer entry (before <code>gtm.js</code>) has
              the keys, and each GA4 hit lists them. Then check GA4 DebugView.
            </li>
            <li>
              Values are short codes (<code>all</code> = every product, <code>none</code> = no funnel); use Download
              code list to translate. BigQuery gets them as soon as Tag Manager sends them, even before step 2.
            </li>
            <li>
              Sources: server/utils/html-inject.ts (push before Tag Manager loads), client/src/lib/tracking.ts (every
              event), docs/gtm-analytics-setup.md.
            </li>
          </ol>
        </details>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-product-persona-setup">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
