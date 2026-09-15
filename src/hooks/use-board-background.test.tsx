import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BoardBackgroundProvider,
  useBoardBackground,
} from "@/hooks/use-board-background";
import { DEFAULT_BOARD_BACKGROUND } from "@/types/board-background";

/**
 * Board background (T-4): the value is persisted under `janosik-board-bg`,
 * with a one-time migration from the legacy `vortex-board-bg` key so an
 * existing choice is not lost on the rebrand.
 */

const STORAGE_KEY = "janosik-board-bg";
const LEGACY_KEY = "vortex-board-bg";

function wrapper({ children }: { children: React.ReactNode }) {
  return <BoardBackgroundProvider>{children}</BoardBackgroundProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("useBoardBackground", () => {
  it("defaults to flat when nothing is stored", () => {
    const { result } = renderHook(() => useBoardBackground(), { wrapper });

    expect(result.current.background).toBe(DEFAULT_BOARD_BACKGROUND);
  });

  it("migrates the legacy vortex-board-bg key", () => {
    localStorage.setItem(LEGACY_KEY, "dots");

    const { result } = renderHook(() => useBoardBackground(), { wrapper });

    expect(result.current.background).toBe("dots");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dots");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-background");

    const { result } = renderHook(() => useBoardBackground(), { wrapper });

    expect(result.current.background).toBe(DEFAULT_BOARD_BACKGROUND);
  });

  it("persists updates", () => {
    const { result } = renderHook(() => useBoardBackground(), { wrapper });

    act(() => result.current.setBackground("grid"));

    expect(result.current.background).toBe("grid");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("grid");
  });
});
