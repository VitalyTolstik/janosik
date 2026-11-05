import { buildTranscodeArgs, TranscodeService } from "./transcode.service";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The TASK-50 encode profile: ≤1080p x264 CRF 25 + faststart — the actual
 * ffmpeg invocation is exercised end-to-end in `attachments-transcode.e2e-spec`.
 */
describe("buildTranscodeArgs", () => {
  it("scales, encodes x264/aac and faststarts the output", () => {
    const args = buildTranscodeArgs("/data/in.mov", "/data/.tmp-x.mp4");
    const has = (flag: string) => args.includes(flag);

    expect(args[0]).toBe("-y");
    expect(args[args.indexOf("-i") + 1]).toBe("/data/in.mov");
    expect(args[args.length - 1]).toBe("/data/.tmp-x.mp4");
    expect(has("-movflags") && has("+faststart")).toBe(true);
    expect(args[args.indexOf("-crf") + 1]).toBe("25");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.indexOf("-vf") + 1]).toContain("min(1920,iw)");
  });
});

describe("transcode output size", () => {
  it.each([
    ["video/mp4", 5, true],
    ["video/mp4", 10, false],
    ["video/mp4", 15, false],
    ["video/quicktime", 15, true],
  ])(
    "converts %s with a %i-byte result (replace: %s)",
    async (mimeType, size, shouldReplace) => {
      const dir = await mkdtemp(path.join(tmpdir(), "transcode-test-"));
      try {
        const original = path.join(dir, "original.mov");
        await writeFile(original, Buffer.alloc(10, 1));
        const prisma = {
          attachment: {
            findFirst: jest.fn().mockResolvedValue({
              id: "a",
              cardId: "c",
              boardId: "b",
              storedName: "original.mov",
              mimeType,
              transcodeStatus: "pending",
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        const realtime = { publish: jest.fn() };
        const service = new TranscodeService(
          prisma as never,
          { attachmentPath: (name: string) => path.join(dir, name) } as never,
          realtime as never,
        );
        jest
          .spyOn(
            service as unknown as {
              encode: (input: string, output: string) => Promise<void>;
            },
            "encode",
          )
          .mockImplementation(async (_input, output) =>
            writeFile(output, Buffer.alloc(size, 2)),
          );
        await service.process("a");
        const data = prisma.attachment.updateMany.mock.calls[0][0].data;
        expect(data.transcodeStatus).toBe("done");
        if (shouldReplace) {
          expect(data.mimeType).toBe("video/mp4");
          expect((await readFile(path.join(dir, data.storedName))).length).toBe(
            size,
          );
        } else {
          expect(data.storedName).toBeUndefined();
          expect(await readFile(original)).toEqual(Buffer.alloc(10, 1));
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * TASK-87: a transient encode failure must leave the row `pending` while
 * BullMQ still has attempts left, so the retry is not a no-op; only the last
 * attempt (or the never-retrying in-process fallback) marks it `failed`.
 */
describe("TranscodeService retry policy", () => {
  const pendingRow = {
    id: "att-1",
    cardId: "card-1",
    boardId: "board-1",
    storedName: "clip.mp4",
    transcodeStatus: "pending",
  };

  function build() {
    const prisma = {
      attachment: {
        findFirst: jest.fn().mockResolvedValue(pendingRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage = { attachmentPath: (name: string) => `/blobs/${name}` };
    const realtime = { publish: jest.fn() };
    const service = new TranscodeService(
      prisma as never,
      storage as never,
      realtime as never,
    );
    jest
      .spyOn(service as unknown as { encode: () => Promise<void> }, "encode")
      .mockRejectedValue(new Error("ffmpeg died"));
    return { service, prisma };
  }

  it("keeps the row pending while attempts remain", async () => {
    const { service, prisma } = build();
    await expect(
      service.process("att-1", { attemptsMade: 0, attempts: 3 }),
    ).rejects.toThrow("ffmpeg died");
    expect(prisma.attachment.updateMany).not.toHaveBeenCalled();
  });

  it("marks the row failed on the final attempt", async () => {
    const { service, prisma } = build();
    await expect(
      service.process("att-1", { attemptsMade: 2, attempts: 3 }),
    ).rejects.toThrow("ffmpeg died");
    expect(prisma.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { transcodeStatus: "failed" } }),
    );
  });

  it("marks the row failed in the in-process fallback (no retry info)", async () => {
    const { service, prisma } = build();
    await expect(service.process("att-1")).rejects.toThrow("ffmpeg died");
    expect(prisma.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { transcodeStatus: "failed" } }),
    );
  });
});
