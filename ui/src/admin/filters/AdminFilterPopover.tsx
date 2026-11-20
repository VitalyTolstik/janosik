import { useId, useState, type ReactNode, type RefObject } from "react";
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
import type { AdminListFilters } from "../admin-list-query";
import { Badge } from "../ui";
import { FilterFacetPicker } from "./FilterFacetPicker";
import {
  OFFERED_CARD_FILTERS,
  cardFilterValue,
  type CardFilterFacet,
  type CardFilterKey,
} from "./filter-registry";

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
  onChange: (key: CardFilterKey, id: string) => void;
}) {
  const t = useAdminT();
  const mobile = useMediaQuery("(max-width: 639px)");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const title = t("admin.filters.title");
  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="outline"
      size="sm"
      className="h-11 sm:h-8"
    >
      <ListFilter aria-hidden />
      {t("admin.filters.open")}
      {count > 0 ? <Badge>{count}</Badge> : null}
    </Button>
  );
  const menu = (
    <FilterMenu
      filters={filters}
      onClose={() => setOpen(false)}
      onSelect={(key, id) => {
        onChange(key, id);
        setOpen(false);
      }}
    />
  );
  if (mobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          hideClose
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
  onSelect: (key: CardFilterKey, id: string) => void;
}) {
  const t = useAdminT();
  const [active, setActive] = useState<CardFilterFacet | null>(null);
  const [lastFacet, setLastFacet] = useState<CardFilterKey | null>(null);

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
              onClick={() => setActive(null)}
            >
              <ChevronLeft aria-hidden />
              {t(active.label)}
            </Button>
            <FilterFacetPicker
              key={active.key}
              facet={active}
              boardId={filters.boardId}
              value={cardFilterValue(filters, active.key)}
              onSelect={(id) => onSelect(active.key, id)}
            />
          </>
        ) : (
          <>
            <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("admin.filters.scope")}
            </h3>
            {OFFERED_CARD_FILTERS.filter(({ key }) => key !== "labelId").map(
              renderFacet,
            )}
            <h3 className="mt-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("admin.filters.properties")}
            </h3>
            {OFFERED_CARD_FILTERS.filter(({ key }) => key === "labelId").map(
              renderFacet,
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 sm:h-8"
          onClick={onClose}
        >
          {t("admin.filters.close")}
        </Button>
      </div>
    </>
  );
}
