import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

interface UseTouchDragOptions {
  /** CSS selector every drop target must match. */
  targetSelector: string;
  /** Attribute on the target that carries its drop key (card id, day key…). */
  targetKeyAttribute?: string;
  /** Elements inside the draggable that keep their own gestures (buttons,
   *  inputs). A press that starts there never begins a drag. */
  ignoreSelector?: string;
  /** A press shorter than this is a tap/scroll, not a drag. */
  delay?: number;
  /** A finger that moved further than this before the delay is scrolling. */
  tolerance?: number;
  /** Gesture is off (mouse-only build, VIEWER, active filter). */
  disabled?: boolean;
  /** Fires when the long press wins and the drag becomes active. */
  onStart?: (payload: string) => void;
  /** Fires whenever the finger enters/leaves a drop target. */
  onOverChange?: (key: string | null) => void;
  /** Fires on release over a target. */
  onDrop: (payload: string, key: string) => void;
  /** Fires when an active drag ends without a target. */
  onCancel?: (payload: string) => void;
}

/** Live pointer gesture. Kept in a ref: pointer events outrun React state. */
interface TouchDragSession {
  payload: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  /** The finger actually moved after the drag activated. */
  moved: boolean;
  /** The pointer is captured to the body so a virtualized source can unmount. */
  captured: boolean;
  timer: number | null;
  frame: number | null;
  /** Scroll containers resolved from the element under the finger. */
  scrollX: HTMLElement | null;
  scrollY: HTMLElement | null;
}

const DEFAULT_TARGET_KEY_ATTRIBUTE = "data-drop-key";
const DEFAULT_DELAY = 220;
const DEFAULT_TOLERANCE = 8;
/** After a drop the browser may still synthesize a click; swallow it for
 *  this long at most, so a genuinely new tap is never eaten. */
const CLICK_SUPPRESS_MS = 400;
/** Pointer distance from a scroll container edge that starts auto-scroll. */
const AUTO_SCROLL_EDGE = 48;
/** Maximum auto-scroll step per 60 Hz frame, in CSS pixels. */
const AUTO_SCROLL_MAX_STEP = 14;
/** Longest frame delta auto-scroll compensates for, in milliseconds. A
 *  stalled animation frame (busy main thread, background tab) must not slow
 *  the gesture down: the scroll speed stays px-per-time, not px-per-frame. */
const AUTO_SCROLL_MAX_FRAME_MS = 250;

/** Nearest scrollable ancestor (or self) on `axis`, or the document scroller. */
function scrollParentFor(
  element: Element,
  axis: "x" | "y",
): HTMLElement | null {
  let node: HTMLElement | null = element as HTMLElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    const client = axis === "x" ? node.clientWidth : node.clientHeight;
    const scroll = axis === "x" ? node.scrollWidth : node.scrollHeight;
    if (/(auto|scroll)/.test(overflow) && scroll > client + 1) return node;
    node = node.parentElement;
  }
  const root = document.scrollingElement as HTMLElement | null;
  if (!root) return null;
  const client = axis === "x" ? root.clientWidth : root.clientHeight;
  const scroll = axis === "x" ? root.scrollWidth : root.scrollHeight;
  return scroll > client + 1 ? root : null;
}

/**
 * Scroll container under the finger, preferring the drop target's ancestor:
 * an unscheduled chip is dragged over the grid, so the *source* panel must
 * not trap the auto-scroll. Falls back to the element actually hit.
 */
function scrollParentAt(
  x: number,
  y: number,
  axis: "x" | "y",
  targetSelector: string,
): HTMLElement | null {
  if (typeof document.elementFromPoint !== "function") return null;
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element)) return null;
  const target = hit.closest<HTMLElement>(targetSelector) ?? hit;
  return scrollParentFor(target, axis);
}

