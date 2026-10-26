import { useEffect, useState } from "react";

import { api } from "@/api/client";

interface CachedAvatar {
  /** Object URL of the fetched blob, or `null` for a known-missing avatar. */
  url: string | null;
  /** Stored name the blob was fetched for — cache key freshness marker. */
  path: string;
}

/**
 * Module-level avatar cache (TASK-47): `userId` → fetched blob URL. Blob
 * URLs survive across components (presence, member lists, card faces all
 * render the same face), and `path` invalidates when the user uploads a
 * new image. URLs live for the tab's lifetime — a handful of small images.
 * A `null` url is a negative cache entry: the user has no avatar, so no
 * second request is made (TASK-106).
 */
const cache = new Map<string, CachedAvatar>();
/** In-flight fetches keyed by user, so N components share one request. */
const inflight = new Map<string, Promise<void>>();

/**
 * Drop every cached avatar and revoke its object URL (TASK-106) — called on
 * logout so a shared browser never keeps another account's images alive.
 */
export function clearAvatarCache(): void {
  for (const entry of cache.values()) {
    if (entry.url !== null) URL.revokeObjectURL(entry.url);
  }
  cache.clear();
  inflight.clear();
}

/**
 * Resolve a user's avatar image to an object URL. The endpoint needs the
 * Authorization header, so an `<img src>` cannot point at it directly —
 * the blob is fetched once and reused. Returns `null` while loading or
 * when the user has no image (callers fall back to the initials).
 */
export function useAvatarObjectUrl(
  userId: string,
  avatarPath: string | null | undefined,
): string | null {
  const cached = userId ? cache.get(userId) : undefined;
  const [url, setUrl] = useState<string | null>(
    cached && (!avatarPath || cached.path === avatarPath) ? cached.url : null,
  );

  useEffect(() => {
    if (!userId || !avatarPath) {
      setUrl(null);
      return;
    }
    const cached = cache.get(userId);
    if (cached && cached.path === avatarPath) {
      setUrl(cached.url);
      return;
    }
    let alive = true;
    // Dedupe concurrent fetches for the same user (TASK-106).
    let pending = inflight.get(userId);
    if (pending === undefined) {
      pending = api
        // `avatarPath` doubles as the cache-busting version: the endpoint is
        // served `immutable`, so the same URL would keep the previous image.
        .fetchUserAvatar(userId, avatarPath)
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          // A replaced avatar's URL must be revoked, not leaked.
          const previous = cache.get(userId);
          if (previous?.url) URL.revokeObjectURL(previous.url);
          cache.set(userId, { url: objectUrl, path: avatarPath });
        })
        .catch(() => {
          cache.set(userId, { url: null, path: avatarPath });
        })
        .finally(() => {
          inflight.delete(userId);
        });
      inflight.set(userId, pending);
    }
    void pending.then(() => {
      if (!alive) return;
      setUrl(cache.get(userId)?.url ?? null);
    });
    return () => {
      alive = false;
    };
  }, [userId, avatarPath]);

  return url;
}
