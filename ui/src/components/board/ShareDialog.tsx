import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";

import type { BoardShareDto, BoardShareMode } from "@janosik/shared";
import { SHARE_TTL_HOURS } from "@janosik/shared";
import { api, ApiError, isApiEnabled } from "@/api/client";
import { appShareUrl } from "@/utils/app-path";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";

/**
 * «Поделиться» dialog (TASK-58, §7.9.4): a board ADMIN mints public
 * read-only links — a frozen snapshot or a live view — with a TTL and the
 * comment/attachment flags, copies the link (or an `<iframe>` embed snippet),
 * refreshes a snapshot and revokes any link. The panel is mounted only while
 * open, so every open refetches the list (no imperative reset).
 */
export function ShareDialog() {
  const { t } = useI18n();
  const { board, roleOf } = useBoard();
  const [open, setOpen] = useState(false);

  if (!isApiEnabled() || !board || roleOf(board.id) !== "ADMIN") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("share.button")}
              data-testid="share-trigger"
            >
              <LazyAnimatedIcon name="external-link" size={20} aria-hidden />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("share.button")}</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>
        {open ? <SharePanel boardId={board.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function shareLink(token: string): string {
  return appShareUrl(routesShare(token));
}

function routesShare(token: string): string {
  return `/s/${token}`;
}

function buildEmbed(token: string): string {
  return `<iframe src="${appShareUrl(`/s/${token}?embed=1`)}" width="100%" height="600" style="border:0" loading="lazy" title="Janosik board"></iframe>`;
}

function SharePanel({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [shares, setShares] = useState<BoardShareDto[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setShares(await api.listShares(boardId));
    } catch {
      toast.error(t("share.loadError"));
      setShares([]);
    }
  }, [boardId, toast, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list lands after the await, not synchronously
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <CreateForm
        busy={creating}
        onCreate={async (request) => {
          setCreating(true);
          try {
            const created = await api.createShare(boardId, request);
            await copy(shareLink(created.token));
            toast.success(t("share.created"));
            await load();
          } catch (error) {
            toast.error(
              error instanceof ApiError && error.offline
                ? t("share.offline")
                : t("share.actionError"),
            );
          } finally {
            setCreating(false);
          }
        }}
      />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          {t("share.active")}
        </p>
        {shares === null ? (
          <p className="text-sm text-muted-foreground">{t("share.loading")}</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("share.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="share-list">
            {shares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                boardId={boardId}
                onChanged={load}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShareRow({
  share,
  boardId,
  onChanged,
}: {
  share: BoardShareDto;
  boardId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const revoked = share.revokedAt !== null;

  return (
    <li
      className="space-y-2 rounded-md border p-2 text-sm"
      data-testid="share-row"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
          {share.mode === "live"
            ? t("share.mode.live")
            : t("share.mode.snapshot")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          /s/{share.token}
        </span>
        {revoked ? (
          <span className="text-xs text-destructive">{t("share.revoked")}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void copy(shareLink(share.token))}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t("share.copy")}
        </Button>
        {!revoked ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void copy(buildEmbed(share.token))}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {t("share.embed")}
            </Button>
            {share.mode === "snapshot" ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={async () => {
                  try {
                    await api.refreshShare(boardId, share.id);
                    toast.success(t("share.refreshed"));
                    await onChanged();
                  } catch {
                    toast.error(t("share.actionError"));
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("share.refresh")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-destructive"
              onClick={async () => {
                try {
                  await api.revokeShare(boardId, share.id);
                  toast.success(t("share.revokeDone"));
                  await onChanged();
                } catch {
                  toast.error(t("share.actionError"));
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("share.revoke")}
            </Button>
          </>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("share.meta", {
          views: share.views,
          flags: [
            share.includeComments ? t("share.flag.comments") : null,
            share.includeAttachments ? t("share.flag.attachments") : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
      </p>
    </li>
  );
}

function CreateForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (request: {
    mode: BoardShareMode;
    title?: string;
    includeComments: boolean;
    includeAttachments: boolean;
    expiresAt: string | null;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<BoardShareMode>("live");
  const [title, setTitle] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [ttlHours, setTtlHours] = useState<number>(SHARE_TTL_HOURS[1]);

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex gap-2">
        {(["live", "snapshot"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            variant={mode === option ? "default" : "outline"}
            size="sm"
            className="flex-1"
            data-testid={`share-mode-${option}`}
            onClick={() => setMode(option)}
          >
            {t(`share.mode.${option}`)}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "live"
          ? t("share.mode.liveHint")
          : t("share.mode.snapshotHint")}
      </p>

      <Input
        value={title}
        maxLength={100}
        placeholder={t("share.titlePlaceholder")}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeComments}
            onCheckedChange={setIncludeComments}
            aria-label={t("share.flag.comments")}
          />
          {t("share.flag.comments")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeAttachments}
            onCheckedChange={setIncludeAttachments}
            aria-label={t("share.flag.attachments")}
          />
          {t("share.flag.attachments")}
        </label>
      </div>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("share.ttl.label")}</span>
        <select
          value={ttlHours}
          onChange={(event) => setTtlHours(Number(event.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          data-testid="share-ttl"
        >
          <option value={0}>{t("share.ttl.never")}</option>
          {SHARE_TTL_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {t("share.ttl.hours", { count: hours })}
            </option>
          ))}
        </select>
      </label>

      <Button
        type="button"
        className="w-full gap-1.5"
        disabled={busy}
        data-testid="share-create"
        onClick={() =>
          void onCreate({
            mode,
            ...(title.trim() !== "" ? { title: title.trim() } : {}),
            includeComments,
            includeAttachments,
            expiresAt:
              ttlHours === 0
                ? null
                : new Date(Date.now() + ttlHours * 3_600_000).toISOString(),
          })
        }
      >
        <Check className="h-4 w-4" aria-hidden />
        {t("share.create")}
      </Button>
    </div>
  );
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable — the link is still visible in the row */
  }
}
