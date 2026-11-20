import type { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./wipe";

describe("wipeAll", () => {
  const $executeRawUnsafe = jest.fn<
    ReturnType<PrismaService["$executeRawUnsafe"]>,
    [string]
  >();
  const prisma = { $executeRawUnsafe };

  beforeEach(() => $executeRawUnsafe.mockReset());

  it("retries the same truncate after a deadlock and a serialization failure", async () => {
    $executeRawUnsafe
      .mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } })
      .mockRejectedValueOnce({ code: "40001" })
      .mockResolvedValueOnce(0);

    await wipeAll(prisma);

    const [[statement]] = $executeRawUnsafe.mock.calls;
    expect(statement).toMatch(/^TRUNCATE TABLE .* RESTART IDENTITY CASCADE$/);
    expect($executeRawUnsafe.mock.calls).toEqual([
      [statement],
      [statement],
      [statement],
    ]);
  });

  it("rethrows the last error after three failed attempts", async () => {
    const lastError = { code: "P2010", meta: { code: "40001" } };
    $executeRawUnsafe
      .mockRejectedValueOnce({ code: "40P01" })
      .mockRejectedValueOnce({ code: "40P01" })
      .mockRejectedValueOnce(lastError);

    await expect(wipeAll(prisma)).rejects.toBe(lastError);
    expect($executeRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it("rethrows other errors without retrying", async () => {
    const error = { code: "P2010", meta: { code: "42P01" } };
    $executeRawUnsafe.mockRejectedValueOnce(error);

    await expect(wipeAll(prisma)).rejects.toBe(error);
    expect($executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
