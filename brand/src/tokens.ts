/**
 * Janosik brand tokens — the single source of truth for colour, shape, type
 * and motion.
 *
 * `tokens.css` mirrors these values as CSS custom properties (the form the
 * app, the marketing site and the video project actually consume);
 * `tokens.test.ts` fails if the two ever drift apart.
 */

/** Semantic colour roles. Every role has a dark and a light value. */
export interface ThemeColors {
  /** App background (the dark value is also the brand background). */
  background: string;
  /** Cards / columns surface. */
  card: string;
  /** Elevated surfaces, menus, dialogs. */
  surface: string;
  /** Hover accents. */
  hover: string;
  /** Primary text. */
  foreground: string;
  /** Secondary text. */
  mutedForeground: string;
  /** Brand accent. */
  primary: string;
  primaryForeground: string;
  /** Secondary accent. */
  secondary: string;
  secondaryForeground: string;
  /** Success / done. */
  success: string;
  /** Warning / in progress. */
  warning: string;
  /** Danger / high. */
  danger: string;
  /** Extended label palette. */
  blue: string;
  indigo: string;
  pink: string;
  teal: string;
  orange: string;
  slate: string;
  yellow: string;
  fuchsia: string;
  brown: string;
  /** Borders & dividers. */
  border: string;
  input: string;
  ring: string;
  /** Selection accent for the board-background picker (tuned per theme). */
  brandAccent: string;
}

/** Dark is the default theme; light is activated with `.light` on <html>. */
export const themes: Record<"dark" | "light", ThemeColors> = {
  dark: {
    background: "#0b1220",
    card: "#121a2e",
    surface: "#172033",
    hover: "#1e2a44",
    foreground: "#e6edf7",
    mutedForeground: "#93a4bd",
    primary: "#3b82f6",
    primaryForeground: "#ffffff",
    secondary: "#38bdf8",
    secondaryForeground: "#06283d",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    blue: "#4f8df0",
    indigo: "#818cf8",
    pink: "#f472b6",
    teal: "#2dd4bf",
    orange: "#fb923c",
    slate: "#94a3b8",
    yellow: "#eab308",
    fuchsia: "#d946ef",
    brown: "#92400e",
    border: "#24324a",
    input: "#24324a",
    ring: "#3b82f6",
    brandAccent: "#2563eb",
  },
  light: {
    background: "#f4f5f6",
    card: "#ffffff",
    surface: "#fbfbfc",
    hover: "#eaecee",
    foreground: "#1a1a24",
    mutedForeground: "#5c5c70",
    primary: "#2563eb",
    primaryForeground: "#ffffff",
    secondary: "#0369a1",
    secondaryForeground: "#ffffff",
    success: "#059669",
    warning: "#d97706",
    danger: "#dc2626",
    blue: "#2563eb",
    indigo: "#4f46e5",
    pink: "#db2777",
    teal: "#0d9488",
    orange: "#ea580c",
    slate: "#475569",
    yellow: "#eab308",
    fuchsia: "#c026d3",
    brown: "#78350f",
    border: "#e2e8f0",
    input: "#e2e8f0",
    ring: "#2563eb",
    brandAccent: "#3b82f6",
  },
};

/** camelCase theme key → the CSS custom property it is written to. */
export const colorVarNames: Record<keyof ThemeColors, string> = {
  background: "--background",
  card: "--card",
  surface: "--surface",
  hover: "--hover",
  foreground: "--foreground",
  mutedForeground: "--muted-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
  blue: "--blue",
  indigo: "--indigo",
  pink: "--pink",
  teal: "--teal",
  orange: "--orange",
  slate: "--slate",
  yellow: "--yellow",
  fuchsia: "--fuchsia",
  brown: "--brown",
  border: "--border",
  input: "--input",
  ring: "--ring",
  brandAccent: "--janosik-brand-accent",
};

