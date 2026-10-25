import { createElement, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";
import { LABEL_COLOR_CHIP, type LabelColor } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { adminApi } from "./admin-client";
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
  maxChars,
}: {
  value: string | null | undefined;
  className?: string;
  maxWidth?: string;
  /** Hard character cap: longer values are cut with an ellipsis (title keeps
   * the full text). Width truncation still applies as a second guard. */
  maxChars?: number;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  const shown =
    maxChars !== undefined && value.length > maxChars
      ? `${value.slice(0, maxChars)}…`
      : value;
  return (
    <span
      className={cn("block truncate", className)}
      style={{ maxWidth }}
      title={value}
    >
      {shown}
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

/** TASK-50 video encode state — the "ужиматор" lifecycle chip. */
export function TranscodeBadge({ status }: { status: string }) {
  if (status === "none")
    return <span className="text-muted-foreground">—</span>;
  const tone =
    status === "done"
      ? "bg-success/15 text-success"
      : status === "failed"
        ? "bg-danger/15 text-danger"
        : "bg-muted text-muted-foreground";
  return (
    <span
      data-testid="admin-transcode-status"
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      {status}
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
 * Free-form JSON cell (activity details, audit details, command payloads):
 * collapsed as one truncated monospace line, expanded into the complete
 * pretty-printed JSON with no trim — the same component everywhere JSON
 * shows (TASK-48 support feedback).
 */
export function JsonCell({
  value,
  testId,
}: {
  value: Record<string, unknown> | null;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (
    value === null ||
    typeof value !== "object" ||
    Object.keys(value).length === 0
  ) {
    return <span className="text-muted-foreground">—</span>;
  }
  const raw = JSON.stringify(value);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <span className="block">
      <button
        type="button"
        data-testid={testId ? `${testId}-expand` : undefined}
        aria-expanded={expanded}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {!expanded ? (
          <code
            className="block truncate font-mono text-[11px]"
            style={{ maxWidth: "20rem" }}
            title={raw}
          >
            {raw}
          </code>
        ) : null}
      </button>
      {expanded ? (
        <pre
          data-testid={testId ? `${testId}-json` : undefined}
          className="mt-1 max-h-64 max-w-[36rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] text-foreground"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </span>
  );
}

/**
 * A long-text cell that expands in place (like `JsonCell`): collapsed it
 * truncates with a chevron, expanded it shows the whole value. Used for
 * announcement titles/messages so a truncated or oversized value stays
 * fully readable without leaving the table.
 */
export function TextExpandCell({
  value,
  maxWidth = "20rem",
  className,
  testId,
}: {
  value: string | null | undefined;
  maxWidth?: string;
  className?: string;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <span className="block">
      <button
        type="button"
        aria-expanded={expanded}
        data-testid={testId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        className="inline-flex max-w-full items-start gap-1 text-left transition-colors"
      >
        <Chevron
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        {!expanded ? (
          <span
            className={cn("block truncate", className)}
            style={{ maxWidth }}
            title={value}
          >
            {value}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <pre className="mt-1 max-w-[36rem] whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-sans text-xs text-foreground">
          {value}
        </pre>
      ) : null}
    </span>
  );
}

const MIME_ICONS: Array<[RegExp, typeof FileImage]> = [
  [/^video\//, FileVideo],
  [/^audio\//, FileAudio],
  [/zip|compressed|tar/, FileArchive],
  [/sheet|excel|csv/, FileSpreadsheet],
  [/^text\/|json/, FileText],
];

/**
 * Attachment preview: a real thumbnail for images (blob-fetched through the
 * admin download route), a mime icon for everything else.
 */
export function AttachmentThumb({
  attachmentId,
  mimeType,
  fileName,
}: {
  attachmentId: string;
  mimeType: string;
  fileName: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = mimeType.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    let created: string | null = null;
    adminApi
      .downloadAttachment(attachmentId)
      .then((blob) => {
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        /* icon fallback stays */
      });
    return () => {
      alive = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [attachmentId, isImage]);

  if (!isImage) {
    const Icon = MIME_ICONS.find(([pattern]) => pattern.test(mimeType))?.[1];
    return createElement(Icon ?? FileIcon, {
      className: "h-4 w-4 shrink-0 text-muted-foreground",
      "aria-label": fileName,
    });
  }
  if (url === null) {
    return (
      <span
        className="inline-block h-7 w-7 shrink-0 animate-pulse rounded bg-muted/50"
        aria-label={fileName}
      />
    );
  }
  return (
    <img
      src={url}
      alt={fileName}
      className="h-7 w-7 shrink-0 rounded border border-border object-cover"
    />
  );
}

/** One-click download of an attachment blob with its original name. */
export function AttachmentDownloadButton({
  attachmentId,
  fileName,
}: {
  attachmentId: string;
  fileName: string;
}) {
  return (
    <button
      type="button"
      data-testid={`admin-attachment-download-${attachmentId}`}
      title={fileName}
      aria-label={fileName}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void adminApi
          .downloadAttachment(attachmentId)
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = fileName;
            anchor.click();
            URL.revokeObjectURL(url);
          })
          .catch(() => undefined);
      }}
      className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
