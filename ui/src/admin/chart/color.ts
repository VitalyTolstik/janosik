/**
 * Colour helpers for the canvas chart. Theme colours live as CSS custom
 * properties (which may be `oklch(...)`); a canvas 2d context both resolves
 * them to a concrete colour and lets us derive an alpha variant for area
 * fills — no hard-coded palette, the chart follows dark/light tokens.
 */

/** Read a CSS custom property off `:root`, with a fallback. */
export function readToken(token: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

/** The same colour at `alpha`, as an `rgba(...)` string. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = toRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Normalise any CSS colour to `[r, g, b]` via a scratch canvas context. */
function toRgb(color: string): [number, number, number] {
  if (typeof document === "undefined") return [128, 128, 128];
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [128, 128, 128];
  ctx.fillStyle = "#000000";
  ctx.fillStyle = color; // the context normalises whatever we set
  const normalised = ctx.fillStyle;
  if (typeof normalised === "string" && normalised.startsWith("#")) {
    const hex =
      normalised.length === 4
        ? normalised
            .slice(1)
            .split("")
            .map((char) => char + char)
            .join("")
        : normalised.slice(1, 7);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const match =
    typeof normalised === "string"
      ? normalised.match(/rgba?\(([^)]+)\)/)
      : null;
  if (match?.[1]) {
    const parts = match[1].split(",").map((part) => parseFloat(part));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  return [128, 128, 128];
}
