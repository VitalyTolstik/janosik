import type { CSSProperties, ReactNode } from "react";
import {
  Bug,
  CalendarDays,
  Check,
  Layers,
  ListChecks,
  Rocket,
  Sun,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  LABEL_COLOR_CHIP,
  boardTemplateCounts,
  boardTemplateLabelColor,
  templateDueDate,
  type BoardTemplate,
  type BoardStarterLocale,
  type BoardTemplateCardCopy,
  type BoardTemplateId,
} from "@janosik/shared";

import { cn } from "@/lib/utils";
import { formatDateOnly, useI18n } from "@/i18n";

export const TEMPLATE_ICONS: Record<BoardTemplateId, LucideIcon> = {
  "product-launch": Rocket,
  sprint: Layers,
  personal: Sun,
  "content-calendar": CalendarDays,
  hiring: Users,
  "bug-tracker": Bug,
};

const ACCENT_ICON = {
  blue: "border-blue/25 bg-blue/15 text-(--chip-blue)",
  amber: "border-warning/25 bg-warning/15 text-(--chip-warning)",
  teal: "border-teal/25 bg-teal/15 text-(--chip-teal)",
  pink: "border-pink/25 bg-pink/15 text-(--chip-pink)",
  indigo: "border-indigo/25 bg-indigo/15 text-(--chip-indigo)",
  red: "border-danger/25 bg-danger/15 text-(--chip-red)",
} satisfies Record<BoardTemplate["accent"], string>;

export function templateAccentIconClass(template: BoardTemplate): string {
  return ACCENT_ICON[template.accent];
}

export function TemplateGlyph({
  template,
  className,
}: {
  template: BoardTemplate;
  className?: string;
}) {
  const Icon = TEMPLATE_ICONS[template.id];
  return <Icon aria-hidden className={className} />;
}

function labelChipClass(template: BoardTemplate, key: string): string {
  return LABEL_COLOR_CHIP[boardTemplateLabelColor(template, key)];
}

