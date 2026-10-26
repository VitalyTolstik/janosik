import { Link } from "react-router-dom";
import { Home, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";

export type ShareUnavailableVariant = "missing" | "gone" | "error";

/**
 * A friendly dead-end for the public share contour (TASK-58).
 *
 * Three flavours, one look: `missing` (404 — revoked/expired/unknown token),
 * `gone` (410 — the board behind a live link was deleted) and `error` (a
 * transient load failure, with a retry). The art is a kanban column whose
 * card has floated off the board — a playful nod to "the card is not here".
 */
export function ShareUnavailable({
  variant,
  onRetry,
}: {
  variant: ShareUnavailableVariant;
  onRetry?: () => void;
}) {
  const { t } = useI18n();

  const code = variant === "gone" ? "410" : variant === "missing" ? "404" : "…";
  const key = variant === "missing" ? "notFound" : variant;
  const title = t(`share.public.${key}.title` as const);
  const body = t(`share.public.${key}.body` as const);

  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10"
      data-testid="share-unavailable"
    >
      {/* Ambient brand glow — pure CSS, no assets. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 right-[-8rem] h-80 w-[28rem] rounded-full bg-secondary/10 blur-3xl"
      />

      <div className="relative flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-border bg-card/70 p-8 text-center shadow-xl shadow-black/20 backdrop-blur">
        <div className="group flex items-center gap-2">
          <BrandMark />
          <span className="font-display text-sm font-semibold tracking-tight">
            Janosik
          </span>
        </div>

        <LostBoardArt ghost={variant === "gone"} />

        <span
          className="inline-flex items-center rounded-full border border-border bg-hover/60 px-3 py-1 font-mono text-xs font-medium tabular-nums text-muted-foreground"
          data-testid="share-unavailable-code"
        >
          {code}
        </span>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {variant === "error" && onRetry ? (
            <Button size="sm" onClick={onRetry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t("share.public.retry")}
            </Button>
          ) : null}
          <Button
            asChild
            size="sm"
            variant={variant === "error" ? "outline" : "default"}
          >
            <Link to={routes.home}>
              <Home className="h-3.5 w-3.5" aria-hidden />
              {t("share.public.home")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline SVG scene: a kanban column with an empty slot where a card used to
 * be, while a card drifts away with a little puff. `ghost` draws the whole
 * board as a faded outline (the board itself is gone).
 */
function LostBoardArt({ ghost }: { ghost: boolean }) {
  return (
    <svg
      width="240"
      height="150"
      viewBox="0 0 260 170"
      role="img"
      aria-hidden
      className="max-w-full"
    >
      <defs>
        <linearGradient id="janosik-lost-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--secondary)" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* The column */}
      <g
        style={{ opacity: ghost ? 0.5 : 1 }}
        strokeDasharray={ghost ? "6 6" : undefined}
      >
        <rect
          x="62"
          y="34"
          width="120"
          height="122"
          rx="16"
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth="2"
        />
        <rect
          x="76"
          y="48"
          width="52"
          height="8"
          rx="4"
          fill="var(--muted-foreground)"
          opacity="0.5"
        />
        {/* Filled slots */}
        <rect x="76" y="70" width="92" height="18" rx="6" fill="var(--hover)" />
        <rect
          x="76"
          y="126"
          width="92"
          height="18"
          rx="6"
          fill="var(--hover)"
        />
        {/* The empty slot — where the card should be */}
        <rect
          x="76"
          y="98"
          width="92"
          height="18"
          rx="6"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.7"
        />
      </g>

      {/* The card that floated off the board */}
      <g className="janosik-lost-float">
        <rect
          x="178"
          y="6"
          width="72"
          height="50"
          rx="11"
          fill={ghost ? "var(--hover)" : "url(#janosik-lost-grad)"}
          stroke={ghost ? "var(--border)" : "none"}
          strokeWidth="2"
          style={{ filter: "drop-shadow(0 6px 12px rgb(0 0 0 / 0.25))" }}
        />
        <rect
          x="188"
          y="20"
          width="44"
          height="7"
          rx="3.5"
          fill="#fff"
          opacity="0.85"
        />
        <rect
          x="188"
          y="33"
          width="30"
          height="7"
          rx="3.5"
          fill="#fff"
          opacity="0.55"
        />
      </g>

      {/* A little puff where the card lifted off */}
      <g fill="var(--secondary)">
        <circle
          className="janosik-lost-poof"
          cx="150"
          cy="96"
          r="3"
          style={{ animationDelay: "0s" }}
        />
        <circle
          className="janosik-lost-poof"
          cx="160"
          cy="88"
          r="2.4"
          style={{ animationDelay: "0.7s" }}
        />
        <circle
          className="janosik-lost-poof"
          cx="168"
          cy="100"
          r="2"
          style={{ animationDelay: "1.4s" }}
        />
      </g>
    </svg>
  );
}
