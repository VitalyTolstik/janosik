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
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-0.5">
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
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
}: {
  variant?: keyof typeof BADGE_VARIANTS;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        BADGE_VARIANTS[variant],
      )}
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

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useAdminT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
      <p className="text-xs text-muted-foreground">{t("admin.common.error")}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t("admin.common.retry")}
      </Button>
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const t = useAdminT();
  return (
    <div className="py-16 text-center text-xs text-muted-foreground">
      {message ?? t("admin.common.empty")}
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
      className={cn("overflow-auto overscroll-contain", className)}
      style={{ maxHeight }}
    >
      <table className="w-max min-w-full border-collapse text-left text-xs">
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
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
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
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap border-b border-border/60 px-3 py-2 align-middle text-foreground",
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
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const t = useAdminT();
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
      <span className="text-[11px] text-muted-foreground">
        {t("admin.common.total", { count: total })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          {t("admin.common.prev")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t("admin.common.page", { page, pages })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={page >= pages}
          onClick={() => onChange(offset + limit)}
        >
          {t("admin.common.next")}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-primary" : "bg-divider",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
