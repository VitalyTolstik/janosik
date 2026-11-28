import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Epic } from "@janosik/shared";

import { epicCollapseKey, useEpicCollapse } from "@/hooks/use-epic-collapse";

const epics: Epic[] = [
  {
    id: "epic-a",
    title: "Epic A",
    position: 0,
    status: "active",
    color: "rose",
    createdAt: 1,
    updatedAt: 1,
  },
];

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("defaults to collapsed and reloads state only for the same account and board", () => {
  const { result, rerender, unmount } = renderHook(
    ({ user, board }) => useEpicCollapse(board, user, epics),
    { initialProps: { user: "owner", board: "board" } },
  );
  expect(result.current.expanded.size).toBe(0);
  expect(result.current.completedOpen).toBe(false);
  act(() => result.current.toggleEpic("epic-a"));
  act(() => result.current.toggleCompleted());
  rerender({ user: "owner", board: "another" });
  expect(result.current.expanded.size).toBe(0);
  rerender({ user: "viewer", board: "board" });
  expect(result.current.completedOpen).toBe(false);
  unmount();
  const reopened = renderHook(() => useEpicCollapse("board", "owner", epics));
  expect([...reopened.result.current.expanded]).toEqual(["epic-a"]);
  expect(reopened.result.current.completedOpen).toBe(true);
});

it("recovers from corrupt data and never exposes removed or invalid ids", () => {
  const key = epicCollapseKey("local", "board");
  localStorage.setItem(key, "{");
  const { result, unmount } = renderHook(() =>
    useEpicCollapse("board", "local", epics),
  );
  expect(result.current.expanded.size).toBe(0);
  act(() => result.current.toggleEpic("epic-a"));
  expect(
    Object.keys(localStorage).some((name) =>
      name.startsWith(`${key}.corrupt.`),
    ),
  ).toBe(true);
  unmount();

  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      expanded: ["epic-a", "deleted", null],
      completedOpen: true,
    }),
  );
  const restored = renderHook(() => useEpicCollapse("board", "local", epics));
  expect([...restored.result.current.expanded]).toEqual(["epic-a"]);
});

it("keeps the current session working when writes exceed quota", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const { result } = renderHook(() => useEpicCollapse("board", "local", epics));
  act(() => result.current.toggleEpic("epic-a"));
  expect(result.current.expanded.has("epic-a")).toBe(true);
});
