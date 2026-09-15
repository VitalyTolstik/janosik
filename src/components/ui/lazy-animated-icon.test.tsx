import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";

// TASK-21.9: the wrapper must show a static lucide twin until the browser is
// idle, then swap in the motion-powered icon. `requestIdleCallback` is mocked
// so the test controls exactly when the idle frame happens.
describe("LazyAnimatedIcon", () => {
  let idleCallbacks: Array<() => void>;

  beforeEach(() => {
    idleCallbacks = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the static lucide fallback before the first idle frame", () => {
    render(<LazyAnimatedIcon name="palette" size={20} />);

    const fallback = document.querySelector('[data-lazy-state="static"]');
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveClass("lucide-palette");
    expect(
      document.querySelector('[data-lazy-state="animated"]'),
    ).not.toBeInTheDocument();
    expect(idleCallbacks).toHaveLength(1);
  });

  it("swaps in the animated icon once the browser goes idle", async () => {
    render(<LazyAnimatedIcon name="palette" size={20} />);

    await act(async () => {
      idleCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(
        document.querySelector('[data-lazy-state="animated"]'),
      ).toBeInTheDocument();
    });
    expect(
      document.querySelector('[data-lazy-state="static"]'),
    ).not.toBeInTheDocument();
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);

    render(<LazyAnimatedIcon name="archive" size={20} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-lazy-state="animated"]'),
      ).toBeInTheDocument();
    });
  });
});
