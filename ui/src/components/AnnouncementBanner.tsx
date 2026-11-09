import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
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
  const { t } = useI18n();
  const [items, setItems] = useState<AnnouncementDto[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => dismissedIds());

  useEffect(() => {
    if (!isApiEnabled() || status !== "authenticated") return;
    let active = true;
    api
      .activeAnnouncements()
      .then((list) => {
        if (active) setItems(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [status]);

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
      {visible.map((item) => (
        <Notice
          key={item.id}
          tone={TONE_BY_LEVEL[item.level]}
          icon={Megaphone}
          eyebrow={t("announcement.eyebrow")}
          title={item.title}
          body={item.body}
          bodyClassName="whitespace-pre-line"
          close={{
            onClick: () => dismiss(item.id),
            label: t("announcement.dismiss"),
            testId: `announcement-dismiss-${item.id}`,
          }}
        />
      ))}
    </div>
  );
}
