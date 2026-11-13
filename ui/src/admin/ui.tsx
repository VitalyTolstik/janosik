import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminT } from "./admin-i18n";

/**
 * Dense premium primitives for the master panel (TASK-36): same design
 * tokens and Radix components as the app, tighter type scale and spacing so
 * more data fits on screen.
 */

export function Panel({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  meta,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Small uppercase context line above the h1. */
  eyebrow?: string;
  /** A short meta line below the subtitle (ids, status, dates). */
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        {eyebrow ? (
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-xs leading-5 text-muted-foreground">{subtitle}</p>
        ) : null}
        {meta ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

const BADGE_VARIANTS = {
  neutral: "border-border bg-hover/60 text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  primary: "border-primary/30 bg-primary/10 text-primary",
} as const;

export function Badge({
  variant = "neutral",
  children,
  ...rest
}: {
  variant?: keyof typeof BADGE_VARIANTS;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        BADGE_VARIANTS[variant],
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const t = useAdminT();
  return (
    <label
      className={cn(
        "relative inline-flex h-8 w-64 items-center rounded-lg border border-input bg-background/60 focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      <Search
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
        aria-hidden
      />
      <input
        value={value}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("admin.common.search")}
        aria-label={t("admin.common.search")}
        className="h-full w-full bg-transparent pl-8 pr-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function FilterTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-primary/15 text-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Row identifier, DB-style: eight characters, monospace, click to copy the
 * full id (the tooltip carries it too). Support work starts with an id.
 */
export function IdChip({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={id}
      data-testid={`admin-id-${id}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(id)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {id.slice(0, 8)}
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-hidden />
      ) : (
        <Copy className="h-3 w-3 opacity-60" aria-hidden />
      )}
    </button>
  );
}

/**
 * A foreign key: the id is the value, the human label is secondary (muted,
 * with the full value in its tooltip). Board/column titles are not unique,
 * so support work has to go through ids.
 */
export function RefId({
  id,
  label,
  testId,
}: {
  id: string | null;
  label?: string | null;
  testId?: string;
}) {
  if (id === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      data-testid={testId}
      className="inline-flex max-w-[16rem] items-center gap-2"
    >
      <IdChip id={id} />
      {label ? (
        <span className="truncate text-muted-foreground" title={label}>
          {label}
        </span>
      ) : null}
    </span>
  );
}

/** A list of related ids (e.g. every comment on a card). No counts. */
export function IdList({ ids }: { ids: string[] }) {
  if (ids.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {ids.map((id) => (
        <IdChip key={id} id={id} />
      ))}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("h-4 w-4 animate-spin text-muted-foreground", className)}
      aria-hidden
    />
  );
}

export function LoadingState() {
  const t = useAdminT();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
      <Spinner />
      <span className="text-xs">{t("admin.common.loading")}</span>
    </div>
  );
}

export function ErrorState({
  onRetry,
  reference,
}: {
  onRetry: () => void;
  /** A short support reference (request id, timestamp or entity key). */
  reference?: string;
}) {
  const t = useAdminT();
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center"
      data-testid="admin-error-state"
      role="alert"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-danger/25 bg-danger/10">
        <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
      </span>
      <p className="text-xs font-medium text-foreground">
        {t("admin.common.error")}
      </p>
      <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
        {t("admin.common.errorHint")}
      </p>
      {reference ? (
        <p
          className="font-mono text-[10px] text-muted-foreground"
          data-testid="admin-error-reference"
        >
          {t("admin.common.errorReference")}: {reference}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        data-testid="admin-error-retry"
      >
        {t("admin.common.retry")}
      </Button>
    </div>
  );
}

export function EmptyState({
  message,
  filtered = false,
  onClear,
  action,
}: {
  message?: string;
  /** Distinguish "no rows exist" from "the current filters match nothing". */
  filtered?: boolean;
  onClear?: () => void;
  action?: ReactNode;
}) {
  const t = useAdminT();
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center"
      data-testid="admin-empty-state"
    >
      <p className="text-xs font-medium text-foreground">
        {message ?? t("admin.common.empty")}
      </p>
      {filtered ? (
        <p className="text-[11px] text-muted-foreground">
          {t("admin.common.emptyFiltered")}
        </p>
      ) : null}
      {filtered && onClear ? (
        <Button size="sm" variant="outline" onClick={onClear}>
          {t("admin.common.clearFilters")}
        </Button>
      ) : (
        action
      )}
    </div>
  );
}

/** Explicit 403 state for an owner-only screen reached by direct URL. */
export function ForbiddenState({ onBack }: { onBack?: () => void }) {
  const t = useAdminT();
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center"
      data-testid="admin-forbidden-state"
      role="alert"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">
        {t("admin.hub.forbidden.title")}
      </p>
      <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
        {t("admin.hub.forbidden.body")}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {t("admin.common.forbiddenHint")}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={onBack ?? (() => window.history.back())}
      >
        {t("admin.common.backToPanel")}
      </Button>
    </div>
  );
}

/**
 * Table viewport: the panel owns a fixed slice of the viewport height and
 * scrolls both axes inside it, so the horizontal bar sits in the panel
 * (right below the visible rows) instead of at the bottom of a very tall
 * page, and the header stays put while rows scroll under it.
 */
export function Table({
  children,
  className,
  maxHeight = "calc(100vh - 14rem)",
}: {
  children: ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      data-testid="admin-table-scroll"
      className={cn(
        "admin-table-scroll overflow-auto overscroll-contain",
        className,
      )}
      style={{ maxHeight }}
    >
      <table className="admin-table w-max min-w-full text-left text-xs">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  label,
}: {
  children?: ReactNode;
  className?: string;
  /** Column name used by the phone card layout (`data-label`). */
  label?: string;
}) {
  return (
    <td
      data-label={label ?? ""}
      className={cn(
        "whitespace-nowrap border-b border-border/60 px-3 align-middle text-foreground",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
  onLimitChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  /** Enables the 25 / 50 / 100 rows-per-page select. */
  onLimitChange?: (limit: number) => void;
}) {
  const t = useAdminT();
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-1.5">
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {t("admin.common.total", { count: total })}
      </span>
      <div className="flex items-center gap-2">
        {onLimitChange ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="sr-only">{t("admin.common.pageSize")}</span>
            <select
              data-testid="admin-page-size"
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="h-7 rounded-md border border-border bg-background/60 px-1.5 text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">
              {t("admin.common.pageSize")}
            </span>
          </label>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
          data-testid="admin-pagination-prev"
          aria-label={t("admin.common.prev")}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          {t("admin.common.prev")}
        </Button>
        <span
          className="text-[11px] text-muted-foreground"
          data-testid="admin-pagination-status"
        >
          {t("admin.common.page", { page, pages })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={page >= pages}
          data-testid="admin-pagination-next"
          aria-label={t("admin.common.next")}
          onClick={() => onChange(offset + limit)}
        >
          {t("admin.common.next")}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * Footer of a windowed detail list (TASK-176.3): the exact `N of M` count and
 * an explicit `Load more` action. The total is a server count, never the
 * number of loaded rows, so the same footer works for comments, sessions and
 * the merged timeline. Wraps on narrow screens without widening the table.
 */
export function ListWindowFooter({
  shown,
  total,
  hasMore,
  loading = false,
  onLoadMore,
  testId,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  testId: string;
}) {
  const t = useAdminT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5">
      <span
        className="text-[11px] tabular-nums text-muted-foreground"
        data-testid={`${testId}-count`}
        aria-live="polite"
      >
        {t("admin.common.ofTotal", { shown, total })}
      </span>
      {hasMore ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={loading}
          data-testid={`${testId}-more`}
          onClick={onLoadMore}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          {t("admin.common.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useAdminT();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onClose}>
            {t("admin.common.cancel")}
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            data-testid="admin-confirm-accept"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** A compact on/off switch for settings pages (TASK-61). */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked
          ? "bg-primary ring-primary/60"
          : "bg-muted-foreground/40 ring-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/**
 * A labelled form field with a consistent error/counter footer (TASK-66
 * audit). Every admin input sits in one of these, so a validation message
 * and a character counter always look and sit the same way.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  counter,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  /** Localised message, or `null`/`undefined` when the field is valid. */
  error?: string | null;
  hint?: ReactNode;
  counter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      {label ? (
        <label htmlFor={htmlFor} className="text-muted-foreground">
          {label}
        </label>
      ) : null}
      {children}
      {error || counter ? (
        <div className="flex items-start justify-between gap-2">
          <span
            role={error ? "alert" : undefined}
            className="text-[11px] text-danger"
          >
            {error}
          </span>
          {counter}
        </div>
      ) : null}
      {hint ? (
        <span className="text-[11px] leading-4 text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Character counter for length-limited inputs (TASK-62): shows how many
 * characters remain, warning as it runs low and red once over the limit —
 * the same affordance the card dialog uses on the board.
 */
export function CharCount({
  value,
  max,
  className,
}: {
  value: string;
  max: number;
  className?: string;
}) {
  const t = useAdminT();
  const left = max - value.length;
  return (
    <span
      data-testid="char-count"
      className={cn(
        "self-end text-[11px] tabular-nums",
        left < 0
          ? "text-danger"
          : left <= Math.max(20, Math.round(max * 0.1))
            ? "text-warning"
            : "text-muted-foreground",
        className,
      )}
    >
      {left >= 0
        ? t("admin.common.charsLeft", { count: left })
        : t("admin.common.charsOver", { count: -left })}
    </span>
  );
}
