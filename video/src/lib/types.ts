export type ThemeName = "light" | "dark";

/**
 * Every clip takes the same prop so the theme can be flipped in the Studio.
 * A `type` (not an `interface`) so it is assignable to Remotion's
 * `Record<string, unknown>` component constraint.
 */
export type ClipProps = {
  theme: ThemeName;
};
