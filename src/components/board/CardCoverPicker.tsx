import { Paintbrush, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  COVER_COLORS,
  COVER_COLOR_CSS,
  COVER_GRADIENTS,
  COVER_GRADIENT_CSS,
  coverBackground,
  type CardCover,
  type CoverColor,
  type CoverGradient,
} from "@/types/kanban";
import { useBoard } from "@/store/BoardContext";

interface CardCoverPickerProps {
  cardId: string;
  /** Current cover, absent when unset. */
  cover?: CardCover;
}

/** Small rounded swatch rendering a solid color. */
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
      className={cn(
        "h-7 w-7 rounded-full transition-transform hover:scale-110",
        selected &&
          "ring-2 ring-primary ring-offset-2 ring-offset-popover scale-110",
      )}
      style={{ background: COVER_COLOR_CSS[color] }}
    />
  );
}

/** Small rounded swatch rendering a gradient preset. */
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
      className={cn(
        "h-9 w-14 rounded-md border border-border/60 transition-transform hover:scale-105",
        selected &&
          "ring-2 ring-primary ring-offset-2 ring-offset-popover scale-105",
      )}
      style={{ background: COVER_GRADIENT_CSS[gradient] }}
    />
  );
}

/**
 * Card cover row in the card dialog: a trigger button with a mini preview
 * of the current cover (or a "set" placeholder) opening a picker popover —
 * solid token colors, named gradient presets, and a remove action.
 * Picking applies immediately (like the label/due-date editors).
 *
 * Rendering rules (Trello-style): a solid color shows as a slim strip on
 * the card; a gradient shows as a taller header band (see CardItem).
 */
export function CardCoverPicker({ cardId, cover }: CardCoverPickerProps) {
  const { setCardCover } = useBoard();
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("card.coverLabel")}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="cover-trigger">
            {cover ? (
              <span
                aria-hidden
                className="h-3.5 w-3.5 rounded-full border border-border/40"
                style={{ background: coverBackground(cover) }}
              />
            ) : (
              <Paintbrush className="h-3.5 w-3.5" />
            )}
            {cover ? t("card.coverChange") : t("card.coverSet")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3">
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("card.coverColors")}
            </div>
            <div
              role="radiogroup"
              aria-label={t("card.coverColors")}
              className="flex flex-wrap items-center gap-2 py-1"
            >
              {COVER_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  selected={
                    cover?.type === "color" && cover.value === color
                  }
                  onClick={() =>
                    setCardCover(cardId, { type: "color", value: color })
                  }
                  label={t(`card.coverColor.${color}` as never)}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("card.coverGradients")}
            </div>
            <div
              role="radiogroup"
              aria-label={t("card.coverGradients")}
              className="flex flex-wrap items-center gap-2 py-1"
            >
              {COVER_GRADIENTS.map((gradient) => (
                <GradientSwatch
                  key={gradient}
                  gradient={gradient}
                  selected={
                    cover?.type === "gradient" && cover.value === gradient
                  }
                  onClick={() =>
                    setCardCover(cardId, { type: "gradient", value: gradient })
                  }
                  label={t(`card.coverGradient.${gradient}` as never)}
                />
              ))}
            </div>
          </div>
          {cover && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setCardCover(cardId, undefined)}
              data-testid="cover-remove"
            >
              <X className="h-3.5 w-3.5" />
              {t("card.coverRemove")}
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
