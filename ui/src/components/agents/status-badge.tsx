import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * TASK-179.9 — one status badge for every agent surface.
 *
 * The prototype renders every lifecycle/approval/run state as the same
 * `status-pill`: a 22 px pill with a 5 px status mark, an 11 px label and a
 * fixed height so the mark and the label share one optical centre. The tone
 * names mirror the prototype (`ok`, `warn`, `bad`, `primary`, `muted`).
 *
 * Approval (pending/approved/rejected/expired/cancelled/consumed), session
 * lifecycle (active/idle/waiting_approval/completed/failed/cancelled) and run
 * status (applied/reverted/failed) all render through this component; callers
 * keep their own label/test-id/data attributes.
 */
export type StatusTone = "ok" | "warn" | "bad" | "primary" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-success/32 bg-success/6 text-[color:var(--agent-tone-success)]",
  warn: "border-warning/34 bg-warning/6 text-[color:var(--agent-tone-warning)]",
  bad: "border-danger/32 bg-danger/6 text-[color:var(--agent-tone-danger)]",
  primary:
    "border-primary/32 bg-primary/6 text-[color:var(--agent-tone-primary)]",
  muted: "border-border bg-hover text-muted-foreground",
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  tone: StatusTone;
  /** Machine-readable state, rendered as `data-status`. */
  status?: string;
  testId?: string;
  /** Hide the leading mark for a plain chip (pause scope and similar). */
  withDot?: boolean;
  "data-lifecycle"?: string;
}

export function StatusBadge({
  label,
  tone,
  status,
  testId,
  withDot = true,
  className,
  ...rest
}: StatusBadgeProps) {
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={cn(
        "inline-flex h-[22px] max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[5px] border px-[7px] text-[11px] leading-none font-[650] whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {withDot ? (
        <span
          aria-hidden
          className="h-[5px] w-[5px] shrink-0 rounded-full bg-current"
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
