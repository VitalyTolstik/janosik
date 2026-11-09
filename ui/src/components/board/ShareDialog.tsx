import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import type { BoardShareDto, BoardShareMode } from "@janosik/shared";
import { SHARE_LIMITS, SHARE_TTL_HOURS } from "@janosik/shared";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
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
              <LazyAnimatedIcon name="external-link" size={18} aria-hidden />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("share.button")}</TooltipContent>
      </Tooltip>
      <DialogContent className="h-[min(800px,calc(100dvh-2rem))] max-w-lg overflow-hidden">
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

type EmbedTheme = "system" | "light" | "dark";

function buildEmbed(token: string, theme: EmbedTheme): string {
  return `<iframe src="${appShareUrl(`/s/${token}?embed=1&theme=${theme}`)}" width="100%" height="600" style="border:0" loading="lazy" title="Janosik board"></iframe>`;
}

function SharePanel({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [shares, setShares] = useState<BoardShareDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<BoardShareMode>("live");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <CreateForm
        busy={creating}
        shares={shares}
        now={now}
        mode={mode}
        onModeChange={setMode}
        onCreate={async (request) => {
          setCreating(true);
          try {
            const created = await api.createShare(boardId, request);
            // A refused clipboard is not a created-and-copied success: the
            // user would walk away without the link. Keep the row (it is in
            // the list) and say exactly what failed.
            if (await copy(shareLink(created.token))) {
              toast.success(t("share.created"));
            } else {
              toast.error(t("share.copyError"));
            }
            await load();
          } catch (error) {
            toast.error(
              error instanceof ApiError && error.status === 409
                ? t("share.limitReached")
                : error instanceof ApiError && error.offline
                  ? t("share.offline")
                  : t("share.actionError"),
            );
            if (error instanceof ApiError && error.status === 409) await load();
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
        ) : !shares.some((share) => share.mode === mode) ? (
          <p className="text-sm text-muted-foreground">{t("share.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="share-list">
            {shares
              .filter((share) => share.mode === mode)
              .map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  boardId={boardId}
                  now={now}
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
  now,
}: {
  share: BoardShareDto;
  boardId: string;
  onChanged: () => Promise<void>;
  now: number;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const revoked = share.revokedAt !== null;
  const expired = share.expiresAt !== null && share.expiresAt <= now;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        {revoked || expired ? (
          <span className="text-xs text-destructive">
            {revoked ? t("share.revoked") : t("share.expired")}
          </span>
        ) : null}
        {revoked &&
          (confirmDelete ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-success hover:text-success"
                aria-label={t("share.deleteConfirm")}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await api.deleteRevokedShare(boardId, share.id);
                    await onChanged();
                  } catch {
                    toast.error(t("share.actionError"));
                    setDeleting(false);
                  }
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                aria-label={t("share.deleteCancel")}
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              aria-label={t("share.delete")}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ))}
      </div>
      {share.title && (
        <p className="truncate font-medium" title={share.title}>
          {share.title}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {share.expiresAt === null
          ? t("share.expiresNever")
          : t("share.expiresAt", {
              date: new Date(share.expiresAt).toLocaleString(),
            })}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        {!revoked && !expired ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={async () => {
                if (await copy(shareLink(share.token))) {
                  toast.success(t("share.copied"));
                } else {
                  toast.error(t("share.copyError"));
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t("share.copy")}
            </Button>
            <EmbedPicker token={share.token} />
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
            share.includeComments ? t("share.visible.comments") : null,
            share.includeAttachments ? t("share.visible.attachments") : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
      </p>
    </li>
  );
}

function EmbedPicker({ token }: { token: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [theme, setTheme] = useState<EmbedTheme>("system");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          {t("share.embed")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("share.embedTheme.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("share.embedTheme.hint")}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={t("share.embedTheme.title")}
          className="space-y-1"
        >
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover",
                theme === option && "bg-muted font-medium",
              )}
            >
              {t(`share.embedTheme.${option}`)}
              {theme === option && (
                <Check className="h-4 w-4 text-primary" aria-hidden />
              )}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full gap-2"
          onClick={async () => {
            if (await copy(buildEmbed(token, theme))) {
              toast.success(t("share.embedTheme.copied"));
              setOpen(false);
            } else {
              toast.error(t("share.embedTheme.copyError"));
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t("share.embedTheme.copy")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Link-lifetime picker: an outline trigger opening a popover of radio rows
 * with the project's check-mark idiom (BoardMembersDialog's RolePicker) —
 * a native `<select>` renders as a black browser control in the dark theme
 * and cannot be styled to match the dialog.
 */
function TtlPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const label = (hours: number) =>
    hours === 0 ? t("share.ttl.never") : t("share.ttl.hours", { count: hours });
  const options = [0, ...SHARE_TTL_HOURS];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("share.ttl.label")}
          data-testid="share-ttl"
          className="h-8 min-w-[5.5rem] justify-between gap-1.5 px-2 font-normal"
        >
          {label(value)}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        <div role="radiogroup" aria-label={t("share.ttl.label")}>
          {options.map((hours) => (
            <button
              key={hours}
              type="button"
              role="radio"
              aria-checked={hours === value}
              data-testid="share-ttl-option"
              onClick={() => {
                setOpen(false);
                onChange(hours);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
                hours === value
                  ? "font-medium text-foreground"
                  : "text-foreground/90",
              )}
            >
              {label(hours)}
              {hours === value && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CreateForm({
  busy,
  shares,
  now,
  mode,
  onModeChange,
  onCreate,
}: {
  busy: boolean;
  shares: BoardShareDto[] | null;
  now: number;
  mode: BoardShareMode;
  onModeChange: (mode: BoardShareMode) => void;
  onCreate: (request: {
    mode: BoardShareMode;
    title?: string;
    includeComments: boolean;
    includeAttachments: boolean;
    expiresAt: string | null;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [ttlHours, setTtlHours] = useState<number>(SHARE_TTL_HOURS[1]);
  const active = (shares ?? []).filter(
    (share) =>
      !share.revokedAt && (share.expiresAt === null || share.expiresAt > now),
  );
  const count = active.filter((share) => share.mode === mode).length;
  const limit = SHARE_LIMITS.activePerBoard[mode];
  const similar = active.find(
    (share) =>
      share.mode === mode &&
      (share.title ?? "") === title.trim() &&
      share.includeComments === includeComments &&
      share.includeAttachments === includeAttachments &&
      (ttlHours === 0
        ? share.expiresAt === null
        : share.expiresAt !== null &&
          Math.abs(share.expiresAt - share.createdAt - ttlHours * 3_600_000) <
            60_000),
  );

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
            aria-pressed={mode === option}
            onClick={() => onModeChange(option)}
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
      <p className="text-xs text-muted-foreground">
        {t("share.count", { count, limit })}
      </p>

      <Input
        value={title}
        maxLength={100}
        aria-label={t("share.titlePlaceholder")}
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

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("share.ttl.label")}</span>
        <TtlPicker value={ttlHours} onChange={setTtlHours} />
      </div>

      {similar && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          {t(mode === "snapshot" ? "share.similarSnapshot" : "share.similar")}
        </p>
      )}
      {count >= limit && (
        <p className="text-xs text-destructive">{t("share.limitReached")}</p>
      )}

      <Button
        type="button"
        className="w-full gap-1.5"
        disabled={busy || shares === null || count >= limit}
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
        {similar ? t("share.createAnother") : t("share.create")}
      </Button>
    </div>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
