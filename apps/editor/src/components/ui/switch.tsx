import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils.ts";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[checked]:translate-x-[18px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
