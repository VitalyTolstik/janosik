import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTER } from "@/utils/filter";
import {
  createSavedView,
  loadSavedViews,
  MAX_SAVED_VIEWS,
  peekSavedViewsCount,
  pruneSavedViews,
  removeSavedView,
  renameSavedView,
  SAVED_VIEW_NAME_LIMIT,
  SAVED_VIEWS_VERSION,
  savedViewsKey,
  saveSavedViews,
  sanitizeSavedViews,
  type SavedView,
} from "@/utils/saved-views";

const USER = "user-1";
const BOARD = "board-1";
const OTHER_USER = "user-2";
const OTHER_BOARD = "board-2";

function view(overrides: Partial<SavedView> = {}): SavedView {
  return {
    name: "Urgent",
    filter: { ...EMPTY_FILTER, due: "overdue" },
    view: "table",
    ...overrides,
  };
}

function seedRaw(value: unknown): void {
  localStorage.setItem(savedViewsKey(USER, BOARD), JSON.stringify(value));
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("saved views storage", () => {
  it("reports a missing key without inventing data", () => {
    expect(loadSavedViews(USER, BOARD)).toEqual({
      status: "missing",
      views: [],
    });
  });

  it("round-trips views through the versioned envelope", () => {
    const saved = view();

    expect(saveSavedViews(USER, BOARD, [saved])).toEqual({
      ok: true,
      views: [saved],
    });
    expect(loadSavedViews(USER, BOARD)).toEqual({
      status: "ok",
      views: [saved],
    });
    expect(
      JSON.parse(localStorage.getItem(savedViewsKey(USER, BOARD)) ?? ""),
    ).toEqual({
      version: SAVED_VIEWS_VERSION,
      views: [saved],
    });
  });

  it("namespaces storage by account and board", () => {
    saveSavedViews(USER, BOARD, [view()]);

    expect(loadSavedViews(OTHER_USER, BOARD).views).toEqual([]);
    expect(loadSavedViews(USER, OTHER_BOARD).views).toEqual([]);
    expect(loadSavedViews(USER, BOARD).views).toHaveLength(1);
  });

  it("migrates a legacy bare array and an unversioned envelope", () => {
    seedRaw([view()]);
    expect(loadSavedViews(USER, BOARD)).toMatchObject({
      status: "ok",
      migrated: true,
      views: [view()],
    });

    seedRaw({ views: [view({ name: "Later" })] });
    expect(loadSavedViews(USER, BOARD)).toMatchObject({
      status: "ok",
      migrated: true,
      views: [view({ name: "Later" })],
    });
  });

  it("upgrades a legacy payload to the versioned envelope on the next write", () => {
    seedRaw([view()]);
    expect(loadSavedViews(USER, BOARD).migrated).toBe(true);

    expect(saveSavedViews(USER, BOARD, [view()]).ok).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(savedViewsKey(USER, BOARD)) ?? ""),
    ).toEqual({ version: SAVED_VIEWS_VERSION, views: [view()] });
  });

  it("leaves a newer payload version untouched at write time too", () => {
    const raw = `{"version":${SAVED_VIEWS_VERSION + 1},"views":[]}`;
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);

    expect(loadSavedViews(USER, BOARD)).toEqual({
      status: "unsupported",
      views: [],
    });
    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: false,
      reason: "newer-version",
    });
    // Byte-for-byte preservation: not reformatted, not overwritten.
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("reads the version before validating a future envelope shape", () => {
    const raw = `{"version":${SAVED_VIEWS_VERSION + 1},"savedViews":[]}`;
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);

    expect(loadSavedViews(USER, BOARD)).toEqual({
      status: "unsupported",
      views: [],
    });
    expect(
      Object.keys(localStorage).some((key) => key.includes(".corrupt.")),
    ).toBe(false);
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("refuses to overwrite damaged data when the quarantine copy failed", () => {
    const raw = "{not json";
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("refuses a wrong-shape payload when its first quarantine copy failed", () => {
    const raw = JSON.stringify({ version: SAVED_VIEWS_VERSION, views: "nope" });
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("reuses an existing quarantine copy before locking a wrong-shape payload", () => {
    const raw = JSON.stringify({ version: SAVED_VIEWS_VERSION, views: "nope" });
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    const loaded = loadSavedViews(USER, BOARD);
    expect(loaded.status).toBe("corrupt");
    expect(loaded.quarantineKey).not.toBeNull();

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.includes(".corrupt.")) throw new Error("quota exceeded");
      originalSetItem.call(this, key, value);
    });

    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: true,
      views: [view()],
    });
    expect(localStorage.getItem(loaded.quarantineKey ?? "")).toBe(raw);
    expect(loadSavedViews(USER, BOARD).views).toEqual([view()]);
  });

  it("replaces quarantined damage only after the copy succeeds", () => {
    localStorage.setItem(savedViewsKey(USER, BOARD), "{not json");

    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: true,
      views: [view()],
    });
    expect(
      Object.keys(localStorage).some((key) => key.includes(".corrupt.")),
    ).toBe(true);
    expect(loadSavedViews(USER, BOARD).views).toEqual([view()]);
  });

  it("quarantines unparsable JSON", () => {
    localStorage.setItem(savedViewsKey(USER, BOARD), "{not json");

    const loaded = loadSavedViews(USER, BOARD);

    expect(loaded.status).toBe("corrupt");
    expect(loaded.views).toEqual([]);
    expect(loaded.quarantineKey).toMatch(
      /^janosik-saved-views:user-1:board-1\.corrupt\.\d+$/,
    );
    expect(localStorage.getItem(loaded.quarantineKey ?? "")).toBe("{not json");
  });

  it("quarantines valid JSON of the wrong shape", () => {
    seedRaw({ version: SAVED_VIEWS_VERSION, views: "nope" });

    const loaded = loadSavedViews(USER, BOARD);

    expect(loaded.status).toBe("corrupt");
    expect(localStorage.getItem(loaded.quarantineKey ?? "")).toBe(
      localStorage.getItem(savedViewsKey(USER, BOARD)),
    );
  });

  it("reports unavailable storage instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(loadSavedViews(USER, BOARD)).toEqual({
      status: "unavailable",
      views: [],
    });
  });

  it("reports a failed write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(saveSavedViews(USER, BOARD, [view()])).toEqual({
      ok: false,
      reason: "storage",
    });
  });

  it("applies the cap and uniqueness through a direct save", () => {
    const many = Array.from({ length: MAX_SAVED_VIEWS + 5 }, (_, index) =>
      view({ name: `View ${index}` }),
    );
    many.push(view({ name: "view 0" }));

    const written = saveSavedViews(USER, BOARD, many);

    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("expected a write");
    expect(written.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(loadSavedViews(USER, BOARD).views).toHaveLength(MAX_SAVED_VIEWS);
  });

  it("drops an emptied view on save and does not resurrect it on load", () => {
    const written = saveSavedViews(USER, BOARD, [
      view({ filter: { ...EMPTY_FILTER } }),
    ]);

    expect(written).toEqual({ ok: true, views: [] });
    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
  });

  it("peeks at the trigger count without quarantining damaged data", () => {
    saveSavedViews(USER, BOARD, [view(), view({ name: "Second" })]);
    expect(peekSavedViewsCount(USER, BOARD)).toBe(2);

    localStorage.setItem(savedViewsKey(USER, BOARD), "{broken");
    expect(peekSavedViewsCount(USER, BOARD)).toBe(0);
    expect(
      Object.keys(localStorage).some((key) => key.includes(".corrupt.")),
    ).toBe(false);
  });
});

