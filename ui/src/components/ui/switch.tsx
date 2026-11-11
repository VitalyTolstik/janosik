import * as React from "react";

import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "checked" | "type"
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name when there is no visible <label> association. */
  "aria-label": string;
}

/**
 * The compact app switch: 31×18 px, a white 12 px knob and the brand primary
 * when on. Button-based (`role="switch"` + `aria-checked`) so Space/Enter work
 * natively and the board workflow can put it inside a row without nesting an
 * input in a button.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[18px] w-[31px] shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-primary/80 bg-primary"
          : "border-muted-foreground/25 bg-hover/70",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.28)] transition-transform motion-reduce:transition-none",
          checked && "translate-x-[13px]",
        )}
      />
    </button>
  ),
);

Switch.displayName = "Switch";
