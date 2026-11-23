import type { PrismaService } from "@/common/prisma/prisma.service";
import type { RealtimeService } from "@/realtime/realtime.service";

type Invalidation = Parameters<RealtimeService["publishInvalidation"]>[0];

/** A minimal shared control bus standing in for Redis pub/sub. */
function controlBus() {
  const listeners = new Set<(event: Invalidation) => void>();
  const service = {
    onInvalidation(listener: (event: Invalidation) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishInvalidation(event: Invalidation) {
      for (const listener of listeners) listener(event);
    },
  } as unknown as RealtimeService;
  return { service, listeners };
}

function processConfig(prisma: PrismaService, realtime: RealtimeService) {
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
      settings: new ThrottleSettingsService(prisma, realtime),
    };
  });
  return config;
}

it("a saved throttle limit is live on the editing process and reaches peers without a restart", async () => {
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
  const bus = controlBus();
  const first = processConfig(prisma, bus.service);
  const peer = processConfig(prisma, bus.service);
  await first.settings.onModuleInit();
  await peer.settings.onModuleInit();
  expect(first.limit()).toBe(123);
  expect(peer.limit()).toBe(123);

  await first.settings.update(456, "admin");
  expect(first.limit()).toBe(456);
  // TASK-200.12: the control frame applies on the peer immediately instead of
  // waiting for its next restart.
  expect(peer.limit()).toBe(456);
  expect((await peer.settings.getPublic()).limit).toBe(456);
  const restarted = processConfig(prisma, bus.service);
  await restarted.settings.onModuleInit();
  expect(restarted.limit()).toBe(456);

  first.settings.onModuleDestroy();
  peer.settings.onModuleDestroy();
  restarted.settings.onModuleDestroy();
});
