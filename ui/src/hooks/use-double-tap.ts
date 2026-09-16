import { useCallback, useRef } from "react";

interface DoubleTapOptions {
  /** Max gap between the first tap's release and the second tap's press, ms. */
  maxDelay?: number;
  /** A tap held longer than this is a long-press (drag), not a tap. */
  maxTapDuration?: number;
  /** A pointer that moved more than this many px is a drag, not a tap. */
  slop?: number;
}

/**
 * Detects a double tap on the pointer stream (touch and pen), independent
 * of the browser-synthesized `dblclick`.
 *
 * Touch browsers only emit `dblclick` for a tap pair their gesture
 * recognizer accepts as a double tap; an element that also owns drag
 * listeners (dnd-kit) is not guaranteed to get that synthesis, so a touch
 * rename gesture must be read from the pointer events themselves
 * (TASK-21.11). Mouse input keeps using the native `onDoubleClick` — this
 * hook ignores `pointerType: "mouse"`, so the two paths never overlap.
 *
 * The pair is timed like the browser does it: the gap between releasing
 * the first tap and pressing the second one must be within `maxDelay`
 * (measuring press-to-press instead would also count the first tap's hold
 * time, so a normal slow-ish double tap would miss). A tap that moved
 * further than `slop` (a drag) or lasted longer than `maxTapDuration` (a
 * long-press drag) is discarded and breaks any pending pair.
 */
export function useDoubleTap(
  onDoubleTap: () => void,
  { maxDelay = 300, maxTapDuration = 500, slop = 24 }: DoubleTapOptions = {},
) {
  const downRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastTapUpRef = useRef<{ time: number; x: number; y: number } | null>(
    null,
  );
  const secondTapRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      const now = performance.now();
      const last = lastTapUpRef.current;
      secondTapRef.current =
        last !== null &&
        now - last.time <= maxDelay &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) <= slop;
      if (secondTapRef.current) lastTapUpRef.current = null;
      downRef.current = {
        time: now,
        x: event.clientX,
        y: event.clientY,
      };
    },
    [maxDelay, slop],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      const down = downRef.current;
      downRef.current = null;
      if (!down) return;

      const now = performance.now();
      const moved =
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > slop;
      const tooLong = now - down.time > maxTapDuration;
      if (moved || tooLong) {
        secondTapRef.current = false;
        lastTapUpRef.current = null;
        return;
      }

      if (secondTapRef.current) {
        secondTapRef.current = false;
        lastTapUpRef.current = null;
        onDoubleTap();
        return;
      }
      lastTapUpRef.current = {
        time: now,
        x: event.clientX,
        y: event.clientY,
      };
    },
    [maxTapDuration, onDoubleTap, slop],
  );

  const onPointerCancel = useCallback(() => {
    downRef.current = null;
    lastTapUpRef.current = null;
    secondTapRef.current = false;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
