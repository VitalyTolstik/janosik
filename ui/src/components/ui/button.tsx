import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-body font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-action-primary text-primary-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--action-primary)_88%,black)]",
        destructive:
          "bg-action-danger text-destructive-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--action-danger)_88%,black)]",
        outline:
          "border border-input bg-transparent hover:bg-hover hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/90",
        ghost: "hover:bg-hover hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        /** Premium primary (owner call): a soft vertical gradient, a
         *  colored ring and a gentle lift — for the composer's Save. */
        premium:
          "bg-gradient-to-b from-action-primary to-[color-mix(in_oklab,var(--action-primary)_85%,black)] text-primary-foreground shadow-sm ring-1 ring-inset ring-white/20 hover:from-[color-mix(in_oklab,var(--action-primary)_96%,black)] hover:to-[color-mix(in_oklab,var(--action-primary)_78%,black)] hover:shadow-md active:scale-[0.98] transition-[box-shadow,filter,transform]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-ui-label",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
