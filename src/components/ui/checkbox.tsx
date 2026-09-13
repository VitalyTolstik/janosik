import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "checked" | "type"
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * The app-wide checkbox: a compact rounded box that fills with primary and
 * shows a check when on. Button-based (role="checkbox" + aria-checked), so
 * it works in dropdown menus and keeps native Space/Enter semantics.
 */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent hover:border-foreground/40",
        className,
      )}
      {...props}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  ),
);

Checkbox.displayName = "Checkbox";
