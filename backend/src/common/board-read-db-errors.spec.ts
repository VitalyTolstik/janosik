import { classifyBoardReadDbError } from "./board-read-db-errors";

describe("classifyBoardReadDbError", () => {
  it("treats a pool timeout as pool_wait", () => {
    expect(
      classifyBoardReadDbError({
        code: "P2024",
        message: "Timed out fetching a new connection from the connection pool",
      }),
    ).toBe("pool_wait");
  });

  it("distinguishes a transaction-start pool wait from an expired read", () => {
    expect(
      classifyBoardReadDbError({
        code: "P2028",
        message:
          "Transaction API error: Unable to start a transaction in the given time.",
      }),
    ).toBe("pool_wait");
    expect(
      classifyBoardReadDbError({
        code: "P2028",
        message:
          "Transaction already closed: A query cannot be executed on an expired transaction.",
      }),
    ).toBe("timeout");
  });

  it("ignores unrelated errors", () => {
    expect(classifyBoardReadDbError(new Error("boom"))).toBeUndefined();
    expect(classifyBoardReadDbError({ code: "P2025" })).toBeUndefined();
    expect(classifyBoardReadDbError(null)).toBeUndefined();
  });
});
