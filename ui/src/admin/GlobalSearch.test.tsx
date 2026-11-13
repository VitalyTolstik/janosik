import { describe, expect, it } from "vitest";
import type { AdminGlobalSearchDto } from "@janosik/shared";
import { buildSearchLines } from "./GlobalSearch";

/**
 * TASK-176.5 — global search must land on the exact object, not just its card:
 * a comment/attachment carries its own id (the card detail centres and
 * highlights it), and a label opens the cards that carry that label.
 */

const groups = {
  users: "Users",
  boards: "Boards",
  cards: "Cards",
  comments: "Comments",
  attachments: "Files",
  labels: "Labels",
};

function results(): AdminGlobalSearchDto {
  return {
    users: [],
    boards: [],
    cards: [],
    comments: [
      {
        id: "cm-1",
        cardId: "c-1",
        cardTitle: "Ship it",
        authorId: "u-1",
        authorEmail: "author@example.com",
        text: "a found comment",
        createdAt: 1,
        updatedAt: 1,
        editedAt: null,
        deletedAt: null,
      },
    ],
    attachments: [
      {
        id: "att-1",
        cardId: "c-1",
        cardTitle: "Ship it",
        boardId: "b-1",
        boardTitle: "—",
        fileName: "spec.pdf",
        storedName: "stored",
        mimeType: "application/pdf",
        sizeBytes: 10,
        uploadedById: "u-1",
        uploadedByEmail: "author@example.com",
        transcodeStatus: "none",
        deletedAt: null,
        createdAt: 1,
      },
    ],
    labels: [
      {
        id: "l-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        name: "urgent",
        color: "red",
        position: 0,
        cardCount: 3,
        deletedAt: null,
        version: 0,
      },
    ],
  };
}

describe("global search result targets", () => {
  it("passes the exact comment id and names the found object", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "comment-cm-1",
    );
    expect(line?.group).toBe("Comments");
    expect(line?.href).toBe("/admin/cards/c-1?comment=cm-1");
    expect(line?.secondary).toContain("Ship it");
  });

  it("passes the exact attachment id", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "attachment-att-1",
    );
    expect(line?.group).toBe("Files");
    expect(line?.href).toBe("/admin/cards/c-1?attachment=att-1");
  });

  it("opens the cards filtered by the label, not the board", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "label-l-1",
    );
    expect(line?.group).toBe("Labels");
    expect(line?.href).toBe("/admin/boards?tab=cards&labelId=l-1");
  });
});
