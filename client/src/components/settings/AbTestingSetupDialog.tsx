/**
 * Setup instructions for page-test reporting: what staff must do in GA4 and Tag Manager so
 * `experiment_id` / `variant` (and the `experiment_exposure` event) reach Google Analytics reports.
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

const KEYS = ["experiment_id", "variant"];

export function AbTestingSetupDialog({
  open,
  onOpenChange,
  dimensionsReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dimensionsReady?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-ab-testing-setup">
        <DialogHeader>
          <DialogTitle>See page versions in Google Analytics</DialogTitle>
          <DialogDescription>
            The site already sends which version each visitor saw. Five steps get it into your reports. Tests keep
            running while you set this up.
          </DialogDescription>
        </DialogHeader>

        <Accordion type="single" collapsible defaultValue={dimensionsReady ? "step-2" : "step-1"}>
          <SetupStep n={1} title="Add them to Google Analytics" done={dimensionsReady}>
            Click <CreateThemChip /> on this card.
          </SetupStep>

          <SetupStep n={2} title="Create two variables in Tag Manager">
            In Tag Manager, go to Variables → New → Data Layer Variable. Make one per row: give it the name on the left,
            and type the right column exactly in the Data Layer Variable Name field.
            <GtmVariablesTable keys={KEYS} />
          </SetupStep>

          <SetupStep n={3} title="Add a tag for the version a visitor sees">
            Go to Tags → New → Google Analytics: GA4 Event. Set the event name to{" "}
            <span className="font-mono text-foreground">experiment_exposure</span> and add two event parameters,{" "}
            <span className="font-mono text-foreground">experiment_id</span> and{" "}
            <span className="font-mono text-foreground">variant</span>, each set to its variable. For the trigger, make
            a Custom Event trigger with the same event name.
          </SetupStep>

          <SetupStep n={4} title="Send them with every event">
            Add the two variables to the Google tag and to each conversion tag (form submissions and other
            conversions). Then click Submit and Publish.
          </SetupStep>

          <SetupStep n={5} title="Check your reports">
            Give it a day, then in Explorations compare visitors who saw each version. Older data won&apos;t have them.
          </SetupStep>
        </Accordion>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Read more (advanced): Tag Manager steps</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
            <li>
              Step 2: web container, Data Layer Version 2 (the default). The name is only a label; the Data Layer
              Variable Name must match the key exactly.
            </li>
            <li>
              Step 4 shortcut: if you already have a Google Tag: Event Settings variable (for example from product /
              persona setup), add <code>experiment_id</code> and <code>variant</code> to it (value ={" "}
              <code>{"{{DLV - <key>}}"}</code>). It must be attached to the Google tag under Shared event settings (so
              page views carry them) and to every GA4 Event tag.
            </li>
            <li>
              Server container: make sure no parameter filter or transformation drops <code>experiment_id</code> or{" "}
              <code>variant</code>.
            </li>
            <li>
              Verify in Preview from a private window (staff, bots and <code>?force_variant=</code> previews are never
              put in a test): on a tested page the first Data Layer entry (before <code>gtm.js</code>) has both keys and
              an <code>experiment_exposure</code> event follows. Then check GA4 DebugView.
            </li>
            <li>
              Values: <code>experiment_id</code> = <code>contentType:slug:locale@start-date</code>;{" "}
              <code>variant</code> = the version slug, or <code>default</code> for the original. Conversions carry the
              visit&apos;s first test (cookie <code>4g_visit_exp</code>, 30 minutes).
            </li>
            <li>
              Keep the event and parameter names: server/ads/paid-detection.ts reads them from BigQuery for the
              per-version paid and organic numbers.
            </li>
            <li>
              Tag Manager loads on first interaction or after 15 seconds, so visitors who leave sooner appear in the
              server counts but never in GA4.
            </li>
            <li>
              Sources: server/utils/html-inject.ts (push before Tag Manager loads), client/src/lib/tracking.ts
              (exposure event and conversions), docs/gtm-analytics-setup.md.
            </li>
          </ol>
        </details>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-ab-testing-setup">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
