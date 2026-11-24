import { BOARD_TEMPLATE_IDS, COMMAND_BATCH_MAX } from "@janosik/shared";

import { boardTemplateCommands } from "./board-templates";

describe("boardTemplateCommands", () => {
  it.each(BOARD_TEMPLATE_IDS)(
    "turns %s into a bounded, ordered command batch",
    (templateId) => {
      const commands = boardTemplateCommands(
        "board-1",
        templateId,
        "en",
        1_700_000_000_000,
      );

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.length).toBeLessThanOrEqual(80);
      expect(commands.length).toBeLessThanOrEqual(COMMAND_BATCH_MAX);
      for (const command of commands) {
        expect(command.commandId).toEqual(expect.any(String));
        expect(command.action).toMatchObject({
          boardId: "board-1",
          at: 1_700_000_000_000,
        });
      }

      const types = commands.map(
        (command) => (command.action as { type: string }).type,
      );
      const firstCard = types.indexOf("ADD_CARD");
      const firstLabel = types.indexOf("ADD_LABEL");
      expect(types.slice(0, firstLabel)).toEqual(
        types.slice(0, firstLabel).map(() => "ADD_COLUMN"),
      );
      expect(firstLabel).toBeGreaterThan(0);
      expect(firstCard).toBeGreaterThan(firstLabel);
      expect(types).toContain("ADD_CHECKLIST_ITEM");
      expect(types).toContain("SET_CARD_DUE_DATE");
    },
  );

  it("localizes column, card and checklist copy", () => {
    const commands = boardTemplateCommands(
      "board-1",
      "product-launch",
      "ru",
      1_700_000_000_000,
    );
    const titles = commands
      .map((command) => command.action as { type: string; title?: string })
      .filter((action) => action.type === "ADD_COLUMN")
      .map((action) => action.title);
    expect(titles).toEqual([
      "Стратегия",
      "Подготовка",
      "Перед запуском",
      "Выпущено",
    ]);
  });
});
