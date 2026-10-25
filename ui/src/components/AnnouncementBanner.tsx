import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import type { AnnouncementDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n";

const DISMISS_KEY = "janosik.announcements.dismissed";

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
 * to everyone or a chosen segment. Shown as a slim banner under the header;
 * a dismissal is remembered per announcement in localStorage, so a user only
 * sees each one once.
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
    <div className="flex flex-col" data-testid="announcement-banner">
      {visible.map((item) => (
        <div
          key={item.id}
          role="status"
          className={
            item.level === "danger"
              ? "flex items-start gap-2 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              : item.level === "warning"
                ? "flex items-start gap-2 bg-warning/10 px-4 py-2 text-sm"
                : "flex items-start gap-2 bg-primary/10 px-4 py-2 text-sm"
          }
        >
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.title}</p>
            <p className="whitespace-pre-line opacity-90">{item.body}</p>
          </div>
          <button
            type="button"
            aria-label={t("announcement.dismiss")}
            data-testid={`announcement-dismiss-${item.id}`}
            onClick={() => dismiss(item.id)}
            className="rounded p-1 hover:bg-hover"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