describe("saved view sanitization", () => {
  it("whitelists filter fields and drops invalid entries", () => {
    seedRaw({
      version: SAVED_VIEWS_VERSION,
      views: [
        {
          name: "  Valid  ",
          filter: {
            query: "x",
            labelIds: ["a", "a", 1, "b"],
            labelMatch: "all",
            noLabel: "yes",
            created: "nope",
            createdOn: "2025-02-30",
            due: "bogus",
            priorities: ["high", "nope", "high"],
            assignees: ["u1", 2],
            unassigned: true,
            blocked: 1,
            hasLinks: true,
            extra: "drop me",
          },
          view: "watch",
          extra: "drop me",
        },
        { name: "Empty", filter: { query: "   " } },
        { name: "", filter: { query: "x" } },
        { name: "Dup", filter: { query: "a" } },
        { name: "dup", filter: { query: "b" } },
        { name: "Bad view", filter: { query: "c" }, view: "watch" },
        "not a view",
        null,
      ],
    });

    const loaded = loadSavedViews(USER, BOARD);
    expect(loaded.status).toBe("ok");
    expect(loaded.views.map((entry) => entry.name)).toEqual([
      "Valid",
      "Dup",
      "Bad view",
    ]);
    expect(loaded.views[0].filter).toEqual({
      ...EMPTY_FILTER,
      query: "x",
      labelIds: ["a", "b"],
      labelMatch: "all",
      due: "any",
      created: "any",
      createdOn: null,
      priorities: ["high"],
      assignees: ["u1"],
      unassigned: true,
      blocked: false,
      hasLinks: true,
    });
    expect(loaded.views[0].view).toBeUndefined();
    expect(loaded.views[2].view).toBeUndefined();
    expect(loaded.views[1].filter.query).toBe("a");
  });

  it("caps a stored list at 20 and truncates over-long names", () => {
    const many = Array.from({ length: MAX_SAVED_VIEWS + 5 }, (_, index) => ({
      name: `View ${index}`,
      filter: { query: "q" },
    }));
    many.push({
      name: "a".repeat(SAVED_VIEW_NAME_LIMIT + 1),
      filter: { query: "q" },
    });
    seedRaw({ version: SAVED_VIEWS_VERSION, views: many });

    const loaded = loadSavedViews(USER, BOARD);

    expect(loaded.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(loaded.views[0].name).toBe("View 0");
    expect(loaded.views[MAX_SAVED_VIEWS - 1].name).toBe("View 19");

    const long = sanitizeSavedViews([
      {
        name: "a".repeat(SAVED_VIEW_NAME_LIMIT + 1),
        filter: { query: "q" },
      },
    ]);
    expect(long[0].name).toHaveLength(SAVED_VIEW_NAME_LIMIT);
  });
});

describe("createSavedView", () => {
  it("trims the name and stores filter + projection", () => {
    const result = createSavedView([], {
      name: "  My overdue cards  ",
      filter: { ...EMPTY_FILTER, due: "overdue", assignees: ["u1"] },
      view: "calendar",
    });

    if (!result.ok) throw new Error("expected a saved view");
    expect(result.view.name).toBe("My overdue cards");
    expect(result.view.filter.due).toBe("overdue");
    expect(result.view.filter.assignees).toEqual(["u1"]);
    expect(result.view.view).toBe("calendar");
    expect(result.views).toHaveLength(1);
  });

  it("rejects empty filters", () => {
    expect(
      createSavedView([], { name: "Nothing", filter: { ...EMPTY_FILTER } }),
    ).toEqual({ ok: false, reason: "empty-filter" });
  });

  it("rejects blank and over-long names", () => {
    expect(
      createSavedView([], {
        name: "   ",
        filter: { ...EMPTY_FILTER, due: "soon" },
      }),
    ).toEqual({ ok: false, reason: "invalid-name" });
    expect(
      createSavedView([], {
        name: "a".repeat(SAVED_VIEW_NAME_LIMIT + 1),
        filter: { ...EMPTY_FILTER, due: "soon" },
      }),
    ).toEqual({ ok: false, reason: "invalid-name" });
  });

  it("rejects case-insensitive duplicate names", () => {
    const existing = view({ name: "Release" });

    expect(
      createSavedView([existing], {
        name: "rElEaSe",
        filter: { ...EMPTY_FILTER, due: "soon" },
      }),
    ).toEqual({ ok: false, reason: "duplicate" });
  });

  it("enforces the per-board cap", () => {
    const full = Array.from({ length: MAX_SAVED_VIEWS }, (_, index) =>
      view({ name: `View ${index}` }),
    );

    expect(
      createSavedView(full, {
        name: "One more",
        filter: { ...EMPTY_FILTER, due: "soon" },
      }),
    ).toEqual({ ok: false, reason: "limit" });
  });

  it("allows a filter-only view without a projection", () => {
    const result = createSavedView([], {
      name: "Just a filter",
      filter: { ...EMPTY_FILTER, query: "release" },
    });

    if (!result.ok) throw new Error("expected a saved view");
    expect(result.view.view).toBeUndefined();
    expect(result.view.filter.query).toBe("release");
  });

  it("never stores the watch projection", () => {
    const result = createSavedView([], {
      name: "No watch",
      filter: { ...EMPTY_FILTER, query: "x" },
      view: "watch" as "board",
    });

    if (!result.ok) throw new Error("expected a saved view");
    expect(result.view.view).toBeUndefined();
  });
});

describe("rename and delete", () => {
  it("renames a view and keeps its filter and projection", () => {
    const original = view();
    const result = renameSavedView([original], "Urgent", "  Released  ");

    if (!result.ok) throw new Error("expected a rename");
    expect(result.view.name).toBe("Released");
    expect(result.view.filter).toEqual(original.filter);
    expect(result.view.view).toBe("table");
    expect(result.views).toEqual([{ ...original, name: "Released" }]);
  });

  it("allows a case-only rename", () => {
    const result = renameSavedView(
      [view({ name: "Urgent" })],
      "Urgent",
      "urgent",
    );
    if (!result.ok) throw new Error("expected a rename");
    expect(result.views[0].name).toBe("urgent");
  });

  it("rejects a name taken by another view", () => {
    const views = [view({ name: "One" }), view({ name: "Two" })];

    expect(renameSavedView(views, "One", "two")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects invalid names and unknown targets", () => {
    expect(renameSavedView([view()], "Urgent", "  ")).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(renameSavedView([view()], "Missing", "Another")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("removes only the named view, case-insensitively", () => {
    const views = [view({ name: "One" }), view({ name: "Two" })];

    expect(removeSavedView(views, "One")).toEqual([views[1]]);
    expect(removeSavedView(views, " one ")).toEqual([views[1]]);
    expect(removeSavedView(views, "Missing")).toEqual(views);
  });
});

describe("pruneSavedViews", () => {
  const drifted = view({
    name: "Drifted",
    filter: {
      ...EMPTY_FILTER,
      query: "bug",
      labelIds: ["l1", "gone-label"],
      assignees: ["u1", "gone-user"],
      unassigned: true,
    },
  });

  it("prunes deleted labels and assignees and reports the drift", () => {
    const result = pruneSavedViews([drifted], {
      labelIds: ["l1", "l2"],
      assigneeIds: ["u1"],
    });

    expect(result.missingOptions).toBe(true);
    expect(result.changedViewNames).toEqual(["Drifted"]);
    expect(result.droppedViewNames).toEqual([]);
    expect(result.views[0].filter.labelIds).toEqual(["l1"]);
    expect(result.views[0].filter.assignees).toEqual(["u1"]);
    expect(result.views[0].filter.unassigned).toBe(true);
    expect(drifted.filter.labelIds).toEqual(["l1", "gone-label"]);
  });

  it("drops a view instead of leaving it with an empty filter", () => {
    const onlyMissing = view({
      name: "Only missing",
      filter: { ...EMPTY_FILTER, labelIds: ["gone-label"] },
    });

    const result = pruneSavedViews([onlyMissing], { labelIds: ["l1"] });

    expect(result.views).toEqual([]);
    expect(result.missingOptions).toBe(true);
    expect(result.changedViewNames).toEqual([]);
    expect(result.droppedViewNames).toEqual(["Only missing"]);
  });

  it("reports no drift when every referenced option still exists", () => {
    const clean = view({
      filter: {
        ...EMPTY_FILTER,
        query: "x",
        labelIds: ["l1"],
        assignees: ["u1"],
      },
    });

    expect(
      pruneSavedViews([clean], {
        labelIds: ["l1"],
        assigneeIds: ["u1"],
      }),
    ).toEqual({
      views: [clean],
      missingOptions: false,
      changedViewNames: [],
      droppedViewNames: [],
    });
  });

  it("leaves facets alone while their option source is unknown", () => {
    expect(pruneSavedViews([drifted], {})).toEqual({
      views: [drifted],
      missingOptions: false,
      changedViewNames: [],
      droppedViewNames: [],
    });
  });

  it("drops a view when the board has no matching options left", () => {
    const onlyMissing = view({
      name: "Drifted",
      filter: {
        ...EMPTY_FILTER,
        labelIds: ["gone-label"],
        assignees: ["gone-user"],
      },
    });
    const result = pruneSavedViews([onlyMissing], {
      labelIds: [],
      assigneeIds: [],
    });

    expect(result.missingOptions).toBe(true);
    expect(result.views).toEqual([]);
    expect(result.droppedViewNames).toEqual(["Drifted"]);
  });

  it("scopes changes to the drifted view, not its clean neighbours", () => {
    const clean = view({
      name: "Clean",
      filter: { ...EMPTY_FILTER, query: "x" },
    });
    const other = view({
      name: "Other",
      filter: { ...EMPTY_FILTER, labelIds: ["gone"] },
    });

    const result = pruneSavedViews([clean, other], { labelIds: [] });

    expect(result.views).toEqual([clean]);
    expect(result.changedViewNames).toEqual([]);
    expect(result.droppedViewNames).toEqual(["Other"]);
  });
});
