import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
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
    ["users", "verified", "verified", "active disabled", true, true],
    [
      "boards",
      `${scoped} adminMemberId`,
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
      "boardId cardId type",
      "boardId cardId type",
      "active deleted",
      false,
      false,
    ],
    [
      "comments",
      `${scoped} authorId kind`,
      "boardId cardId authorId kind",
      "active deleted",
      true,
      true,
    ],
    [
      "attachments",
      `${scoped} uploadedById mime transcode`,
      "boardId cardId uploadedById mime transcode",
      "active deleted",
      true,
      true,
    ],
    [
      "activity",
      `${scoped} actorId type`,
      "boardId cardId actorId type",
      "",
      true,
      true,
    ],
    [
      "commands",
      "boardId columnId cardId commandId actorId type",
      "boardId actorId type cardId columnId commandId",
      "",
      true,
      true,
    ],
    [
      "audit",
      "commandId adminId action targetType targetId",
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
    (entity, supported, offered, statuses, dateRange, period) => {
      const keys = (value: string) => value.split(" ").filter(Boolean).sort();
      const config = ENTITY_FILTERS[entity];
      expect([...config.supported].sort()).toEqual(keys(supported));
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
