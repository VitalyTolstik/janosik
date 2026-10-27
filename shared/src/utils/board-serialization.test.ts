import { describe, expect, it } from "vitest";

import {
  EXPORT_APP,
  EXPORT_SCHEMA_VERSION,
  parseExport,
  serializeExport,
} from "./board-serialization";
import { initialBoardState } from "../store/board-reducer";
import { LIMITS } from "../types/kanban";

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
    expect(() =>
      parseExport(JSON.stringify({ app: "other", boards: [] })),
    ).toThrow();
  });

  it("rejects unknown future schema versions", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: 99,
      boards: [],
    });
    expect(() => parseExport(raw)).toThrow();
  });

  it("rejects non-integer or non-positive schema versions", () => {
    for (const schemaVersion of [0, -1, 1.5, Number.NaN]) {
      const raw = JSON.stringify({
        app: EXPORT_APP,
        schemaVersion,
        boards: [],
      });
      expect(() => parseExport(raw), `version ${schemaVersion}`).toThrow(
        "Unsupported schema version",
      );
    }
  });

  it("accepts the current integer schema version", () => {
    const raw = JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      boards: [],
    });
    expect(parseExport(raw)).toEqual([]);
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

/**
 * S-7: an import is checked strictly before the lenient normalization —
 * a malformed file is refused with a field path, never with a raw
 * TypeError from inside `normalizeBoards` or a 500 from the server writer.
 */
describe("parseExport — strict structure and integrity (S-7)", () => {
  const wrap = (boards: unknown): string =>
    JSON.stringify({
      app: EXPORT_APP,
      schemaVersion: 1,
      exportedAt: 1,
      boards,
    });

  const board = (extra: Record<string, unknown> = {}) => ({
    id: "b",
    title: "Board",
    createdAt: 1,
    updatedAt: 1,
    labels: [],
    columns: [{ id: "col", title: "Todo", cardIds: ["k1"], createdAt: 1 }],
    cards: {
      k1: { id: "k1", title: "One", labelIds: [], createdAt: 1, updatedAt: 1 },
    },
    ...extra,
  });

  /** Parse and return the error, asserting it is a readable `Error`. */
  function failure(raw: string): Error {
    try {
      parseExport(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      return error as Error;
    }
    throw new Error("expected parseExport to throw");
  }

  it("accepts a well-formed board", () => {
    expect(parseExport(wrap([board()]))[0].cards["k1"].title).toBe("One");
  });

  it.each([
    ["a null label", board({ labels: [null] }), "boards[0].labels[0]"],
    [
      "a column without a title",
      board({ columns: [{ id: "col", cardIds: [], createdAt: 1 }] }),
      "boards[0].columns[0].title",
    ],
    [
      "a card with a string timestamp",
      board({
        cards: {
          k1: {
            id: "k1",
            title: "One",
            labelIds: [],
            createdAt: "now",
            updatedAt: 1,
          },
        },
      }),
      'boards[0].cards["k1"].createdAt',
    ],
    [
      "a timestamp outside the Date range",
      board({ updatedAt: 1e300 }),
      "boards[0].updatedAt",
    ],
    [
      "a card stored under another key",
      board({
        cards: {
          k1: {
            id: "k2",
            title: "t",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
      'boards[0].cards["k1"].id',
    ],
    [
      "a dangling card id",
      board({
        columns: [
          { id: "col", title: "a", cardIds: ["k1", "missing"], createdAt: 1 },
        ],
      }),
      "boards[0].columns[0].cardIds[1]",
    ],
    [
      "a card listed twice in one column",
      board({
        columns: [
          { id: "col", title: "a", cardIds: ["k1", "k1"], createdAt: 1 },
        ],
      }),
      "boards[0].columns[0].cardIds[1]",
    ],
    [
      "a card in two columns",
      board({
        columns: [
          { id: "c1", title: "a", cardIds: ["k1"], createdAt: 1 },
          { id: "c2", title: "b", cardIds: ["k1"], createdAt: 1 },
        ],
      }),
      "boards[0].columns[1].cardIds[0]",
    ],
    [
      "duplicate column ids",
      board({
        columns: [
          { id: "col", title: "a", cardIds: ["k1"], createdAt: 1 },
          { id: "col", title: "b", cardIds: [], createdAt: 1 },
        ],
      }),
      "boards[0].columns[1].id",
    ],
    [
      "too many columns",
      board({
        columns: Array.from({ length: LIMITS.columnsPerBoard + 1 }, (_, i) => ({
          id: `c${i}`,
          title: "a",
          cardIds: [],
          createdAt: 1,
        })),
        cards: {},
      }),
      "boards[0].columns",
    ],
    [
      "too many cards in a column",
      board({
        columns: [
          {
            id: "col",
            title: "a",
            cardIds: Array.from(
              { length: LIMITS.cardsPerColumn + 1 },
              (_, i) => `k${i}`,
            ),
            createdAt: 1,
          },
        ],
      }),
      "boards[0].columns[0].cardIds",
    ],
  ])("refuses %s with its field path", (_label, value, field) => {
    expect(failure(wrap([value])).message).toContain(field);
  });

  it("refuses a __proto__ card key", () => {
    const raw =
      '{"app":"janosik","schemaVersion":1,"exportedAt":1,"boards":[{"id":"b","title":"t","createdAt":1,"updatedAt":1,"columns":[],"labels":[],"cards":{"__proto__":{"id":"__proto__","title":"t","labelIds":[],"createdAt":1,"updatedAt":1}}}]}';
    expect(failure(raw).message).toContain("reserved");
  });

  it("refuses more boards than the workspace holds", () => {
    const boards = Array.from({ length: LIMITS.boardsCount + 1 }, (_, i) =>
      board({ id: `b${i}` }),
    );
    expect(failure(wrap(boards)).message).toContain("boards");
  });

  it("refuses duplicate board ids", () => {
    expect(failure(wrap([board(), board()])).message).toContain("boards[1].id");
  });
});
