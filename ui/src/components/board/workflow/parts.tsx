import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { coverSolid, type Column, type WorkflowRole } from "@janosik/shared";

import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n";

export const WORKFLOW_ACCENT_FALLBACK = [
  "var(--slate)",
  "var(--blue)",
  "var(--warning)",
  "var(--indigo)",
  "var(--success)",
] as const;

/** The column's own accent, or a stable brand-palette colour by position. */
export function columnAccent(column: Column, index: number): string {
  return column.accent
    ? coverSolid(column.accent)
    : (WORKFLOW_ACCENT_FALLBACK[index % WORKFLOW_ACCENT_FALLBACK.length] ??
        "var(--slate)");
}

export function ColumnDot({
  color,
  size = 7,
  ring = true,
}: {
  color: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        ...(ring
          ? {
              boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 16%, transparent)`,
            }
          : {}),
      }}
    />
  );
}

export function SectionLabel({
  title,
  aside,
  asideTestId,
  id,
}: {
  title: ReactNode;
  aside?: ReactNode;
  asideTestId?: string;
  id?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p
        id={id}
        className="text-xs font-semibold tracking-[-0.005em] text-foreground"
      >
        {title}
      </p>
      {aside ? (
        <span
          data-testid={asideTestId}
          className="shrink-0 font-mono text-[11px] font-normal tracking-[-0.01em] text-muted-foreground/80"
        >
          {aside}
        </span>
      ) : null}
    </div>
  );
}

export function GlobalMark() {
  return (
    <span
      aria-hidden
      className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-warning/15 font-mono text-[11px] leading-none text-warning"
    >
      *
    </span>
  );
}

interface WorkflowCheckProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
  ariaLabel?: string;
  variant?: "chip" | "plain";
  className?: string;
}

/**
 * The editor's chip checkbox (roles, done columns) and its plain variant
 * (conditions, reverse). A real button with `role="checkbox"`, so Space/Enter
 * work and the visible 12–14 px box is only presentation.
 */
export function WorkflowCheck({
  checked,
  onCheckedChange,
  children,
  testId,
  disabled = false,
  ariaLabel,
  variant = "chip",
  className,
}: WorkflowCheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        variant === "chip"
          ? "rounded-[5px] border px-1.5 py-0.5 text-[11px] leading-4"
          : "rounded-sm py-0.5 text-xs leading-[1.35]",
        variant === "chip" && checked
          ? "border-primary/40 bg-primary/[0.13] text-foreground"
          : variant === "chip"
            ? "border-border bg-card/50 text-muted-foreground hover:text-foreground"
            : checked
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-[3px] border transition-colors motion-reduce:transition-none",
          variant === "chip" ? "h-3 w-3" : "h-3.5 w-3.5",
          checked
            ? "border-primary bg-primary text-white"
            : "border-muted-foreground/35 bg-transparent",
        )}
      >
        {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

export function formatRoles(
  roles: readonly WorkflowRole[] | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const list = roles && roles.length > 0 ? roles : ["ADMIN", "MEMBER"];
  if (list.length === 1) {
    return `${list[0]} · ${t("workflow.onlyRole", { role: list[0] })}`;
  }
  return list.join(" / ");
}

export function formatConditions(
  conditions: readonly string[],
  t: (key: MessageKey) => string,
): string {
  return conditions
    .map((condition) => t(`workflow.conditionShort.${condition}` as MessageKey))
    .join(", ");
}

export function directionOf(
  columns: Column[],
  fromId: string,
  toId: string,
): "forward" | "back" {
  const from = columns.findIndex((column) => column.id === fromId);
  const to = columns.findIndex((column) => column.id === toId);
  return to >= from ? "forward" : "back";
}
