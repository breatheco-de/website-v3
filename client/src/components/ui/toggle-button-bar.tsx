import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Compact segmented toggle bar (filters, mode switches, compact page sections).
 * Prefer this over raw TabsList/ToggleGroup for single-select button bars.
 *
 * Use `ToggleButtonBar` alone when there is no TabsContent.
 * Use `ToggleButtonBarList` + `ToggleButtonBarTrigger` inside an existing `Tabs` root
 * when panels live in `TabsContent`.
 */

const listClassName =
  "inline-flex h-auto flex-wrap items-center justify-start gap-0.5 rounded-md border border-muted-foreground/20 bg-muted/40 p-0.5 text-muted-foreground";

const triggerClassName =
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none";

const ToggleButtonBarList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(listClassName, className)}
    {...props}
  />
));
ToggleButtonBarList.displayName = "ToggleButtonBarList";

const ToggleButtonBarTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(triggerClassName, className)}
    {...props}
  />
));
ToggleButtonBarTrigger.displayName = "ToggleButtonBarTrigger";

export interface ToggleButtonBarProps
  extends Omit<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, "orientation"> {
  /** Classes for the outer bar (list). */
  listClassName?: string;
  listTestId?: string;
}

/**
 * Standalone single-select bar (no TabsContent). Children should be `ToggleButtonBarTrigger`s.
 */
function ToggleButtonBar({
  className,
  listClassName: listCn,
  listTestId,
  children,
  ...props
}: ToggleButtonBarProps) {
  return (
    <TabsPrimitive.Root className={cn(className)} {...props}>
      <ToggleButtonBarList className={listCn} data-testid={listTestId}>
        {children}
      </ToggleButtonBarList>
    </TabsPrimitive.Root>
  );
}
ToggleButtonBar.displayName = "ToggleButtonBar";

export { ToggleButtonBar, ToggleButtonBarList, ToggleButtonBarTrigger };
