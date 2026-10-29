import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type UIEventHandler,
} from "react";

/**
 * One rendered gap row: an 8px AddCardZone followed by the 92px card tile.
 * Both are fixed-size, so the virtual list can compute exact offsets without
 * measuring every card (TASK-139).
 */
export const CARD_ROW_HEIGHT = 100;

/** Rows kept mounted above and below the viewport to absorb fast scrolling. */
const OVERSCAN = 4;

/**
 * Height used before the column has been laid out (and in jsdom, where every
 * element reports a zero height). Deliberately small: the first paint renders
 * ~8 rows per column, then the layout effect measures the real height and
 * fills the rest — with 12 columns every extra initial row is 12 more cards
 * on the boot path.
 */
const INITIAL_VIEWPORT_HEIGHT = 360;

/** The `ul`'s 4px top padding, i.e. where the first AddCardZone starts. */
const LIST_PADDING_TOP = 4;

export interface CardWindowRange {
  /** First mounted card index. */
  start: number;
  /** One past the last mounted card index. */
  end: number;
}

interface CardWindow {
  scrollRef: RefObject<HTMLDivElement>;
  onScroll: UIEventHandler<HTMLDivElement>;
  range: CardWindowRange;
  /** Scroll the column so the card at `index` is visible. */
  scrollToIndex: (index: number) => void;
}

function computeRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
): CardWindowRange {
  const totalHeight = count * CARD_ROW_HEIGHT;
  // A shrinking column can leave a stale scrollTop above the new maximum
  // until the browser settles it; clamp here so the window never goes blank.
  const top = Math.min(
    Math.max(0, scrollTop - LIST_PADDING_TOP),
    Math.max(0, totalHeight - viewportHeight),
  );
  return {
    start: Math.max(0, Math.floor(top / CARD_ROW_HEIGHT) - OVERSCAN),
    end: Math.min(
      count,
      Math.ceil((top + viewportHeight) / CARD_ROW_HEIGHT) + OVERSCAN,
    ),
  };
}

/**
 * Windowed card rows for one column (TASK-139).
 *
 * The board caps at 12 columns × 200 cards; mounting all 2400 cards used
 * ~68k DOM nodes, ~1.1 GB heap and froze the main thread for almost 4 s.
 * Only the rows around each column's own scroll position are mounted, with
 * fixed-height spacers keeping the scrollbar geometry unchanged.
 *
 * `SortableContext` still receives the complete id array, so drag indices and
 * collisions keep using the real column order; the few mounted neighbouring
 * rows (plus dnd-kit's cached active node) are enough to drag through the
 * overscan while auto-scrolling mounts the next rows.
 *
 * Kept dependency-free deliberately: the whole logic is a scroll offset and
 * a fixed row height, and the critical-path bundle budget is tight.
 */
export function useCardWindow(count: number): CardWindow {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: INITIAL_VIEWPORT_HEIGHT,
  });

  const readViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = {
      scrollTop: el.scrollTop,
      height: el.clientHeight || INITIAL_VIEWPORT_HEIGHT,
    };
    setViewport((prev) =>
      prev.scrollTop === next.scrollTop && prev.height === next.height
        ? prev
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    readViewport();
    const observer = new ResizeObserver(readViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, [readViewport]);

  const scrollToIndex = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const height = el.clientHeight || INITIAL_VIEWPORT_HEIGHT;
    const top = LIST_PADDING_TOP + index * CARD_ROW_HEIGHT;
    const bottom = top + CARD_ROW_HEIGHT;
    if (top >= el.scrollTop && bottom <= el.scrollTop + height) return;

    const nextTop = top < el.scrollTop ? top : bottom - height;
    el.scrollTop = nextTop;
    setViewport({ scrollTop: nextTop, height });
  }, []);

  return {
    scrollRef,
    onScroll: readViewport,
    range: computeRange(count, viewport.scrollTop, viewport.height),
    scrollToIndex,
  };
}
