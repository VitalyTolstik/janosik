import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("./check-release-version.mjs", import.meta.url),
);

function check({
  version = "0.1.1",
  lockVersion = version,
  rootVersion = version,
  tag = "",
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "janosik-release-version-"));
  try {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ version }));
    writeFileSync(
      join(cwd, "package-lock.json"),
      JSON.stringify({
        version: lockVersion,
        packages: { "": { version: rootVersion } },
      }),
    );
    return spawnSync(process.execPath, [script], {
      cwd,
      env: { ...process.env, RELEASE_TAG: tag },
      encoding: "utf8",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("accepts matching stable and prerelease tags and untagged builds", () => {
  assert.equal(check().status, 0);
  assert.equal(check({ tag: "v0.1.1" }).status, 0);
  assert.equal(check({ version: "0.2.0-rc.1", tag: "v0.2.0-rc.1" }).status, 0);
});

test("rejects a release tag that disagrees with the product version", () => {
  const result = check({ tag: "v0.1.2" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package.json/);
});

test("rejects a lockfile that disagrees with the product version", () => {
  for (const overrides of [
    { lockVersion: "0.1.0" },
    { rootVersion: "0.1.0" },
  ]) {
    const result = check(overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package-lock.json versions must match/);
  }
});

test("rejects invalid product versions", () => {
  assert.notEqual(check({ version: "not-a-version" }).status, 0);
});
