import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { NotFoundException } from "@nestjs/common";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  extensionForMime,
  mimeForExtension,
  sniffMime,
  StorageService,
} from "./storage.service";

/**
 * TASK-78: `send` must never let a vanished blob (deleted between the
 * `existsSync` check and the read, e.g. by the orphan sweep) emit an
 * unhandled `'error'` and take the process down.
 */
describe("StorageService.send", () => {
  let root: string;
  let storage: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "janosik-storage-"));
    storage = new StorageService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("pipes the blob into the response", async () => {
    const absPath = path.join(root, "blob.bin");
    await writeFile(absPath, "payload");

    const chunks: Buffer[] = [];
    const res = new Writable({
      write(chunk: Buffer, _enc, done) {
        chunks.push(chunk);
        done();
      },
    });

    await storage.send(absPath, res);

    expect(Buffer.concat(chunks).toString()).toBe("payload");
  });

  it("404s when the blob is already gone", async () => {
    await expect(
      storage.send(path.join(root, "missing.bin"), new Writable()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("aborts without throwing when the blob disappears mid-read", async () => {
    const absPath = path.join(root, "blob.bin");
    await writeFile(absPath, "payload");

    jest.spyOn(storage, "open").mockReturnValue(
      new Readable({
        read() {
          this.destroy(new Error("ENOENT: vanished"));
        },
      }),
    );

    const res = new Writable({
      write(_c, _e, done) {
        done();
      },
    });

    await expect(storage.send(absPath, res)).resolves.toBeUndefined();
    expect(res.destroyed).toBe(true);
  });
});

/** TASK-76: the server type comes from the bytes, never the client header. */
describe("sniffMime", () => {
  it("recognises the image families the allowlist accepts", () => {
    expect(
      sniffMime(
        Buffer.from(
          "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
          "hex",
        ),
      ),
    ).toBe("image/png");
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe(
      "image/jpeg",
    );
    expect(sniffMime(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(
      sniffMime(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1")),
    ).toBe("image/webp");
  });

  it("recognises documents and media containers", () => {
    expect(sniffMime(Buffer.from("%PDF-1.7\n", "latin1"))).toBe(
      "application/pdf",
    );
    expect(sniffMime(Buffer.from("PK\u0003\u0004rest", "latin1"))).toBe(
      "application/zip",
    );
    expect(
      sniffMime(
        Buffer.from([
          0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f,
          0x6d,
        ]),
      ),
    ).toBe("video/mp4");
  });

  it("returns null for content with no known signature", () => {
    expect(
      sniffMime(Buffer.from("<html><script>alert(1)</script>")),
    ).toBeNull();
    expect(sniffMime(Buffer.from('{"json":true}'))).toBeNull();
    expect(sniffMime(Buffer.from(""))).toBeNull();
  });

  it("maps a detected type to a canonical extension", () => {
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/webp")).toBe(".webp");
    expect(extensionForMime("text/html")).toBeNull();
  });

  /** TASK-120: the served avatar type comes from the server-named extension. */
  it("maps a stored extension back to a served MIME", () => {
    expect(mimeForExtension(".jpg")).toBe("image/jpeg");
    expect(mimeForExtension("webp")).toBe("image/webp");
    expect(mimeForExtension(".png")).toBe("image/png");
    expect(mimeForExtension(".weird")).toBe("application/octet-stream");
  });
});
