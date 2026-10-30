import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardItem } from "@/components/board/CardItem";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import type { CardLinkFacts } from "@/utils/links";
import type { Card, Label } from "@janosik/shared";

/**
 * TASK-142: the compact card face. It keeps the swarm-readable signal
 * (title, labels as dots, blocked marker, checklist progress, priority,
 * assignee) and drops the full-face chrome — the point is fewer DOM nodes
 * per card and a shorter tile, with the details still one click away.
 */

const labels: Label[] = [
  { id: "l-1", name: "design", color: "fuchsia" },
  { id: "l-2", name: "bug", color: "red" },
];

const richCard: Card = {
  id: "c-rich",
  title: "Design the swarm watch wall",
  labelIds: ["l-1", "l-2"],
  priority: "high",
  dueDate: 4102444800000,
  description: "Watch a swarm of agents work the board.",
  assigneeId: "u-boris",
  checklists: [
    {
      id: "cl-1",
      title: "Steps",
      items: [
        { id: "i-1", text: "reproduce", done: true },
        { id: "i-2", text: "verify", done: false },
      ],
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const blockedFacts: CardLinkFacts = {
  outgoing: [],
  incoming: [],
  degree: 1,
  blocked: true,
};

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </I18nProvider>
  );
}

function renderCard(
  card: Card = richCard,
  props: Partial<React.ComponentProps<typeof CardItem>> = {},
) {
  return render(wrap(<CardItem card={card} labels={labels} {...props} />));
}

function face(): HTMLElement {
  return screen.getByTestId("card-title").closest("article") as HTMLElement;
}

describe("CardItem compact face (TASK-142)", () => {
  it("renders a single-line 48px tile instead of the 92px full tile", () => {
    renderCard(richCard, { compact: true });
    expect(face().className).toContain("h-12");
    expect(face().className).not.toContain("h-[92px]");
  });

  it("keeps the swarm-readable signal", () => {
    renderCard(richCard, { compact: true, linkFacts: blockedFacts });

    expect(screen.getByTestId("card-title")).toHaveTextContent(
      "Design the swarm watch wall",
    );
    // Labels collapse to colour dots (no chip text on the compact face).
    expect(screen.getByTestId("card-labels").children).toHaveLength(2);
    expect(screen.getByTestId("card-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("card-checklist-badge")).toHaveTextContent("1/2");
    expect(screen.getByTestId("card-priority-badge")).toHaveAttribute(
      "data-priority",
      "high",
    );
    expect(screen.getByTestId("card-assignee")).toBeInTheDocument();
  });

  it("drops the full-face chrome: hover actions, due and description badges", () => {
    renderCard(richCard, {
      compact: true,
      onDuplicate: vi.fn(),
      onArchive: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: "Duplicate card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByTestId("card-due-badge")).toBeNull();
    expect(screen.queryByTestId("card-description-badge")).toBeNull();
  });

  it("renders fewer DOM nodes than the full face for the same card", () => {
    const first = render(wrap(<CardItem card={richCard} labels={labels} />));
    const fullNodes = first.container.querySelectorAll("article *").length;
    first.unmount();

    const second = render(
      wrap(<CardItem card={richCard} labels={labels} compact />),
    );
    const compactNodes = second.container.querySelectorAll("article *").length;

    expect(fullNodes).toBeGreaterThan(compactNodes);
    // The compact tile is a small fraction of the full face's node count.
    expect(compactNodes).toBeLessThan(fullNodes / 2);
  });

  it("stays clickable — the dialog opens from the compact face", () => {
    const onClick = vi.fn();
    renderCard(richCard, { compact: true, onClick });

    fireEvent.click(screen.getByTestId("card-title"));
    expect(onClick).toHaveBeenCalledWith("c-rich");
  });

  it("keeps the j/k cursor ring on the compact tile", () => {
    renderCard(richCard, { compact: true, isCursor: true });
    expect(face().className).toContain("ring-primary/60");
  });
});
