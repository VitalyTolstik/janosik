import { useEffect, useState } from "react";
import { Globe2, Megaphone } from "lucide-react";
import type { AnnouncementDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Notice, type NoticeTone } from "@/components/notifications/Notice";
import { useI18n } from "@/i18n";

const DISMISS_KEY = "janosik.announcements.dismissed";

const TONE_BY_LEVEL: Record<AnnouncementDto["level"], NoticeTone> = {
  info: "info",
  warning: "warning",
  danger: "danger",
};

function dismissedIds(): string[] {
  try {
    return JSON.parse(
      window.localStorage.getItem(DISMISS_KEY) ?? "[]",
    ) as string[];
  } catch {
    return [];
  }
}

/**
 * In-app announcements (TASK-62) — news/updates the master panel broadcasts
 * to everyone or a chosen segment. Shown as quiet glass cards under the
 * header; a dismissal is remembered per announcement in localStorage, so a
 * user only sees each one once.
 */
export function AnnouncementBanner() {
  const { status } = useAuth();
  const { t, lang } = useI18n();
  const [items, setItems] = useState<AnnouncementDto[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => dismissedIds());

  useEffect(() => {
    if (!isApiEnabled() || status !== "authenticated") return;
    let active = true;
    api
      .activeAnnouncements(lang)
      .then((list) => {
        if (active) setItems(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [status, lang]);

  const visible = items.filter((item) => !hidden.includes(item.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
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
              onClick: () => dismiss(item.id),
              label: t("announcement.dismiss"),
              testId: `announcement-dismiss-${item.id}`,
            }}
          />
        );
      })}
    </div>
  );
}
