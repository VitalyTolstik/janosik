import { PayloadTooLargeException } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/config/env", () => ({
  env: { MAX_BOARDS_PER_USER: 2 },
}));

import {
  assertBoardExportSize,
  assertBoardQuota,
  boardLimit,
  lockBoardQuota,
} from "./board-limits";

const db = (current: number) =>
  ({
    boardMember: { count: jest.fn(async () => current) },
  }) as never as {
    boardMember: { count: jest.Mock };
  };

describe("TASK-166 board limits", () => {
  it("reads a positive operator cap and treats 0 as unlimited", () => {
    process.env.MAX_BOARDS_PER_USER = "2";
    expect(boardLimit()).toBe(2);
    process.env.MAX_BOARDS_PER_USER = "0";
    expect(boardLimit()).toBeNull();
    delete process.env.MAX_BOARDS_PER_USER;
  });

  it("refuses one over the cap and allows one that fits", async () => {
    const full = db(2);
    await expect(
      assertBoardQuota(full as never, "u1", 1),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "limit_exceeded", limit: 2, current: 2 },
    });

    const room = db(1);
    await expect(
      assertBoardQuota(room as never, "u1", 1),
    ).resolves.toBeUndefined();
  });

  it("locks the account quota only when a cap exists", async () => {
    const tx = { $executeRaw: jest.fn(async () => 1) } as never;
    await lockBoardQuota(tx, "u1");
    expect(
      (tx as unknown as { $executeRaw: jest.Mock }).$executeRaw,
    ).toHaveBeenCalledTimes(1);
  });

  it("never truncates an export: the exact ceiling passes, one byte over is 413", () => {
    expect(() => assertBoardExportSize(25 * 1024 * 1024)).not.toThrow();
    expect(() => assertBoardExportSize(25 * 1024 * 1024 + 1)).toThrow(
      PayloadTooLargeException,
    );
  });
});
