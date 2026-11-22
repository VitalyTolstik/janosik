import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  CARD_SELECTION_MAX,
  CardSelectionProvider,
  useCardSelection,
} from "@/store/board-selection";

function Probe({ ids }: { ids: string[] }) {
  const selection = useCardSelection();
  return (
    <div>
      <span data-testid="count">{selection.count}</span>
      <span data-testid="selected">{selection.selectedIds.join(",")}</span>
      <button
        type="button"
        onClick={() => {
          for (const id of ids) selection.toggle(id);
        }}
      >
        add all
      </button>
      <button type="button" onClick={() => selection.toggle(ids[0]!, true)}>
        shift first
      </button>
      <button type="button" onClick={selection.clear}>
        clear
      </button>
      <button
        type="button"
        onClick={() => selection.toggle(ids[ids.length - 1]!)}
      >
        toggle last
      </button>
      <button type="button" onClick={selection.selectAllVisible}>
        select all visible
      </button>
    </div>
  );
}

function Harness({ order }: { order: string[] }) {
  const [current, setCurrent] = useState(order);
  return (
    <I18nProvider>
      <CardSelectionProvider boardId="b-1" order={current} enabled>
        <Probe ids={order} />
        <button type="button" onClick={() => setCurrent(order.slice(0, 2))}>
          shrink
        </button>
      </CardSelectionProvider>
    </I18nProvider>
  );
}

describe("card selection state", () => {
  it("caps a selection at the command batch ceiling", () => {
    const ids = Array.from(
      { length: CARD_SELECTION_MAX + 5 },
      (_, i) => `c-${i}`,
    );
    render(<Harness order={ids} />);
    fireEvent.click(screen.getByRole("button", { name: "add all" }));
    expect(screen.getByTestId("count")).toHaveTextContent(
      String(CARD_SELECTION_MAX),
    );
  });

  it("select-all takes the first visible cards in provider order", () => {
    const ids = Array.from(
      { length: CARD_SELECTION_MAX + 5 },
      (_, i) => `c-${i}`,
    );
    render(<Harness order={ids} />);
    fireEvent.click(screen.getByRole("button", { name: "select all visible" }));
    expect(screen.getByTestId("count")).toHaveTextContent(
      String(CARD_SELECTION_MAX),
    );
    expect(screen.getByTestId("selected")).toHaveTextContent(`c-0,c-1,`);
    expect(screen.getByTestId("selected")).not.toHaveTextContent(
      `c-${CARD_SELECTION_MAX}`,
    );
  });

  it("selects a shift range across columns and prunes hidden cards", async () => {
    render(<Harness order={["col-1-card", "col-1-other", "col-2-card"]} />);
    fireEvent.click(screen.getByRole("button", { name: "toggle last" }));
    fireEvent.click(screen.getByRole("button", { name: "shift first" }));
    expect(screen.getByTestId("count")).toHaveTextContent("3");

    fireEvent.click(screen.getByRole("button", { name: "shrink" }));
    await waitFor(() =>
      expect(screen.getByTestId("count")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("selected")).toHaveTextContent(
      "col-1-card,col-1-other",
    );
  });

  it("clears on demand", () => {
    render(<Harness order={["a", "b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "add all" }));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
