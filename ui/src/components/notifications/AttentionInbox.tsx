import { useState } from "react";
import type { MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AttentionNotificationPage } from "@janosik/shared";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";
import {
  attentionTarget,
  type AttentionLinkTarget,
} from "@/utils/attention-nav";
import { shouldLeaveToBrowser } from "@/utils/card-nav";

interface Props {
  page: AttentionNotificationPage | null;
  unavailable: boolean;
  onReload: () => Promise<void>;
  /** Close the bell popover when a row link navigates. */
  onNavigate: () => void;
}

export function AttentionInbox({
  page,
  unavailable,
  onReload,
  onNavigate,
}: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
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

  /**
   * A real anchor: modifier/middle clicks keep the browser's own new-tab
   * behavior, a plain left click stays an in-place SPA transition. The
   * popover closes in both cases because the user has left the inbox.
   */
  function follow(
    event: MouseEvent<HTMLAnchorElement>,
    target: AttentionLinkTarget,
  ): void {
    if (shouldLeaveToBrowser(event)) {
      onNavigate();
      return;
    }
    event.preventDefault();
    onNavigate();
    navigate(target.path);
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
            className="max-md:min-h-11 max-md:px-3"
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
            className="max-md:min-h-11 max-md:px-3"
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
          {visible.items.map((item) => {
            const target = attentionTarget(item, location.pathname);
            const unread = item.readAt === null;
            return (
              <li
                key={item.id}
                data-testid="attention-item"
                data-attention-type={item.type}
                className="space-y-1 px-4 py-3"
              >
                {target === null ? (
                  <p
                    className={
                      unread
                        ? "break-words text-sm font-semibold"
                        : "break-words text-sm"
                    }
                  >
                    {item.title}
                  </p>
                ) : (
                  <a
                    href={target.href}
                    data-testid="attention-link"
                    aria-label={t("notifications.attention.openAria", {
                      title: item.title,
                    })}
                    className="group -mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => follow(event, target)}
                    onAuxClick={() => onNavigate()}
                  >
                    <span
                      className={
                        unread ? "break-words font-semibold" : "break-words"
                      }
                    >
                      {item.title}
                    </span>
                    <ArrowUpRight
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                  </a>
                )}
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
                  {unread ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="max-md:min-h-11 max-md:px-3"
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
            );
          })}
        </ul>
      )}
      {olderPage || visible?.nextCursor ? (
        <div className="flex justify-between gap-2 px-4 py-2">
          {olderPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              className="max-md:min-h-11 max-md:px-3"
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
              className="max-md:min-h-11 max-md:px-3"
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
