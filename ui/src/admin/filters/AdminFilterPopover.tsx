import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAdminT } from "../admin-i18n";
import { listFilterError, type AdminListFilters } from "../admin-list-query";
import { Badge } from "../ui";
import { DraftFacetPicker, FilterFacetPicker } from "./FilterFacetPicker";
import {
  OFFERED_CARD_FILTERS,
  ATTACHMENT_CHOICES,
  DUE_CHOICES,
  removeCardFilter,
  selectedFilterValues,
  type CardFilterFacet,
  type CardFilterKey,
} from "./filter-registry";

import { FilterRadioGroup } from "./FilterRadioGroup";

const panelClass =
  "flex flex-col gap-0 border-border bg-popover p-0 text-popover-foreground";
const titleClass = "border-b border-border px-3 py-3 text-sm font-semibold";

export function AdminFilterPopover({
  triggerRef,
  filters,
  count,
  onChange,
}: {
  triggerRef: RefObject<HTMLButtonElement>;
  filters: AdminListFilters;
  count: number;
  onChange: (patch: Partial<AdminListFilters>) => void;
}) {
  const t = useAdminT();
  const mobile = useMediaQuery("(max-width: 639px)");
  const [open, setOpen] = useState(false);
  const restoreFocus = useRef(false);
  const rememberFocusReturn = () => {
    restoreFocus.current = true;
  };
  const close = () => {
    rememberFocusReturn();
    setOpen(false);
  };
  const onCloseAutoFocus = (event: Event) => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    event.preventDefault();
    triggerRef.current?.focus();
  };
  const titleId = useId();
  const title = t("admin.filters.title");
  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="outline"
      size="sm"
      className="h-11 sm:h-8"
      aria-label={count > 0 ? `${t("admin.filters.open")} ${count}` : undefined}
    >
      <ListFilter aria-hidden />
      {t("admin.filters.open")}
      {count > 0 ? <Badge>{count}</Badge> : null}
    </Button>
  );
  const menu = (
    <FilterMenu
      filters={filters}
      onClose={close}
      onSelect={(patch) => {
        onChange(patch);
        close();
      }}
    />
  );
  if (mobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          hideClose
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={rememberFocusReturn}
          aria-modal="true"
          aria-describedby={undefined}
          className={`${panelClass} inset-x-0 top-auto bottom-0 m-0 max-h-[70dvh] w-full max-w-none rounded-t-xl pb-[env(safe-area-inset-bottom)]`}
        >
          <DialogTitle className={titleClass}>{title}</DialogTitle>
          {menu}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={rememberFocusReturn}
        aria-labelledby={titleId}
        className={`${panelClass} max-h-[var(--radix-popover-content-available-height)] w-80`}
      >
        <h2 id={titleId} className={titleClass}>
          {title}
        </h2>
        {menu}
      </PopoverContent>
    </Popover>
  );
}

