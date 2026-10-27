/**
 * Filesystem policy for the tools that touch the machine running this server
 * (attachment upload/download, board export to a file). Board content is
 * untrusted — it reaches the model as tool output — so these tools are
 * opt-in, can be confined to one directory, never follow a symlink out of
 * that directory, never overwrite an existing file and never read anything
 * but a regular file of bounded size.
 */

import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";

/** Filesystem access policy, from the server config. */
export interface FsOptions {
  allowFs: boolean;
  fsRoot: string | null;
}

/** Reject a filesystem call unless the operator opted in. */
export function assertFsEnabled(options: FsOptions): void {
  if (options.allowFs) return;
  throw new Error(
    "Filesystem access is disabled. Uploading/downloading attachments and " +
      "exporting to a file read and write files on the machine running " +
      "this server, so they are opt-in: set JANOSIK_MCP_ALLOW_FS=1 (and " +
      "optionally JANOSIK_MCP_FS_ROOT=/path to confine them to a directory).",
  );
}

/** Whether `child` is `root` itself or lies beneath it. */
function isWithin(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * The real (symlink-free) path of `target`, refused when it escapes the
 * sandbox root. A relative path resolves against the root when one is set.
 * For a file about to be created, the parent directory is resolved instead.
 */
async function resolveInRoot(
  target: string,
  options: FsOptions,
  forCreate: boolean,
): Promise<string> {
  const root = options.fsRoot ? await realpath(options.fsRoot) : null;
  const absolute = path.resolve(root ?? process.cwd(), target);
  const real = forCreate
    ? path.join(await realpath(path.dirname(absolute)), path.basename(absolute))
    : await realpath(absolute);
  if (root !== null && !isWithin(root, real)) {
    throw new Error(`Path is outside the allowed root (${root}).`);
  }
  return real;
}

/**
 * Read a regular file for upload, refusing devices, directories, files
 * outside the root (symlinks included) and anything over `maxBytes`.
 */
export async function readSandboxedFile(
  target: string,
  options: FsOptions,
  maxBytes: number,
): Promise<{ path: string; data: Buffer }> {
  assertFsEnabled(options);
  const resolved = await resolveInRoot(target, options, false);
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`${resolved} is not a regular file.`);
  }
  if (info.size > maxBytes) {
    throw new Error(
      `${resolved} is ${info.size} bytes, over the ${maxBytes}-byte limit.`,
    );
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(resolved, "r");
    return { path: resolved, data: await handle.readFile() };
  } finally {
    await handle?.close();
  }
}

/**
 * Write a new file inside the root. `wx` fails when the path already exists
 * — including a planted symlink — so a download can never overwrite an
 * existing file such as a shell profile.
 */
export async function writeSandboxedFile(
  target: string,
  options: FsOptions,
  data: Uint8Array | string,
): Promise<string> {
  assertFsEnabled(options);
  const resolved = await resolveInRoot(target, options, true);
  let handle: FileHandle | undefined;
  try {
    handle = await open(resolved, "wx");
    await handle.writeFile(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${resolved} already exists. Choose a new file name; existing files ` +
          "are never overwritten.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return resolved;
}
