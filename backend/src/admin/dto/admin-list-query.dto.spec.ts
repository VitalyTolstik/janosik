import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
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
});
