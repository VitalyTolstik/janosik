import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { InspectorTabs } from "@/components/board/InspectorTabs";
import { PeoplePanel } from "@/components/board/PeoplePanel";
import {
  BOARD_INSPECTOR_ID,
  inspectorPanelId,
  inspectorTabId,
  useBoardInspector,
} from "@/hooks/use-board-inspector";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { RIGHT_PANEL_MAX, RIGHT_PANEL_MIN } from "@/utils/board-panel-storage";
import { isEditableTarget } from "@/utils/keyboard";
import { isOverlayOpen } from "@/utils/overlay";

import "./board-inspector.css";

const TITLE_ID = "board-inspector-title";

function ResizeHandle({
  width,
  defaultWidth,
  disabled,
  setWidth,
}: {
  width: number;
  defaultWidth: number;
  disabled: boolean;
  setWidth: (width: number) => void;
}) {
  const { t } = useI18n();
  const gesture = useRef<{
    pointerId: number;
    x: number;
    width: number;
  } | null>(null);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || event.pointerType === "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, x: event.clientX, width };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!disabled && drag?.pointerId === event.pointerId) {
      setWidth(drag.width + drag.x - event.clientX);
    }
  }

  function resize(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = event.shiftKey ? 64 : 16;
    switch (event.key) {
      case "ArrowLeft":
        setWidth(width + step);
        break;
      case "ArrowRight":
        setWidth(width - step);
        break;
      case "Home":
        setWidth(RIGHT_PANEL_MIN);
        break;
      case "End":
        setWidth(RIGHT_PANEL_MAX);
        break;
      case "Enter":
        setWidth(defaultWidth);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-label={t("inspector.resize")}
      aria-orientation="vertical"
      aria-valuemin={RIGHT_PANEL_MIN}
      aria-valuemax={RIGHT_PANEL_MAX}
      aria-valuenow={width}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className="inspector-separator"
      onKeyDown={resize}
      onDoubleClick={() => {
        if (!disabled) setWidth(defaultWidth);
      }}
      onPointerDown={start}
      onPointerMove={move}
      onLostPointerCapture={() => {
        gesture.current = null;
      }}
    />
  );
}

export function BoardInspector({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const panel = useBoardInspector();
  const docked = panel?.mode === "dock";
  const { open, focusOnOpen } = panel ?? {};
  useEffect(() => {
    if (docked && open) focusOnOpen?.();
  }, [docked, open, focusOnOpen]);
  if (!panel) return null;
  const { mode, cardOpen, dragging } = panel;

  const content = (
    <aside
      id={BOARD_INSPECTOR_ID}
      aria-labelledby={TITLE_ID}
      aria-modal={docked ? undefined : true}
      className="board-inspector"
      data-mode={mode}
      data-state={open ? "open" : "closed"}
      {...(cardOpen || !open ? { inert: "" } : {})}
      onKeyDown={(event) => {
        if (
          docked &&
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !isEditableTarget(event.target) &&
          !dragging &&
          !cardOpen &&
          !isOverlayOpen()
        ) {
          event.preventDefault();
          event.stopPropagation();
          panel.close();
        }
      }}
    >
      {docked && open ? (
        <ResizeHandle
          width={panel.width}
          defaultWidth={panel.defaultWidth}
          disabled={dragging}
          setWidth={panel.setWidth}
        />
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        {docked ? (
          <h2 id={TITLE_ID} className="text-ui-title font-semibold">
            {t("inspector.title")}
          </h2>
        ) : (
          <Dialog.Title asChild id={TITLE_ID}>
            <h2 className="text-ui-title font-semibold">
              {t("inspector.title")}
            </h2>
          </Dialog.Title>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("inspector.close")}
          className="inspector-control"
          disabled={dragging}
          onClick={() => panel.close()}
        >
          <X aria-hidden />
        </Button>
      </div>
      <InspectorTabs
        tab={panel.tab}
        onChange={panel.setTab}
        tabRef={panel.tabRef}
      />
      <div
        id={inspectorPanelId(panel.tab)}
        role="tabpanel"
        aria-labelledby={inspectorTabId(panel.tab)}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {open ? <PeoplePanel boardId={boardId} /> : null}
      </div>
    </aside>
  );

  if (docked) {
    return (
      <div
        className="inspector-dock"
        style={{ "--inspector-width": `${panel.width}px` } as CSSProperties}
        data-open={open}
      >
        {content}
      </div>
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) panel.close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="inspector-scrim" />
        <Dialog.Content
          asChild
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.target instanceof HTMLElement)
              panel.focusOnOpen(event.target);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!cardOpen) panel.triggerRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (dragging || cardOpen || isEditableTarget(event.target))
              event.preventDefault();
          }}
        >
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
