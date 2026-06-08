import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../../lib/utils.ts";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn("relative flex", className)} {...props} />
));
TabsList.displayName = "TabsList";

export const TabsTab = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Tab>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Tab
    ref={ref}
    className={cn(
      "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-muted-foreground outline-none transition select-none hover:text-foreground data-[selected]:text-foreground",
      className,
    )}
    {...props}
  />
));
TabsTab.displayName = "TabsTab";

/** Sliding underline that tracks the active tab via Base UI's position vars. */
export const TabsIndicator = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Indicator
    ref={ref}
    className={cn(
      "absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-full bg-primary transition-all duration-150",
      className,
    )}
    {...props}
  />
));
TabsIndicator.displayName = "TabsIndicator";

export const TabsPanel = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Panel>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Panel ref={ref} className={cn("h-full outline-none", className)} {...props} />
));
TabsPanel.displayName = "TabsPanel";
