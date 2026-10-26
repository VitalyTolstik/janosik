import type { User } from "@prisma/client";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { PresenceService } from "@/realtime/presence.service";
import type { RealtimeService } from "@/realtime/realtime.service";
import type { StorageService } from "@/attachments/storage.service";
import { UsersService } from "./users.service";

const prismaMock = {
  user: {
    update: jest.fn(),
  },
  boardMember: {
    findMany: jest.fn(),
  },
} as unknown as PrismaService & {
  user: Record<"update", jest.Mock>;
  boardMember: Record<"findMany", jest.Mock>;
};

const presenceMock = {
  updateUser: jest.fn(),
} as unknown as PresenceService & { updateUser: jest.Mock };

const realtimeMock = {
  publish: jest.fn(),
} as unknown as RealtimeService & { publish: jest.Mock };

const storageMock = {} as unknown as StorageService;

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "",
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  disabledAt: null,
  emailVerifiedAt: null,
  notifyDigest: true,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("UsersService", () => {
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.boardMember.findMany.mockResolvedValue([]);
    service = new UsersService(
      prismaMock,
      presenceMock,
      realtimeMock,
      storageMock,
    );
  });

  describe("updateProfile", () => {
    it("writes only the provided keys and returns the fresh projection", async () => {
      prismaMock.user.update.mockResolvedValue(
        makeUser({ displayName: "Vera", avatarColor: "pink" }),
      );

      const result = await service.updateProfile("user-1", {
        displayName: "Vera",
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { displayName: "Vera" },
      });
      expect(result).toEqual({
        id: "user-1",
        email: "user@example.com",
        displayName: "Vera",
        avatarColor: "pink",
        avatarPath: null,
        emailVerifiedAt: null,
        createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
      });
    });

    it("clears a field with null", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {
        displayName: null,
        avatarColor: null,
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { displayName: null, avatarColor: null },
      });
    });

    it("passes an empty patch through untouched", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {});

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {},
      });
    });

    it("rewrites live identities and refreshes every board's directory", async () => {
      prismaMock.user.update.mockResolvedValue(
        makeUser({ displayName: "Vera", avatarColor: "pink" }),
      );
      prismaMock.boardMember.findMany.mockResolvedValue([
        { boardId: "board-1" },
        { boardId: "board-2" },
      ]);

      await service.updateProfile("user-1", {
        displayName: "Vera",
        avatarColor: "pink",
      });

      expect(presenceMock.updateUser).toHaveBeenCalledWith("user-1", {
        displayName: "Vera",
        avatarColor: "pink",
        avatarPath: null,
      });
      expect(prismaMock.boardMember.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", acceptedAt: { not: null } },
        select: { boardId: true },
      });
      expect(realtimeMock.publish).toHaveBeenCalledTimes(2);
      expect(realtimeMock.publish).toHaveBeenCalledWith("board-1", {
        type: "membership",
        boardId: "board-1",
        userId: "user-1",
        change: "updated",
      });
      expect(realtimeMock.publish).toHaveBeenCalledWith("board-2", {
        type: "membership",
        boardId: "board-2",
        userId: "user-1",
        change: "updated",
      });
    });

    it("keeps an empty patch silent for presence and members", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {});

      expect(presenceMock.updateUser).not.toHaveBeenCalled();
      expect(prismaMock.boardMember.findMany).not.toHaveBeenCalled();
      expect(realtimeMock.publish).not.toHaveBeenCalled();
    });
  });
});
