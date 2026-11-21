import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Info, Paintbrush, X } from "lucide-react";
import {
  CARD_PRIORITIES,
  COVER_COLORS,
  COVER_COLOR_CSS,
  COVER_GRADIENTS,
  COVER_GRADIENT_CSS,
  DEFAULT_CARD_PRIORITY,
  LIMITS,
  coverBackground,
  type BoardAction,
  type CardCover,
  type CardPriority,
  type CoverColor,
  type CoverGradient,
} from "@janosik/shared";
import type {
  AdminBoardDetailDto,
  AdminBoardMemberRowDto,
  AdminCardDetailDto,
} from "@janosik/shared";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { CalendarComponent } from "@/components/ui/calendar-lazy";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/Toast";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { createId } from "@/utils/id";
import { COVER_COLOR_KEYS, COVER_GRADIENT_KEYS } from "@/utils/palette-keys";
import { PRIORITY_META, priorityLabel } from "@/utils/priority";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import {
  DateTimeField,
  type CalendarFallbackState,
} from "./announcements/DateTimeField";
import { LabelChip } from "./cells";
import { CharCount, Field, OwnerAttributionNotice, Panel } from "./ui";

/**
 * TASK-176.9 (B1) — admin-native editing of the card's scalar fields.
 *
 * The normal board editors require `BoardContext`, which `/admin/*` never
 * mounts, so this panel reuses their data/constants/presentation only and
 * sends one fresh command per field. Each command gets its own `commandId`;
 * unchanged values are suppressed before the wire so they cannot create an
 * empty command/audit row.
 */

type FieldKey = "title" | "assignee" | "due" | "priority" | "cover" | "labels";

/** One keyed label-success toast per card (TASK-182.1). */
function labelToastKey(cardId: string): string {
  return `admin.card.labels:${cardId}`;
}

type CardFieldAction =
  | { type: "UPDATE_CARD"; title: string }
  | { type: "SET_CARD_ASSIGN"; assigneeId: string | null }
  | { type: "SET_CARD_DUE_DATE"; dueDate?: number }
  | { type: "SET_CARD_PRIORITY"; priority: CardPriority }
  | {
      type: "SET_CARD_COVER";
      cover?:
        | { type: "color"; value: CoverColor }
        | {
            type: "gradient";
            value: CoverGradient;
          };
    }
  | { type: "SET_CARD_LABEL"; labelId: string; on: boolean };

/** Epoch ms → `datetime-local` value (`YYYY-MM-DDTHH:MM`), "" when null. */
function toLocalInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value → epoch ms; "" or an invalid value → null. */
function fromLocalInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

/**
 * The control exposes minute precision, so a persisted second/millisecond
 * must not make an untouched field look dirty (TASK-176.9 review B1).
 */
function sameMinute(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.floor(a / 60_000) === Math.floor(b / 60_000);
}

/** Narrow the admin DTO's `coverType`/`coverValue` strings to `CardCover`. */
function readCover(card: AdminCardDetailDto["card"]): CardCover | undefined {
  const value = card.coverValue;
  if (card.coverType === "color" && value !== null) {
    if ((COVER_COLORS as readonly string[]).includes(value)) {
      return { type: "color", value: value as CoverColor };
    }
  }
  if (card.coverType === "gradient" && value !== null) {
    if ((COVER_GRADIENTS as readonly string[]).includes(value)) {
      return { type: "gradient", value: value as CoverGradient };
    }
  }
  return undefined;
}

/** Keep an unknown persisted value from crashing the priority picker. */
function readPriority(value: string | null): CardPriority {
  return (CARD_PRIORITIES as readonly string[]).includes(value ?? "")
    ? (value as CardPriority)
    : DEFAULT_CARD_PRIORITY;
}

function memberLabel(member: AdminBoardMemberRowDto): string {
  return member.userDisplayName ?? member.userEmail;
}

/** Avoid the duplicate `email · email` option when a name is missing. */
function memberOptionLabel(member: AdminBoardMemberRowDto): string {
  const name = member.userDisplayName?.trim();
  return name ? `${name} · ${member.userEmail}` : member.userEmail;
}

function memberActive(member: AdminBoardMemberRowDto): boolean {
  return (
    member.acceptedAt !== null &&
    (member.expiresAt === null || member.expiresAt > Date.now())
  );
}

