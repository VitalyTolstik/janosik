import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTouchDrag } from "@/hooks/use-touch-drag";

/**
 * Touch long-press drag (TASK-31) — the shared gesture under the calendar
 * chips and table rows. HTML5 DnD never fires on a phone, so the hook reads
 * the pointer stream: hold still to lift, move to scroll, tap to click.
 */

const DELAY = 220;

function Harness({
  onDrop,
  onStart,
  onCancel,
  onClick,
  disabled,
}: {
  onDrop: (payload: string, key: string) => void;
  onStart?: (payload: string) => void;
  onCancel?: (payload: string) => void;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const drag = useTouchDrag({
    targetSelector: '[data-testid="drop-zone"]',
    disabled,
    onDrop,
    onStart,
    onCancel,
  });
  return (
    <>
      <button
        type="button"
        data-testid="chip"
        onClick={onClick}
        onPointerDown={(event) => drag.onPointerDown(event, "card-1")}
      >
        Chip
      </button>
      <div data-testid="drop-zone" data-drop-key="target-1">
        <span data-testid="drop-inner">target</span>
      </div>
      <output data-testid="active">{drag.activePayload ?? ""}</output>
      <output data-testid="over">{drag.overKey ?? ""}</output>
    </>
  );
}

function pressChip(x = 10, y = 10, pointerType = "touch") {
  fireEvent.pointerDown(screen.getByTestId("chip"), {
    pointerType,
    button: 0,
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
}

function move(x: number, y: number) {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y });
}

function release(x: number, y: number) {
  fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });
}

const active = () => screen.getByTestId("active").textContent;
const over = () => screen.getByTestId("over").textContent;

function ScrollerHarness({
  onDrop,
}: {
  onDrop: (payload: string, key: string) => void;
}) {
  const drag = useTouchDrag({
    targetSelector: '[data-drop-key="target"]',
    onDrop,
  });
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <button
        type="button"
        data-testid="scroller-chip"
        onPointerDown={(event) => drag.onPointerDown(event, "card-1")}
      >
        Chip
      </button>
    </div>
  );
}

function pressScrollerChip(y: number) {
  fireEvent.pointerDown(screen.getByTestId("scroller-chip"), {
    pointerType: "touch",
    button: 0,
    pointerId: 1,
    isPrimary: true,
    clientX: 10,
    clientY: y,
  });
}

