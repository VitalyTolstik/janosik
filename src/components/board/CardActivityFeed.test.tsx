import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardActivityFeed } from "@/components/board/CardActivityFeed";
import { I18nProvider } from "@/i18n";
import type { CardActivityEvent } from "@/types/kanban";

/**
 * Unit tests for the card activity timeline (TASK-12): newest-first
 * rendering, localized event texts with detail snapshots, relative
 * timestamps, and the legacy fallback (cards stored before the feature
 * have no `activity` array — a single "created" row from `createdAt`).
 */

const HOUR = 60 * 60 * 1000;

function event(extra: Partial<CardActivityEvent>): CardActivityEvent {
  return { id: "ev", type: "created", at: 0, actorId: null, ...extra };
}

function renderFeed(props: Parameters<typeof CardActivityFeed>[0]) {
  return render(
    <I18nProvider>
      <CardActivityFeed {...props} />
    </I18nProvider>,
  );
}

describe("CardActivityFeed", () => {
  it("renders events newest-first with localized texts", () => {
    renderFeed({
      activity: [
        event({ id: "e1", type: "created", at: 3 * HOUR }),
        event({ id: "e2", type: "moved", at: 2 * HOUR, detail: "Done" }),
      ],
      createdAt: 3 * HOUR,
    });

    const rows = screen.getAllByTestId("activity-event");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Moved to Done");
    expect(rows[1]).toHaveTextContent("Created");
  });

  it("renders label events with the captured name snapshot", () => {
    renderFeed({
      activity: [event({ id: "e1", type: "label-added", at: HOUR, detail: "Design" })],
      createdAt: 0,
    });
    expect(screen.getAllByTestId("activity-event")[0]).toHaveTextContent(
      "Label Design added",
    );
  });

  it("falls back to a single 'created' row for legacy cards", () => {
    renderFeed({ activity: undefined, createdAt: 5 * HOUR });
    const rows = screen.getAllByTestId("activity-event");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Created");
  });

  it("keeps the synthesized 'created' row once legacy cards get events", () => {
    renderFeed({
      activity: [event({ id: "e1", type: "renamed", at: 6 * HOUR })],
      createdAt: 5 * HOUR,
    });
    const rows = screen.getAllByTestId("activity-event");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Title changed");
    expect(rows[1]).toHaveTextContent("Created");
  });

  it("shows a relative timestamp with the exact one on hover", () => {
    const recent = Date.now() - 2 * HOUR;
    renderFeed({
      activity: [event({ id: "e1", type: "created", at: recent })],
      createdAt: recent,
    });
    const time = screen.getByText(/hours? ago|2 hours/i);
    expect(time).toHaveAttribute("dateTime", new Date(recent).toISOString());
  });
});
