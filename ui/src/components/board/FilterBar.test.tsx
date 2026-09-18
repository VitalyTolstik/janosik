import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/board/FilterBar";
import { I18nProvider } from "@/i18n";
import type { Label } from "@janosik/shared";
import { EMPTY_FILTER, type CardFilter } from "@/utils/filter";

/**
 * The faceted filters (due date, labels, creation date) live behind a single
 * "Filters" popover button; the due facet reuses the TASK-4 status model
 * (overdue / soon ≤24 h / no due date).
 */

const LABELS: Label[] = [
  { id: "l1", name: "Bug", color: "red" },
  { id: "l2", name: "Feature", color: "blue" },
];

function renderBar(filter: CardFilter = EMPTY_FILTER) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <FilterBar
        filter={filter}
        labels={LABELS}
        matchCount={3}
        onChange={onChange}
      />
    </I18nProvider>,
  );
  return onChange;
}

describe("FilterBar", () => {
  it("keeps the search input inline and the facets behind the popover", async () => {
    renderBar();
    expect(
      screen.getByLabelText("Search cards", { selector: "input" }),
    ).toBeInTheDocument();

    // Facet options are not rendered until the popover opens.
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("keeps the popover scrollable so every facet stays reachable", async () => {
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));

    // On short viewports the panel is capped to the available height and
    // scrolls as one surface (no nested label-list scroller).
    const popover = screen.getByTestId("filters-popover");
    expect(popover).toHaveClass("overflow-y-auto", "overscroll-contain");
    expect(
      screen.getByRole("checkbox", { name: "Bug" }).parentElement,
    ).not.toHaveClass("overflow-y-auto");
  });

  it("selects a due status from the popover", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    await userEvent.click(screen.getByRole("radio", { name: "Overdue" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      due: "overdue",
    });
  });

  it("toggles a label checkbox from the popover", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bug" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      labelIds: ["l1"],
    });
  });

  it("switches the label match mode between any and all", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    const group = screen.getByRole("radiogroup", { name: "Label match mode" });
    expect(group).toHaveTextContent("Any");
    expect(group).toHaveTextContent("All");
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      labelMatch: "all",
    });
  });

  it("shows the active facet count on the filters button", () => {
    renderBar({ ...EMPTY_FILTER, due: "soon", labelIds: ["l1"] });
    expect(
      screen.getByRole("button", { name: "Filter cards" }),
    ).toHaveTextContent("2");
  });

  it("renders removable chips for the active facets", async () => {
    const onChange = renderBar({
      ...EMPTY_FILTER,
      due: "overdue",
      noLabel: true,
    });

    expect(screen.getByText("Overdue")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Remove label" })[0],
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      due: "any",
      noLabel: true,
    });
  });

  it("renders a removable chip for the relative created window", async () => {
    const onChange = renderBar({ ...EMPTY_FILTER, created: "7d" });

    // The window is a live facet like any other: visible and switchable
    // without reopening the popover.
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove label" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      created: "any",
    });
  });

  it("retires the relative window when a calendar day is picked", async () => {
    const onChange = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Filter cards" }));
    await userEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));

    // Open the calendar and pick a day; the lazy chunk needs a longer wait.
    await userEvent.click(screen.getByRole("radio", { name: /On date/ }));
    await waitFor(
      () => {
        expect(
          document.querySelectorAll("button[data-day]").length,
        ).toBeGreaterThan(0);
      },
      { timeout: 15_000 },
    );
    await userEvent.click(
      [...document.querySelectorAll("button[data-day]")].find(
        (b) => b.textContent === "15",
      ) as HTMLElement,
    );

    // The window must not survive as a dormant facet — otherwise it
    // resurrects when the exact-day chip is removed.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTER,
      created: "any",
      createdOn: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`,
    });
  });
});
