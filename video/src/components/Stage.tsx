import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";

import type { ThemeName } from "../lib/types";

/** Full-frame backdrop. `theme` flips the brand palette (light site / dark app). */
export const Stage = ({
  theme,
  children,
}: {
  theme: ThemeName;
  children: ReactNode;
}) => (
  <AbsoluteFill
    className={theme === "dark" ? "stage dark" : "stage light"}
    style={{ background: "var(--background)", color: "var(--foreground)" }}
  >
    {children}
  </AbsoluteFill>
);