function FilterMenu({
  filters,
  onClose,
  onSelect,
}: {
  filters: AdminListFilters;
  onClose: () => void;
  onSelect: (patch: Partial<AdminListFilters>) => void;
}) {
  const t = useAdminT();
  const [active, setActive] = useState<CardFilterFacet | null>(null);
  const [lastFacet, setLastFacet] = useState<CardFilterKey | null>(null);

  const [draft, setDraft] = useState(filters);
  const [limitError, setLimitError] = useState(false);
  const drafting = active?.kind === "multi";
  const updateDraft = (patch: Partial<AdminListFilters>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const apply = (patch: Partial<AdminListFilters>) => {
    const next = { ...filters, ...patch };
    if (patch.boardId !== undefined && patch.boardId !== filters.boardId) {
      next.columnId = next.labelId = next.cardId = null;
      delete next.labelMatch;
    }
    if (listFilterError(next, "cards")) {
      setLimitError(true);
      return;
    }
    onSelect(patch);
  };
  const draftChanges = drafting
    ? {
        [active.key]: draft[active.key],
        ...(active.key === "assigneeId"
          ? { unassigned: draft.unassigned }
          : {}),
        ...(active.key === "labelId" ? { labelMatch: draft.labelMatch } : {}),
      }
    : undefined;
  const draftError =
    draftChanges !== undefined &&
    listFilterError({ ...filters, ...draftChanges }, "cards") !== undefined;

  const renderFacet = (facet: CardFilterFacet): ReactNode => (
    <Button
      key={facet.key}
      type="button"
      variant="ghost"
      size="sm"
      className="h-11 w-full justify-between px-2 text-sm sm:h-8"
      autoFocus={lastFacet === facet.key}
      onClick={() => {
        setLastFacet(facet.key);
        setDraft(filters);
        setLimitError(false);
        setActive(facet);
      }}
    >
      {t(facet.label)}
      <ChevronRight aria-hidden />
    </Button>
  );

  return (
    <>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-2.5">
        {active ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mb-1 h-11 px-2 sm:h-8"
              aria-label={t("admin.filters.back", { facet: t(active.label) })}
              onClick={() => {
                setLimitError(false);
                setActive(null);
              }}
            >
              <ChevronLeft aria-hidden />
              {t(active.label)}
            </Button>
            {active.kind === "lookup" ? (
              <FilterFacetPicker
                key={active.key}
                facet={active}
                boardId={filters.boardId}
                value={selectedFilterValues(filters, active.key)[0] ?? null}
                onSelect={(id) => apply({ [active.key]: id })}
              />
            ) : active.kind === "multi" ? (
              <DraftFacetPicker
                key={active.key}
                facet={active}
                draft={draft}
                onChange={updateDraft}
              />
            ) : active.key === "due" ? (
              <FilterRadioGroup
                label={t("admin.filters.due.control")}
                options={[
                  t("admin.filters.any"),
                  ...DUE_CHOICES.map(({ label }) => t(label)),
                ]}
                selected={
                  DUE_CHOICES.findIndex(({ value }) => filters.due === value) +
                  1
                }
                onSelect={(index) =>
                  apply({ due: DUE_CHOICES[index - 1]?.value })
                }
              />
            ) : (
              <FilterRadioGroup
                label={t("admin.filters.attachments.control")}
                options={[
                  t("admin.filters.any"),
                  ...ATTACHMENT_CHOICES.map(({ label }) => t(label)),
                ]}
                selected={
                  ATTACHMENT_CHOICES.findIndex(
                    ({ value }) => filters.hasAttachments === value,
                  ) + 1
                }
                onSelect={(index) =>
                  apply({
                    hasAttachments: ATTACHMENT_CHOICES[index - 1]?.value,
                  })
                }
              />
            )}
          </>
        ) : (
          <>
            <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("admin.filters.scope")}
            </h3>
            {OFFERED_CARD_FILTERS.filter(({ kind }) => kind === "lookup").map(
              renderFacet,
            )}
            <h3 className="mt-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("admin.filters.people")}
            </h3>
            {OFFERED_CARD_FILTERS.filter(({ key }) => key === "assigneeId").map(
              renderFacet,
            )}
            <h3 className="mt-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("admin.filters.properties")}
            </h3>
            {OFFERED_CARD_FILTERS.filter(
              ({ kind, key }) => kind !== "lookup" && key !== "assigneeId",
            ).map(renderFacet)}
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-2">
        {draftError || limitError ? (
          <p role="status" className="mb-2 text-xs text-muted-foreground">
            {t("admin.filters.limit")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {drafting ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto h-11 sm:h-8"
              onClick={() =>
                updateDraft({
                  ...removeCardFilter(draft, active.key),
                  ...(active.key === "assigneeId"
                    ? { unassigned: undefined }
                    : {}),
                })
              }
            >
              {t("admin.common.clear")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            onClick={onClose}
          >
            {t(drafting ? "admin.common.cancel" : "admin.filters.close")}
          </Button>
          {drafting ? (
            <Button
              type="button"
              size="sm"
              className="h-11 sm:h-8"
              disabled={draftError}
              onClick={() => draftChanges && apply(draftChanges)}
            >
              {t("admin.filters.apply")}
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
