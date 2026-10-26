/**
 * The deploy base path (Astro's `base`) with no trailing slash — e.g.
 * `/janosik` for a GitHub Pages project site, or `""` for a root domain.
 */
export const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/+$/, "");

/**
 * Prefix an absolute site path with the deploy base. Anchors and query
 * strings survive: `withBase("/#features")` → `/janosik/#features`.
 */
export function withBase(path: string): string {
  const normalized = "/" + path.replace(/^\/+/, "");
  return base + normalized;
}
