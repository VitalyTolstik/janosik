import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { LABEL_COLOR_CHIP, type LabelColor } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAdminT } from "./admin-i18n";
import { Badge, IdChip } from "./ui";

/**
 * Shared cell renderers for the admin tables (TASK-48). One human-readable
 * value per cell; ids stay copy-on-click chips and foreign keys render as
 * links to the related entity's detail page.
 */

export function DateCell({ value }: { value: number | null }) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums text-muted-foreground">
      {formatDate(value, lang, hour12)}
    </span>
  );
}

export function TextCell({
  value,
  className,
  maxWidth = "20rem",
}: {
  value: string | null | undefined;
  className?: string;
  maxWidth?: string;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn("block truncate", className)}
      style={{ maxWidth }}
      title={value}
    >
      {value}
    </span>
  );
}

/** One-click copy of a searchable value (email, name) next to its link. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={`admin-copy-${value}`}
      title={value}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-hidden />
      ) : (
        <Copy className="h-3 w-3 opacity-60" aria-hidden />
      )}
    </button>
  );
}

/** Foreign key rendered as a link to the related entity's page. */
export function EntityLink({
  to,
  children,
  className,
  testId,
  copyValue,
}: {
  to: string | null;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  /** When set, a copy icon rides next to the link (searchable values). */
  copyValue?: string;
}) {
  if (to === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <Link
        to={to}
        data-testid={testId}
        className={cn(
          "truncate font-medium text-primary underline-offset-2 hover:underline",
          className,
        )}
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </Link>
      {copyValue ? <CopyButton value={copyValue} /> : null}
    </span>
  );
}

/** Copyable id chip with an optional leading label (e.g. a cuid owner id). */
export function IdCell({ id }: { id: string | null }) {
  if (id === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <IdChip id={id} />;
}

export function RoleBadge({ role }: { role: string }) {
  const t = useAdminT();
  const variant =
    role === "ADMIN" || role === "OWNER"
      ? "primary"
      : role === "VIEWER"
        ? "warning"
        : "neutral";
  const key =
    role === "ADMIN"
      ? "admin.role.admin"
      : role === "MEMBER"
        ? "admin.role.member"
        : role === "VIEWER"
          ? "admin.role.viewer"
          : role === "OWNER"
            ? "admin.role.owner"
            : "admin.role.operator";
  return <Badge variant={variant}>{t(key)}</Badge>;
}

/** Row status badges: soft-deleted beats archived beats active. */
export function StatusBadge({
  deletedAt,
  archivedAt,
  labels,
}: {
  deletedAt: number | null;
  archivedAt?: number | null;
  labels: {
    deleted: string;
    archived?: string;
    active: string;
  };
}) {
  if (deletedAt !== null) {
    return <Badge variant="danger">{labels.deleted}</Badge>;
  }
  if (archivedAt !== undefined && archivedAt !== null && labels.archived) {
    return <Badge variant="warning">{labels.archived}</Badge>;
  }
  return <Badge variant="success">{labels.active}</Badge>;
}

export function BoolCell({ value }: { value: boolean }) {
  const t = useAdminT();
  return (
    <Badge variant={value ? "success" : "neutral"}>
      {value ? t("admin.common.yes") : t("admin.common.no")}
    </Badge>
  );
}

export function NumberCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="tabular-nums">{value}</span>;
}

export function SizeCell({ bytes }: { bytes: number }) {
  if (bytes < 1024) return <span className="tabular-nums">{bytes} B</span>;
  if (bytes < 1024 * 1024) {
    return <span className="tabular-nums">{(bytes / 1024).toFixed(1)} KB</span>;
  }
  return (
    <span className="tabular-nums">
      {(bytes / (1024 * 1024)).toFixed(1)} MB
    </span>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  const chip = LABEL_COLOR_CHIP[color as LabelColor] ?? LABEL_COLOR_CHIP.plain;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        chip,
      )}
    >
      {name}
    </span>
  );
}

/**
 * Human-readable rendering of a free-form `details` JSON (activity, audit):
 * comment text is quoted, id-only fields collapse to their short form and
 * everything else becomes `key: value` pairs — the raw JSON stays in the
 * tooltip.
 */
export function DetailsCell({
  details,
  maxWidth = "24rem",
}: {
  details: Record<string, unknown> | null;
  maxWidth?: string;
}) {
  const t = useAdminT();
  if (details === null || typeof details !== "object") {
    return <span className="text-muted-foreground">—</span>;
  }
  const entries = Object.entries(details).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (entries.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const parts: string[] = [];
  const ids: string[] = [];
  if (typeof details.text === "string") {
    parts.push(`"${details.text}"`);
  }
  for (const [key, value] of entries) {
    if (key === "text") continue;
    if (typeof value === "string" && key.endsWith("Id")) {
      ids.push(value);
      continue;
    }
    const rendered =
      typeof value === "boolean"
        ? t(value ? "admin.common.yes" : "admin.common.no")
        : String(value);
    parts.push(`${key}: ${rendered}`);
  }
  if (parts.length === 0) {
    parts.push(...ids.map((id) => id.slice(0, 8)));
  }

  const raw = JSON.stringify(details);
  return (
    <span
      className="block text-muted-foreground"
      style={{ maxWidth }}
      title={raw}
    >
      {parts.join("  ·  ")}
    </span>
  );
}
