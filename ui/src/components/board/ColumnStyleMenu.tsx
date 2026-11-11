import { Paintbrush } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  COLUMN_STYLE_HINT_KEYS,
  COLUMN_STYLE_KEYS,
} from "@/utils/column-accent";
import { COLUMN_ACCENT_STYLES, type ColumnAccentStyle } from "@janosik/shared";

/** Tiny 28×20 column glyph showing where the accent lands. */
function StyleGlyph({ style }: { style: ColumnAccentStyle }) {
  const rail = style === "rail" || style === "glass" || style === "signature";
  const left = style === "left";
  const headerTint =
    style === "wash" ||
    style === "glass" ||
    style === "signature" ||
    style === "band";
  const dot = style === "dot" || style === "signature";
  const title = style === "title";
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex h-5 w-7 shrink-0 flex-col overflow-hidden rounded border border-border bg-card",
        style === "glow" && "shadow-[0_0_0_1px_var(--primary)]",
      )}
    >
      {rail ? (
        <span className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
      ) : null}
      {left ? (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
      ) : null}
      {style === "wash" ? (
        <span className="absolute inset-0 bg-primary/10" />
      ) : null}
      <span
        className={cn(
          "relative mt-1 flex items-center gap-[2px] px-1",
          headerTint && "bg-primary/15 py-[2px]",
          style === "band" && "bg-primary py-[2px]",
        )}
      >
        {dot ? (
          <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span
          className={cn(
            "h-[2px] w-3 rounded bg-muted-foreground/70",
            title && "bg-primary",
            style === "band" && "bg-white/90",
          )}
        />
      </span>
      <span className="mx-1 mt-[3px] h-[2px] rounded bg-border" />
      <span className="mx-1 mt-[2px] h-[2px] w-3 rounded bg-border" />
    </span>
  );
}

/**
 * Board-wide column accent shape — nine options, one per board. Lives in
 * the view toolbar next to density/glass; picking applies live and the
 * choice is stored on the board (so every participant sees the same shape).
 */
export function ColumnStyleMenu({
  value,
  onChange,
}: {
  value: ColumnAccentStyle;
  onChange: (style: ColumnAccentStyle) => void;
}) {
  const { t } = useI18n();

  return (
    <Tooltip>
      <DropdownMenu modal={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("column.styleMenu")}
              aria-haspopup="menu"
              data-testid="column-style-menu"
            >
              <Paintbrush className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5">
          <div className="px-2 pb-1 pt-1">
            <div className="text-xs font-medium text-foreground">
              {t("column.styleMenu")}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {t("column.styleMenuHint")}
            </div>
          </div>
          <ColumnStyleOptions value={value} onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("column.styleMenu")}</TooltipContent>
    </Tooltip>
  );
}

export function ColumnStyleOptions({
  value,
  onChange,
}: {
  value: ColumnAccentStyle;
  onChange: (style: ColumnAccentStyle) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(next) => onChange(next as ColumnAccentStyle)}
      className="space-y-0.5"
    >
      {COLUMN_ACCENT_STYLES.map((style) => (
        <DropdownMenuRadioItem
          key={style}
          value={style}
          data-testid={`column-style-menu-${style}`}
          onSelect={(event) => event.preventDefault()}
          className="items-start gap-2 py-1.5 pl-2 pr-7"
        >
          <StyleGlyph style={style} />
          <span className="min-w-0">
            <span className="block text-xs font-medium">
              {t(COLUMN_STYLE_KEYS[style])}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {t(COLUMN_STYLE_HINT_KEYS[style])}
            </span>
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
