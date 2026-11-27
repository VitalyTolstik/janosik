import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBoardPanels } from "@/hooks/use-board-panels";
import { boardPanelKey } from "@/utils/board-panel-storage";

const KEY = boardPanelKey("user", "board");

function viewport(width: number) {
  const events = new EventTarget();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    get matches() {
      return width >= Number(/\d+/.exec(query)?.[0]);
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  }));
  return (next: number) => {
    width = next;
    act(() => events.dispatchEvent(new Event("change")));
  };
}

function prefs(width = 380, tab = "people", version = 1) {
  return JSON.stringify({
    version,
    right: { open: true, width, tab },
    left: { open: true, width: 300 },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("board panel preferences", () => {
  it.each([
    ["missing", ""],
    ["corrupt", "{"],
    ["newer", prefs(400, "people", 2)],
  ])("defaults when storage is %s", (_, raw) => {
    viewport(1440);
    localStorage.setItem(KEY, raw);
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    expect(result.current).toMatchObject({
      open: false,
      width: 360,
      tab: "people",
      mode: "dock",
    });
  });

  it.each([
    [390, "sheet", false],
    [768, "drawer", false],
    [1024, "drawer", false],
    [1439, "drawer", false],
    [1440, "dock", true],
    [1680, "dock", true],
    [1920, "dock", true],
  ])("only restores open when docked at %i", (width, mode, open) => {
    viewport(width);
    localStorage.setItem(KEY, prefs());
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    expect(result.current).toMatchObject({ mode, open, width: 380 });
  });

  it.each(["activity", "card"] as const)("restores the %s tab", (tab) => {
    viewport(390);
    localStorage.setItem(KEY, prefs(380, tab));
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    expect(result.current).toMatchObject({ open: false, tab });
  });

  it("keeps an overlay visit from changing the saved docked preference", () => {
    viewport(1024);
    localStorage.setItem(KEY, prefs());
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    act(() => result.current.setOpen(true));
    act(() => result.current.setOpen(false));
    expect(localStorage.getItem(KEY)).toBe(prefs());
  });

  it("persists dismissal immediately after a docked panel becomes a drawer", () => {
    const resize = viewport(1440);
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() =>
      useBoardPanels("user", "board"),
    );
    act(() => result.current.setOpen(true));
    act(() => result.current.setWidth(410));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      right: { open: true, width: 360 },
    });

    resize(1024);
    expect(result.current.mode).toBe("drawer");
    act(() => result.current.setOpen(false));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      right: { open: false, width: 410 },
    });
    act(() => vi.advanceTimersByTime(200));
    resize(1440);
    expect(result.current).toMatchObject({ mode: "dock", open: false });
    unmount();

    const reloaded = renderHook(() => useBoardPanels("user", "board"));
    expect(reloaded.result.current).toMatchObject({ open: false, width: 410 });
  });

  it("uses session state and preserves a newer preference version", () => {
    viewport(1440);
    const key = boardPanelKey("newer-user", "board");
    const stored = prefs(400, "people", 2);
    localStorage.setItem(key, stored);
    const { result, unmount } = renderHook(() =>
      useBoardPanels("newer-user", "board"),
    );
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    unmount();
    expect(localStorage.getItem(key)).toBe(stored);
    const next = renderHook(() => useBoardPanels("newer-user", "board"));
    expect(next.result.current.open).toBe(true);
  });

  it.each([undefined, "invalid", null])(
    "uses the wide default when the stored width is %s",
    (width) => {
      viewport(1920);
      localStorage.setItem(
        KEY,
        JSON.stringify({ version: 1, right: { open: true, width } }),
      );
      const { result } = renderHook(() => useBoardPanels("user", "board"));
      expect(result.current).toMatchObject({ open: true, width: 400 });
    },
  );

  it("starts at 400 on a wide viewport without any saved preferences", () => {
    viewport(1920);
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    expect(result.current).toMatchObject({ open: false, width: 400 });
  });

  it("isolates boards and users and flushes the old board's resize on switch", () => {
    viewport(1440);
    localStorage.setItem(KEY, prefs(380));
    localStorage.setItem(boardPanelKey("user", "other"), prefs(420));
    const { result, rerender } = renderHook(
      ({ user, board }) => useBoardPanels(user, board),
      { initialProps: { user: "user", board: "board" } },
    );
    expect(result.current.width).toBe(380);
    act(() => result.current.setWidth(400));
    rerender({ user: "user", board: "other" });
    expect(result.current).toMatchObject({
      open: true,
      width: 420,
      tab: "people",
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      right: { width: 400 },
    });

    rerender({ user: "other", board: "board" });
    expect(result.current).toMatchObject({ open: false, width: 360 });
    rerender({ user: "user", board: "board" });
    expect(result.current).toMatchObject({ open: true, width: 400 });
  });

  it("clamps invalid widths and falls back from a removed tab", () => {
    viewport(1440);
    localStorage.setItem(KEY, prefs(900, "removed"));
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    expect(result.current).toMatchObject({ width: 480, tab: "people" });
    act(() => result.current.setWidth(100));
    expect(result.current.width).toBe(320);
    act(() => result.current.setOpen(false));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      version: 1,
      right: { open: false, width: 320, tab: "people" },
      left: { open: true, width: 300 },
    });
  });

  it("debounces repeated resize writes for 200 ms and flushes immediately on close", () => {
    viewport(1440);
    vi.useFakeTimers();
    localStorage.setItem(KEY, prefs(380));
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useBoardPanels("user", "board"));
    act(() => result.current.setWidth(390));
    act(() => vi.advanceTimersByTime(150));
    act(() => result.current.setWidth(410));
    act(() => vi.advanceTimersByTime(199));
    expect(write).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      right: { open: true, width: 410 },
    });

    act(() => result.current.setWidth(430));
    act(() => result.current.setOpen(false));
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      right: { open: false, width: 430 },
    });
    act(() => vi.advanceTimersByTime(200));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(["quota", "denied"])(
    "keeps session preferences on %s storage errors",
    (kind) => {
      viewport(1440);
      const error = new DOMException(
        "Storage failed",
        kind === "quota" ? "QuotaExceededError" : "SecurityError",
      );
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw error;
      });
      if (kind === "denied") {
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
          throw error;
        });
      }
      const user = `user-${kind}`;
      const first = renderHook(() => useBoardPanels(user, "board"));
      expect(first.result.current).toMatchObject({ open: false, width: 360 });
      act(() => first.result.current.setOpen(true));
      act(() => first.result.current.setWidth(445));
      first.unmount();

      const next = renderHook(() => useBoardPanels(user, "board"));
      expect(next.result.current).toMatchObject({ open: true, width: 445 });
    },
  );
});
