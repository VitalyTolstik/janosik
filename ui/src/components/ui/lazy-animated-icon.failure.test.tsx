import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The animated chunks are prefetched on idle, so a connection that drops in
// that window rejects the import. The wrapper must keep its static twin.
const state = vi.hoisted(() => ({ renders: 0 }));

vi.mock("@/components/ui/archive-icon", () => ({
  ArchiveIcon: () => {
    state.renders += 1;
    throw new Error("Animated icon chunk failed to load");
  },
}));

import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";

describe("LazyAnimatedIcon chunk failures (TASK-162.14)", () => {
  let idleCallbacks: Array<() => void>;

  beforeEach(() => {
    state.renders = 0;
    idleCallbacks = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    // React logs the caught render error; the fallback is the expected result.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the static fallback when the animated chunk fails", async () => {
    render(<LazyAnimatedIcon name="archive" size={20} />);
    expect(
      document.querySelector('[data-lazy-state="static"]'),
    ).toBeInTheDocument();

    await act(async () => {
      idleCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => expect(state.renders).toBeGreaterThan(0));
    await waitFor(() => {
      expect(
        document.querySelector('[data-lazy-state="static"]'),
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-lazy-state="animated"]'),
      ).not.toBeInTheDocument();
    });
    expect(document.querySelector(".lucide-archive")).toBeInTheDocument();
  });
});
