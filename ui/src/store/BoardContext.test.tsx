import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import {
  BoardProvider,
  useBoard,
  useBoardActions,
  useBoardHistory,
  useBoardIdentity,
  useBoardState,
} from "@/store/BoardContext";
import type { Board } from "@janosik/shared";

/**
 * Regression coverage for the provider's dispatch/history wiring (TASK-33):
 * two convenience actions fired in the same event handler (create a label +
 * attach it) must produce two *distinct* history snapshots, so undo walks
 * back through them one by one instead of replaying a duplicated no-op step.
 */

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Alpha",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["c-1"], createdAt: 1 },
        ],
        cards: {
          "c-1": {
            id: "c-1",
            title: "First card",
            labelIds: [],
            createdAt: 1000,
            updatedAt: 1000,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

// The test drives the provider through a probe component: it mirrors the
// pieces of state under assertion plus the undo/redo/add/toggle actions.
let latest: {
  labels: Board["labels"];
  cardLabelIds: string[];
  addLabel: ReturnType<typeof useBoard>["addLabel"];
  toggleCardLabel: ReturnType<typeof useBoard>["toggleCardLabel"];
  undo: () => void;
  redo: () => void;
};

function Probe() {
  const { board, addLabel, toggleCardLabel, undo, redo } = useBoard();
  latest = {
    labels: board?.labels ?? [],
    cardLabelIds: board?.cards["c-1"]?.labelIds ?? [],
    addLabel,
    toggleCardLabel,
    undo,
    redo,
  };
  return null;
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[routes.board("b-1")]}>
            <BoardProvider>
              <Routes>
                <Route path={routes.boardPattern} element={<Probe />} />
              </Routes>
            </BoardProvider>
          </MemoryRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("BoardContext dispatch/history (TASK-33)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("same-tick create+attach label yields two exact undo steps", () => {
    renderProbe();

    // One user gesture, two dispatches in the same tick.
    act(() => {
      latest.addLabel({ id: "l-1", name: "Red", color: "red" });
      latest.toggleCardLabel("c-1", "l-1");
    });
    expect(latest.labels.map((l) => l.id)).toEqual(["l-1"]);
    expect(latest.cardLabelIds).toEqual(["l-1"]);

    // Undo #1: detach the label (it still exists).
    act(() => latest.undo());
    expect(latest.cardLabelIds).toEqual([]);
    expect(latest.labels.map((l) => l.id)).toEqual(["l-1"]);

    // Undo #2: remove the label entirely. Before the fix the duplicated
    // "before" snapshot made this a silent no-op.
    act(() => latest.undo());
    expect(latest.labels).toEqual([]);

    // Redo replays both steps symmetrically.
    act(() => latest.redo());
    expect(latest.labels.map((l) => l.id)).toEqual(["l-1"]);
    expect(latest.cardLabelIds).toEqual([]);

    act(() => latest.redo());
    expect(latest.cardLabelIds).toEqual(["l-1"]);
  });

  it("two same-tick dispatches keep the history free of duplicate snapshots", () => {
    renderProbe();

    act(() => {
      latest.addLabel({ id: "l-1", name: "Red", color: "red" });
      latest.toggleCardLabel("c-1", "l-1");
    });

    // With the duplicated-snapshot bug both undos landed on the *same*
    // board (the second was a silent no-op); each step must be distinct.
    act(() => latest.undo());
    const afterFirst = JSON.stringify(latest);
    act(() => latest.undo());
    const afterSecond = JSON.stringify(latest);

    expect(afterFirst).not.toEqual(afterSecond);
    expect(
      JSON.parse(afterFirst).labels.map((l: { id: string }) => l.id),
    ).toEqual(["l-1"]);
    expect(JSON.parse(afterSecond).labels).toEqual([]);
  });
});

/**
 * Render-isolation coverage for the context split (TASK-21.4): editing a
 * card must reach the state consumers and leave the actions-only ones (the
 * header, the pickers) untouched. Counting renders is the assertion the
 * React Profiler would make by hand.
 */

let stateRenders = 0;
let actionsRenders = 0;
let historyRenders = 0;
let identityRenders = 0;
let api: ReturnType<typeof useBoardActions>;
let flags: ReturnType<typeof useBoardHistory>;
let identity: ReturnType<typeof useBoardIdentity>;
let cardTitle: string | undefined;
let live: Board | undefined;

function StateProbe() {
  stateRenders += 1;
  const { board } = useBoardState();
  cardTitle = board?.cards["c-1"]?.title;
  live = board;
  return null;
}

function ActionsProbe() {
  actionsRenders += 1;
  api = useBoardActions();
  return null;
}

function HistoryProbe() {
  historyRenders += 1;
  flags = useBoardHistory();
  return null;
}

function IdentityProbe() {
  identityRenders += 1;
  identity = useBoardIdentity();
  return null;
}

