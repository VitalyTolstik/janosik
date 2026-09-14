import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCardLabels } from "@/hooks/use-card-labels";
import type { Label } from "@/types/kanban";

/**
 * The whole point of the hook is identity (TASK-21.4): `memo` on the card
 * components only holds while the same ids resolve to the same array.
 */

const red: Label = { id: "l-1", name: "Red", color: "red" };
const teal: Label = { id: "l-2", name: "Teal", color: "teal" };

describe("useCardLabels", () => {
  it("resolves ids in order and skips unknown ones", () => {
    const { result } = renderHook(() => useCardLabels([red, teal]));

    expect(result.current(["l-2", "l-1"])).toEqual([teal, red]);
    expect(result.current(["l-1", "gone"])).toEqual([red]);
  });

  it("returns the same array for the same ids across renders", () => {
    const labels = [red, teal];
    const { result, rerender } = renderHook(() => useCardLabels(labels));
    const first = result.current(["l-1", "l-2"]);

    rerender();

    expect(result.current(["l-1", "l-2"])).toBe(first);
    expect(result.current([])).toBe(result.current([]));
  });

  it("hands out fresh arrays once a label changes", () => {
    const { result, rerender } = renderHook(
      ({ labels }: { labels: Label[] }) => useCardLabels(labels),
      { initialProps: { labels: [red, teal] } },
    );
    const first = result.current(["l-1"]);

    // A rename replaces the board's `labels` array — the cards carrying
    // that label must re-render, so a new array is exactly right.
    rerender({ labels: [{ ...red, name: "Crimson" }, teal] });
    const second = result.current(["l-1"]);

    expect(second).not.toBe(first);
    expect(second[0]?.name).toBe("Crimson");
  });
});
