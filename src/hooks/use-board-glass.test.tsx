import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BoardGlassProvider, useBoardGlass } from "@/hooks/use-board-glass";
import { GLASS_PRESETS } from "@/utils/board-glass";

/**
 * Column glass (T-4): the UI is a pair of on/off checkboxes, so the hook must
 * normalize any legacy slider value persisted by older versions to the
 * nearest preset and keep the CSS custom properties in sync.
 */

const STORAGE_KEY = "janosik-board-glass";

function wrapper({ children }: { children: React.ReactNode }) {
  return <BoardGlassProvider>{children}</BoardGlassProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("useBoardGlass", () => {
  it("falls back to the opaque preset when nothing is stored", () => {
    const { result } = renderHook(() => useBoardGlass(), { wrapper });

    expect(result.current.glass).toEqual({
      transparency: GLASS_PRESETS.transparency.on,
      blur: GLASS_PRESETS.blur.on,
    });
  });

  it("normalizes legacy slider values to the nearest preset", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ transparency: 30, blur: 0 }),
    );
    const opaque = renderHook(() => useBoardGlass(), { wrapper });
    expect(opaque.result.current.glass).toEqual({
      transparency: GLASS_PRESETS.transparency.off,
      blur: GLASS_PRESETS.blur.off,
    });

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ transparency: 80, blur: 3 }),
    );
    const frosted = renderHook(() => useBoardGlass(), { wrapper });
    expect(frosted.result.current.glass).toEqual({
      transparency: GLASS_PRESETS.transparency.on,
      blur: GLASS_PRESETS.blur.on,
    });
  });

  it("persists updates and mirrors them onto CSS custom properties", () => {
    const { result } = renderHook(() => useBoardGlass(), { wrapper });

    act(() =>
      result.current.setGlass({
        transparency: GLASS_PRESETS.transparency.off,
        blur: GLASS_PRESETS.blur.off,
      }),
    );

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
      transparency: GLASS_PRESETS.transparency.off,
      blur: GLASS_PRESETS.blur.off,
    });
    expect(
      document.documentElement.style.getPropertyValue(
        "--janosik-glass-transparency",
      ),
    ).toBe(String(GLASS_PRESETS.transparency.off));
    expect(
      document.documentElement.style.getPropertyValue("--janosik-glass-blur"),
    ).toBe(`${GLASS_PRESETS.blur.off}px`);
  });

  it("survives corrupt stored JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useBoardGlass(), { wrapper });

    expect(result.current.glass).toEqual({
      transparency: GLASS_PRESETS.transparency.on,
      blur: GLASS_PRESETS.blur.on,
    });
  });
});
