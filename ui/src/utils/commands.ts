import type { BoardView } from "@/components/board/ViewSwitcher";
import type { MessageKey } from "@/i18n";
import type { Board } from "@janosik/shared";

export interface CommandActions {
  setView?: (view: BoardView) => void;
  openFilters?: () => void;
  openMembers?: () => void;
  openShare?: () => void;
  openSettings?: () => void;
  openData?: () => void;
  toggleDensity?: () => void;
  /** H3 can supply this once the board inspector has an open/toggle handler. */
  openPanel?: () => void;
}

type CommandOption = {
  id: string;
  label: string;
  keywords?: string;
};

type CommandAction = CommandOption & { run: () => void };
type CommandPicker = CommandOption & { choices: CommandAction[] };
export type PaletteCommand = CommandAction | CommandPicker;

const VIEWS = ["board", "calendar", "table", "watch"] as const;

const ACTIONS = [
  ["openFilters", "filter.filters", "commands.keywords.filters"],
  ["openMembers", "board.members.button", "commands.keywords.members"],
  ["openShare", "share.button", "commands.keywords.share"],
  ["openSettings", "board.settings.button", "commands.keywords.settings"],
  ["openData", "data.tooltip", "commands.keywords.data"],
  ["toggleDensity", "view.densityMenu", "commands.keywords.density"],
  ["openPanel", "commands.panel", "commands.keywords.panel"],
] as const;

export function readCommandQuery(input: string): string | null {
  return input.startsWith(">") ? input.slice(1).trim() : null;
}

export function filterCommands<T extends PaletteCommand>(
  commands: T[],
  query: string,
): T[] {
  if (query === "") return commands;
  const terms = query.toLowerCase().split(/\s+/);
  return commands.filter(({ label, keywords }) => {
    const text = `${label} ${keywords ?? ""}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function boardCommands(
  t: (key: MessageKey) => string,
  boards: readonly Pick<Board, "id" | "title" | "archivedAt">[],
  openBoard: (id: string) => void,
  actions?: CommandActions,
): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const choices = boards
    .filter((board) => board.archivedAt === undefined)
    .map(({ id, title }) => ({ id, label: title, run: () => openBoard(id) }));

  if (choices.length > 0) {
    commands.push({
      id: "boards",
      label: t("board.switcher.aria"),
      keywords: t("commands.keywords.boards"),
      choices,
    });
  }
  const setView = actions?.setView;
  if (setView) {
    const views = VIEWS.map((id) => ({
      id,
      label: t(`view.${id}`),
      run: () => setView(id),
    }));
    commands.push({
      id: "views",
      label: t("commands.switchView"),
      keywords: views.map(({ label }) => label).join(" "),
      choices: views,
    });
  }
  for (const [id, label, keywords] of ACTIONS) {
    const run = actions?.[id];
    if (run) commands.push({ id, label: t(label), keywords: t(keywords), run });
  }
  return commands;
}
