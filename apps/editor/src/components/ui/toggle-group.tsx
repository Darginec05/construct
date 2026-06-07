import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cn } from "../../lib/utils.ts";

export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive
    ref={ref}
    className={cn(
      "inline-flex flex-wrap gap-1 rounded-md border border-input bg-background p-1",
      className,
    )}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleItem = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive>
>(({ className, ...props }, ref) => (
  <TogglePrimitive
    ref={ref}
    className={cn(
      "rounded px-2 py-1 text-[12px] font-medium text-muted-foreground outline-none transition select-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary",
      className,
    )}
    {...props}
  />
));
ToggleItem.displayName = "ToggleItem";
