/* shadcn/ui-derived, trimmed to this plugin's needs (no coarse-pointer sizing
 * helper here — that module lives in components/ui/ of other plugins but
 * isn't vendored into this one; height/text-size just match the existing
 * Button's "sm" size so inputs sit flush next to it in a toolbar). */
import * as React from "react";

import { cn } from "../../lib/utils";
import { CONTROL_HOVER_TRANSITION } from "./motion.js";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        autoComplete="off"
        className={cn(
          `flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground ${CONTROL_HOVER_TRANSITION} placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
