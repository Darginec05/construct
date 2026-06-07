import * as React from "react";
import { cn } from "../../lib/utils.ts";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
