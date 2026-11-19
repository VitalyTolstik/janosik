import type { PrismaService } from "@/common/prisma/prisma.service";

function processConfig(prisma: PrismaService) {
  let config!: {
    limit: () => number;
    settings: InstanceType<
      typeof import("./throttle-settings.service").ThrottleSettingsService
    >;
  };
  jest.isolateModules(() => {
    const { throttleLimit } =
      jest.requireActual<typeof import("@/config/throttle")>(
        "@/config/throttle",
      );
    const { ThrottleSettingsService } = jest.requireActual<
      typeof import("./throttle-settings.service")
    >("./throttle-settings.service");
    config = {
      limit: throttleLimit,
      settings: new ThrottleSettingsService(prisma),
    };
  });
  return config;
}

it("a saved throttle limit is live on the editing process and applies to peers on restart", async () => {
  let row = { limit: 123, updatedBy: "admin", updatedAt: new Date() };
  const prisma = {
    throttleSettings: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async ({ update }: { update: { limit: number } }) => {
        row = { ...row, limit: update.limit };
        return row;
      }),
    },
  } as unknown as PrismaService;
  const first = processConfig(prisma);
  const peer = processConfig(prisma);
  await first.settings.onModuleInit();
  await peer.settings.onModuleInit();
  expect(first.limit()).toBe(123);
  expect(peer.limit()).toBe(123);

  await first.settings.update(456, "admin");
  expect(first.limit()).toBe(456);
  expect(peer.limit()).toBe(123);
  expect((await peer.settings.getPublic()).limit).toBe(456);
  const restarted = processConfig(prisma);
  await restarted.settings.onModuleInit();
  expect(restarted.limit()).toBe(456);
});
