// TASK-200.1 — git/environment metadata for the report.

import { execFileSync } from "node:child_process";
import os from "node:os";

export function gitInfo(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    return {
      commit: run(["rev-parse", "HEAD"]),
      branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: run(["status", "--porcelain", "--untracked-files=no"]) !== "",
    };
  } catch {
    return { commit: "unknown", branch: "unknown", dirty: false };
  }
}

export function environmentInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
    hostname: os.hostname(),
  };
}
