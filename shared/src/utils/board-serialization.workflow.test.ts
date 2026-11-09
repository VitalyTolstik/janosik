import { describe, expect, it } from "vitest";

import {
  EXPORT_APP,
  EXPORT_SCHEMA_VERSION,
  parseExport,
  serializeExport,
} from "./board-serialization";
import type { Board } from "../types/kanban";

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

describe("export schema v2", () => {
  it("writes version 2 with the workflow and reads it back", () => {
    const raw = serializeExport([board()]);
    expect(JSON.parse(raw).schemaVersion).toBe(2);
    expect(EXPORT_SCHEMA_VERSION).toBe(2);
    expect(parseExport(raw)).toEqual([board()]);
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

  it("refuses a version above the schema this client knows", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION + 1,
      exportedAt: 1,
      boards: [board()],
    });
    expect(() => parseExport(raw)).toThrow("Unsupported schema version");
  });
});
