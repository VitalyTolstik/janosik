import type { CSSProperties } from "react";

export const EPIC_THEME = {
  "--epic-ink": "light-dark(#9f1239, #fecdd3)",
  "--epic-accent": "light-dark(#be123c, #fb7185)",
  "--epic-border":
    "light-dark(#fecdd3, color-mix(in oklab, var(--epic-accent) 36%, var(--border)))",
  "--epic-surface":
    "light-dark(#fff1f4, color-mix(in oklab, #fda4af 8%, var(--card)))",
  "--epic-track":
    "color-mix(in oklab, var(--epic-accent) 16%, var(--epic-surface))",
} as CSSProperties;