describe("useTouchDrag (TASK-31)", () => {
  let elementFromPoint: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Only the gesture timer is faked; React/Base UI keep the real clock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    elementFromPoint = vi.fn();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lifts on a long press and drops on the target under the finger", () => {
    const onDrop = vi.fn();
    const onStart = vi.fn();
    render(<Harness onDrop={onDrop} onStart={onStart} />);

    pressChip();
    expect(active()).toBe("");
    act(() => vi.advanceTimersByTime(DELAY));
    expect(active()).toBe("card-1");
    expect(onStart).toHaveBeenCalledWith("card-1");

    elementFromPoint.mockReturnValue(screen.getByTestId("drop-inner"));
    move(60, 60);
    expect(over()).toBe("target-1");

    release(60, 60);
    expect(onDrop).toHaveBeenCalledWith("card-1", "target-1");
    expect(active()).toBe("");
    expect(over()).toBe("");
  });

  it("treats movement before the long press as a scroll, not a drag", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    pressChip();
    move(60, 60);
    act(() => vi.advanceTimersByTime(DELAY));
    release(60, 60);

    expect(active()).toBe("");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("keeps a short press a tap", () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Harness onDrop={onDrop} onClick={onClick} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY - 40));
    release(10, 10);
    fireEvent.click(screen.getByTestId("chip"));

    expect(active()).toBe("");
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps a slow tap a tap even after the drag delay", () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Harness onDrop={onDrop} onClick={onClick} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY + 60));
    expect(active()).toBe("card-1");
    // No move after activation: releasing is still a tap, not a drop.
    release(10, 10);
    expect(active()).toBe("");
    expect(onDrop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("chip"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("swallows exactly one click after a drop", () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Harness onDrop={onDrop} onClick={onClick} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    elementFromPoint.mockReturnValue(screen.getByTestId("drop-zone"));
    move(40, 40);
    release(40, 40);

    fireEvent.click(screen.getByTestId("chip"));
    expect(onClick).not.toHaveBeenCalled();

    // The suppression window expires, so the next real tap still works.
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByTestId("chip"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse pointers — desktop keeps HTML5 drag and drop", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    pressChip(10, 10, "mouse");
    act(() => vi.advanceTimersByTime(DELAY));
    expect(active()).toBe("");
    release(10, 10);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does nothing while disabled (VIEWER, active filter)", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} disabled />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    expect(active()).toBe("");
    release(10, 10);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("cancels an active drag on Escape", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    expect(active()).toBe("card-1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(active()).toBe("");

    release(10, 10);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("cancels an active drag when the browser takes the pointer", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(active()).toBe("");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("drops into a target nested inside the drop zone", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    elementFromPoint.mockReturnValue(screen.getByTestId("drop-inner"));
    move(30, 30);
    release(30, 30);

    expect(onDrop).toHaveBeenCalledWith("card-1", "target-1");
  });

  it("does not auto-scroll a motionless long press", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onDrop = vi.fn();
    render(<ScrollerHarness onDrop={onDrop} />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    scroller.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    elementFromPoint.mockReturnValue(screen.getByTestId("scroller-chip"));

    pressScrollerChip(90);
    act(() => vi.advanceTimersByTime(DELAY + 40));

    expect(frames).toHaveLength(0);
    expect(scroller.scrollTop).toBe(0);
    release(90, 90);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("auto-scrolls the container under the finger after real movement", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onDrop = vi.fn();
    render(<ScrollerHarness onDrop={onDrop} />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    scroller.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    elementFromPoint.mockReturnValue(screen.getByTestId("scroller-chip"));

    pressScrollerChip(90);
    act(() => vi.advanceTimersByTime(DELAY + 40));
    move(10, 99);
    expect(frames.length).toBeGreaterThan(0);
    act(() => frames.shift()?.call(window, 0));

    // A normal 60 Hz frame keeps the original 14 px step.
    expect(scroller.scrollTop).toBe(14);

    // A stalled frame (rAF drops to a few fps on a loaded machine) must not
    // slow the gesture down: 200 ms is 12 frames' worth of scrolling.
    act(() => frames.shift()?.call(window, 200));
    expect(scroller.scrollTop).toBe(182);

    // Catch-up is capped at 250 ms, so a 1 s gap moves 15 frames at most.
    act(() => frames.shift()?.call(window, 1000));
    expect(scroller.scrollTop).toBe(392);

    release(10, 99);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("cancels on a second finger instead of dropping", () => {
    const onDrop = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onDrop={onDrop} onCancel={onCancel} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    fireEvent.touchStart(window, {
      touches: [
        { identifier: 1, clientX: 10, clientY: 10 },
        { identifier: 2, clientX: 80, clientY: 80 },
      ],
    });
    expect(active()).toBe("");
    release(10, 10);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels when the release misses every drop target", () => {
    const onDrop = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onDrop={onDrop} onCancel={onCancel} />);

    pressChip();
    act(() => vi.advanceTimersByTime(DELAY));
    elementFromPoint.mockReturnValue(null);
    move(60, 60);
    release(60, 60);

    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("card-1");
  });

  it("prevents the native touchmove only while the drag is active", () => {
    render(<Harness onDrop={vi.fn()} />);

    pressChip();
    const beforeActivation = fireEvent.touchMove(window, {
      touches: [{ identifier: 1, clientX: 12, clientY: 12 }],
    });
    expect(beforeActivation).toBe(true);

    act(() => vi.advanceTimersByTime(DELAY));
    const afterActivation = fireEvent.touchMove(window, {
      touches: [{ identifier: 1, clientX: 40, clientY: 40 }],
    });
    expect(afterActivation).toBe(false);
  });

  it("does not leave the dragging class behind when unmounted mid-hold", () => {
    const onStart = vi.fn();
    const { unmount } = render(<Harness onDrop={vi.fn()} onStart={onStart} />);

    pressChip();
    unmount();
    act(() => vi.advanceTimersByTime(DELAY + 50));

    expect(onStart).not.toHaveBeenCalled();
    expect(document.body.classList.contains("janosik-touch-dragging")).toBe(
      false,
    );
  });

  it("opts out of the wrapper's card-context-menu long press", () => {
    const { result } = renderHook(() =>
      useTouchDrag({ targetSelector: ".none", onDrop: vi.fn() }),
    );
    const preventBaseUIHandler = vi.fn();
    act(() =>
      result.current.onTouchStart({
        preventBaseUIHandler,
      } as unknown as Parameters<typeof result.current.onTouchStart>[0]),
    );
    expect(preventBaseUIHandler).toHaveBeenCalledTimes(1);
  });

  it("leaves the context-menu gesture alone when disabled", () => {
    const { result } = renderHook(() =>
      useTouchDrag({
        targetSelector: ".none",
        onDrop: vi.fn(),
        disabled: true,
      }),
    );
    const preventBaseUIHandler = vi.fn();
    act(() =>
      result.current.onTouchStart({
        preventBaseUIHandler,
      } as unknown as Parameters<typeof result.current.onTouchStart>[0]),
    );
    expect(preventBaseUIHandler).not.toHaveBeenCalled();
  });
});