function renderSplitProbes() {
  stateRenders = 0;
  actionsRenders = 0;
  historyRenders = 0;
  identityRenders = 0;
  return render(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[routes.board("b-1")]}>
            <BoardProvider>
              <Routes>
                <Route
                  path={routes.boardPattern}
                  element={
                    <>
                      <StateProbe />
                      <ActionsProbe />
                      <HistoryProbe />
                      <IdentityProbe />
                    </>
                  }
                />
              </Routes>
            </BoardProvider>
          </MemoryRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("BoardContext split (TASK-21.4)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("a card edit re-renders state consumers only", () => {
    renderSplitProbes();
    const stateBefore = stateRenders;
    const actionsBefore = actionsRenders;
    const apiBefore = api;

    act(() => api.updateCard("c-1", { title: "Renamed" }));

    expect(cardTitle).toBe("Renamed");
    expect(stateRenders).toBeGreaterThan(stateBefore);
    // The actions object is assembled once, so its consumers never hear
    // about anyone else's edits.
    expect(actionsRenders).toBe(actionsBefore);
    expect(api).toBe(apiBefore);
  });

  it("undo availability only changes when it actually flips", () => {
    renderSplitProbes();
    expect(flags).toEqual({ canUndo: false, canRedo: false });

    // First edit: false -> true, so the header does re-render, once.
    act(() => api.updateCard("c-1", { title: "One" }));
    const afterFirstEdit = historyRenders;
    expect(flags).toEqual({ canUndo: true, canRedo: false });

    // Further edits keep undo available — no further header renders.
    act(() => api.updateCard("c-1", { title: "Two" }));
    act(() => api.updateCard("c-1", { title: "Three" }));
    expect(historyRenders).toBe(afterFirstEdit);

    act(() => api.undo());
    expect(flags.canRedo).toBe(true);
  });
  it("keeps the board's own name out of card edits", () => {
    renderSplitProbes();
    expect(identity).toEqual({ id: "b-1", title: "Alpha" });
    const before = identityRenders;

    // A card edit does not touch the board's name...
    act(() => api.updateCard("c-1", { title: "Renamed card" }));
    expect(identityRenders).toBe(before);

    // ...renaming the board does.
    act(() => api.renameBoard("Beta"));
    expect(identity.title).toBe("Beta");
    expect(identityRenders).toBeGreaterThan(before);
  });

  it("keeps the history when a board removal is refused (B-12)", () => {
    renderSplitProbes();
    act(() => api.addColumn("Doing"));
    expect(flags.canUndo).toBe(true);

    // The reducer refuses to remove the only board...
    act(() => api.removeBoard("b-1"));
    expect(live?.id).toBe("b-1");

    // ...so the refused command must not silently drop its undo history.
    expect(flags.canUndo).toBe(true);
    act(() => api.undo());
    expect(live?.columns.map((c) => c.title)).not.toContain("Doing");
  });
});

/**
 * End-to-end proof of the inverse history (TASK-21.7d) through the real
 * provider: a session of edits, then Ctrl+Z all the way back. Two promises
 * are checked — every press changes something (no press is swallowed), and
 * the board comes back exactly as it started, timestamps included.
 */
describe("undo walks a whole session back (TASK-21.7d)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("returns the board to its starting state, press by press", () => {
    renderSplitProbes();
    const start = JSON.stringify(live);

    // A session touching a bit of everything, including the commands whose
    // undo has to restore deleted content and positions.
    const session: (() => void)[] = [
      () => api.addColumn("Doing"),
      () => api.addCard("col-1", "Zebra card"),
      () => api.updateCard("c-1", { title: "Renamed" }),
      () => api.addLabel({ id: "l-1", name: "Red", color: "red" }),
      () => api.toggleCardLabel("c-1", "l-1"),
      // Sorting is destructive by nature: its undo is an explicit order.
      () => api.addCard("col-1", "Aardvark"),
      () => api.sortColumn("col-1", "title"),
      () => api.setColumnWipLimit("col-1", 3),
      () => api.archiveColumnCards("col-1"),
      () => api.addCard("col-1", "After the archive"),
      () => api.deleteLabel("l-1"),
      () => api.renameBoard("Beta"),
    ];
    const states: string[] = [];
    for (const step of session) {
      states.push(JSON.stringify(live));
      act(step);
      // Every command in this session does change something — otherwise the
      // walk back below would be testing fewer steps than it looks.
      expect(JSON.stringify(live)).not.toEqual(states[states.length - 1]);
    }

    // Now back, one press per step, in reverse.
    for (const expected of states.reverse()) {
      expect(flags.canUndo).toBe(true);
      act(() => api.undo());
      expect(JSON.stringify(live)).toEqual(expected);
    }
    expect(flags.canUndo).toBe(false);
    expect(JSON.stringify(live)).toEqual(start);

    // And forward again: redo replays the very same session.
    for (let i = 0; i < session.length; i++) {
      expect(flags.canRedo).toBe(true);
      act(() => api.redo());
    }
    expect(flags.canRedo).toBe(false);
  });

  it("undoes an archive of a WIP-full column without being refused", () => {
    renderSplitProbes();
    act(() => api.addCard("col-1", "Second"));
    act(() => api.setColumnWipLimit("col-1", 2));
    const full = live?.columns[0].cardIds;
    expect(full).toHaveLength(2);

    act(() => api.archiveColumnCards("col-1"));
    expect(live?.columns[0].cardIds).toEqual([]);

    act(() => api.undo());
    // Back in the column, in the same order, even though the column was at
    // its limit when the archive happened.
    expect(live?.columns[0].cardIds).toEqual(full);
    for (const id of full ?? []) {
      expect(live?.cards[id].archivedAt).toBeUndefined();
    }
  });
});