function MiniBoard({
  template,
  locale,
  now,
  maxCards = 2,
}: {
  template: BoardTemplate;
  locale: BoardStarterLocale;
  now: Date;
  maxCards?: number;
}) {
  const copy = template.copy[locale];
  return (
    <div
      className="template-mini-board mt-3.5"
      style={
        {
          "--template-cols": copy.columns.length,
        } as CSSProperties
      }
      role="group"
      aria-label={copy.name}
    >
      {copy.columns.map((column) => (
        <div
          key={column.title}
          className="min-w-0 rounded-[9px] border border-border bg-background/70 p-[7px]"
        >
          <div className="mb-1.5 flex items-center justify-between gap-1 text-[8.5px] font-bold uppercase leading-[1.55] tracking-[0.05em] text-muted-foreground">
            <span className="min-w-0 truncate">{column.title}</span>
            <span className="font-semibold text-muted-foreground/70">
              {column.cards.length}
            </span>
          </div>
          {column.cards.slice(0, maxCards).map((card) => (
            <MiniCard
              key={card.title}
              template={template}
              card={card}
              locale={locale}
              now={now}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MiniCard({
  template,
  card,
  locale,
  now,
}: {
  template: BoardTemplate;
  card: BoardTemplateCardCopy;
  locale: BoardStarterLocale;
  now: Date;
}) {
  const copy = template.copy[locale];
  const due =
    typeof card.dueInDays === "number"
      ? formatDateOnly(templateDueDate(now.getTime(), card.dueInDays), locale)
      : "";
  return (
    <div className="mt-[5px] rounded-[7px] border border-border bg-card p-[7px] shadow-sm first:mt-0">
      {card.labels.length > 0 ? (
        <div className="mb-1 flex flex-wrap gap-0.5">
          {card.labels.slice(0, 2).map((key) => (
            <span
              key={key}
              className={cn(
                "inline-flex max-w-full items-center gap-0.5 truncate rounded-[3px] px-1 py-px text-[7.5px] font-semibold leading-[1.45]",
                labelChipClass(template, key),
              )}
            >
              <span
                aria-hidden
                className="h-[3px] w-[3px] shrink-0 rounded-full bg-current"
              />
              {copy.labels[key]}
            </span>
          ))}
        </div>
      ) : null}
      <div className="line-clamp-2 text-[9.5px] font-[610] leading-[1.33] text-foreground">
        {card.title}
      </div>
      {card.checklist || due ? (
        <div className="mt-[5px] flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[8px] text-muted-foreground">
          {card.checklist ? (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
              <Check aria-hidden className="h-[9px] w-[9px]" />
              {card.checklist.items.length}
            </span>
          ) : null}
          {due ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 whitespace-nowrap",
                card.dueInDays !== undefined && card.dueInDays <= 1
                  ? "text-warning"
                  : undefined,
              )}
            >
              <CalendarDays aria-hidden className="h-[9px] w-[9px]" />
              {due}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SampleCard({
  template,
  locale,
  now,
}: {
  template: BoardTemplate;
  locale: BoardStarterLocale;
  now: Date;
}) {
  const { t } = useI18n();
  const copy = template.copy[locale];
  const allCards = copy.columns.flatMap((column) => column.cards);
  const card = allCards.find((candidate) => candidate.desc) ?? allCards[0];
  if (!card) return null;
  const due =
    typeof card.dueInDays === "number"
      ? formatDateOnly(templateDueDate(now.getTime(), card.dueInDays), locale)
      : "";

  return (
    <div className="mt-3 rounded-[10px] border border-dashed border-border bg-card/55 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {t("board.templatePicker.sampleCard")}
        <span className="rounded-[3px] border border-border px-1 py-px text-[8.5px] font-medium normal-case tracking-normal">
          {t("board.templatePicker.description")}
        </span>
      </div>
      <h4 className="mb-1 text-[12.5px] font-semibold leading-tight text-foreground">
        {card.title}
      </h4>
      <p className="m-0 line-clamp-2 text-[10.5px] leading-[1.48] text-muted-foreground">
        {card.desc ?? copy.long}
      </p>
      <div className="mt-[7px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[8.5px] text-muted-foreground">
        {card.labels.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            {card.labels.map((key) => (
              <span
                key={key}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-[3px] px-1 py-px text-[8px] font-semibold",
                  labelChipClass(template, key),
                )}
              >
                {copy.labels[key]}
              </span>
            ))}
          </span>
        ) : null}
        {card.checklist ? (
          <span className="inline-flex items-center gap-1">
            <Check aria-hidden className="h-2.5 w-2.5" />
            {t("board.templatePicker.items", {
              count: card.checklist.items.length,
            })}
          </span>
        ) : null}
        {due ? (
          <span className="inline-flex items-center gap-1">
            <CalendarDays aria-hidden className="h-2.5 w-2.5" />
            {due}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatPill({
  children,
  icon: Icon,
}: {
  children: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] border border-border bg-background/70 px-[7px] py-[3px] text-[9.5px] font-semibold text-muted-foreground">
      <Icon
        aria-hidden
        className="h-[11px] w-[11px] text-muted-foreground/70"
      />
      {children}
    </span>
  );
}

export function TemplateStats({
  template,
  className,
}: {
  template: BoardTemplate;
  className?: string;
}) {
  const { t } = useI18n();
  const counts = boardTemplateCounts(template);
  return (
    <div className={cn("flex flex-wrap gap-[5px]", className)}>
      <StatPill icon={Layers}>
        {t("board.templatePicker.columns", { count: counts.columns })}
      </StatPill>
      <StatPill icon={CalendarDays}>
        {t("board.templatePicker.cards", { count: counts.cards })}
      </StatPill>
      <StatPill icon={Tag}>
        {t("board.templatePicker.labels", { count: counts.labels })}
      </StatPill>
      <StatPill icon={ListChecks}>
        {t("board.templatePicker.checklists", {
          count: counts.checklists,
        })}
      </StatPill>
    </div>
  );
}

export function TemplatePreview({
  template,
  locale,
  now,
}: {
  template: BoardTemplate;
  locale: BoardStarterLocale;
  now: Date;
}) {
  const { t } = useI18n();
  const copy = template.copy[locale];
  const checklistCards = copy.columns
    .flatMap((column) => column.cards)
    .filter((card) => card.checklist)
    .slice(0, 3);

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] border",
            templateAccentIconClass(template),
          )}
        >
          <TemplateGlyph template={template} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            <span>{t("board.templatePicker.preview")}</span>
            {template.id === "product-launch" ? (
              <span className="rounded-[4px] bg-primary/15 px-1.5 py-px text-[8.5px] font-semibold tracking-normal text-primary">
                {t("board.templatePicker.recommended")}
              </span>
            ) : null}
          </div>
          <h3 className="m-0 text-[22px] font-semibold leading-[1.12] tracking-[-0.025em] text-foreground">
            {copy.name}
          </h3>
        </div>
      </div>

      <p className="mt-[7px] max-w-[650px] text-[11.5px] leading-[1.5] text-muted-foreground">
        {copy.long}
      </p>
      <TemplateStats template={template} className="mt-2.5" />
      <div className="mt-[7px] flex flex-wrap gap-1">
        {copy.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-[3px] border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      <MiniBoard template={template} locale={locale} now={now} />
      <SampleCard template={template} locale={locale} now={now} />

      <div className="mt-3 grid grid-cols-2 gap-x-[18px] gap-y-2.5 border-t border-border pt-[11px] max-[620px]:grid-cols-1">
        <div>
          <h4 className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            {t("board.templatePicker.insideColumns")}
          </h4>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {copy.columns.map((column) => (
              <li
                key={column.title}
                className="flex items-center gap-1.5 text-[9.5px] leading-[1.35] text-muted-foreground"
              >
                <Check
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 text-success"
                />
                <span className="min-w-0 truncate">{column.title}</span>
                <span className="text-muted-foreground/60">
                  · {column.cards.length}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            {t("board.templatePicker.insideLabels")}
          </h4>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {Object.entries(copy.labels)
              .slice(0, 4)
              .map(([key, name]) => (
                <li
                  key={key}
                  className="flex items-center gap-1.5 text-[9.5px] leading-[1.35] text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-[3px]",
                      LABEL_COLOR_CHIP[boardTemplateLabelColor(template, key)],
                    )}
                  />
                  <span className="min-w-0 truncate">{name}</span>
                </li>
              ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            {t("board.templatePicker.insideChecklists")}
          </h4>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {checklistCards.map((card) => (
              <li
                key={card.title}
                className="flex items-center gap-1.5 text-[9.5px] leading-[1.35] text-muted-foreground"
              >
                <Check
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 text-success"
                />
                <span className="min-w-0 truncate">
                  {card.checklist!.title}
                </span>
                <span className="text-muted-foreground/60">
                  · {card.checklist!.items.length}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Public so the success panel can reuse the same miniature board. */
export function TemplateMiniBoard({
  template,
  locale,
  now,
  maxCards,
}: {
  template: BoardTemplate;
  locale: BoardStarterLocale;
  now: Date;
  maxCards?: number;
}) {
  return (
    <MiniBoard
      template={template}
      locale={locale}
      now={now}
      maxCards={maxCards}
    />
  );
}
