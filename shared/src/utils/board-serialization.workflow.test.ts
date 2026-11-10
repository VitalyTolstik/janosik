import { describe, expect, it } from "vitest";

import {
  EXPORT_APP,
  EXPORT_SCHEMA_VERSION,
  parseExport,
  serializeExport,
} from "./board-serialization";
import type { Board, BoardAgentPolicy } from "../types/kanban";

const workflow = {
  schemaVersion: 1 as const,
  enabled: true,
  initialColumnId: "col-a",
  doneColumnIds: ["col-b"],
  transitions: [
    {
      id: "tr-1",
      fromColumnId: "col-a",
      toColumnId: "col-b",
      allowedRoles: ["ADMIN" as const, "MEMBER" as const],
    },
  ],
};

function board(): Board {
  return {
    id: "b1",
    title: "Board",
    columns: [
      { id: "col-a", title: "A", cardIds: [], createdAt: 1 },
      { id: "col-b", title: "B", cardIds: [], createdAt: 1 },
    ],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    workflow,
  };
}

describe("export schema v3", () => {
  it("writes version 3 with the workflow and reads it back", () => {
    const raw = serializeExport([board()]);
    expect(JSON.parse(raw).schemaVersion).toBe(3);
    expect(EXPORT_SCHEMA_VERSION).toBe(3);
    expect(parseExport(raw)).toEqual([board()]);
  });

  it("carries the board agent policy and reads it back", () => {
    const policy: BoardAgentPolicy = {
      schemaVersion: 1,
      destructive: "deny",
      requireApprovalFor: ["delete_card"],
      approverRoles: ["ADMIN"],
      maxCommandsPerRun: 50,
      maxCardsPerRun: 20,
      approvalTtlMinutes: 30,
    };
    const raw = serializeExport([{ ...board(), agentPolicy: policy }]);
    expect(parseExport(raw)[0].agentPolicy).toEqual(policy);
  });

  it("still imports a version 1 file without a workflow", () => {
    const legacy = {
      app: EXPORT_APP,
      schemaVersion: 1,
      exportedAt: 1,
      boards: [{ ...board(), workflow: undefined }],
    };
    const parsed = parseExport(JSON.stringify(legacy));
    expect(parsed[0].workflow).toBeUndefined();
  });

  it("rejects an invalid board policy on import", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: 1,
      boards: [
        {
          ...board(),
          agentPolicy: {
            schemaVersion: 1,
            destructive: "approval",
            requireApprovalFor: ["delete_card", "not_a_real_action"],
            approverRoles: ["ADMIN"],
            maxCommandsPerRun: 100,
            maxCardsPerRun: 50,
            approvalTtlMinutes: 60,
          },
        },
      ],
    });
    expect(() => parseExport(raw)).toThrow(
      "agentPolicy: requireApprovalFor contains an unknown action",
    );
  });

  it("imports a version 2 file with a null policy", () => {
    const legacy = {
      app: EXPORT_APP,
      schemaVersion: 2,
      exportedAt: 1,
      boards: [board()],
    };
    const parsed = parseExport(JSON.stringify(legacy));
    expect(parsed[0].agentPolicy).toBeUndefined();
  });

  it("refuses a version above the schema this client knows", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION + 1,
      exportedAt: 1,
      boards: [board()],
    });
    expect(() => parseExport(raw)).toThrow("Unsupported schema version");
  });

  it("keeps the local 10-board guard by default but lets the server cap apply", () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      ...board(),
      id: `b${index}`,
    }));
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: 1,
      boards: many,
    });
    expect(() => parseExport(raw)).toThrow("must hold at most 10 boards");
    expect(parseExport(raw, { maxBoards: null })).toHaveLength(11);
  });
});
