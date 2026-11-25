import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  BOARD_TEMPLATES,
  LIMITS,
  boardTemplateById,
  boardTemplateCounts,
  templateDateString,
  type BoardStarterLocale,
  type BoardTemplate,
  type BoardTemplateId,
} from "@janosik/shared";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { boardNameIsDuplicate, generateBoardName } from "@/utils/board-name";
import {
  TemplateGlyph,
  TemplateMiniBoard,
  TemplatePreview,
  TemplateStats,
  templateAccentIconClass,
} from "@/components/board/TemplatePreview";

export type TemplateCreateResult = {
  id: string;
  name: string;
  templateId: BoardTemplateId;
  deduped: boolean;
};

/**
 * The template create can distinguish a contract/version mismatch (the
 * server does not know this template yet) from a generic refusal. The UI
 * offers an empty-board fallback only for the former.
 */
export type TemplateCreateOutcome =
  string | { code: "template_unavailable" } | null;

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All account board titles (archived included) for the dedupe suffix. */
  existingTitles: readonly string[];
  /** A name typed on the empty state; opens as a manual draft when present. */
  initialName: string;
  /** Creates the board and resolves with its id, a known failure, or null. */
  createBoard: (
    name: string,
    templateId: BoardTemplateId,
    locale: BoardStarterLocale,
    templateDate: string,
    templateUtcOffsetMinutes: number,
  ) => Promise<TemplateCreateOutcome> | TemplateCreateOutcome;
  /** Version-skew fallback: create a plain board with the current draft name. */
  createEmptyBoard: (name: string) => Promise<string | null> | string | null;
  /** Called by the success CTA; the parent navigates to the new board. */
  onOpenBoard: (boardId: string) => void;
  /**
   * Overrides Radix's focus return when the opener is not a stable element
   * (e.g. a control inside a popover that closed to open this dialog).
   */
  onCloseAutoFocus?: ComponentPropsWithoutRef<
    typeof DialogContent
  >["onCloseAutoFocus"];
}

type NameMode = "auto" | "manual" | "empty";

