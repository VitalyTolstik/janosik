import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_FILTER_MAX_VALUES,
  adminFilterEntries,
  adminFilterLimitError,
  adminFilterValueLimit,
  ADMIN_PAGE_LIMITS,
  ENTITY_FILTERS,
  ENTITY_STATUS_VALUES,
  type AdminListSurface,
  ADMIN_PASSWORD_MAX,
  ADMIN_PASSWORD_MIN,
} from "./admin";

describe("admin contract", () => {
  it("keeps audit actions unique and namespaced", () => {
    expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("ships sane page limits", () => {
    expect(ADMIN_PAGE_LIMITS.min).toBeLessThan(ADMIN_PAGE_LIMITS.default);
    expect(ADMIN_PAGE_LIMITS.default).toBeLessThan(ADMIN_PAGE_LIMITS.max);
    expect(ADMIN_PAGE_LIMITS.max).toBeLessThanOrEqual(100);
  });

  it("bounds master-created passwords like the register DTO", () => {
    expect(ADMIN_PASSWORD_MIN).toBeGreaterThanOrEqual(8);
    expect(ADMIN_PASSWORD_MAX).toBeGreaterThanOrEqual(ADMIN_PASSWORD_MIN);
  });
});

const scoped = "boardId columnId labelId cardId";
const surfaces: [AdminListSurface, string, string, string, boolean, boolean][] =
  [
    ["users", "", "verified", "active disabled", false, false],
    [
      "boards",
      scoped,
      "adminMemberId",
      "active archived deleted",
      false,
      false,
    ],
    [
      "cards",
      `${scoped} labelMatch assigneeId unassigned priority due hasAttachments`,
      "boardId columnId labelId labelMatch assigneeId unassigned priority due hasAttachments",
      "active archived deleted",
      true,
      true,
    ],
    ["columns", scoped, "boardId", "active deleted", false, false],
    ["labels", scoped, "boardId", "active deleted", false, false],
    ["checklists", scoped, "boardId cardId", "active deleted", false, false],
    ["checklistItems", scoped, "", "active deleted", false, false],
    [
      "cardLinks",
      "boardId cardId",
      "boardId cardId type",
      "active deleted",
      false,
      false,
    ],
    [
      "comments",
      scoped,
      "boardId cardId authorId kind",
      "active deleted",
      true,
      true,
    ],
    [
      "attachments",
      scoped,
      "boardId cardId uploadedById mime transcode",
      "active deleted",
      false,
      false,
    ],
    ["activity", scoped, "boardId cardId actorId type", "", true, true],
    [
      "commands",
      "boardId columnId cardId commandId",
      "boardId actorId type cardId columnId commandId",
      "",
      true,
      true,
    ],
    [
      "audit",
      "commandId",
      "adminId action targetType targetId commandId",
      "",
      true,
      true,
    ],
    ["sessions", "", "", "", true, true],
    ["tokens", "", "", "active disabled", true, true],
    ["shares", "boardId", "", "", true, false],
    ["announcements", "", "", "active disabled deleted", false, false],
    ["boardMembers", "boardId", "", "active disabled", false, false],
    ["cardLabels", scoped, "", "", false, false],
    ["admins", "", "", "", false, false],
  ];

describe("admin filter surface matrix", () => {
  it("covers every surface", () => {
    expect(Object.keys(ENTITY_FILTERS).sort()).toEqual(
      surfaces.map(([entity]) => entity).sort(),
    );
  });

  it.each(surfaces)(
    "%s has the declared facets and status values",
    (entity, implemented, offered, statuses, dateRange, period) => {
      const keys = (value: string) => value.split(" ").filter(Boolean).sort();
      const config = ENTITY_FILTERS[entity];
      expect([...config.implemented].sort()).toEqual(keys(implemented));
      expect([...config.offered].sort()).toEqual(keys(offered));
      const statusTabs =
        statuses !== "" &&
        !["tokens", "boardMembers", "checklistItems"].includes(entity);
      expect(config).toMatchObject({ dateRange, period, statusTabs });
      expect([...ENTITY_STATUS_VALUES[entity]].sort()).toEqual(
        keys(`all ${statuses}`),
      );
    },
  );
});

describe("admin filter values", () => {
  it("allows multiple labels on cards and keeps legacy ids single-valued", () => {
    expect(adminFilterValueLimit("labelId", "cards")).toBe(20);
    expect(adminFilterValueLimit("labelId", "comments")).toBe(1);
    expect(adminFilterValueLimit("boardId", "cards")).toBe(1);
    const labels = {
      labelId: ["label-b", " label-a", "label-b"],
      labelMatch: "all",
    } as const;
    expect(adminFilterEntries(labels, "cards")).toEqual([
      ["labelId", "label-a"],
      ["labelId", "label-b"],
      ["labelMatch", "all"],
    ]);
    expect(adminFilterEntries(labels, "comments")).toEqual([]);
    expect(
      adminFilterEntries(
        { labelId: ["label-a", "label-a"], labelMatch: "all" },
        "cards",
      ),
    ).toEqual([["labelId", "label-a"]]);
  });

  it("counts unique values towards the total and encoded length limits", () => {
    const assigneeId = Array.from({ length: 20 }, (_, i) => `user-${i}`);
    const authorId = Array.from({ length: 12 }, (_, i) => `user-${i}`);
    expect(
      adminFilterLimitError(
        adminFilterEntries({
          assigneeId: [...assigneeId, ...assigneeId],
          authorId,
        }),
      ),
    ).toBeUndefined();
    expect(
      adminFilterLimitError(
        adminFilterEntries({
          assigneeId,
          authorId: [...authorId, "user-extra"],
        }),
      ),
    ).toContain("32");
    const longIds = Array.from(
      { length: ADMIN_FILTER_MAX_VALUES },
      (_, i) => `${"u".repeat(62)}${i}`,
    );
    expect(
      adminFilterLimitError(
        adminFilterEntries({
          assigneeId: longIds,
          authorId: longIds.slice(0, 12),
        }),
      ),
    ).toContain("too long");
  });
});
