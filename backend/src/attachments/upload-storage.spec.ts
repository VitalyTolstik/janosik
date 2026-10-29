import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readFilePrefix } from "./upload-storage";

/**
 * TASK-155: magic bytes are checked against a bounded prefix, never by
 * loading the whole (up to 25 MB) upload into memory.
 */
describe("readFilePrefix", () => {
  it("reads at most the requested number of bytes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "janosik-upload-"));
    const file = path.join(dir, "probe.bin");
    await writeFile(file, Buffer.alloc(10_000, 7));
    try {
      const prefix = await readFilePrefix(file, 32);
      expect(prefix).toHaveLength(32);
      expect(prefix.every((byte) => byte === 7)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a short file as-is", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "janosik-upload-"));
    const file = path.join(dir, "tiny.bin");
    await writeFile(file, "abc");
    try {
      expect((await readFilePrefix(file, 4096)).toString()).toBe("abc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
