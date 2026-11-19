import { execFile } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSandboxedFile, writeSandboxedFile } from "./fs-policy.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "janosik-mcp-root-"));
  outside = await mkdtemp(path.join(tmpdir(), "janosik-mcp-out-"));
});

afterEach(async () => {
  await Promise.all(
    [root, outside].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const sandbox = () => ({ allowFs: true, fsRoot: root });
const supportedRoot =
  process.platform === "linux" && ["x64", "arm64"].includes(process.arch);

describe.skipIf(!supportedRoot)("readSandboxedFile", () => {
  it("reads a file inside the root, relative to it", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    const file = await readSandboxedFile("a.txt", sandbox(), 1024);
    expect(file.data.toString()).toBe("hello");
  });

  it("refuses a symlink that escapes the root", async () => {
    await writeFile(path.join(outside, "secret"), "key");
    await symlink(path.join(outside, "secret"), path.join(root, "link"));
    await expect(readSandboxedFile("link", sandbox(), 1024)).rejects.toThrow(
      /outside the allowed root/,
    );
  });

  it("refuses directories and oversized files", async () => {
    await expect(readSandboxedFile(".", sandbox(), 1024)).rejects.toThrow(
      /not a regular file/,
    );
    await writeFile(path.join(root, "big"), "x".repeat(100));
    await expect(readSandboxedFile("big", sandbox(), 10)).rejects.toThrow(
      /over the 10-byte limit/,
    );
  });

  it("is disabled without the opt-in", async () => {
    await expect(
      readSandboxedFile("a.txt", { allowFs: false, fsRoot: null }, 10),
    ).rejects.toThrow(/JANOSIK_MCP_ALLOW_FS/);
  });
});

describe.skipIf(!supportedRoot)("writeSandboxedFile", () => {
  it("writes a new file and never overwrites an existing one", async () => {
    const saved = await writeSandboxedFile("out.bin", sandbox(), "one");
    expect(await readFile(saved, "utf8")).toBe("one");
    await expect(
      writeSandboxedFile("out.bin", sandbox(), "two"),
    ).rejects.toThrow(/already exists/);
    expect(await readFile(saved, "utf8")).toBe("one");
  });

  it("refuses a target whose directory escapes the root", async () => {
    await symlink(outside, path.join(root, "escape"));
    await expect(
      writeSandboxedFile("escape/x", sandbox(), "data"),
    ).rejects.toThrow(/outside the allowed root/);
  });
});

describe.skipIf(supportedRoot)("unsupported confined filesystem access", () => {
  it("fails closed for reads and writes", async () => {
    await expect(readSandboxedFile("a.txt", sandbox(), 1024)).rejects.toThrow(
      /cannot enforce FS_ROOT safely/,
    );
    await expect(
      writeSandboxedFile("a.txt", sandbox(), "data"),
    ).rejects.toThrow(/cannot enforce FS_ROOT safely/);
  });
});

const writeModes = [
  { mode: "unconfined", confined: false },
  ...(supportedRoot ? [{ mode: "confined", confined: true }] : []),
];

describe.each(writeModes)("$mode file publication", ({ confined }) => {
  it("installs one complete private file under concurrent writes", async () => {
    const target = path.join(root, "output");
    const options = { allowFs: true, fsRoot: confined ? root : null };
    const documents = ["first".repeat(20_000), "second".repeat(20_000)];
    const results = await Promise.allSettled(
      documents.map((document) =>
        writeSandboxedFile(target, options, document),
      ),
    );
    const winner = results.findIndex((result) => result.status === "fulfilled");
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(results[1 - winner]).toMatchObject({
      status: "rejected",
      reason: { message: expect.stringContaining("already exists") },
    });
    expect(await readFile(target, "utf8")).toBe(documents[winner]);
    expect(await readdir(root)).toEqual(["output"]);
    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(!supportedRoot)(
    "leaves no file after a partial write fails",
    async () => {
      const target = path.join(root, "output");
      // Force a real short write and subsequent EFBIG without filling the disk.
      const limit = [
        "import os, resource, signal, sys",
        "signal.signal(signal.SIGXFSZ, signal.SIG_IGN)",
        "resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))",
        "os.execv(sys.argv[1], sys.argv[1:])",
      ].join("\n");
      const script = `
      import assert from "node:assert/strict";
      import { writeSandboxedFile } from ${JSON.stringify(new URL("./fs-policy.ts", import.meta.url).href)};
      const [target, root] = process.argv.slice(1);
      await assert.rejects(
        writeSandboxedFile(target, { allowFs: true, fsRoot: root ?? null }, Buffer.alloc(128 * 1024)),
        { name: "FilesystemWriteError", message: /EFBIG|File too large/ },
      );
    `;
      await promisify(execFile)("python3", [
        "-c",
        limit,
        process.execPath,
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        target,
        ...(confined ? [root] : []),
      ]);
      expect(await readdir(root)).toEqual([]);
    },
  );
});
