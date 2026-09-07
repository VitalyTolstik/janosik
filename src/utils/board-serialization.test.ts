import { describe, expect, it } from "vitest";

import {
  EXPORT_APP,
  EXPORT_SCHEMA_VERSION,
  parseExport,
  serializeExport,
} from "@/utils/board-serialization";
import { initialBoardState } from "@/store/board-reducer";

/**
 * Tests for export/import JSON: a round-trip preserves the data, the file
 * envelope is stable (the future server seed format), and malformed or
 * unsupported payloads throw readable errors.
 */

describe("board serialization", () => {
  it("round-trips the full state through export → import", () => {
    const state = initialBoardState();
    const imported = parseExport(serializeExport(state));
    expect(imported).toEqual(state);
  });

  it("uses a stable, versioned envelope", () => {
    const state = initialBoardState();
    const parsed = JSON.parse(serializeExport(state)) as {
      app: string;
      schemaVersion: number;
      exportedAt: number;
      boards: unknown;
    };
    expect(parsed.app).toBe(EXPORT_APP);
    expect(parsed.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(typeof parsed.exportedAt).toBe("number");
    expect(parsed.boards).toEqual(state);
  });

  it("rejects anything that is not JSON", () => {
    expect(() => parseExport("not json at all")).toThrow();
  });

  it("rejects payloads that are not a Janosik export", () => {
    expect(() => parseExport(JSON.stringify({ app: "other", boards: [] }))).toThrow();
  });

  it("rejects unknown future schema versions", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: 99,
      boards: [],
    });
    expect(() => parseExport(raw)).toThrow();
  });

  it("rejects missing or invalid board data", () => {
    expect(() =>
      parseExport(
        JSON.stringify({ app: EXPORT_APP, schemaVersion: 1, boards: null }),
      ),
    ).toThrow();
    expect(() =>
      parseExport(
        JSON.stringify({
          app: EXPORT_APP,
          schemaVersion: 1,
          boards: [{}],
        }),
      ),
    ).toThrow();
  });

  it("normalizes legacy labelId shapes on import", () => {
    const legacy = {
      id: "board-legacy",
      title: "Legacy",
      columns: [],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Old",
          labelId: "label-x",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      // labels only needs to be an array for validation
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const imported = parseExport(
      JSON.stringify({ app: EXPORT_APP, schemaVersion: 1, boards: [legacy] }),
    );
    expect(imported[0].cards["card-1"]).toHaveProperty("labelIds", ["label-x"]);
  });
});