function CardCalendarFallback({
  value,
  onChange,
  retry,
}: CalendarFallbackState) {
  const t = useAdminT();
  const inputId = useId();
  const retryButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryButton.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="w-72 max-w-full space-y-2">
      <p role="alert" className="text-xs text-danger">
        {t("admin.cards.fields.calendarFailed")}
      </p>
      <Button
        ref={retryButton}
        type="button"
        variant="outline"
        size="sm"
        onClick={retry}
      >
        {t("admin.cards.fields.calendarRetry")}
      </Button>
      <Field
        htmlFor={inputId}
        label={t("admin.cards.fields.calendarFallbackLabel")}
      >
        <Input
          id={inputId}
          type="datetime-local"
          className="min-w-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </div>
  );
}

function LabelsHelp() {
  const t = useAdminT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          aria-label={t("admin.cards.fields.labelsHelp")}
          data-testid="admin-card-labels-help"
        >
          <Info aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] text-xs"
      >
        <p className="font-medium">{t("admin.cards.fields.labelsHelp")}</p>
        <p className="mt-1 text-muted-foreground">
          {t("admin.cards.fields.labelsHelpBody")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function CardFieldsPanel({
  card,
  cardLabels,
  onSaved,
  calendarLoader,
}: {
  card: AdminCardDetailDto["card"];
  /** Labels currently attached to the card, as served by the detail DTO. */
  cardLabels: AdminCardDetailDto["labels"];
  onSaved: () => void;
  calendarLoader?: () => Promise<{ Calendar: CalendarComponent }>;
}) {
  const t = useAdminT();
  const toast = useToast();
  const { t: tApp, lang } = useI18n();
  const hour12 = useHour12();

  const [board, setBoard] = useState<AdminBoardDetailDto | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [boardReloadKey, setBoardReloadKey] = useState(0);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [assigneeDraft, setAssigneeDraft] = useState(card.assigneeId ?? "");
  const [dueDraft, setDueDraft] = useState(() => toLocalInput(card.dueDate));
  const [priorityDraft, setPriorityDraft] = useState<CardPriority>(() =>
    readPriority(card.priority),
  );
  const [coverOpen, setCoverOpen] = useState(false);
  const [busy, setBusy] = useState<FieldKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const mountedRef = useRef(true);
  const cardIdRef = useRef(card.id);
  cardIdRef.current = card.id;

  // A label success toast belongs to one card. Clear it when the panel leaves
  // the card; the parent also keys this panel by card id (TASK-182.1).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      toast.clear(labelToastKey(card.id));
    };
  }, [card.id, toast]);

  useEffect(() => {
    let active = true;
    setBoard(null);
    setBoardError(false);
    adminApi
      .boardDetail(card.boardId)
      .then((next) => {
        if (active) setBoard(next);
      })
      .catch(() => {
        if (active) setBoardError(true);
      });
    return () => {
      active = false;
    };
  }, [card.boardId, boardReloadKey]);

  useEffect(() => setTitleDraft(card.title), [card.title]);
  useEffect(() => setAssigneeDraft(card.assigneeId ?? ""), [card.assigneeId]);
  useEffect(() => setDueDraft(toLocalInput(card.dueDate)), [card.dueDate]);
  useEffect(
    () => setPriorityDraft(readPriority(card.priority)),
    [card.priority],
  );

  const members = useMemo(() => {
    const list = (board?.members ?? []).filter(memberActive);
    return [...list].sort((a, b) =>
      memberLabel(a).localeCompare(memberLabel(b)),
    );
  }, [board]);

  // Disabled users are hidden from new choices for UX (a current disabled
  // assignee stays visible as the selected fallback); the backend still
  // accepts an active membership whose user is disabled, so this is a
  // presentation choice, not a validation rule.
  const selectableMembers = useMemo(
    () => members.filter((member) => member.userDisabledAt === null),
    [members],
  );

  const assigneeOutsidePicker =
    card.assigneeId !== null &&
    (board === null ||
      !selectableMembers.some((member) => member.userId === card.assigneeId));

  const boardLabels = useMemo(
    () => (board?.labels ?? []).filter((label) => label.deletedAt === null),
    [board],
  );

  // Count only labels the board still offers: a soft-deleted relation cannot
  // be toggled here and must not make the live cap look full.
  const selectedLabelIds = useMemo(() => {
    const live = new Set(boardLabels.map((label) => label.id));
    return new Set(
      cardLabels.map((label) => label.id).filter((id) => live.has(id)),
    );
  }, [boardLabels, cardLabels]);
  const labelsAtCap = selectedLabelIds.size >= LIMITS.labelsPerCard;
  const currentCover = readCover(card);
  const effectivePriority = readPriority(card.priority);

  const clearError = (field: FieldKey) => {
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const errorText = (cause: unknown, field: FieldKey): string => {
    if (cause instanceof ApiError) {
      if (cause.status === 403) return t("admin.common.forbidden");
      if (cause.status === 404) {
        return t("admin.cards.fields.errorNotFound");
      }
      if (cause.status === 400) {
        return t("admin.cards.fields.errorInvalid");
      }
      if (cause.status === 409) {
        // The command layer reports collection caps as `conflict: "wip"`.
        // On the labels field that is the per-card cap, so give the exact
        // reason instead of a generic conflict (TASK-176.9 review).
        if (
          field === "labels" &&
          (cause.conflict === "wip" || /label/i.test(cause.messageText))
        ) {
          return t("admin.cards.fields.labelsLimit", {
            limit: LIMITS.labelsPerCard,
          });
        }
        return t("admin.cards.fields.errorConflict");
      }
      // Keep a useful English backend detail for English masters; the admin
      // dictionary stays localized and never shows raw English in RU.
      if (lang === "en" && cause.messageText) return cause.messageText;
    }
    return t("admin.common.actionFailed");
  };

  /** Send exactly one command and refresh the detail on success. */
  const send = async (
    field: FieldKey,
    action: CardFieldAction,
    successKey: AdminMessageKey,
    options?: { toastKey?: string },
  ): Promise<boolean> => {
    if (busy !== null) return false;
    const capturedCardId = card.id;
    const current = () =>
      mountedRef.current && cardIdRef.current === capturedCardId;
    setBusy(field);
    clearError(field);
    // Clear only after the busy guard passed and the request is starting; a
    // busy/cap refusal leaves the previous keyed toast untouched.
    if (options?.toastKey) toast.clear(options.toastKey);
    try {
      await adminApi.sendBoardCommand(card.boardId, {
        commandId: createId(),
        action: {
          ...action,
          cardId: capturedCardId,
          at: Date.now(),
        } as BoardAction,
      });
      if (!current()) return true;
      if (options?.toastKey) {
        toast.success(t(successKey), { key: options.toastKey });
      } else {
        toast.success(t(successKey));
      }
      onSaved();
      return true;
    } catch (cause) {
      if (current()) {
        if (options?.toastKey) toast.clear(options.toastKey);
        setErrors((previous) => ({
          ...previous,
          [field]: errorText(cause, field),
        }));
      }
      return false;
    } finally {
      if (current()) setBusy(null);
    }
  };

  const boardStatus = (section: "assignee" | "labels") => {
    if (boardError) {
      const errorId =
        section === "assignee"
          ? "admin-card-field-assignee-error"
          : "admin-card-fields-board-error";
      const retryId =
        section === "assignee"
          ? "admin-card-field-assignee-retry"
          : "admin-card-fields-board-retry";
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p
            role="alert"
            data-testid={errorId}
            className="text-[11px] text-danger"
          >
            {t("admin.cards.fields.boardFailed")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            data-testid={retryId}
            onClick={() => setBoardReloadKey((key) => key + 1)}
          >
            {t("admin.common.retry")}
          </Button>
        </div>
      );
    }
    if (board === null) {
      return (
        <p className="text-[11px] text-muted-foreground">
          {t("admin.cards.fields.boardLoading")}
        </p>
      );
    }
    return null;
  };

  const titleValidation =
    titleDraft.trim() === ""
      ? t("admin.cards.fields.titleBlank")
      : titleDraft.length > LIMITS.cardTitle
        ? t("admin.cards.fields.titleTooLong", { max: LIMITS.cardTitle })
        : null;
  const titleUnchanged = titleDraft.trim() === card.title.trim();

  const saveTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy !== null) return;
    if (titleValidation !== null) {
      setErrors((previous) => ({
        ...previous,
        title: titleValidation,
      }));
      return;
    }
    if (titleUnchanged) {
      clearError("title");
      return;
    }
    await send(
      "title",
      { type: "UPDATE_CARD", title: titleDraft.trim() },
      "admin.cards.toast.titleSaved",
    );
  };

  const changeAssignee = async (value: string) => {
    const assigneeId = value === "" ? null : value;
    setAssigneeDraft(value);
    if (assigneeId === card.assigneeId) {
      clearError("assignee");
      return;
    }
    const saved = await send(
      "assignee",
      { type: "SET_CARD_ASSIGN", assigneeId },
      "admin.cards.toast.assigneeSaved",
    );
    if (!saved) setAssigneeDraft(card.assigneeId ?? "");
  };

  const saveDue = async (value: number | null): Promise<boolean> => {
    if (sameMinute(value, card.dueDate)) {
      clearError("due");
      return true;
    }
    const action: CardFieldAction =
      value === null
        ? { type: "SET_CARD_DUE_DATE" }
        : { type: "SET_CARD_DUE_DATE", dueDate: value };
    const saved = await send(
      "due",
      action,
      value === null
        ? "admin.cards.toast.dueCleared"
        : "admin.cards.toast.dueSaved",
    );
    // A failed clear must not leave the picker saying "No due date" while
    // the saved-value line still shows a deadline (TASK-176.9 review).
    if (!saved && value === null) {
      setDueDraft(toLocalInput(card.dueDate));
    }
    return saved;
  };

  const submitDue = async () => {
    const parsed = fromLocalInput(dueDraft);
    if (dueDraft.trim() !== "" && parsed === null) {
      setErrors((previous) => ({
        ...previous,
        due: t("admin.cards.fields.dueInvalid"),
      }));
      return;
    }
    await saveDue(parsed);
  };

  const clearDue = async () => {
    setDueDraft("");
    await saveDue(null);
  };

  const changePriority = async (value: CardPriority) => {
    setPriorityDraft(value);
    if (value === effectivePriority) {
      clearError("priority");
      return;
    }
    const saved = await send(
      "priority",
      { type: "SET_CARD_PRIORITY", priority: value },
      "admin.cards.toast.prioritySaved",
    );
    if (!saved) setPriorityDraft(effectivePriority);
  };

  const setCover = async (
    cover:
      | { type: "color"; value: CoverColor }
      | {
          type: "gradient";
          value: CoverGradient;
        },
  ) => {
    setCoverOpen(false);
    if (
      currentCover?.type === cover.type &&
      currentCover.value === cover.value
    ) {
      clearError("cover");
      return;
    }
    await send(
      "cover",
      { type: "SET_CARD_COVER", cover },
      "admin.cards.toast.coverSaved",
    );
  };

  const clearCover = async () => {
    setCoverOpen(false);
    if (currentCover === undefined) {
      clearError("cover");
      return;
    }
    await send(
      "cover",
      { type: "SET_CARD_COVER" },
      "admin.cards.toast.coverCleared",
    );
  };

  const toggleLabel = async (labelId: string) => {
    const on = !selectedLabelIds.has(labelId);
    if (on && labelsAtCap) return;
    await send(
      "labels",
      { type: "SET_CARD_LABEL", labelId, on },
      "admin.cards.toast.labelSaved",
      { toastKey: labelToastKey(card.id) },
    );
  };

  const currentPriorityMeta = PRIORITY_META[priorityDraft];
  const PriorityIcon = currentPriorityMeta.icon;

  return (
    <Panel className="space-y-3 p-3" data-testid="admin-card-fields">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("admin.cards.fields.title")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("admin.cards.fields.hint")}
        </p>
      </div>
      <OwnerAttributionNotice testId="admin-card-field-owner-notice" />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <form
          noValidate
          onSubmit={saveTitle}
          className="space-y-1 md:col-span-2 xl:col-span-3"
          data-testid="admin-card-edit-title"
        >
          <Field
            htmlFor="admin-card-title"
            label={t("admin.cards.fields.titleLabel")}
            counter={<CharCount value={titleDraft} max={LIMITS.cardTitle} />}
          >
            <div className="flex gap-2">
              <Input
                id="admin-card-title"
                data-testid="admin-card-title-input"
                className="min-w-0"
                value={titleDraft}
                maxLength={LIMITS.cardTitle}
                disabled={busy !== null}
                onChange={(event) => {
                  setTitleDraft(event.target.value);
                  clearError("title");
                }}
              />
              <Button
                size="sm"
                type="submit"
                className="shrink-0"
                data-testid="admin-card-title-save"
                disabled={
                  busy !== null || titleValidation !== null || titleUnchanged
                }
              >
                {t("admin.cards.fields.titleSave")}
              </Button>
            </div>
          </Field>
          {titleValidation !== null || errors.title !== undefined ? (
            <p
              role="alert"
              data-testid="admin-card-title-error"
              className="text-xs text-danger"
            >
              {titleValidation ?? errors.title}
            </p>
          ) : null}
        </form>

        <div data-testid="admin-card-field-assignee">
          <Field
            htmlFor="admin-card-assignee"
            label={t("admin.cards.fields.assignee")}
            error={errors.assignee}
          >
            {boardStatus("assignee")}
            <select
              id="admin-card-assignee"
              data-testid="admin-card-field-assignee-select"
              value={assigneeDraft}
              disabled={busy !== null || board === null}
              onChange={(event) => void changeAssignee(event.target.value)}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {t("admin.cards.fields.assigneeUnassigned")}
              </option>
              {selectableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {memberOptionLabel(member)}
                </option>
              ))}
              {assigneeOutsidePicker ? (
                <option value={card.assigneeId ?? ""}>
                  {card.assigneeDisplayName ??
                    card.assigneeEmail ??
                    card.assigneeId}
                  {board === null
                    ? ""
                    : ` · ${t("admin.cards.fields.assigneeInactive")}`}
                </option>
              ) : null}
            </select>
          </Field>
        </div>

        <div data-testid="admin-card-field-due">
          <Field label={t("admin.cards.fields.due")} error={errors.due}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <DateTimeField
                  value={dueDraft}
                  onChange={(value) => {
                    setDueDraft(value);
                    clearError("due");
                  }}
                  disabled={busy !== null}
                  testId="admin-card-due-input"
                  ariaLabel={t("admin.cards.fields.due")}
                  placeholder={t("admin.cards.fields.duePlaceholder")}
                  clearLabel={t("admin.cards.fields.dueClearDraft")}
                  timeLabel={t("admin.cards.fields.dueTime")}
                  calendarLoader={calendarLoader}
                  calendarFallback={CardCalendarFallback}
                />
              </div>
              <Button
                size="sm"
                type="button"
                data-testid="admin-card-due-save"
                disabled={
                  busy !== null ||
                  sameMinute(fromLocalInput(dueDraft), card.dueDate)
                }
                onClick={() => void submitDue()}
              >
                {t("admin.cards.fields.dueSave")}
              </Button>
              {card.dueDate !== null ? (
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  data-testid="admin-card-due-remove"
                  disabled={busy !== null}
                  onClick={() => void clearDue()}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.cards.fields.dueClear")}
                </Button>
              ) : null}
            </div>
            {card.dueDate !== null ? (
              <p className="text-[11px] text-muted-foreground">
                {t("admin.cards.fields.dueCurrent", {
                  value: formatDate(card.dueDate, lang, hour12),
                })}
              </p>
            ) : null}
          </Field>
        </div>

        <div data-testid="admin-card-field-priority">
          <Field
            htmlFor="admin-card-priority"
            label={t("admin.cards.fields.priority")}
            error={errors.priority}
          >
            <div className="flex items-center gap-2">
              <PriorityIcon
                className={cn(
                  "h-4 w-4 shrink-0",
                  currentPriorityMeta.iconClass,
                )}
                aria-hidden
              />
              <select
                id="admin-card-priority"
                data-testid="admin-card-field-priority-select"
                value={priorityDraft}
                disabled={busy !== null}
                onChange={(event) =>
                  void changePriority(event.target.value as CardPriority)
                }
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {CARD_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority, lang)}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>

        <div data-testid="admin-card-field-cover">
          <Field label={t("admin.cards.fields.cover")} error={errors.cover}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                data-testid="admin-card-cover-current"
                className="h-8 w-12 shrink-0 rounded-md border border-border"
                style={{
                  background: currentCover
                    ? coverBackground(currentCover)
                    : "transparent",
                }}
              />
              <Popover open={coverOpen} onOpenChange={setCoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="admin-card-cover-trigger"
                    aria-label={
                      currentCover
                        ? t("admin.cards.fields.coverChange")
                        : t("admin.cards.fields.coverSet")
                    }
                    disabled={busy !== null}
                  >
                    <Paintbrush className="h-3.5 w-3.5" aria-hidden />
                    {currentCover
                      ? t("admin.cards.fields.coverChange")
                      : t("admin.cards.fields.coverSet")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {tApp("card.coverColors")}
                    </p>
                    <div
                      role="radiogroup"
                      aria-label={tApp("card.coverColors")}
                      className="flex flex-wrap items-center gap-2 py-1"
                    >
                      {COVER_COLORS.map((color) => {
                        const selected =
                          currentCover?.type === "color" &&
                          currentCover.value === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={tApp(COVER_COLOR_KEYS[color])}
                            title={tApp(COVER_COLOR_KEYS[color])}
                            data-testid={`admin-card-cover-color-${color}`}
                            onClick={() =>
                              void setCover({ type: "color", value: color })
                            }
                            className={cn(
                              "flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110",
                              selected &&
                                "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                            )}
                            style={{ background: COVER_COLOR_CSS[color] }}
                          >
                            {selected ? (
                              <Check
                                className="h-3 w-3 text-white"
                                strokeWidth={3}
                                aria-hidden
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {tApp("card.coverGradients")}
                    </p>
                    <div
                      role="radiogroup"
                      aria-label={tApp("card.coverGradients")}
                      className="flex flex-wrap items-center gap-2 py-1"
                    >
                      {COVER_GRADIENTS.map((gradient) => {
                        const selected =
                          currentCover?.type === "gradient" &&
                          currentCover.value === gradient;
                        return (
                          <button
                            key={gradient}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={tApp(COVER_GRADIENT_KEYS[gradient])}
                            title={tApp(COVER_GRADIENT_KEYS[gradient])}
                            data-testid={`admin-card-cover-gradient-${gradient}`}
                            onClick={() =>
                              void setCover({
                                type: "gradient",
                                value: gradient,
                              })
                            }
                            className={cn(
                              "h-5 w-8 rounded-full transition-transform hover:scale-110",
                              selected &&
                                "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                            )}
                            style={{ background: COVER_GRADIENT_CSS[gradient] }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {currentCover ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                      data-testid="admin-card-cover-remove"
                      onClick={() => void clearCover()}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t("admin.cards.fields.coverRemove")}
                    </Button>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>
          </Field>
        </div>

        <div
          className="md:col-span-2 xl:col-span-3"
          data-testid="admin-card-field-labels"
        >
          <Field
            label={t("admin.cards.fields.labels")}
            labelAction={<LabelsHelp />}
            error={errors.labels}
          >
            {boardStatus("labels") ??
              (boardLabels.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("admin.cards.fields.noLabels")}
                </p>
              ) : (
                <div
                  role="group"
                  aria-label={t("admin.cards.fields.labels")}
                  className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5"
                >
                  {boardLabels.map((label) => {
                    const selected = selectedLabelIds.has(label.id);
                    const disabled =
                      busy !== null || (!selected && labelsAtCap);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        aria-pressed={selected}
                        data-testid={`admin-card-label-toggle-${label.id}`}
                        disabled={disabled}
                        title={label.name}
                        onClick={() => void toggleLabel(label.id)}
                        className={cn(
                          "min-w-0 max-w-full rounded-md border px-1 py-0.5 transition-colors",
                          selected
                            ? "border-foreground/40 bg-hover"
                            : "border-transparent hover:border-border",
                          disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <LabelChip
                          name={label.name}
                          color={label.color}
                          className="max-w-full"
                        />
                      </button>
                    );
                  })}
                </div>
              ))}
            {labelsAtCap ? (
              <p className="text-[11px] text-muted-foreground">
                {t("admin.cards.fields.labelsLimit", {
                  limit: LIMITS.labelsPerCard,
                })}
              </p>
            ) : null}
          </Field>
        </div>
      </div>
    </Panel>
  );
}
