import { useState } from "react";
import type { AttentionNotificationPage } from "@janosik/shared";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";

interface Props {
  page: AttentionNotificationPage | null;
  unavailable: boolean;
  onReload: () => Promise<void>;
}

export function AttentionInbox({ page, unavailable, onReload }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [olderPage, setOlderPage] = useState<AttentionNotificationPage | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const visible = olderPage ?? page;

  async function run(
    action: () => Promise<void>,
    errorMessage = t("notifications.attention.error"),
  ): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="attention-inbox-heading"
      className="border-b border-border/60"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 id="attention-inbox-heading" className="text-sm font-semibold">
          {t("notifications.attention.title")}
        </h2>
        {(page?.unreadCount ?? 0) > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.markAllAttentionRead();
                setOlderPage(null);
                await onReload();
              })
            }
          >
            {t("notifications.attention.readAll")}
          </Button>
        ) : null}
      </div>

      {unavailable && (
        <div className="px-4 pb-3 text-xs">
          <p role="alert" className="text-danger">
            {t("notifications.attention.loadError")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(onReload)}
          >
            {t("notifications.attention.retry")}
          </Button>
        </div>
      )}
      {visible === null ? (
        !unavailable && (
          <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">
            {t("notifications.attention.loading")}
          </p>
        )
      ) : visible.items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          {t("notifications.attention.empty")}
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto">
          {visible.items.map((item) => (
            <li key={item.id} className="space-y-1 px-4 py-3">
              <p
                className={
                  item.readAt === null
                    ? "break-words text-sm font-semibold"
                    : "break-words text-sm"
                }
              >
                {item.title}
              </p>
              {item.body && (
                <p className="whitespace-pre-line break-words text-xs text-muted-foreground">
                  {item.body}
                </p>
              )}
              <div className="flex min-h-7 items-center justify-between gap-2">
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={new Date(item.createdAt).toISOString()}
                >
                  {formatDateOnly(item.createdAt, lang)}
                </time>
                {item.readAt === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const updated = await api.markAttentionRead(item.id);
                        setOlderPage(
                          (current) =>
                            current && {
                              ...current,
                              items: current.items.map((row) =>
                                row.id === updated.id ? updated : row,
                              ),
                            },
                        );
                        await onReload();
                      })
                    }
                  >
                    {t("notifications.attention.read")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {olderPage || visible?.nextCursor ? (
        <div className="flex justify-between gap-2 px-4 py-2">
          {olderPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setOlderPage(null)}
            >
              {t("notifications.attention.newest")}
            </Button>
          )}
          {visible?.nextCursor && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setOlderPage(
                    await api.listAttentionNotifications(
                      visible.nextCursor ?? undefined,
                    ),
                  );
                }, t("notifications.attention.olderError"))
              }
            >
              {t("notifications.attention.older")}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
