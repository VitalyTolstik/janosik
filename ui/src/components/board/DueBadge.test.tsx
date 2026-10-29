import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DueBadge } from "@/components/board/DueBadge";
import { I18nProvider } from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * TASK-152 (C19): the badge classifies against the clock, so it must update
 * when a deadline passes even though no board change ever happened.
 */
describe("DueBadge clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reclassifies a due date once it passes", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    render(
      <I18nProvider>
        <TooltipProvider>
          <DueBadge dueDate={start + 1_000} />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId("card-due-badge")).toHaveAttribute(
      "data-due-status",
      "soon",
    );

    act(() => {
      vi.setSystemTime(start + 2_000);
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId("card-due-badge")).toHaveAttribute(
      "data-due-status",
      "overdue",
    );
  });
});
