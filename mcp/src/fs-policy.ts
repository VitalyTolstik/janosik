/**
 * Filesystem access for attachment and export tools. Access is opt-in. When
 * a root is configured, paths are opened atomically beneath a pinned root
 * using Linux openat2. A path check followed by open is not a sandbox: an
 * attacker can swap a symlink between those operations.
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";

export interface FsOptions {
  allowFs: boolean;
  fsRoot: string | null;
}

export function assertFsEnabled(options: FsOptions): void {
  if (options.allowFs) return;
  throw new Error(
    "Filesystem access is disabled. Uploading/downloading attachments and " +
      "exporting to a file read and write files on the machine running " +
      "this server, so they are opt-in: set JANOSIK_MCP_ALLOW_FS=1 (and " +
      "optionally JANOSIK_MCP_FS_ROOT=/path to confine them to a directory).",
  );
}

function isWithin(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/*
 * Node has no openat2 binding. This small helper uses libc's syscall from
 * Python's standard library. fd 3 is an already-open root directory; the
 * kernel resolves the entire relative path beneath that same directory in
 * one operation. This also prevents symlink swaps in intermediate paths.
 * Only Linux x64/arm64 is enabled below (openat2 syscall number 437). An
 * unavailable helper or kernel fails closed; there is no realpath fallback.
 */
const OPENAT2_HELPER = String.raw`
import ctypes, errno, os, stat, sys

class OpenHow(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint64), ("mode", ctypes.c_uint64), ("resolve", ctypes.c_uint64)]

try:
    operation, target, maximum = sys.argv[1], sys.argv[2], int(sys.argv[3])
    flags = (os.O_RDONLY | os.O_NONBLOCK) if operation == "read" else (os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    how = OpenHow(flags | os.O_CLOEXEC, 0 if operation == "read" else 0o600, 0x08 | 0x02)
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.syscall(437, 3, os.fsencode(target), ctypes.byref(how), ctypes.sizeof(how))
    if fd < 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise ValueError("already exists. Choose a new file name; existing files are never overwritten.")
        if code in (errno.EXDEV, errno.ELOOP):
            raise ValueError("Path is outside the allowed root or contains an unsafe symlink.")
        if code in (errno.ENOSYS, errno.EINVAL):
            raise ValueError("Secure filesystem access requires Linux openat2 support.")
        raise OSError(code, os.strerror(code))
    try:
        if operation == "read":
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("Target is not a regular file.")
            if info.st_size > maximum:
                raise ValueError("File is over the %d-byte limit." % maximum)
            remaining = maximum + 1
            chunks = []
            while remaining:
                chunk = os.read(fd, min(remaining, 65536))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            if remaining == 0:
                raise ValueError("File is over the %d-byte limit." % maximum)
            sys.stdout.buffer.write(b"".join(chunks))
        else:
            while True:
                chunk = sys.stdin.buffer.read(65536)
                if not chunk:
                    break
                offset = 0
                while offset < len(chunk):
                    offset += os.write(fd, chunk[offset:])
    finally:
        os.close(fd)
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;

async function rootedOperation(
  target: string,
  rootPath: string,
  operation: "read" | "write",
  maxBytes: number,
  data?: Uint8Array | string,
): Promise<{ path: string; data: Buffer }> {
  if (target.includes("\0")) throw new Error("Path contains a null byte.");
  if (
    process.platform !== "linux" ||
    !["x64", "arm64"].includes(process.arch)
  ) {
    throw new Error(
      "Confined filesystem access requires Linux x64 or arm64 with openat2 and python3. " +
        "Filesystem operations are disabled because this platform cannot enforce FS_ROOT safely.",
    );
  }
  const root = await realpath(rootPath);
  const absolute = path.resolve(root, target);
  if (!isWithin(root, absolute)) {
    throw new Error(`Path is outside the allowed root (${root}).`);
  }
  const relative = path.relative(root, absolute) || ".";
  const rootHandle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    // Pin the configured directory, not a symlink substituted after realpath.
    if ((await realpath(`/proc/self/fd/${rootHandle.fd}`)) !== root) {
      throw new Error(
        "The configured filesystem root changed while opening it.",
      );
    }
    const result = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        "python3",
        ["-I", "-c", OPENAT2_HELPER, operation, relative, String(maxBytes)],
        { stdio: ["pipe", "pipe", "pipe", rootHandle.fd] },
      );
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr!.on("data", (chunk: Buffer) => errors.push(chunk));
      // The helper may reject the path before consuming all input.
      child.stdin!.on("error", () => undefined);
      child.on("error", (error) => {
        reject(
          new Error("Secure filesystem access requires python3.", {
            cause: error,
          }),
        );
      });
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else
          reject(
            new Error(
              Buffer.concat(errors).toString("utf8").trim() ||
                "Secure filesystem operation failed.",
            ),
          );
      });
      child.stdin!.end(data);
    });
    return { path: absolute, data: result };
  } finally {
    await rootHandle.close();
  }
}

/** Read only a regular file of bounded size. */
export async function readSandboxedFile(
  target: string,
  options: FsOptions,
  maxBytes: number,
): Promise<{ path: string; data: Buffer }> {
  assertFsEnabled(options);
  if (options.fsRoot)
    return rootedOperation(target, options.fsRoot, "read", maxBytes);
  const resolved = await realpath(path.resolve(target));
  const handle = await open(
    resolved,
    constants.O_RDONLY |
      (process.platform === "linux" ? constants.O_NONBLOCK : 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${resolved} is not a regular file.`);
    if (info.size > maxBytes)
      throw new Error(`${resolved} is over the ${maxBytes}-byte limit.`);
    // Bound the read even if a file grows after fstat.
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= maxBytes) {
      const data = Buffer.alloc(Math.min(65536, maxBytes + 1 - length));
      const { bytesRead } = await handle.read(data, 0, data.length, null);
      if (bytesRead === 0) break;
      chunks.push(data.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > maxBytes)
      throw new Error(`${resolved} is over the ${maxBytes}-byte limit.`);
    return { path: resolved, data: Buffer.concat(chunks, length) };
  } finally {
    await handle.close();
  }
}

/** Write a new file without overwriting an existing path. */
export async function writeSandboxedFile(
  target: string,
  options: FsOptions,
  data: Uint8Array | string,
): Promise<string> {
  assertFsEnabled(options);
  if (options.fsRoot) {
    return (await rootedOperation(target, options.fsRoot, "write", 0, data))
      .path;
  }
  const resolved = path.resolve(target);
  let handle: FileHandle | undefined;
  try {
    handle = await open(resolved, "wx");
    await handle.writeFile(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${resolved} already exists. Choose a new file name; existing files are never overwritten.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return resolved;
}