/** Signed scroll step for a point near one edge of `container`, or 0. */
function autoScrollStep(
  container: HTMLElement,
  axis: "x" | "y",
  point: number,
): number {
  const rect = container.getBoundingClientRect();
  const start = axis === "x" ? rect.left : rect.top;
  const end = axis === "x" ? rect.right : rect.bottom;
  if (point < start || point > end) return 0;
  const fromStart = point - start;
  const fromEnd = end - point;
  if (fromStart < AUTO_SCROLL_EDGE) {
    return -Math.ceil(
      ((AUTO_SCROLL_EDGE - fromStart) / AUTO_SCROLL_EDGE) *
        AUTO_SCROLL_MAX_STEP,
    );
  }
  if (fromEnd < AUTO_SCROLL_EDGE) {
    return Math.ceil(
      ((AUTO_SCROLL_EDGE - fromEnd) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX_STEP,
    );
  }
  return 0;
}

/**
 * Long-press drag for surfaces that cannot use HTML5 drag & drop on touch
 * (TASK-31): calendar chips and table rows.
 *
 * The gesture follows the board's dnd-kit TouchSensor (TASK-21.10):
 *
 * - a press that moves beyond `tolerance` before `delay` is a scroll — the
 *   browser keeps the gesture, so the grid/column scrolls normally;
 * - a press held still for `delay` lifts the item; from that point the native
 *   `touchmove` is cancelled (non-passive listener, bound only for the live
 *   session), so the finger drags the chip instead of scrolling;
 * - a press released without moving after activation is still a tap: the
 *   click is not swallowed (a slow tap must open the card);
 * - while the finger sits near an edge of the nearest scroll container, a
 *   requestAnimationFrame loop scrolls it, so days/rows outside the initial
 *   viewport stay reachable;
 * - a second finger cancels the drag instead of dropping on an arbitrary
 *   target;
 * - mouse pointers are ignored — the desktop keeps its HTML5/dnd-kit paths;
 * - the click the browser synthesizes after a real drop is swallowed once.
 *
 * Drop targets are resolved from `document.elementFromPoint`, which keeps the
 * hit test correct over nested chips/labels: the closest ancestor matching
 * `targetSelector` wins. A release that misses every target cancels — the
 * last hovered target is never reused.
 */
export function useTouchDrag({
  targetSelector,
  targetKeyAttribute = DEFAULT_TARGET_KEY_ATTRIBUTE,
  ignoreSelector,
  delay = DEFAULT_DELAY,
  tolerance = DEFAULT_TOLERANCE,
  disabled = false,
  onStart,
  onOverChange,
  onDrop,
  onCancel,
}: UseTouchDragOptions) {
  /** Payload of the active drag (null while idle). */
  const [activePayload, setActivePayload] = useState<string | null>(null);
  /** Key of the target currently under the finger. */
  const [overKey, setOverKey] = useState<string | null>(null);

  const sessionRef = useRef<TouchDragSession | null>(null);
  const overKeyRef = useRef<string | null>(null);
  const clickSwallowRef = useRef<(() => void) | null>(null);
  const touchHandlersRef = useRef<{
    start: (event: TouchEvent) => void;
    move: (event: TouchEvent) => void;
  } | null>(null);

  // Latest options without re-creating the window listeners on every render.
  const optionsRef = useRef({
    targetSelector,
    targetKeyAttribute,
    ignoreSelector,
    delay,
    tolerance,
    disabled,
    onStart,
    onOverChange,
    onDrop,
    onCancel,
  });
  useEffect(() => {
    optionsRef.current = {
      targetSelector,
      targetKeyAttribute,
      ignoreSelector,
      delay,
      tolerance,
      disabled,
      onStart,
      onOverChange,
      onDrop,
      onCancel,
    };
  });

  const setOver = useCallback((next: string | null) => {
    if (overKeyRef.current === next) return;
    overKeyRef.current = next;
    setOverKey(next);
    optionsRef.current.onOverChange?.(next);
  }, []);

  const resolveTarget = useCallback((x: number, y: number) => {
    const options = optionsRef.current;
    if (typeof document.elementFromPoint !== "function") return null;
    const element = document.elementFromPoint(x, y);
    if (!(element instanceof Element)) return null;
    return element.closest<HTMLElement>(options.targetSelector);
  }, []);

  const targetKeyOf = useCallback((target: HTMLElement | null) => {
    if (!target) return null;
    return target.getAttribute(optionsRef.current.targetKeyAttribute);
  }, []);

  const clearTimer = useCallback(() => {
    const session = sessionRef.current;
    if (session?.timer !== null && session?.timer !== undefined) {
      window.clearTimeout(session.timer);
      session.timer = null;
    }
  }, []);

  const unbindTouchListeners = useCallback(() => {
    const handlers = touchHandlersRef.current;
    if (!handlers) return;
    window.removeEventListener("touchstart", handlers.start);
    window.removeEventListener("touchmove", handlers.move);
    touchHandlersRef.current = null;
  }, []);

  const clearFrame = useCallback(() => {
    const session = sessionRef.current;
    if (session?.frame !== null && session?.frame !== undefined) {
      window.cancelAnimationFrame(session.frame);
      session.frame = null;
    }
  }, []);

  /** Tears the gesture down and clears every visible trace of it. */
  const resetSession = useCallback(() => {
    const session = sessionRef.current;
    if (session?.captured) {
      try {
        if (document.body.hasPointerCapture(session.pointerId)) {
          document.body.releasePointerCapture(session.pointerId);
        }
      } catch {
        /* already released by the browser */
      }
    }
    clearTimer();
    clearFrame();
    unbindTouchListeners();
    sessionRef.current = null;
    document.body.classList.remove("janosik-touch-dragging");
    setActivePayload(null);
    setOver(null);
  }, [clearFrame, clearTimer, setOver, unbindTouchListeners]);

  const swallowNextClick = useCallback(() => {
    clickSwallowRef.current?.();
    let timer = 0;
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    const finish = () => {
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("pointerdown", onNextPointerDown, true);
      window.clearTimeout(timer);
      if (clickSwallowRef.current === finish) clickSwallowRef.current = null;
    };
    // The browser synthesizes the post-drop click right after pointerup; a
    // *new* pointerdown means the user started another interaction (e.g. the
    // row menu), so that click must not be swallowed.
    const onNextPointerDown = () => finish();
    timer = window.setTimeout(finish, CLICK_SUPPRESS_MS);
    clickSwallowRef.current = finish;
    window.addEventListener("click", swallow, true);
    window.addEventListener("pointerdown", onNextPointerDown, true);
  }, []);

  /** Ends the gesture; a press that never moved stays a plain tap. */
  const finishGesture = useCallback(
    (drop: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      const wasActive = session.active;
      const moved = session.moved;
      const { payload } = session;
      // Resolve at release time only. A release outside every target is a
      // cancel; falling back to the last hovered target would drop on a day
      // or row the finger has already left.
      const hasHitTest = typeof document.elementFromPoint === "function";
      const target =
        wasActive && drop ? resolveTarget(session.x, session.y) : null;
      const key =
        targetKeyOf(target) ?? (hasHitTest ? null : overKeyRef.current);
      resetSession();
      if (!wasActive || !moved) return;
      swallowNextClick();
      if (key !== null) {
        optionsRef.current.onDrop(payload, key);
      } else {
        optionsRef.current.onCancel?.(payload);
      }
    },
    [resetSession, resolveTarget, swallowNextClick, targetKeyOf],
  );

  /** Aborts without a drop (scroll won the gesture, pointer cancelled). */
  const cancelGesture = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const refreshScrollContainers = useCallback((session: TouchDragSession) => {
    const selector = optionsRef.current.targetSelector;
    session.scrollY = scrollParentAt(session.x, session.y, "y", selector);
    session.scrollX = scrollParentAt(session.x, session.y, "x", selector);
  }, []);

  /** rAF loop: scroll the resolved container while the finger is at an edge. */
  const startAutoScroll = useCallback(
    (session: TouchDragSession) => {
      if (typeof window.requestAnimationFrame !== "function") return;
      if (session.frame !== null) return;
      if (!session.scrollX && !session.scrollY) return;
      // Scale the per-frame step by the time actually elapsed since the last
      // frame. On a loaded machine rAF can drop to a few frames per second;
      // scrolling a fixed 14 px per callback then crawls (the TASK-31 far-row
      // gesture needs hundreds of pixels). A normal 60 Hz frame keeps exactly
      // the old 14 px step, so the feel is unchanged.
      let lastFrame: number | null = null;
      const step = (time: number) => {
        if (sessionRef.current !== session || !session.active) return;
        if (!session.scrollX && !session.scrollY) {
          session.frame = null;
          return;
        }
        const elapsed =
          lastFrame === null
            ? 1000 / 60
            : Math.min(Math.max(time - lastFrame, 0), AUTO_SCROLL_MAX_FRAME_MS);
        lastFrame = time;
        const scale = elapsed / (1000 / 60);
        for (const axis of ["y", "x"] as const) {
          const container = axis === "y" ? session.scrollY : session.scrollX;
          if (!container) continue;
          const delta = autoScrollStep(
            container,
            axis,
            axis === "y" ? session.y : session.x,
          );
          if (delta === 0) continue;
          // Keep at least 1 px per frame (with the original sign): on a
          // high-refresh display scale can be below 0.5, and rounding the
          // smallest edge step to zero would freeze auto-scroll forever.
          const distance =
            Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) * scale));
          if (axis === "y") {
            container.scrollTop += distance;
          } else {
            container.scrollLeft += distance;
          }
        }
        setOver(targetKeyOf(resolveTarget(session.x, session.y)));
        session.frame = window.requestAnimationFrame(step);
      };
      session.frame = window.requestAnimationFrame(step);
    },
    [resolveTarget, setOver, targetKeyOf],
  );

  const activate = useCallback(
    (session: TouchDragSession) => {
      if (sessionRef.current !== session) return;
      session.active = true;
      session.timer = null;
      // Capture on the body (a stable element) so the pointer stream survives
      // a virtualized source row unmounting mid-scroll. A tap never gets here,
      // so it still clicks its own target.
      try {
        document.body.setPointerCapture(session.pointerId);
        session.captured = true;
      } catch {
        /* pointer capture unavailable — window listeners still work */
      }
      window.getSelection()?.removeAllRanges();
      document.body.classList.add("janosik-touch-dragging");
      setActivePayload(session.payload);
      optionsRef.current.onStart?.(session.payload);
      setOver(targetKeyOf(resolveTarget(session.x, session.y)));
    },
    [resolveTarget, setOver, targetKeyOf],
  );

  const track = useCallback(
    (x: number, y: number) => {
      const session = sessionRef.current;
      if (!session) return;
      session.x = x;
      session.y = y;
      if (!session.active) {
        if (
          Math.hypot(x - session.startX, y - session.startY) >
          optionsRef.current.tolerance
        ) {
          cancelGesture();
        }
        return;
      }
      if (
        !session.moved &&
        Math.hypot(x - session.startX, y - session.startY) >
          optionsRef.current.tolerance
      ) {
        session.moved = true;
      }
      if (session.moved) {
        // Resolve the container from the element under the finger, not the
        // source: Unscheduled lives in a side panel but drops onto the grid,
        // and a virtualized row can unmount mid-scroll. Only rect reads stay
        // in the rAF loop.
        refreshScrollContainers(session);
        startAutoScroll(session);
      }
      setOver(targetKeyOf(resolveTarget(x, y)));
    },
    [
      cancelGesture,
      refreshScrollContainers,
      resolveTarget,
      setOver,
      startAutoScroll,
      targetKeyOf,
    ],
  );

  /** Non-passive touch listeners exist only while a session is live. */
  const bindTouchListeners = useCallback(() => {
    if (touchHandlersRef.current) return;
    const start = (event: TouchEvent) => {
      // A second finger means a pinch/gesture, not a drag: drop it.
      if ((event.touches?.length ?? 0) > 1) cancelGesture();
    };
    const move = (event: TouchEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const touches = event.touches;
      if (!touches || touches.length === 0) {
        cancelGesture();
        return;
      }
      if (touches.length > 1) {
        cancelGesture();
        return;
      }
      const touch = touches[0];
      if (!touch) return;
      track(touch.clientX, touch.clientY);
      if (session.active && event.cancelable) event.preventDefault();
    };
    touchHandlersRef.current = { start, move };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
  }, [cancelGesture, track]);

  /** Spread on the draggable: `<button {...handlers(card.id)}>`. */
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, payload: string) => {
      const options = optionsRef.current;
      if (options.disabled || event.pointerType === "mouse") return;
      if (event.button !== 0 || event.isPrimary === false) return;
      if (sessionRef.current !== null) return;
      if (
        options.ignoreSelector &&
        event.target instanceof Element &&
        event.target.closest(options.ignoreSelector)
      ) {
        return;
      }

      const session: TouchDragSession = {
        payload,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        moved: false,
        captured: false,
        timer: null,
        frame: null,
        scrollX: null,
        scrollY: null,
      };
      session.timer = window.setTimeout(() => activate(session), options.delay);
      sessionRef.current = session;
      bindTouchListeners();
    },
    [activate, bindTouchListeners],
  );

  /**
   * Runs before the surface's own long-press handlers. The calendar chips and
   * table rows are wrapped in `CardContextMenu`, whose touch long-press timer
   * (500 ms in Base UI) would otherwise open the card menu in the middle of a
   * drag. `preventBaseUIHandler` is Base UI's documented way for a merged
   * handler to opt out. The explicit "Card actions" button on every chip/row
   * keeps the menu reachable on touch; a mouse right-click is untouched.
   */
  const onTouchStart = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    if (optionsRef.current.disabled) return;
    const merged = event as ReactTouchEvent<HTMLElement> & {
      preventBaseUIHandler?: () => void;
    };
    merged.preventBaseUIHandler?.();
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      track(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      finishGesture(true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      cancelGesture();
    };
    const onTouchEnd = (event: TouchEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      // A finger left on the glass means this was a multi-touch gesture.
      if ((event.touches?.length ?? 0) > 0) {
        cancelGesture();
        return;
      }
      finishGesture(true);
    };
    const onTouchCancel = () => {
      if (sessionRef.current) cancelGesture();
    };
    const onContextMenu = (event: MouseEvent) => {
      // The native long-press menu would otherwise cover the drag.
      if (sessionRef.current?.active) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sessionRef.current) cancelGesture();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown);
      // Unmount during a hold must not leave a timer that later adds the
      // dragging class to a body the component no longer owns.
      const session = sessionRef.current;
      if (session?.captured) {
        try {
          if (document.body.hasPointerCapture(session.pointerId)) {
            document.body.releasePointerCapture(session.pointerId);
          }
        } catch {
          /* already released by the browser */
        }
      }
      clearTimer();
      clearFrame();
      unbindTouchListeners();
      sessionRef.current = null;
      clickSwallowRef.current?.();
      document.body.classList.remove("janosik-touch-dragging");
    };
  }, [
    cancelGesture,
    clearFrame,
    clearTimer,
    finishGesture,
    track,
    unbindTouchListeners,
  ]);

  return {
    /** Payload of the lifted item, for the item's own active styling. */
    activePayload,
    /** Key of the target under the finger, for the target's highlight. */
    overKey,
    /** Start a gesture from the item's own `onPointerDown`. */
    onPointerDown,
    /** Suppresses the wrapper's touch long-press whenever the layer is on. */
    onTouchStart,
    /** Abort from caller code (dialog opened, board changed…). */
    cancel: cancelGesture,
  };
}
