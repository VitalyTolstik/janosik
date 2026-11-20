import { useEffect, useState } from "react";
import type {
  AdminFilterOptionsDto,
  AdminFilterOptionsQuery,
} from "@janosik/shared";
import { adminApi } from "../admin-client";

const SEARCH_DELAY_MS = 250;
const CACHE_TTL_MS = 45_000;
const CACHE_LIMIT = 128;

interface CacheEntry {
  data: AdminFilterOptionsDto;
  expiresAt: number;
}

let cacheToken: string | null = null;
let cache = new Map<string, CacheEntry>();

type Answer = {
  key: string;
  attempt: number;
  data?: AdminFilterOptionsDto;
};

export function useFilterOptions(query: AdminFilterOptionsQuery | null) {
  // Canonicalize searches and exact-id sets independently. Exact lookups
  // deliberately omit parent scope so a match can reveal a conflict.
  const key =
    query === null
      ? null
      : JSON.stringify(
          query.ids === undefined
            ? {
                type: query.type,
                q: query.q?.trim() ?? "",
                limit: query.limit,
                boardId: query.boardId,
                columnId: query.columnId,
                cardId: query.cardId,
              }
            : { type: query.type, ids: [...new Set(query.ids)].sort() },
        );
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (key === null) return;
    const token = adminApi.getAccessToken();
    if (token !== cacheToken) {
      cacheToken = token;
      cache = new Map();
    }
    const sessionCache = cache;
    const cached = sessionCache.get(key);
    const controller = new AbortController();
    const params = JSON.parse(key) as AdminFilterOptionsQuery;
    const useCached = cached !== undefined && Date.now() < cached.expiresAt;
    const delay = useCached || params.ids !== undefined ? 0 : SEARCH_DELAY_MS;

    const timer = setTimeout(() => {
      if (useCached) {
        setAnswer({ key, attempt, data: cached.data });
        return;
      }
      void adminApi.filterOptions(params, controller.signal).then(
        (data) => {
          // A closed picker or an older generation of the same query must
          // never overwrite the current answer or the cache.
          if (controller.signal.aborted) return;
          sessionCache.delete(key);
          sessionCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
          if (sessionCache.size > CACHE_LIMIT) {
            const oldest = sessionCache.keys().next().value;
            if (oldest !== undefined) sessionCache.delete(oldest);
          }
          setAnswer({ key, attempt, data });
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ key, attempt });
        },
      );
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt]);

  const current =
    answer?.key === key && answer.attempt === attempt ? answer : undefined;
  return {
    data: current?.data,
    loading: key !== null && current === undefined,
    error: current !== undefined && current.data === undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
