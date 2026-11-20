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
  FILTER_BAR_TITLES,
  offeredFilters,
  RADIO_FILTERS,
  type FilterBarSurface,
  removeListFilter,
  selectedFilterValues,
  type FilterFacet,
  type FilterKey,
} from "./filter-registry";

import { FilterRadioGroup } from "./FilterRadioGroup";

const panelClass =
  "flex flex-col gap-0 border-border bg-popover p-0 text-popover-foreground";
const titleClass = "border-b border-border px-3 py-3 text-sm font-semibold";

export function AdminFilterPopover({
  triggerRef,
  surface,
  filters,
  count,
  onChange,
}: {
  triggerRef: RefObject<HTMLButtonElement>;
  surface: FilterBarSurface;
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
  const title = t(FILTER_BAR_TITLES[surface]);
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
      surface={surface}
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
  surface,
  filters,
  onClose,
  onSelect,
}: {
  surface: FilterBarSurface;
  filters: AdminListFilters;
  onClose: () => void;
  onSelect: (patch: Partial<AdminListFilters>) => void;
}) {
  const t = useAdminT();
  const [active, setActive] = useState<FilterFacet | null>(null);
  const [lastFacet, setLastFacet] = useState<FilterKey | null>(null);

  const [draft, setDraft] = useState(filters);
  const [limitError, setLimitError] = useState(false);
  const drafting = active?.kind === "multi";
  const radio =
    active?.kind === "radio" ? RADIO_FILTERS[active.key] : undefined;
  const facets = offeredFilters(surface);
  const groups = [
    {
      label: "admin.filters.scope",
      facets: facets.filter(
        (facet) =>
          "type" in facet && facet.type !== "user" && facet.kind === "lookup",
      ),
    },
    {
      label: "admin.filters.people",
      facets: facets.filter(
        (facet) => "type" in facet && facet.type === "user",
      ),
    },
    {
      label: "admin.filters.properties",
      facets: facets.filter(
        ({ kind, key }) => kind !== "lookup" && key !== "assigneeId",
      ),
    },
  ] as const;
  const updateDraft = (patch: Partial<AdminListFilters>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const apply = (patch: Partial<AdminListFilters>) => {
    const next = { ...filters, ...patch };
    if (patch.boardId !== undefined && patch.boardId !== filters.boardId) {
      next.columnId = next.labelId = next.cardId = null;
      delete next.labelMatch;
    }
    if (listFilterError(next, surface)) {
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
    listFilterError({ ...filters, ...draftChanges }, surface) !== undefined;

  const renderFacet = (facet: FilterFacet): ReactNode => (
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
            ) : radio ? (
              <FilterRadioGroup
                label={t(radio.label)}
                options={[
                  t("admin.filters.any"),
                  ...radio.choices.map(({ label }) => t(label)),
                ]}
                selected={
                  radio.choices.findIndex(
                    ({ value }) => filters[active.key] === value,
                  ) + 1
                }
                onSelect={(index) =>
                  apply({ [active.key]: radio.choices[index - 1]?.value })
                }
              />
            ) : null}
          </>
        ) : (
          groups
            .filter(({ facets }) => facets.length > 0)
            .map(({ label, facets }) => (
              <div key={label} className="mt-2 first:mt-0">
                <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {t(label)}
                </h3>
                {facets.map(renderFacet)}
              </div>
            ))
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
                  ...removeListFilter(draft, active.key),
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
