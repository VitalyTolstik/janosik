import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DueBadge } from "@/components/board/DueBadge";
import { I18nProvider } from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * TASK-152 (C19): the badge classifies against the clock, so it must update
 * when a deadline passes even though no board change ever happened.
 *
 * TASK-156: every badge reads the one shared clock (a single interval and
 * one pair of focus/visibility listeners), so mounting, unmounting and
 * remounting badges must never spawn per-badge timers.
 */
describe("DueBadge clock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("shares one clock interval across badges and unmounts cleanly (TASK-156)", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    // Fresh source modules (a fresh clock): the interval count starts at
    // zero no matter what the earlier test in this file already started.
    vi.resetModules();
    const [
      { DueBadge: Badge },
      { I18nProvider: Provider },
      { TooltipProvider: Tooltip },
    ] = await Promise.all([
      import("@/components/board/DueBadge"),
      import("@/i18n"),
      import("@/components/ui/tooltip"),
    ]);
    const interval = vi.spyOn(globalThis, "setInterval");
    expect(interval).not.toHaveBeenCalled();

    const first = render(
      <Provider>
        <Tooltip>
          <Badge dueDate={start + 30_000} />
        </Tooltip>
      </Provider>,
    );
    const second = render(
      <Provider>
        <Tooltip>
          <Badge dueDate={start + 30_000} />
        </Tooltip>
      </Provider>,
    );
    // However many badges are on screen, the clock owns exactly one timer.
    expect(interval).toHaveBeenCalledTimes(1);

    // Both badges reclassify together on the one shared tick.
    act(() => {
      vi.setSystemTime(start + 120_000);
      vi.advanceTimersByTime(60_000);
    });
    expect(
      within(first.container).getByTestId("card-due-badge"),
    ).toHaveAttribute("data-due-status", "overdue");
    expect(
      within(second.container).getByTestId("card-due-badge"),
    ).toHaveAttribute("data-due-status", "overdue");

    // Unmounting a badge unsubscribes it; the shared clock keeps serving
    // the remaining one and still creates no new timer.
    second.unmount();
    act(() => {
      vi.setSystemTime(start + 240_000);
      vi.advanceTimersByTime(60_000);
    });
    expect(
      within(first.container).getByTestId("card-due-badge"),
    ).toHaveAttribute("data-due-status", "overdue");
    expect(interval).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(interval).toHaveBeenCalledTimes(1);
  });
});