/**
 * TASK-177.16 follow-up: one-screen gallery + live preview.
 *
 * Radix Dialog owns the focus trap, Escape and focus return. This component
 * owns the draft: selection, generated/manual name, busy and success state.
 * Nothing is created until the footer CTA, and cancelling never changes the
 * empty-state name field.
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  existingTitles,
  initialName,
  createBoard,
  createEmptyBoard,
  onOpenBoard,
  onCloseAutoFocus,
}: TemplatePickerDialogProps) {
  const { t, lang } = useI18n();
  const locale: BoardStarterLocale = lang.startsWith("ru") ? "ru" : "en";

  const [selectedId, setSelectedId] =
    useState<BoardTemplateId>("product-launch");
  const [now, setNow] = useState(() => new Date());
  const [nameValue, setNameValue] = useState("");
  const [nameMode, setNameMode] = useState<NameMode>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versionSkew, setVersionSkew] = useState(false);
  const [created, setCreated] = useState<TemplateCreateResult | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const nameInputRef = useRef<HTMLInputElement>(null);
  const successTitleRef = useRef<HTMLHeadingElement>(null);
  const submitLock = useRef(false);
  const galleryButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const wasOpen = useRef(false);

  const template = boardTemplateById(selectedId) ?? BOARD_TEMPLATES[0]!;
  const templateDate = templateDateString(now);
  const templateUtcOffsetMinutes = -now.getTimezoneOffset();
  const generated = useMemo(
    () => generateBoardName(template, lang, now, existingTitles),
    [template, lang, now, existingTitles],
  );
  const duplicateManual =
    nameMode === "manual" &&
    boardNameIsDuplicate(nameValue, existingTitles, lang);
  // In auto mode the input follows the generated name directly, so changing
  // the template or the UI language cannot leave a stale name behind without
  // an effect or a manual overwrite.
  const displayName = nameMode === "auto" ? generated.name : nameValue;
  const effectiveName =
    displayName.trim().length > 0 ? displayName : generated.name;
  const deduped = nameMode === "manual" ? duplicateManual : generated.deduped;

  // A fresh draft per opening. The displayed auto name is derived, so this
  // effect only resets the manual draft and the frozen date.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const openedAt = new Date();
    const seeded = initialName.trim();
    // Opening a controlled dialog is an external event; this resets its draft.
    setNow(openedAt);
    setSelectedId("product-launch");
    setCreated(null);
    setError("");
    setVersionSkew(false);
    setBusy(false);
    setAnnouncement("");
    setNameValue(seeded);
    setNameMode(seeded.length > 0 ? "manual" : "auto");
  }, [open, initialName]);

  useEffect(() => {
    if (created) successTitleRef.current?.focus();
  }, [created]);

  const announce = (text: string) => {
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(text));
  };

  const selectTemplate = (next: BoardTemplate) => {
    if (busy || created) return;
    setSelectedId(next.id);
    setError("");
    setVersionSkew(false);
    if (nameMode !== "manual") {
      setNameValue("");
      setNameMode("auto");
    }
    announce(
      `${next.copy[locale].name} ${t("board.templatePicker.selectAnnounce")}`,
    );
  };

  const onGalleryKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const last = BOARD_TEMPLATES.length - 1;
    let next = index;
    if (event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    const target = BOARD_TEMPLATES[next]!;
    galleryButtons.current[next]?.focus();
    selectTemplate(target);
  };

  const regenerate = () => {
    if (busy || created) return;
    const next = generateBoardName(template, lang, now, existingTitles);
    setNameValue("");
    setNameMode("auto");
    nameInputRef.current?.focus();
    announce(
      t("board.templatePicker.regenerated", {
        name: next.name,
      }),
    );
  };

  const submit = async () => {
    if (busy || created || submitLock.current) return;
    const finalName = (displayName.trim() || generated.name).trim();
    if (finalName.length === 0) {
      setError(t("board.templatePicker.nameError"));
      return;
    }
    submitLock.current = true;
    setBusy(true);
    setError("");
    setVersionSkew(false);
    announce(t("board.templatePicker.busyAnnounce"));
    try {
      const outcome = await createBoard(
        finalName,
        selectedId,
        locale,
        templateDate,
        templateUtcOffsetMinutes,
      );
      if (outcome !== null && typeof outcome === "object") {
        setVersionSkew(true);
        return;
      }
      if (!outcome) {
        setError(t("board.templatePicker.createError"));
        return;
      }
      const result: TemplateCreateResult = {
        id: outcome,
        name: finalName,
        templateId: selectedId,
        deduped,
      };
      setCreated(result);
      announce(t("board.templatePicker.createdAnnounce", { name: finalName }));
    } catch {
      setError(t("board.templatePicker.createError"));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const createPlainBoard = async () => {
    if (busy || created || submitLock.current) return;
    const finalName = (displayName.trim() || generated.name).trim();
    if (finalName.length === 0) {
      setError(t("board.templatePicker.nameError"));
      return;
    }
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await createEmptyBoard(finalName);
      if (!id) {
        setError(t("board.templatePicker.createError"));
        return;
      }
      onOpenChange(false);
      onOpenBoard(id);
    } catch {
      setError(t("board.templatePicker.createError"));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const openCreatedBoard = () => {
    if (!created) return;
    onOpenChange(false);
    onOpenBoard(created.id);
  };

  const requestClose = () => {
    if (busy) return;
    if (created) {
      openCreatedBoard();
      return;
    }
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (busy) return;
    if (created) {
      openCreatedBoard();
      return;
    }
    onOpenChange(false);
  };

  const createdTemplate = created
    ? boardTemplateById(created.templateId)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideClose
        aria-modal="true"
        data-testid="template-picker"
        aria-busy={busy || undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            const selected =
              galleryButtons.current[
                BOARD_TEMPLATES.findIndex((item) => item.id === selectedId)
              ];
            selected?.focus();
          });
        }}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
            return;
          }
          if (created) {
            event.preventDefault();
            openCreatedBoard();
          }
        }}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            !created
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "h-[min(672px,calc(100dvh-2rem))] w-[min(1110px,calc(100vw-2rem))] max-w-[1110px] gap-0 overflow-hidden rounded-[18px] border-border-strong bg-surface p-0 pt-0 pr-0 pb-0 pl-0 shadow-[0_40px_110px_-40px_rgb(0_0_0/0.9),0_2px_12px_rgb(0_0_0/0.3)] sm:rounded-[18px]",
          "max-[900px]:h-[min(700px,calc(100dvh-1.5rem))] max-[900px]:w-[calc(100vw-1.5rem)]",
          "max-[620px]:h-dvh max-[620px]:max-h-dvh max-[620px]:w-screen max-[620px]:max-w-none max-[620px]:rounded-none max-[620px]:border-0",
          "max-[620px]:pt-[env(safe-area-inset-top)] max-[620px]:pr-[env(safe-area-inset-right)] max-[620px]:pb-[env(safe-area-inset-bottom)] max-[620px]:pl-[env(safe-area-inset-left)]",
        )}
      >
        {created && createdTemplate ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface p-6 max-[620px]:justify-start max-[620px]:p-[20px_12px]">
            <div className="m-auto flex w-full max-w-[900px] flex-col items-center text-center max-[620px]:m-0">
              <span className="mb-2.5 grid h-[54px] w-[54px] place-items-center rounded-full border border-success/30 bg-success/15 text-success">
                <Check aria-hidden className="h-[25px] w-[25px]" />
              </span>
              <p className="mb-1 text-ui-micro font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {t("board.templatePicker.createdEyebrow")}
              </p>
              <DialogTitle
                ref={successTitleRef}
                tabIndex={-1}
                className="mb-0.5 text-2xl font-semibold tracking-[-0.02em] text-foreground outline-none"
              >
                {t("board.templatePicker.createdTitle")}
              </DialogTitle>
              <p className="mb-1 max-w-[620px] text-base font-semibold tracking-[-0.01em] text-foreground max-[620px]:text-[14px]">
                {created.name}
              </p>
              <DialogDescription className="max-w-[520px] text-ui-body text-muted-foreground">
                {createdTemplate.copy[locale].long}
              </DialogDescription>
              <TemplateStats template={createdTemplate} className="my-3" />
              <div className="w-full text-left">
                <TemplateMiniBoard
                  template={createdTemplate}
                  locale={locale}
                  templateDate={templateDate}
                  templateUtcOffsetMinutes={templateUtcOffsetMinutes}
                />
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 max-[620px]:w-full">
                <button
                  type="button"
                  data-testid="template-open-board"
                  onClick={openCreatedBoard}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-action-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface max-[620px]:flex-1"
                >
                  <ArrowRight aria-hidden className="h-4 w-4" />
                  {t("board.templatePicker.openBoard")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 pb-3 pt-[17px] max-[620px]:px-[13px] max-[620px]:pb-2.5 max-[620px]:pt-[13px]">
              <div className="min-w-0">
                <p className="mb-1 inline-flex items-center gap-[7px] text-ui-micro font-bold uppercase leading-[1.4] tracking-[0.08em] text-(--tab-text)">
                  <span
                    aria-hidden
                    className="h-px w-4 bg-current opacity-70"
                  />
                  {t("board.templatePicker.eyebrow")}
                </p>
                <DialogTitle className="text-[19px] font-semibold leading-[1.14] tracking-[-0.02em] text-foreground max-[620px]:text-[17px]">
                  {t("board.templatePicker.title")}
                </DialogTitle>
                <DialogDescription className="mt-[3px] text-ui-body leading-[1.4] text-muted-foreground">
                  {t("board.templatePicker.subtitle")}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                aria-label={t("board.templatePicker.close")}
                title={t("board.templatePicker.close")}
                className="grid h-[31px] w-[31px] shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50 max-[1024.98px]:h-11 max-[1024.98px]:w-11"
              >
                <X aria-hidden className="h-[15px] w-[15px]" />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] max-[900px]:grid-rows-[auto_minmax(0,1fr)] min-[901px]:grid-cols-[338px_minmax(0,1fr)] min-[901px]:grid-rows-1">
              <aside className="flex min-h-0 min-w-0 flex-col border-b border-border bg-background/40 p-3 max-[900px]:border-b max-[900px]:p-2.5 max-[620px]:p-2">
                <div className="flex items-center justify-between gap-2 px-[5px] pb-[9px] pt-[2px] text-ui-micro font-bold uppercase tracking-[0.09em] text-muted-foreground max-[900px]:pb-1.5">
                  <span>{t("board.templatePicker.examples")}</span>
                  <span className="font-medium normal-case tracking-normal">
                    {t("board.templatePicker.curated")}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label={t("board.templatePicker.examples")}
                  className="template-gallery flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5 max-[900px]:snap-x max-[900px]:snap-proximity max-[900px]:flex-row max-[900px]:overflow-x-auto max-[900px]:overflow-y-hidden max-[900px]:pb-1"
                >
                  {BOARD_TEMPLATES.map((item, index) => {
                    const selected = item.id === selectedId;
                    const itemCopy = item.copy[locale];
                    const itemCounts = boardTemplateCounts(item);
                    return (
                      <button
                        key={item.id}
                        ref={(element) => {
                          galleryButtons.current[index] = element;
                        }}
                        type="button"
                        aria-pressed={selected}
                        tabIndex={selected ? 0 : -1}
                        disabled={busy}
                        data-template-id={item.id}
                        onClick={() => selectTemplate(item)}
                        onKeyDown={(event) => onGalleryKeyDown(event, index)}
                        className={cn(
                          "grid w-full grid-cols-[32px_minmax(0,1fr)_17px] items-start gap-2 rounded-[9px] border px-2 py-2 text-left text-foreground transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60",
                          selected
                            ? "border-primary/45 bg-card shadow-sm ring-2 ring-primary/15"
                            : "border-transparent hover:bg-hover",
                          "max-[900px]:min-w-[248px] max-[900px]:max-w-[248px] max-[900px]:shrink-0 max-[900px]:snap-start max-[900px]:border-border max-[900px]:bg-card max-[900px]:p-2 max-[620px]:min-w-[216px] max-[620px]:max-w-[216px]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-[34px] w-[34px] place-items-center rounded-[9px] border max-[900px]:h-[30px] max-[900px]:w-[30px] max-[620px]:h-[28px] max-[620px]:w-[28px]",
                            templateAccentIconClass(item),
                          )}
                        >
                          <TemplateGlyph
                            template={item}
                            className="h-[17px] w-[17px]"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="text-ui-body font-semibold leading-[1.3] tracking-[-0.005em] max-[620px]:text-ui-label">
                              {itemCopy.name}
                            </span>
                            {item.id === "product-launch" ? (
                              <span className="rounded-[5px] bg-primary/15 px-1.5 py-0.5 text-ui-micro font-[650] leading-[1.4] text-(--tab-text)">
                                {t("board.templatePicker.recommended")}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 line-clamp-1 text-ui-label leading-[1.38] text-muted-foreground max-[900px]:line-clamp-2">
                            {itemCopy.short}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-[7px] gap-y-1 text-ui-meta leading-[1.3] text-muted-foreground">
                            <span>
                              {t("board.templatePicker.columns", {
                                count: itemCounts.columns,
                              })}
                            </span>
                            <span aria-hidden className="opacity-55">
                              ·
                            </span>
                            <span>
                              {t("board.templatePicker.cards", {
                                count: itemCounts.cards,
                              })}
                            </span>
                            <span aria-hidden className="opacity-55">
                              ·
                            </span>
                            <span className="min-w-0 overflow-hidden text-ellipsis">
                              {itemCopy.tags.join(" · ")}
                            </span>
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 grid h-[17px] w-[17px] place-items-center rounded-full border",
                            selected
                              ? "border-action-primary bg-action-primary text-primary-foreground"
                              : "border-muted-foreground/40 text-transparent",
                          )}
                        >
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <div className="relative min-h-0 min-w-0">
                <section
                  aria-label={`${t("board.templatePicker.preview")}: ${template.copy[locale].name}`}
                  tabIndex={0}
                  className="template-preview-scroll h-full min-w-0 overflow-y-auto overflow-x-hidden bg-surface pb-[22px] pl-5 pr-5 pt-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-[900px]:p-[15px_16px_18px] max-[620px]:p-3"
                >
                  <TemplatePreview
                    template={template}
                    locale={locale}
                    templateDate={templateDate}
                    templateUtcOffsetMinutes={templateUtcOffsetMinutes}
                  />
                </section>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-surface via-surface/70 to-transparent"
                />
              </div>
            </div>

            {error || versionSkew ? (
              <div
                role="alert"
                className="mx-5 mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-ui-body leading-[1.45] text-(--agent-tone-danger) max-[620px]:mx-3"
              >
                <span className="min-w-0 flex-1">
                  {error ||
                    (versionSkew ? t("board.templatePicker.versionSkew") : "")}
                </span>
                {versionSkew ? (
                  <button
                    type="button"
                    onClick={() => void createPlainBoard()}
                    disabled={busy}
                    className="inline-flex h-11 shrink-0 items-center rounded-md border border-current px-2.5 font-semibold transition-colors hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {t("board.templatePicker.createEmptyFallback")}
                  </button>
                ) : null}
              </div>
            ) : null}

            <footer className="flex shrink-0 flex-wrap items-end gap-3.5 border-t border-border bg-card px-[18px] py-3 max-[900px]:py-[9px] max-[620px]:gap-2 max-[620px]:p-[9px_11px]">
              <div className="min-w-0 flex-1 max-[620px]:basis-full">
                <div className="mb-1 flex items-center gap-1.5">
                  <label
                    htmlFor="template-board-name"
                    className="text-ui-label font-semibold text-foreground"
                  >
                    {t("board.templatePicker.nameLabel")}
                  </label>
                  <span
                    id="template-name-source"
                    className={cn(
                      "inline-flex items-center rounded-[4px] px-1.5 py-px text-ui-micro font-semibold leading-[1.4]",
                      nameMode === "manual"
                        ? "bg-warning/15 text-(--warning-strong-on-tint)"
                        : "bg-primary/15 text-(--tab-text)",
                    )}
                  >
                    {nameMode === "manual"
                      ? t("board.templatePicker.nameManual")
                      : t("board.templatePicker.nameAuto")}
                  </span>
                  <span
                    id="template-name-count"
                    aria-live="polite"
                    aria-atomic="true"
                    className="ml-auto text-ui-meta tabular-nums text-muted-foreground"
                  >
                    {effectiveName.length} / {LIMITS.boardTitle}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    ref={nameInputRef}
                    id="template-board-name"
                    name="board-title"
                    autoComplete="off"
                    maxLength={LIMITS.boardTitle}
                    value={displayName}
                    disabled={busy}
                    placeholder={generated.name}
                    aria-describedby="template-name-source template-name-hint template-name-count"
                    onChange={(event) => {
                      const value = event.target.value;
                      setNameValue(value);
                      setNameMode(value.trim().length > 0 ? "manual" : "empty");
                      setError("");
                      setVersionSkew(false);
                    }}
                    className="h-[37px] min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-ui-body text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-muted-foreground/40 focus:border-primary focus:ring-[3px] focus:ring-primary/20 disabled:opacity-60 max-[1024.98px]:h-11 max-[1024.98px]:text-base"
                  />
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={busy}
                    title={t("board.templatePicker.regenerate")}
                    aria-label={t("board.templatePicker.regenerate")}
                    className="inline-flex h-[37px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-ui-label font-[620] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50 max-[1024.98px]:h-11 max-[620px]:w-11 max-[620px]:px-0"
                  >
                    <RefreshCw aria-hidden className="h-3 w-3" />
                    <span className="max-[620px]:hidden">
                      {t("board.templatePicker.regenerate")}
                    </span>
                  </button>
                </div>
                <p
                  id="template-name-hint"
                  aria-live="polite"
                  className={cn(
                    "mt-1 text-ui-meta leading-[1.4] text-muted-foreground",
                    (duplicateManual || generated.truncated) &&
                      "text-(--warning-strong-on-tint)",
                  )}
                >
                  {displayName.trim().length === 0
                    ? t("board.templatePicker.nameHintEmpty")
                    : nameMode === "manual"
                      ? duplicateManual
                        ? t("board.templatePicker.nameHintManualDedupe")
                        : t("board.templatePicker.nameHintManual")
                      : generated.truncated
                        ? t("board.templatePicker.nameHintTruncated")
                        : generated.deduped
                          ? t("board.templatePicker.nameHintDedupe", {
                              index: generated.dedupeIndex,
                            })
                          : t("board.templatePicker.nameHintAuto")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 max-[620px]:w-full max-[620px]:justify-end">
                <button
                  type="button"
                  onClick={requestClose}
                  disabled={busy}
                  className="inline-flex h-[37px] items-center justify-center rounded-lg px-3.5 text-ui-body font-[650] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50 max-[1024.98px]:h-11 max-[620px]:flex-none"
                >
                  {t("board.templatePicker.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  aria-busy={busy || undefined}
                  data-testid="template-create-board"
                  className="inline-flex h-[37px] items-center justify-center gap-2 rounded-lg bg-action-primary px-6 text-ui-body font-[650] text-primary-foreground shadow-sm transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-80 max-[1024.98px]:h-11 max-[620px]:flex-1"
                >
                  {busy ? (
                    <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {busy
                      ? t("board.templatePicker.creating")
                      : t("board.templatePicker.create")}
                  </span>
                </button>
              </div>
            </footer>
          </>
        )}
        <p role="status" aria-live="polite" aria-atomic className="sr-only">
          {announcement}
        </p>
      </DialogContent>
    </Dialog>
  );
}
