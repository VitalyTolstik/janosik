import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { readSandboxedFile, writeSandboxedFile } from "./fs-policy.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "janosik-mcp-root-"));
  outside = await mkdtemp(path.join(tmpdir(), "janosik-mcp-out-"));
});

const sandbox = () => ({ allowFs: true, fsRoot: root });

describe("readSandboxedFile", () => {
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

describe("writeSandboxedFile", () => {
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
