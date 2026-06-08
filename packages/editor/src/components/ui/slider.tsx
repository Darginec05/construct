import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../../lib/utils.ts";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={cn("relative w-full", className)} {...props}>
    <SliderPrimitive.Control className="flex w-full items-center py-1.5">
      <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-input">
        <SliderPrimitive.Indicator className="rounded-full bg-primary" />
        <SliderPrimitive.Thumb className="h-3.5 w-3.5 rounded-full bg-primary shadow ring-2 ring-background outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </SliderPrimitive.Track>
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
