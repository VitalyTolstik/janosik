import { useEffect, useState } from "react";

/**
 * TASK-179.9 — a single matchMedia subscription for responsive ARIA state.
 *
 * The agent rails are vertical on desktop and horizontal on mobile. Their
 * `aria-orientation` must follow the rendered direction, not a hard-coded
 * desktop value.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
