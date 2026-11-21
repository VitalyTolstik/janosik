/**
 * TASK-177.16 first-run starter. The board itself is created empty; this plan
 * tells the server (as commands) and the offline store (as reducer state) what
 * columns, welcome card and checklist a new user gets when they choose the
 * example instead of an empty board.
 *
 * Keep the copy here so the backend and the UI cannot drift.
 */
export const BOARD_STARTER_LOCALES = ["en", "ru"] as const;

export type BoardStarterLocale = (typeof BOARD_STARTER_LOCALES)[number];

export interface BoardStarterCopy {
  todo: string;
  inProgress: string;
  done: string;
  cardTitle: string;
  checklistTitle: string;
  items: readonly [string, string, string];
}

export const BOARD_STARTER_COPY: Record<BoardStarterLocale, BoardStarterCopy> =
  {
    en: {
      todo: "To do",
      inProgress: "In progress",
      done: "Done",
      cardTitle: "Welcome to your board",
      checklistTitle: "First steps",
      items: [
        "Rename the board to your project",
        "Add your first real card",
        "Invite a teammate",
      ],
    },
    ru: {
      todo: "Сделать",
      inProgress: "В работе",
      done: "Готово",
      cardTitle: "Добро пожаловать на доску",
      checklistTitle: "Первые шаги",
      items: [
        "Переименуйте доску под свой проект",
        "Добавьте первую настоящую карточку",
        "Пригласите коллегу",
      ],
    },
  };

export interface BoardStarterPlan {
  columns: Array<{ id: string; title: string }>;
  card: { id: string; columnId: string; title: string };
  checklist: {
    id: string;
    title: string;
    items: Array<{ id: string; text: string }>;
  };
}

/** Resolve one starter plan with caller-generated ids (server or offline). */
export function boardStarterPlan(
  locale: BoardStarterLocale,
  newId: () => string,
): BoardStarterPlan {
  const copy = BOARD_STARTER_COPY[locale];
  const columns = [copy.todo, copy.inProgress, copy.done].map((title) => ({
    id: newId(),
    title,
  }));
  const cardId = newId();
  return {
    columns,
    card: {
      id: cardId,
      columnId: columns[0]!.id,
      title: copy.cardTitle,
    },
    checklist: {
      id: newId(),
      title: copy.checklistTitle,
      items: copy.items.map((text) => ({ id: newId(), text })),
    },
  };
}
