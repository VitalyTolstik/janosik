import { useCallback, useEffect, useRef, useState } from "react";
import { Globe2, Megaphone } from "lucide-react";
import type { AnnouncementDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Notice, type NoticeTone } from "@/components/notifications/Notice";
import { useI18n } from "@/i18n";

/**
 * The pre-server banner kept closed ids in one browser-global key. It is no
 * longer read: a dismissal is per user on the server now. The key is removed
 * once so a stale global list cannot be mistaken for this account's state.
 */
const LEGACY_DISMISS_KEY = "janosik.announcements.dismissed";

const TONE_BY_LEVEL: Record<AnnouncementDto["level"], NoticeTone> = {
  info: "info",
  warning: "warning",
  danger: "danger",
};

/**
 * In-app announcements (TASK-62) — news/updates the master panel broadcasts
 * to everyone or a chosen segment. Shown as quiet glass cards under the
 * header. Read state is per user on the server (`AnnouncementDismissal`), so
 * a dismissal survives a new device and never leaks to another account in
 * the same browser; editing an announcement bumps its version and shows it
 * again.
 */
export function AnnouncementBanner() {
  const { status } = useAuth();
  const { t, lang } = useI18n();
  const [items, setItems] = useState<AnnouncementDto[]>([]);
  const [itemsLocale, setItemsLocale] = useState<string | null>(null);
  // Every load takes a sequence number. A response from an older language,
  // account or unmounted render is ignored instead of overwriting the current
  // banner (and the optimistic-restore path uses the same guard).
  const requestRef = useRef(0);
  // `load` is called from event handlers after a render; read the current
  // language from a ref so a failure refetch started under an old render
  // cannot write an old locale after the user switched languages.
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_DISMISS_KEY);
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const applyList = useCallback(
    (request: number, locale: string, list: AnnouncementDto[]): boolean => {
      if (request !== requestRef.current) return false;
      setItems(list);
      setItemsLocale(locale);
      return true;
    },
    [],
  );

  const load = useCallback(async (): Promise<"ok" | "failed" | "stale"> => {
    const locale = langRef.current;
    const request = ++requestRef.current;
    try {
      const list = await api.activeAnnouncements(locale);
      return applyList(request, locale, list) ? "ok" : "stale";
    } catch {
      return request === requestRef.current ? "failed" : "stale";
    }
  }, [applyList]);

  useEffect(() => {
    if (!isApiEnabled() || status !== "authenticated") return;
    const request = ++requestRef.current;
    api
      .activeAnnouncements(lang)
      .then((list) => {
        applyList(request, lang, list);
      })
      .catch(() => undefined);
    return () => {
      requestRef.current += 1;
    };
  }, [applyList, status, lang]);

  const visible = itemsLocale === lang ? items : [];
  if (visible.length === 0) return null;

  const dismiss = (item: AnnouncementDto) => {
    const index = items.findIndex((entry) => entry.id === item.id);
    // Optimistic: the notice disappears immediately. The server remains the
    // source of truth; a failure refetches and, if that also fails, restores
    // the notice so a lost request never hides it for good.
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    void api.dismissAnnouncement(item.id, item.version).catch(() => {
      void load().then((result) => {
        if (result !== "failed") return;
        setItems((current) => {
          if (current.some((entry) => entry.id === item.id)) return current;
          const next = [...current];
          const at = index >= 0 ? Math.min(index, next.length) : next.length;
          next.splice(at, 0, item);
          return next;
        });
      });
    });
  };

  return (
    <div className="contents" data-testid="announcement-banner">
      {visible.map((item) => {
        const fallbackNotice = item.isFallback ? (
          <p
            lang={lang}
            data-testid={`announcement-fallback-${item.id}`}
            className="flex items-start gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-1.5 text-[11px] leading-snug text-primary"
          >
            <Globe2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {item.contentLocale === "ru"
              ? t("announcement.fallback.onlyRu")
              : t("announcement.fallback.onlyEn")}
          </p>
        ) : null;
        return (
          <Notice
            key={item.id}
            tone={TONE_BY_LEVEL[item.level]}
            icon={Megaphone}
            eyebrow={t("announcement.eyebrow")}
            title={item.title}
            body={item.body}
            contentLang={item.contentLocale}
            notice={fallbackNotice}
            bodyClassName="whitespace-pre-line"
            close={{
              onClick: () => dismiss(item),
              label: t("announcement.dismiss"),
              testId: `announcement-dismiss-${item.id}`,
            }}
          />
        );
      })}
    </div>
  );
}
