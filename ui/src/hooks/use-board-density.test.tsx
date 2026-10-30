import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BOARD_DENSITY_STORAGE_KEY,
  readStoredBoardDensity,
  useBoardDensity,
} from "@/hooks/use-board-density";

/**
 * TASK-142: the card-density preference is a per-browser display setting —
 * persisted to localStorage, defaulted to the full face, and mirrored on the
 * root element so CSS/Playwright can read it.
 */
describe("useBoardDensity", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.density;
  });

  it("defaults to the full face", () => {
    const { result } = renderHook(() => useBoardDensity());
    expect(result.current.density).toBe("full");
    expect(document.documentElement.dataset.density).toBe("full");
  });

  it("restores a stored compact preference", () => {
    localStorage.setItem(BOARD_DENSITY_STORAGE_KEY, "compact");
    const { result } = renderHook(() => useBoardDensity());
    expect(result.current.density).toBe("compact");
  });

  it("falls back to full for an unknown stored value", () => {
    localStorage.setItem(BOARD_DENSITY_STORAGE_KEY, "huge");
    expect(readStoredBoardDensity()).toBe("full");
  });

  it("persists a change and mirrors it on the root element", () => {
    const { result } = renderHook(() => useBoardDensity());
    act(() => result.current.setDensity("compact"));

    expect(localStorage.getItem(BOARD_DENSITY_STORAGE_KEY)).toBe("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("toggles between the two faces", () => {
    const { result } = renderHook(() => useBoardDensity());

    act(() => result.current.toggleDensity());
    expect(result.current.density).toBe("compact");

    act(() => result.current.toggleDensity());
    expect(result.current.density).toBe("full");
  });
});