/** Theme-independent shape tokens. */
export const shape = {
  radius: "0.625rem",
} as const;

/** Column "glass" defaults (overridden at runtime by BoardGlassProvider). */
export const glass = {
  transparency: "100",
  blur: "5px",
} as const;

/**
 * Fullscreen attachment lightbox tokens — intentionally dark in both themes so
 * the image reads against a neutral scrim.
 */
export const overlay = {
  scrim: "rgb(0 0 0 / 0.82)",
  foreground: "#ffffff",
  border: "rgb(255 255 255 / 0.25)",
  button: "rgb(255 255 255 / 0.12)",
  shadow: "0 12px 48px rgb(0 0 0 / 0.55)",
} as const;

/** Typography. Space Grotesk is the single brand face (display + body). */
export const fonts = {
  display:
    '"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

/**
 * Motion tokens. Custom easing curves (not the weak CSS built-ins) and UI
 * durations kept under 300ms — the design-engineering rules that make the
 * interface feel responsive.
 */
export const motion = {
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  easeDrawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  durationPress: "160ms",
  durationFast: "150ms",
  durationBase: "200ms",
  durationSlow: "300ms",
} as const;

/**
 * The logo tile gradient (feather square) — brand blue, deliberately
 * independent of the app's violet accent so the mark reads blue everywhere.
 */
export const logo = {
  from: "#2563eb",
  to: "#38bdf8",
} as const;

/**
 * Marketing-site theme — light, airy white/blue (no violet, no pink). The
 * product app keeps its own dark themes (`themes`); the site imports
 * `@janosik/brand/site-tokens.css`, which overrides the colour roles below.
 * Label roles are carried over from the light app theme (the site does not
 * use labels; they exist to keep the token shape complete).
 */
export const siteTheme: ThemeColors = {
  background: "#ffffff",
  card: "#ffffff",
  surface: "#f8fafc",
  hover: "#eff6ff",
  foreground: "#0f172a",
  mutedForeground: "#64748b",
  primary: "#2563eb",
  primaryForeground: "#ffffff",
  secondary: "#38bdf8",
  secondaryForeground: "#082f49",
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  blue: "#2563eb",
  indigo: "#4f46e5",
  pink: "#db2777",
  teal: "#0d9488",
  orange: "#ea580c",
  slate: "#475569",
  yellow: "#eab308",
  fuchsia: "#c026d3",
  brown: "#78350f",
  border: "#e2e8f0",
  input: "#e2e8f0",
  ring: "#2563eb",
  brandAccent: "#38bdf8",
};

/** One step of the type scale. */
export interface TypeStyle {
  size: string;
  lineHeight: string;
  weight: string;
  tracking: string;
}

/**
 * Type scale — a single role-based ramp for headings and body copy. The app
 * keeps Tailwind's own text utilities; this scale is the brand's shared
 * reference (used by the marketing site, docs and video).
 */
export const typeScale: Record<
  "display" | "h1" | "h2" | "h3" | "lead" | "body" | "small" | "caption",
  TypeStyle
> = {
  display: {
    size: "4.5rem",
    lineHeight: "1.02",
    weight: "700",
    tracking: "-0.03em",
  },
  h1: { size: "3rem", lineHeight: "1.1", weight: "700", tracking: "-0.03em" },
  h2: { size: "2rem", lineHeight: "1.2", weight: "700", tracking: "-0.02em" },
  h3: { size: "1.5rem", lineHeight: "1.3", weight: "700", tracking: "-0.01em" },
  lead: { size: "1.25rem", lineHeight: "1.6", weight: "500", tracking: "0" },
  body: { size: "1rem", lineHeight: "1.6", weight: "400", tracking: "0" },
  small: { size: "0.875rem", lineHeight: "1.5", weight: "500", tracking: "0" },
  caption: {
    size: "0.75rem",
    lineHeight: "1.4",
    weight: "500",
    tracking: "0.02em",
  },
};
