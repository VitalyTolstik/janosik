import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Quiet glass notice (design variant 01): a frosted card with a 3px tone
 * rail, an icon tile and a single accent colour. Every top-of-page message —
 * announcements, impersonation, data safety and the update prompt — renders
 * through this component so the stack reads as one system.
 */
export type NoticeTone = "info" | "success" | "warning" | "danger" | "brand";

export interface NoticeClose {
  onClick: () => void;
  /** Accessible name for the icon-only close button. */
  label: string;
  testId?: string;
}

export interface NoticeProps {
  tone?: NoticeTone;
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  title?: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  close?: NoticeClose;
  /** Status messages are polite; warnings and errors interrupt (assertive). */
  role?: "status" | "alert";
  live?: "polite" | "assertive" | "off";
  testId?: string;
  ariaLabel?: string;
  className?: string;
  bodyClassName?: string;
  /** Toasts bring their own entrance animation; the stack uses this one. */
  animate?: boolean;
  children?: ReactNode;
}

const TONE_CLASSES: Record<
  NoticeTone,
  { rail: string; dot: string; tile: string; eyebrow: string }
> = {
  info: {
    rail: "before:bg-primary",
    dot: "bg-primary",
    tile: "border-primary/20 bg-primary/15 text-primary",
    eyebrow: "text-primary",
  },
  success: {
    rail: "before:bg-success",
    dot: "bg-success",
    tile: "border-success/20 bg-success/15 text-success",
    eyebrow: "text-success",
  },
  warning: {
    rail: "before:bg-warning",
    dot: "bg-warning",
    tile: "border-warning/20 bg-warning/15 text-warning",
    eyebrow: "text-warning",
  },
  danger: {
    rail: "before:bg-danger",
    dot: "bg-danger",
    tile: "border-danger/20 bg-danger/15 text-danger",
    eyebrow: "text-danger",
  },
  brand: {
    rail: "before:bg-secondary",
    dot: "bg-secondary",
    tile: "border-secondary/25 bg-secondary/15 text-secondary",
    eyebrow: "text-secondary",
  },
};

export function Notice({
  tone = "info",
  icon: Icon,
  eyebrow,
  title,
  body,
  actions,
  close,
  role,
  live,
  testId,
  ariaLabel,
  className,
  bodyClassName,
  animate = true,
  children,
}: NoticeProps) {
  const toneClasses = TONE_CLASSES[tone];
  // An error or a warning is news the user must not miss; everything else
  // can arrive politely without interrupting the screen reader.
  const resolvedRole =
    role ?? (tone === "danger" || tone === "warning" ? "alert" : "status");
  const resolvedLive =
    live ?? (resolvedRole === "alert" ? "assertive" : "polite");

  return (
    <article
      data-testid={testId}
      data-tone={tone}
      role={resolvedRole}
      aria-live={resolvedLive}
      aria-label={ariaLabel}
      className={cn(
        "relative flex w-full flex-wrap items-start gap-x-3 gap-y-2.5 overflow-hidden rounded-2xl border border-border/80 bg-surface/90 py-3 pl-4 pr-2.5 text-left shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150",
        "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        animate && "janosik-notice",
        toneClasses.rail,
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] border",
            toneClasses.tile,
          )}
        >
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} aria-hidden />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p
            className={cn(
              "mb-0.5 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em]",
              toneClasses.eyebrow,
            )}
          >
            <span
              aria-hidden
              className={cn("h-[5px] w-[5px] rounded-full", toneClasses.dot)}
            />
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <h3 className="text-[13.5px] font-semibold leading-snug tracking-tight text-foreground">
            {title}
          </h3>
        ) : null}
        {body ? (
          <p
            className={cn(
              "break-words text-[12.5px] leading-relaxed text-muted-foreground",
              title && "mt-0.5",
              bodyClassName,
            )}
          >
            {body}
          </p>
        ) : null}
        {children}
      </div>

      {actions ? (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-1.5 max-sm:order-last max-sm:basis-full max-sm:justify-end",
            Icon && "max-sm:pl-[46px]",
          )}
        >
          {actions}
        </div>
      ) : null}

      {close ? (
        <button
          type="button"
          onClick={close.onClick}
          aria-label={close.label}
          data-testid={close.testId}
          className="-mr-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground/80 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </article>
  );
}
