import { useEffect, useState } from "react";

import { api } from "@/api/client";

interface CachedAvatar {
  /** Object URL of the fetched blob. */
  url: string;
  /** Stored name the blob was fetched for — cache key freshness marker. */
  path: string;
}

/**
 * Module-level avatar cache (TASK-47): `userId` → fetched blob URL. Blob
 * URLs survive across components (presence, member lists, card faces all
 * render the same face), and `path` invalidates when the user uploads a
 * new image. URLs live for the tab's lifetime — a handful of small images.
 */
const cache = new Map<string, CachedAvatar>();

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
    api
      .fetchUserAvatar(userId)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        cache.set(userId, { url: objectUrl, path: avatarPath });
        if (alive) setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [userId, avatarPath]);

  return url;
}
