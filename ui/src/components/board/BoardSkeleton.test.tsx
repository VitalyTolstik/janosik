import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BoardListSkeleton,
  BoardShellSkeleton,
} from "@/components/board/BoardSkeleton";
import { I18nProvider } from "@/i18n";

/**
 * The first-paint board shell (SKELETON-AUDIT §4.2/4.3): one busy region,
 * four column placeholders, three cards each, and pending switcher rows that
 * collapse to nothing once the background hydration is done.
 */

function renderShell() {
  return render(
    <I18nProvider>
      <BoardShellSkeleton />
    </I18nProvider>,
  );
}

describe("BoardShellSkeleton", () => {
  it("reserves the real board geometry under one busy region", () => {
    renderShell();
    const shell = screen.getByTestId("board-shell-skeleton");
    expect(shell).toHaveAttribute("role", "status");
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(shell).toHaveClass("janosik-skeleton-region");
    expect(screen.getAllByTestId("board-skeleton-column")).toHaveLength(4);
    expect(screen.getAllByTestId("board-skeleton-card")).toHaveLength(12);
    expect(screen.getByText("Loading boards…")).toHaveClass("sr-only");
  });
});

describe("BoardListSkeleton", () => {
  it("renders at most two pending rows", () => {
    render(
      <I18nProvider>
        <BoardListSkeleton pending={5} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("board-switcher-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getAllByTestId("board-switcher-skeleton-row")).toHaveLength(
      2,
    );
  });

  it("renders nothing when the hydration already finished", () => {
    const { container } = render(
      <I18nProvider>
        <BoardListSkeleton pending={0} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
