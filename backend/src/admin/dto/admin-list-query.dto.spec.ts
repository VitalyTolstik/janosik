import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AdminBoardCommandDto } from "./admin-board-command.dto";
import { AdminListQueryDto } from "./admin-list-query.dto";

/**
 * TASK-176.6 — structural filters are ids, not free text. The validator must
 * accept the client-generated id alphabet and reject path/query injection
 * before a Prisma query is built.
 */

async function check(value: Record<string, unknown>) {
  return validate(plainToInstance(AdminListQueryDto, value));
}

describe("AdminListQueryDto structural filters", () => {
  it("accepts valid board/column/label/card ids", async () => {
    const errors = await check({
      boardId: "b-1",
      columnId: "col_2",
      labelId: "label-3",
      cardId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects values that are not ids", async () => {
    const errors = await check({
      boardId: "bad$id",
      columnId: "../../etc/passwd",
      labelId: "a".repeat(65),
      cardId: "card/1",
    });
    expect(errors.map((error) => error.property).sort()).toEqual([
      "boardId",
      "cardId",
      "columnId",
      "labelId",
    ]);
  });

  it("treats an empty filter as absent", async () => {
    const dto = plainToInstance(AdminListQueryDto, {
      boardId: "  ",
      columnId: "",
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.boardId).toBeUndefined();
    expect(dto.columnId).toBeUndefined();
  });

  it("caps an oversized offset instead of passing it to Prisma", async () => {
    const errors = await check({
      offset: String(1_000_001),
    });
    expect(errors.map((error) => error.property)).toEqual(["offset"]);
  });

  it("validates the commandId read filter like every other id", async () => {
    const valid = plainToInstance(AdminListQueryDto, {
      commandId: "  0f8fad5b-d9cb-469f-a165-70867728950e  ",
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.commandId).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");

    for (const commandId of ["", "   ", "bad$id", "a".repeat(65)]) {
      const dto = plainToInstance(AdminListQueryDto, { commandId });
      const errors = await validate(dto);
      expect(errors.map((error) => error.property)).toContain("commandId");
    }
  });
});

describe("AdminBoardCommandDto commandId", () => {
  const action = { type: "UPDATE_CARD", cardId: "card-1", at: 1 };

  it("trims and accepts a valid idempotency key", async () => {
    const dto = plainToInstance(AdminBoardCommandDto, {
      commandId: "  cmd_1  ",
      action,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.commandId).toBe("cmd_1");
  });

  it("rejects empty, whitespace, oversized and non-id command ids", async () => {
    for (const commandId of ["", "   ", "a".repeat(65), "bad$id"]) {
      const dto = plainToInstance(AdminBoardCommandDto, {
        commandId,
        action,
      });
      const errors = await validate(dto);
      expect(errors.map((error) => error.property)).toContain("commandId");
    }
  });
});
