import type { Board, Card, Column, Label } from "@/types/kanban";

/**
 * Seed board — shown on first launch when localStorage is empty.
 * One board with three columns and cards demonstrating the label system.
 * Labels are ordinary board data (editable/deletable), not enforced presets.
 */

const now = Date.now();

function card(
  id: string,
  title: string,
  labelIds: string[],
  order: number,
  description?: string,
): Card {
  const result: Card = {
    id,
    title,
    labelIds,
    createdAt: now - order * 60_000,
    updatedAt: now - order * 60_000,
  };
  if (description !== undefined) {
    result.description = description;
  }
  return result;
}

function column(id: string, title: string, cardIds: string[]): Column {
  return {
    id,
    title,
    cardIds,
    createdAt: now,
  };
}

const labels: Label[] = [
  { id: "label-design", name: "Design", color: "brand" },
  { id: "label-dev", name: "Development", color: "cyan" },
  { id: "label-done", name: "Done", color: "green" },
  { id: "label-blocked", name: "Blocked", color: "orange" },
  { id: "label-urgent", name: "Urgent", color: "red" },
  { id: "label-later", name: "Backlog", color: "slate" },
];

export function createSeedBoard(): Board {
  const cards = {
    "card-1": card(
      "card-1",
      "Design the new onboarding flow",
      ["label-design"],
      1,
      "Guided first-run flow for new users — tooltips, a demo board and a gentle intro to drag & drop.",
    ),
    "card-2": card("card-2", "Set up CI/CD pipeline", ["label-dev"], 2),
    "card-3": card(
      "card-3",
      "Write unit tests for the reducer",
      ["label-done"],
      3,
      "Cover move logic, CRUD actions and label cascades with Vitest.",
    ),
    // Demo of multiple labels on one card.
    "card-4": card(
      "card-4",
      "Investigate flaky test suite",
      ["label-blocked", "label-dev"],
      4,
    ),
    "card-5": card("card-5", "Fix critical auth bug", ["label-urgent"], 5),
    "card-6": card("card-6", "Prepare launch checklist", ["label-later"], 6),
  };

  return {
    id: "board-main",
    title: "Product Launch",
    columns: [
      column("col-backlog", "Backlog", ["card-1", "card-2", "card-6"]),
      column("col-progress", "In Progress", ["card-4", "card-5"]),
      column("col-done", "Done", ["card-3"]),
    ],
    cards,
    labels,
    createdAt: now,
    updatedAt: now,
  };
}
