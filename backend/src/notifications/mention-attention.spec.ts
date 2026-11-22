import {
  deleteCommentMentionAttention,
  deleteCommentMentionAttentionForUsers,
  deleteMentionAttentionForComments,
  escapeLikePrefix,
  type MentionAttentionDb,
} from "./mention-attention";

function makeDb(rows: Array<{ id: string; attentionMailId: string | null }>) {
  return {
    attentionNotification: {
      findMany: jest.fn().mockResolvedValue(rows),
      deleteMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
    notificationMail: {
      deleteMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
  } as unknown as MentionAttentionDb & {
    attentionNotification: { findMany: jest.Mock; deleteMany: jest.Mock };
    notificationMail: { deleteMany: jest.Mock };
  };
}

describe("mention attention cleanup (TASK-177.12)", () => {
  it("targets the exact comment id, never a LIKE wildcard", async () => {
    const db = makeDb([{ id: "row-1", attentionMailId: "mail-1" }]);

    await deleteCommentMentionAttention(db, "mention_a");

    expect(db.attentionNotification.findMany).toHaveBeenCalledWith({
      where: { type: "comment.mention", commentId: "mention_a" },
      select: { id: true, attentionMailId: true },
    });
    expect(db.attentionNotification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["row-1"] } },
    });
    expect(db.notificationMail.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["mail-1"] } },
    });
  });

  it("removes only the recipients whose mention was edited out", async () => {
    const db = makeDb([{ id: "row-1", attentionMailId: null }]);

    await deleteCommentMentionAttentionForUsers(db, "comment-1", [
      "user-1",
      "user-1",
    ]);

    expect(db.attentionNotification.findMany).toHaveBeenCalledWith({
      where: {
        type: "comment.mention",
        commentId: "comment-1",
        userId: { in: ["user-1"] },
      },
      select: { id: true, attentionMailId: true },
    });
  });

  it("batches GDPR cleanup for the erased author's comments", async () => {
    const db = makeDb([{ id: "row-1", attentionMailId: "mail-1" }]);

    await deleteMentionAttentionForComments(db, ["comment-1", "comment-1"]);

    expect(db.attentionNotification.findMany).toHaveBeenCalledWith({
      where: {
        type: "comment.mention",
        commentId: { in: ["comment-1"] },
      },
      select: { id: true, attentionMailId: true },
    });
  });

  it("escapes legacy prefix metacharacters", () => {
    expect(escapeLikePrefix("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });
});
