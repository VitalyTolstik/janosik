import { useEffect, useState } from "react";

/**
 * The built app's version manifest — the counterpart to the backend's runtime
 * version. It is emitted as `version.json` at build time by the service-worker
 * plugin (`vite/sw-plugin.ts`), next to `sw.js`, and read by the master panel
 * so an operator can see exactly which build of the frontend is being served
 * (version, commit and the build hash the service worker caches under).
 *
 * Dev servers have no manifest, so {@link loadAppVersion} resolves to `null`
 * and the panel shows a dash instead of inventing a version.
 */
export interface AppVersion {
  version: string;
  commit: string | null;
  build: string;
}

const MANIFEST_PATH = `${import.meta.env.BASE_URL}version.json`;

let pending: Promise<AppVersion | null> | null = null;

/** Fetch (at most once) the app version manifest; `null` when unavailable. */
export function loadAppVersion(): Promise<AppVersion | null> {
  pending ??= fetch(MANIFEST_PATH, { cache: "no-store" })
    .then((response) =>
      response.ok ? (response.json() as Promise<AppVersion>) : null,
    )
    .catch(() => null);
  return pending;
}

/** Drop the memoised manifest so the next read re-fetches (tests only). */
export function resetAppVersionCache(): void {
  pending = null;
}

/** The app version manifest, or `null` while loading / when unavailable. */
export function useAppVersion(): AppVersion | null {
  const [version, setVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    let active = true;
    void loadAppVersion().then((value) => {
      if (active) setVersion(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return version;
}
