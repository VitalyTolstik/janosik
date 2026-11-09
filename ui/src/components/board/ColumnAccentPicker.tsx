import { useState } from "react";
import { Check, Paintbrush, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { columnAccentVars } from "@/utils/column-accent";
import { COVER_COLOR_KEYS, COVER_GRADIENT_KEYS } from "@/utils/palette-keys";
import {
  COVER_COLORS,
  COVER_COLOR_CSS,
  COVER_GRADIENTS,
  COVER_GRADIENT_CSS,
  type CardCover,
  type ColumnAccentStyle,
  type CoverColor,
  type CoverGradient,
} from "@janosik/shared";

interface ColumnAccentPickerProps {
  columnId: string;
  /** Column title — used in the trigger label and the preview. */
  title: string;
  /** Current accent, absent when unset. */
  accent?: CardCover;
  /** Board-wide shape, so the preview matches the live board. */
  columnStyle: ColumnAccentStyle;
  /** Applies immediately (like the card cover picker) or clears on `undefined`. */
  onChange: (accent?: CardCover) => void;
  disabled?: boolean;
}

function ColorSwatch({
  color,
  selected,
  onClick,
  label,
}: {
  color: CoverColor;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={`column-style-option-${color}`}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
      )}
      style={{ background: COVER_COLOR_CSS[color] }}
    >
      {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </button>
  );
}

function GradientSwatch({
  gradient,
  selected,
  onClick,
  label,
}: {
  gradient: CoverGradient;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={`column-style-option-${gradient}`}
      className={cn(
        "h-5 w-8 rounded-full transition-transform hover:scale-110",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
      )}
      style={{ background: COVER_GRADIENT_CSS[gradient] }}
    />
  );
}

/** Mini column that shows the current shape + color inside the popover. */
function AccentPreview({
  title,
  accent,
  columnStyle,
}: {
  title: string;
  accent?: CardCover;
  columnStyle: ColumnAccentStyle;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("column.accentPreview")}
      </div>
      <div
        data-testid="column-style-preview"
        data-column-accent={accent?.value ?? "none"}
        data-column-accent-type={accent?.type ?? "none"}
        data-column-accent-style={accent ? columnStyle : "none"}
        style={columnAccentVars(accent)}
        className={cn(
          "relative overflow-hidden rounded-lg border border-border bg-card/70 p-2",
          accent && "janosik-column-accent",
          accent && `janosik-column-accent-${columnStyle}`,
        )}
      >
        <div className="janosik-column-accent-head flex items-center justify-between gap-2 rounded-t-md px-1 pb-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="janosik-column-accent-dotmark h-[7px] w-[7px] shrink-0 rounded-full"
            />
            <span className="janosik-column-accent-heading truncate text-[11px] font-semibold">
              {title}
            </span>
          </span>
          <span className="janosik-column-accent-count flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-hover px-1 text-[9px] font-medium text-muted-foreground">
            3
          </span>
        </div>
        <div className="space-y-1 px-1 pt-1">
          <span className="block h-1.5 w-4/5 rounded bg-hover" />
          <span className="block h-1.5 w-3/5 rounded bg-hover" />
        </div>
      </div>
    </div>
  );
}

/**
 * Brush button in a column header → palette popover. The header is the
 * column drag handle, so every pointer/click here stops propagation; the
 * popover itself is portaled and cannot start a drag either.
 *
 * Picking applies immediately and keeps the popover open so the user can
 * compare colors without reopening it (same UX as the card cover picker).
 */
export function ColumnAccentPicker({
  columnId,
  title,
  accent,
  columnStyle,
  onChange,
  disabled = false,
}: ColumnAccentPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = accent
    ? `${accent.type}:${accent.value}`
    : ("none" as const);

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("column.accentTrigger", { title })}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={t("column.accentTrigger", { title })}
          data-testid="column-style-trigger"
          data-column-id={columnId}
          onPointerDown={stop}
          onMouseDown={stop}
          onTouchStart={stop}
          onKeyDown={stop}
          onClick={stop}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-foreground",
            accent ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          <Paintbrush className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 space-y-3"
        data-testid="column-style-palette"
        onPointerDown={stop}
        onMouseDown={stop}
        onTouchStart={stop}
        onClick={stop}
      >
        <div className="space-y-0.5">
          <div className="text-sm font-semibold">{t("column.accentTitle")}</div>
          <div className="truncate text-xs text-muted-foreground">{title}</div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("column.accentColors")}
          </div>
          <div
            role="radiogroup"
            aria-label={t("column.accentColors")}
            className="flex flex-wrap items-center gap-2 py-1"
          >
            {COVER_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                selected={accent?.type === "color" && accent.value === color}
                onClick={() => onChange({ type: "color", value: color })}
                label={t(COVER_COLOR_KEYS[color])}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("column.accentGradients")}
          </div>
          <div
            role="radiogroup"
            aria-label={t("column.accentGradients")}
            className="flex flex-wrap items-center gap-2 py-1"
          >
            {COVER_GRADIENTS.map((gradient) => (
              <GradientSwatch
                key={gradient}
                gradient={gradient}
                selected={
                  accent?.type === "gradient" && accent.value === gradient
                }
                onClick={() => onChange({ type: "gradient", value: gradient })}
                label={t(COVER_GRADIENT_KEYS[gradient])}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onChange(undefined)}
          data-testid="column-style-reset"
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-hover",
            selected === "none" && "ring-2 ring-ring ring-offset-1",
          )}
        >
          <X className="h-3.5 w-3.5" />
          {t("column.accentNone")}
        </button>

        <AccentPreview
          title={title}
          accent={accent}
          columnStyle={columnStyle}
        />

        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("column.accentHint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
