import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * TASK-200: tailwind-merge treats an unknown `text-*` token as a text colour,
 * so `text-ui-body text-muted-foreground` silently dropped the semantic size.
 * Register the scale as a font-size group before merging.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-ui-title",
        "text-ui-heading",
        "text-ui-body",
        "text-ui-label",
        "text-ui-meta",
        "text-ui-micro",
      ],
    },
  },
});

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
