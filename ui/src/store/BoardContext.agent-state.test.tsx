import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider, useBoard, useBoardActions } from "@/store/BoardContext";
import type { Board } from "@janosik/shared";

/**
 * TASK-177.4: the card dialog reaches the shared reducer through
 * `BoardContext`. These probes pin the two new convenience actions — the
 * task-spec command and the claim release — so a missing wiring cannot hide
 * behind passing component tests.
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
            claimedBy: "u-1",
            leaseUntil: Date.now() + 900_000,
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

let latestBoard: Board | undefined;
let latestActions: ReturnType<typeof useBoardActions>;

function Probe() {
  const { board } = useBoard();
  latestBoard = board;
  latestActions = useBoardActions();
  return null;
}

function renderProbe() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[routes.board("b-1")]}>
        <BoardProvider>
          <Routes>
            <Route path={routes.boardPattern} element={<Probe />} />
          </Routes>
        </BoardProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("BoardContext agent-owned card state (TASK-177.4)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("SET_CARD_TASK_SPEC lands in the board and writes an activity row", () => {
    renderProbe();

    act(() =>
      latestActions.setCardTaskSpec("c-1", {
        acceptanceCriteria: ["runs", "passes CI"],
        definitionOfDone: ["tests green"],
      }),
    );

    const card = latestBoard?.cards["c-1"];
    expect(card?.acceptanceCriteria).toEqual(["runs", "passes CI"]);
    expect(card?.definitionOfDone).toEqual(["tests green"]);
    expect(card?.activity?.at(-1)?.type).toBe("task-spec-changed");
  });

  it("clears a field with an empty list and leaves the other intact", () => {
    renderProbe();
    act(() =>
      latestActions.setCardTaskSpec("c-1", {
        acceptanceCriteria: ["runs"],
        definitionOfDone: ["tests green"],
      }),
    );
    act(() => latestActions.setCardTaskSpec("c-1", { acceptanceCriteria: [] }));

    const card = latestBoard?.cards["c-1"];
    expect(card?.acceptanceCriteria).toBeUndefined();
    expect(card?.definitionOfDone).toEqual(["tests green"]);
  });

  it("releaseCardClaim clears the lease and records the release", () => {
    renderProbe();

    act(() => latestActions.releaseCardClaim("c-1"));

    const card = latestBoard?.cards["c-1"];
    expect(card?.claimedBy).toBeUndefined();
    expect(card?.leaseUntil).toBeUndefined();
    expect(card?.activity?.at(-1)?.type).toBe("claim-released");
  });
});
