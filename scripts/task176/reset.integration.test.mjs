import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { ids, manifest } from "../fixtures/task176-demo.mjs";
import { consumeSeedNonce, probeIdentity } from "./identity.mjs";
import {
  assertFreePort,
  backend,
  createBackendLifecycle,
  lockDemo,
  root,
} from "./lifecycle.mjs";
import { childEnv, demoTarget } from "./target.mjs";

const enabled = process.env.TASK176_INTEGRATION_ALLOW === "1";
const requireBackend = createRequire(join(backend, "package.json"));
const dbUrl = process.env.TASK176_TEST_DATABASE_URL;
const cli = "scripts/task176-demo.mjs";
const secret = () => randomBytes(32).toString("hex");
const pidPattern = /TASK-176 backend PID (\d+) listening/g;
const stampPattern =
  /live rows SHA-256 ([a-f0-9]{64}), manifest SHA-256 ([a-f0-9]{64})/;
const dbName = (url) => new URL(url).pathname.slice(1);

function start(
  args,
  cwd,
  env,
  { detached = false, node = process.execPath } = {},
) {
  const proc = spawn(node, args, {
    cwd,
    env,
    detached,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (chunk) => {
    output += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => resolve({ code, signal, output }));
  });
  return { proc, closed, output: () => output };
}

async function until(read, label) {
  for (let retry = 0; retry < 400; retry += 1) {
    const value = await read();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function isLive(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return !["Z", "X"].includes(
      stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3),
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listen(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function resetPort() {
  // Keep application listeners out of the default Linux ephemeral port range.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const reservation = await listen(randomInt(10_000, 30_000));
      await reservation.close();
      return reservation.port;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("Could not find an available TASK-176 API port.");
}

function createSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "task176-test-"));
  for (const file of [
    cli,
    "scripts/seed-agent-pixel-demo.mjs",
    "scripts/fixtures/task176-demo.mjs",
    "backend/dist",
    "backend/scripts/admin-cli.cjs",
    "backend/package.json",
  ]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file), { recursive: true });
  }
  cpSync(join(root, "scripts/task176"), join(dir, "scripts/task176"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.mjs"),
  });
  for (const path of [
    "node_modules",
    "backend/node_modules",
    "backend/prisma",
  ]) {
    if (existsSync(join(root, path)))
      symlinkSync(join(root, path), join(dir, path), "dir");
  }
  return dir;
}

async function addDrift(prisma) {
  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: ids.cardClaim },
      data: {
        title: "Card claim visibility 123",
        description:
          "API reference sweep — exact MCP transport contract. фывфыв",
        columnId: ids.columnOpsDone,
        position: 2,
        assigneeId: ids.userAdmin,
        priority: "blocker",
        coverType: "color",
        coverValue: "yellow",
      },
    });
    await tx.label.update({
      where: { id: "px-label-task176-demo" },
      data: { color: "yellow" },
    });
    await tx.checklist.create({
      data: {
        id: "junk-checklist",
        cardId: ids.cardClaim,
        title: "123",
        position: 1,
        items: { create: [{ id: "junk-item", text: "1", position: 0 }] },
      },
    });
    await tx.cardLink.create({
      data: {
        id: "ecf5bed6-5786-464e-a720-a48bed381023",
        boardId: ids.boardOps,
        fromCardId: ids.cardClaim,
        toCardId: ids.cardMcpCallouts,
        type: "relates_to",
        position: 2,
      },
    });
    await tx.comment.createMany({
      data: Array.from({ length: 60 }, (_, n) => ({
        id: `t176-comment-${n}`,
        cardId: ids.cardClaim,
        authorId: ids.userAdmin,
        text: "Manual TASK-176.9 scaffold",
        deletedAt: n < 9 ? new Date() : null,
      })),
    });
    await tx.user.createMany({
      data: [{ email: "1@t.com" }, { email: "2@t.com" }],
    });
  });
  await addOutOfFixtureRows(prisma);
}

async function addOutOfFixtureRows(prisma) {
  await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.create({
      data: {
        email: "disposable@example.invalid",
        passwordHash: "unused",
        role: "OWNER",
      },
    });
    const expiry = new Date(Date.now() + 86_400_000);
    await tx.adminRefreshToken.create({
      data: { adminId: admin.id, tokenHash: "unused", expiresAt: expiry },
    });
    await tx.adminAuditLog.create({
      data: { adminId: admin.id, adminEmail: admin.email, action: "test" },
    });
    await tx.securityAuditLog.create({
      data: { userId: ids.userAdmin, actorId: ids.userAdmin, action: "test" },
    });
    await tx.reminderSent.create({
      data: { cardId: ids.cardClaim, userId: ids.userAdmin, dueDate: expiry },
    });
    await tx.idempotencyRecord.create({
      data: {
        scope: "test",
        actorKey: "test",
        key: "test",
        requestHash: "test",
        expiresAt: expiry,
      },
    });
    await tx.notificationMail.create({
      data: { id: "out-of-fixture", kind: "reminder", nextAttemptAt: expiry },
    });
  });
}

const cleared = [
  "securityAuditLog",
  "idempotencyRecord",
  "reminderSent",
  "adminUser",
  "adminRefreshToken",
  "adminAuditLog",
  "announcementDismissal",
  "notificationMail",
  "comment",
  "refreshToken",
];

function retainGlobals(cipher) {
  return [
    ["featureFlag", "key", { key: "task176-test-flag", enabled: true }],
    [
      "emailSettings",
      "id",
      {
        id: "singleton",
        provider: "custom",
        host: "127.0.0.1",
        port: 1,
        from: "smtp@example.invalid",
        username: "test",
        passwordEnc: cipher,
      },
    ],
    [
      "emailTemplate",
      "key",
      {
        key: "task176-test-template",
        subject: "Fixture test",
        bodyHtml: "<p>Fixture test</p>",
      },
    ],
    ["opsSettings", "id", { id: "singleton", retentionDays: 42 }],
    ["throttleSettings", "id", { id: "singleton", limit: 5000 }],
    [
      "announcement",
      "id",
      { id: "task176-test-announcement", createdBy: "test", active: false },
    ],
    [
      "announcementTranslation",
      "id",
      {
        id: "task176-test-translation",
        announcementId: "task176-test-announcement",
        locale: "en",
        title: "Test",
        body: "Test",
      },
    ],
  ];
}

test(
  "TASK-176 disposable PostgreSQL reset suite",
  { skip: !enabled, timeout: 180_000 },
  async (t) => {
    const jwt = secret();
    const devJwt = secret();
    const settings = secret();
    const pass = secret();
    const smtp = secret();
    const port = await resetPort();
    const api = `http://127.0.0.1:${port}`;
    // Require the regular exact-name guard. Deploy/reset only on a test cluster
    // explicitly provided by the caller.
    const target = demoTarget(
      { DEMO_DATABASE_URL: dbUrl, DEMO_API_URL: api },
      { api: true },
    );
    const otherUrl = (suffix) => {
      const url = new URL(dbUrl);
      url.pathname = `/janosik_task183_1_${suffix}`;
      return url.href;
    };
    const devUrl = otherUrl("dev");
    const pixelUrl = otherUrl("pixel");
    const dir = createSandbox();
    const runtime = join(dir, "runtime");
    mkdirSync(runtime, { mode: 0o700 });
    const runtimeBefore = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = runtime;
    t.after(() => {
      if (runtimeBefore === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = runtimeBefore;
    });
    const prisma = new PrismaClient({ datasourceUrl: dbUrl });
    const dev = new PrismaClient({ datasourceUrl: devUrl });
    const env = {
      ...childEnv(target),
      NODE_ENV: "development",
      DEMO_DATABASE_URL: dbUrl,
      DEMO_API_URL: api,
      DEMO_RESET_ALLOW: "1",
      JWT_SECRET: jwt,
      SETTINGS_SECRET: settings,
      ADMIN_PASSWORD: pass,
      XDG_RUNTIME_DIR: runtime,
    };
    const sensitive = [
      dbUrl,
      devUrl,
      jwt,
      devJwt,
      settings,
      pass,
      smtp,
      "jnk_pixel_",
      "pixel-demo-password",
      decodeURIComponent(new URL(dbUrl).username),
      decodeURIComponent(new URL(dbUrl).password),
    ].filter(Boolean);
    function redacted(output) {
      assert.ok(
        sensitive.every((value) => !output.includes(value)),
        "Sensitive value appeared in process output or argv.",
      );
    }
    async function command(args, overrides = {}) {
      const result = await start([cli, ...args], dir, { ...env, ...overrides })
        .closed;
      redacted(result.output);
      if (args[0] === "reset") await prisma.$disconnect();
      return result;
    }
    async function success(args, overrides) {
      const { code, output } = await command(args, overrides);
      assert.equal(code, 0, output);
      return output;
    }
    function deploy(url, schema = join(dir, "backend/prisma/schema.prisma")) {
      const prismaCli = requireBackend.resolve("prisma/build/index.js");
      const result = spawnSync(
        process.execPath,
        [prismaCli, "migrate", "deploy", "--schema", schema],
        {
          cwd: dir,
          env: { ...childEnv(target), DATABASE_URL: url },
          encoding: "utf8",
        },
      );
      assert.equal(
        result.status,
        0,
        `Could not migrate disposable ${dbName(url)}.`,
      );
    }
    const dotenvFile = join(dir, "backend/.env");
    function dotenvFor(url, apiPort) {
      return [
        `DATABASE_URL=${url}`,
        "NODE_ENV=development",
        `PORT=${apiPort}`,
        `JWT_SECRET=${devJwt}`,
        "COOKIE_SECURE=false",
        "SMTP_HOST=127.0.0.1",
        "SMTP_PORT=1",
        "JANOSIK_DEMO_RESET=0",
        "JANOSIK_DEMO_RESET_ENV_FILE=/tampered",
        "JANOSIK_DEMO_RESET_NONCE=tampered",
        `DEMO_DATABASE_URL=${devUrl}`,
        "PRISMA_SCHEMA_ENGINE_BINARY=/file/does/not/exist",
      ].join("\n");
    }
    async function withNormalBackend(url, work) {
      const reservation = await listen();
      const apiPort = reservation.port;
      await reservation.close();
      writeFileSync(dotenvFile, dotenvFor(url, apiPort), { mode: 0o600 });
      const normal = start([join(dir, "backend/dist/main.js")], dir, {
        ...env,
        JANOSIK_DEMO_RESET: "1",
        JANOSIK_DEMO_RESET_ENV_FILE: "/tampered",
      });
      try {
        await until(
          () => normal.output().includes("API listening"),
          "normal backend",
        );
        return await work(`http://127.0.0.1:${apiPort}`);
      } finally {
        normal.proc.kill("SIGTERM");
        await normal.closed;
        writeFileSync(dotenvFile, dotenvFor(devUrl, 5312), { mode: 0o600 });
      }
    }
    function secretBox(operation, cipher = "") {
      const sealed = mkdtempSync(join(dir, "keys-"));
      const nonce = secret();
      const file = join(sealed, `env-${nonce}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          nonce,
          env: {
            DATABASE_URL: dbUrl,
            NODE_ENV: "test",
            PORT: String(port),
            JWT_SECRET: jwt,
            SETTINGS_SECRET: settings,
            PUBLIC_ORIGIN: api,
            COOKIE_SECURE: "false",
            UPLOAD_DIR: join(sealed, "uploads"),
          },
        }),
        { mode: 0o600 },
      );
      const code = `const box = require("./backend/dist/mailer/secret-box.js");
      if (process.env.T176_OPERATION === "encrypt") console.log(box.encryptSecret(process.env.T176_SMTP));
      else process.exit(box.decryptSecret(process.env.T176_CIPHER) === process.env.T176_SMTP ? 0 : 1);`;
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          code,
          "--",
          "secret-box",
          "--demo-reset",
          `--demo-reset-env-file=${file}`,
          `--demo-reset-nonce=${nonce}`,
          `--demo-reset-port=${port}`,
        ],
        {
          cwd: dir,
          env: {
            ...env,
            T176_OPERATION: operation,
            T176_SMTP: smtp,
            T176_CIPHER: cipher,
          },
          encoding: "utf8",
        },
      );
      assert.equal(
        result.status,
        0,
        "SMTP credential did not survive with the original reset settings key.",
      );
      redacted(result.stdout + result.stderr);
      return result.stdout.trim();
    }
    const verify = async () =>
      (await success(["verify"])).match(stampPattern)?.[1];
    async function assertReset(result, fingerprint, backendCount = 2) {
      assert.equal(result.match(stampPattern)?.[1], fingerprint);
      assert.equal(await verify(), fingerprint);
      const pids = [...result.matchAll(pidPattern)].map((match) =>
        Number(match[1]),
      );
      assert.equal(pids.length, backendCount);
      assert.equal(new Set(pids).size, backendCount);
      assert.ok(pids.every((pid) => !isLive(pid)));
      await assertFreePort(port);
      for (const model of cleared)
        assert.equal(await prisma[model].count(), 0, model);
      assert.equal(await dev.user.count(), 0);
      assert.equal(await dev.adminUser.count(), 0);
    }

    async function killDuringSeed(interrupted, pidToKill) {
      const seedPid = await until(() => {
        const pids = [...interrupted.output().matchAll(pidPattern)];
        return pids.length === 2 && Number(pids[1][1]);
      }, "seed-only backend");
      // Hold a seed write in flight, after the fixture users have been created.
      await prisma.$disconnect();
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`LOCK TABLE "ApiToken" IN SHARE MODE`;
          await until(
            async () =>
              (await prisma.user.count({ where: { id: ids.userAdmin } })) === 1,
            "seed user write",
          );
          process.kill(pidToKill, "SIGKILL");
          assert.equal((await interrupted.closed).signal, "SIGKILL");
        },
        { timeout: 20_000 },
      );
      assert.ok(isLive(seedPid));
      return seedPid;
    }

    async function stopWrapper(child) {
      if (child.proc.exitCode === null && child.proc.signalCode === null)
        child.proc.kill("SIGTERM");
      await child.closed;
    }

    try {
      for (const url of [devUrl, pixelUrl]) deploy(url);
      writeFileSync(dotenvFile, dotenvFor(devUrl, 5312), { mode: 0o600 });
      let fingerprint;
      await t.test(
        "reset repairs a dropped public schema before starting the backend",
        async () => {
          await prisma.$executeRaw`DROP SCHEMA IF EXISTS public CASCADE`;
          for (const file of [
            "config/demo-reset-env.js",
            "auth/security-stamp-hmac.js",
          ]) {
            const artifact = join(dir, "backend/dist", file);
            renameSync(artifact, `${artifact}.bak`);
            try {
              const staleBuild = await command(["reset"]);
              assert.equal(staleBuild.code, 1);
              assert.match(staleBuild.output, /Build the backend/);
              assert.doesNotMatch(
                staleBuild.output,
                /Repairing incomplete|Terminated PostgreSQL|backend PID/,
              );
            } finally {
              renameSync(`${artifact}.bak`, artifact);
            }
          }
          const unauthorized = await command(["reset"], {
            DEMO_RESET_ALLOW: undefined,
          });
          assert.equal(unauthorized.code, 1);
          assert.match(unauthorized.output, /DEMO_RESET_ALLOW=1/);
          assert.doesNotMatch(
            unauthorized.output,
            /Repairing incomplete|Terminated PostgreSQL|backend PID/,
          );
          const fallback = await command(["reset", "--fallback"]);
          assert.equal(fallback.code, 1, fallback.output);
          assert.match(
            fallback.output,
            /schema is incomplete.*without --fallback/,
          );
          assert.doesNotMatch(
            fallback.output,
            /Terminated PostgreSQL|backend PID/,
          );
          const initial = await success(["reset"]);
          const [, liveHash, manifestHash] = initial.match(stampPattern) ?? [];
          fingerprint = liveHash;
          assert.ok(fingerprint);
          assert.notEqual(fingerprint, manifestHash);
          assert.match(
            initial,
            /Repairing incomplete TASK-176 schema on .*\/janosik_task176_demo\.[\s\S]*backend PID/,
          );
          await assertReset(initial, fingerprint, 1);
        },
      );
      assert.ok(fingerprint);

      await t.test(
        "reset repairs a schema left after the first two real migrations",
        async () => {
          const early = join(dir, "early-prisma");
          mkdirSync(join(early, "migrations"), { recursive: true });
          cpSync(
            join(backend, "prisma/schema.prisma"),
            join(early, "schema.prisma"),
          );
          for (const name of [
            "migration_lock.toml",
            "20260916000000_init",
            "20260916000001_add_refresh_token",
          ]) {
            cpSync(
              join(backend, "prisma/migrations", name),
              join(early, "migrations", name),
              { recursive: true },
            );
          }
          await prisma.$executeRaw`DROP SCHEMA public CASCADE`;
          await prisma.$executeRaw`CREATE SCHEMA public`;
          await prisma.$disconnect();
          deploy(dbUrl, join(early, "schema.prisma"));
          const [state] = await prisma.$queryRaw`
          SELECT to_regclass('public."User"') IS NOT NULL AS "hasUser",
            to_regclass('public."Board"') IS NOT NULL AS "hasBoard"
        `;
          assert.deepEqual(state, { hasUser: true, hasBoard: false });
          const repaired = await success(["reset"]);
          assert.match(repaired, /Repairing incomplete TASK-176 schema/);
          await assertReset(repaired, fingerprint, 1);
        },
      );

      await t.test(
        "out-of-fixture runtime and account rows leave verification and its hash unchanged",
        async () => {
          await addOutOfFixtureRows(prisma);
          const counts = async () =>
            Promise.all(
              [
                "securityAuditLog",
                "idempotencyRecord",
                "reminderSent",
                "adminAuditLog",
                "adminRefreshToken",
                "adminUser",
                "notificationMail",
              ].map((model) => prisma[model].count()),
            );
          const before = await counts();
          assert.ok(before.every((count) => count > 0));
          assert.equal(await verify(), fingerprint);
          assert.deepEqual(await counts(), before);
          await assertReset(await success(["reset"]), fingerprint);
        },
      );

      const cipher = secretBox("encrypt");
      const globals = retainGlobals(cipher);
      async function populateGlobals() {
        for (const [model, key, data] of globals) {
          await prisma[model].upsert({
            where: { [key]: data[key] },
            update: {},
            create: data,
          });
        }
        await prisma.announcementDismissal.create({
          data: {
            announcementId: "task176-test-announcement",
            userId: ids.userAdmin,
            version: 1,
          },
        });
        return Promise.all(
          globals.map(([model, key, data]) =>
            prisma[model].findUniqueOrThrow({ where: { [key]: data[key] } }),
          ),
        );
      }

      await t.test(
        "primary reset twice with FK drift and non-zero runtime/account rows",
        async () => {
          for (let round = 0; round < 2; round += 1) {
            await addDrift(prisma);
            await populateGlobals();
            assert.equal((await command(["verify"])).code, 1);
            const idle = new PrismaClient({ datasourceUrl: dbUrl });
            try {
              const [{ pid }] =
                await idle.$queryRaw`SELECT pg_backend_pid() AS pid`;
              const result = await success(["reset"]);
              assert.match(
                result,
                new RegExp(
                  `Terminated PostgreSQL connections for ${target.database}: [^\\n]*\\b${pid}\\b`,
                ),
              );
              await assertReset(result, fingerprint);
              for (const [model, key, data] of globals)
                assert.equal(
                  await prisma[model].count({ where: { [key]: data[key] } }),
                  0,
                );
            } finally {
              await idle.$disconnect();
            }
          }
        },
      );

      await t.test(
        "fallback twice retains global settings and decrypts the saved SMTP credential",
        async () => {
          for (let round = 0; round < 2; round += 1) {
            await addDrift(prisma);
            const before = await populateGlobals();
            for (const model of cleared.filter(
              (name) => name !== "refreshToken",
            )) {
              assert.ok((await prisma[model].count()) > 0, model);
            }
            const result = await success(["reset", "--fallback"]);
            await assertReset(result, fingerprint);
            const after = await Promise.all(
              globals.map(([model, key, data]) =>
                prisma[model].findUniqueOrThrow({
                  where: { [key]: data[key] },
                }),
              ),
            );
            assert.deepEqual(after, before);
            secretBox("decrypt", after[1].passwordEnc);
          }
        },
      );

      await t.test(
        "admin CLI binds to demo despite backend/.env, creates OWNER and keeps secrets out of argv",
        async () => {
          const admin = start(
            [cli, "admin", "--email", "owner@example.invalid"],
            dir,
            {
              ...env,
              DATABASE_URL: devUrl,
              API_URL: "http://127.0.0.1:1",
              DEMO_API_URL: undefined,
            },
          );
          const argv = await until(() => {
            try {
              const children = readFileSync(
                `/proc/${admin.proc.pid}/task/${admin.proc.pid}/children`,
                "utf8",
              ).trim();
              for (const pid of children.split(" ").filter(Boolean)) {
                const args = readFileSync(`/proc/${pid}/cmdline`, "utf8");
                if (args.includes("admin-cli.cjs")) return args;
              }
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }, "admin child process");
          redacted(argv);
          const result = await admin.closed;
          redacted(result.output);
          assert.equal(result.code, 0, result.output);
          assert.equal(
            (
              await prisma.adminUser.findUniqueOrThrow({
                where: { email: "owner@example.invalid" },
              })
            ).role,
            "OWNER",
          );
          assert.equal(await dev.adminUser.count(), 0);
          assert.equal(await verify(), fingerprint);
        },
      );

      await t.test(
        "admin rejects database URL argv without echoing it or creating a master",
        async () => {
          const fakeUrl =
            "postgresql://argv-only-user:argv-only-pass@127.0.0.1/argv-only-db";
          const before = await prisma.adminUser.count();
          for (const args of [
            [
              cli,
              "admin",
              "--email",
              "argv@example.invalid",
              "--database-url",
              fakeUrl,
            ],
            [
              "backend/scripts/admin-cli.cjs",
              "create",
              "--demo-task176",
              "--email",
              "argv@example.invalid",
              `--database-url=${fakeUrl}`,
            ],
          ]) {
            const result = await start(args, dir, env).closed;
            assert.equal(result.code, 1);
            redacted(result.output);
            assert.doesNotMatch(result.output, /postgresql:|argv-only-/);
          }
          assert.equal(await prisma.adminUser.count(), before);
        },
      );

      await t.test(
        "reset rejects DB and API target conflicts and verify uses only the demo DB",
        async () => {
          const wrongApi = "http://127.0.0.1:1";
          for (const [key, value] of [
            ["DATABASE_URL", devUrl],
            ["API_URL", wrongApi],
          ]) {
            const result = await command(["reset"], { [key]: value });
            assert.equal(result.code, 1);
            assert.match(
              result.output,
              new RegExp(`Conflicting ${key} and DEMO_${key}`),
            );
            assert.doesNotMatch(
              result.output,
              /Terminated PostgreSQL|backend PID/,
            );
          }
          const verified = await success(["verify"], {
            DATABASE_URL: devUrl,
            API_URL: wrongApi,
            DEMO_API_URL: undefined,
          });
          assert.equal(verified.match(stampPattern)?.[1], fingerprint);
        },
      );

      await t.test(
        "normal boot ignores reset env controls and a real wrong database rejects the marker",
        async () => {
          await withNormalBackend(devUrl, async (normalApi) => {
            await assert.rejects(
              probeIdentity(
                prisma,
                { apiUrl: normalApi },
                { assertListening() {} },
                devJwt,
              ),
              /HTTP 401/,
            );
            assert.equal(await dev.user.count(), 0);
            assert.equal(await prisma.user.count(), 2);
            assert.equal(await prisma.board.count(), 2);
          });
        },
      );

      await t.test(
        "read-only verify preserves sessions and flags registration and comments",
        async () => {
          await withNormalBackend(dbUrl, async (normalApi) => {
            const registration = await fetch(
              `${normalApi}/api/v1/auth/register`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: "extra@t.com", password: pass }),
              },
            );
            await registration.body?.cancel();
            assert.equal(registration.status, 201);
          });
          const extra = await prisma.user.findUniqueOrThrow({
            where: { email: "extra@t.com" },
          });
          assert.match(
            (await command(["verify"])).output,
            /Fixture user count/,
          );
          // Keep its refresh token on a canonical user so a successful verification
          // can be checked for session writes too.
          await prisma.refreshToken.updateMany({
            where: { userId: extra.id },
            data: { userId: ids.userAdmin },
          });
          await prisma.user.delete({ where: { id: extra.id } });
          const tokens = () =>
            prisma.apiToken.findMany({ orderBy: { id: "asc" } });
          const sessions = () =>
            prisma.refreshToken.findMany({ orderBy: { id: "asc" } });
          const before = await Promise.all([tokens(), sessions()]);
          assert.ok(before[0].some((token) => token.lastUsedAt));
          assert.ok(before[1].length > 0);
          assert.equal(await verify(), fingerprint);
          assert.deepEqual(await Promise.all([tokens(), sessions()]), before);
          await prisma.comment.create({
            data: {
              id: "t176-comment-soft-deleted",
              cardId: ids.cardClaim,
              authorId: ids.userAdmin,
              text: "drift",
              deletedAt: new Date(),
            },
          });
          assert.match(
            (await command(["verify"])).output,
            /Fixture comment count/,
          );
          await prisma.activity.deleteMany({
            where: {
              type: {
                in: ["comment_added", "comment_updated", "comment_deleted"],
              },
            },
          });
          await prisma.commentRevision.deleteMany();
          await prisma.comment.deleteMany();
        },
      );

      await t.test(
        "occupied port, production, and non-200 identity abort before deletion",
        async () => {
          const held = await listen();
          try {
            const occupiedApi = `http://127.0.0.1:${held.port}`;
            const result = await command(["reset"], {
              API_URL: occupiedApi,
              DEMO_API_URL: occupiedApi,
            });
            assert.equal(result.code, 1);
            assert.match(result.output, /port \d+ is unavailable/);
          } finally {
            await held.close();
          }
          assert.match(
            (await command(["reset"], { NODE_ENV: "production" })).output,
            /refuse NODE_ENV=production/,
          );
          await prisma.opsSettings.update({
            where: { id: "singleton" },
            data: { maintenanceMode: true, maintenanceMessage: pass },
          });
          try {
            const result = await command(["reset"]);
            assert.equal(result.code, 1);
            assert.match(result.output, /identity probe returned HTTP 503/);
            assert.doesNotMatch(
              result.output,
              /Terminated PostgreSQL|may be partial/,
            );
          } finally {
            await prisma.opsSettings.update({
              where: { id: "singleton" },
              data: { maintenanceMode: false, maintenanceMessage: null },
            });
          }
          assert.equal(await verify(), fingerprint);
          assert.ok((await prisma.adminUser.count()) > 0);
        },
      );

      await t.test(
        "seed grant is one-shot and bound to the proven backend and target",
        async () => {
          const lock = lockDemo(target);
          const lifecycle = createBackendLifecycle(lock, target, {
            jwtSecret: jwt,
            settingsSecret: settings,
            publicOrigin: api,
          });
          try {
            await lifecycle.start();
            const grant = await probeIdentity(prisma, target, lifecycle, jwt, {
              authorizeSeed: true,
            });
            assert.throws(
              () =>
                consumeSeedNonce(
                  { ...grant, nonce: secret() },
                  target,
                  lifecycle,
                ),
              /reset-issued/,
            );
            consumeSeedNonce(grant, target, lifecycle);
            assert.throws(
              () => consumeSeedNonce(grant, target, lifecycle),
              /reset-issued/,
            );
          } finally {
            await lifecycle.dispose();
            lock.close();
          }
        },
      );

      await t.test(
        "stale process metadata cannot signal an unrelated process",
        async () => {
          const other = spawn(
            process.execPath,
            ["-e", "setInterval(() => {}, 1000)"],
            { detached: true, stdio: "ignore" },
          );
          const exit = new Promise((resolve) => other.once("close", resolve));
          const lock = lockDemo(target);
          const stale = mkdtempSync(join(lock.stateDir, "run-"));
          lock.close();
          try {
            const stat = readFileSync(`/proc/${other.pid}/stat`, "utf8");
            writeFileSync(
              join(stale, "backend.json"),
              JSON.stringify({
                pid: other.pid,
                start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
                port,
                nonce: secret(),
                node: process.execPath,
                entry: "different",
                main: "different",
              }),
              { mode: 0o600 },
            );
            const result = await command(["reset"]);
            assert.equal(result.code, 1);
            assert.match(result.output, /Unproven TASK-176 process ownership/);
            assert.ok(isLive(other.pid));
            assert.ok(!existsSync(stale));
            assert.equal(await verify(), fingerprint);
          } finally {
            other.kill("SIGTERM");
            await exit;
          }
        },
      );

      await t.test(
        "concurrent wrapper refuses the lock and SIGKILL during seed is recoverable",
        async () => {
          const competing = new PrismaClient({ datasourceUrl: dbUrl });
          try {
            await competing.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(176, 183)::text`;
              assert.match(
                (await command(["reset", "--fallback"])).output,
                /holds the database lease/,
              );
            });
          } finally {
            await competing.$disconnect();
          }
          const interrupted = start([cli, "reset", "--fallback"], dir, env);
          let seedPid;
          try {
            await until(
              () => interrupted.output().includes("TASK-176 target"),
              "reset lock",
            );
            assert.match(
              (await command(["reset", "--fallback"])).output,
              /holds the lock/,
            );
            seedPid = await killDuringSeed(interrupted, interrupted.proc.pid);
            const id = "t176-marker-stale-test";
            await prisma.user.create({
              data: { id, email: "stale@example.invalid" },
            });
            await prisma.board.create({ data: { id, title: "Stale marker" } });
            await prisma.boardMember.create({
              data: {
                boardId: id,
                userId: id,
                role: "ADMIN",
                acceptedAt: new Date(),
              },
            });
            await prisma.refreshToken.create({
              data: {
                userId: id,
                tokenHash: secret(),
                expiresAt: new Date(Date.now() + 60_000),
              },
            });
          } finally {
            await stopWrapper(interrupted);
          }
          const state = lockDemo(target);
          try {
            const orphan = mkdtempSync(join(state.stateDir, "run-"));
            writeFileSync(join(orphan, `env-${secret()}.json`), "abandoned", {
              mode: 0o600,
            });
          } finally {
            state.close();
          }
          const result = await success(["reset", "--fallback"]);
          assert.equal(
            await prisma.user.count({
              where: { id: "t176-marker-stale-test" },
            }),
            0,
          );
          assert.ok(!isLive(seedPid));
          await assertReset(result, fingerprint);
          const lock = lockDemo(target);
          try {
            assert.deepEqual(readdirSync(lock.stateDir), ["lock"]);
          } finally {
            lock.close();
          }
        },
      );

      await t.test(
        "SIGKILL of the entire wrapper process group is recoverable with a symlinked Node",
        async () => {
          const node = join(dir, "node-link");
          symlinkSync(process.execPath, node);
          const interrupted = start([cli, "reset", "--fallback"], dir, env, {
            detached: true,
            node,
          });
          let seedPid;
          try {
            seedPid = await killDuringSeed(interrupted, -interrupted.proc.pid);
          } finally {
            await stopWrapper(interrupted);
          }
          await assertReset(await success(["reset"]), fingerprint);
          assert.ok(!isLive(seedPid));
        },
      );

      await t.test(
        "stale marker cleanup names a restrictive child and can be retried",
        async () => {
          const id = "task176-marker-restricted-test";
          await prisma.board.create({ data: { id, title: "Stale marker" } });
          await prisma.column.create({
            data: { id, boardId: id, title: "Blocking column", position: 0 },
          });
          const stateDir = join(runtime, "janosik", target.database);
          const inode = statSync(join(stateDir, "lock")).ino;
          chmodSync(stateDir, 0o755);
          const blocked = await command(["reset"]);
          assert.equal(blocked.code, 1);
          assert.match(blocked.output, /marker cleanup is blocked by Column/);
          assert.doesNotMatch(
            blocked.output,
            /Terminated PostgreSQL|backend PID/,
          );
          assert.equal(statSync(stateDir).mode & 0o777, 0o700);
          assert.equal(statSync(join(stateDir, "lock")).ino, inode);
          await prisma.column.delete({ where: { id } });
          await assertReset(await success(["reset"]), fingerprint);
        },
      );

      await t.test(
        "pixel parity entry point retains the scene and emits raw credentials only to a 0600 file",
        async () => {
          await withNormalBackend(pixelUrl, async (pixelApi) => {
            const secretsFile = join(dir, "pixel-secrets.json");
            const result = await start(
              ["scripts/seed-agent-pixel-demo.mjs"],
              dir,
              {
                ...childEnv(target),
                NODE_ENV: "development",
                SEED_ALLOW: "1",
                DATABASE_URL: pixelUrl,
                API_URL: pixelApi,
                SEED_SECRETS_FILE: secretsFile,
              },
            ).closed;
            redacted(result.output);
            assert.equal(result.code, 0, result.output);
            assert.equal(JSON.parse(result.output).runs.plusTwo, "run-128");
            assert.equal(statSync(secretsFile).mode & 0o777, 0o600);
            assert.ok(
              JSON.parse(readFileSync(secretsFile, "utf8")).tokens[
                "px-token-claude"
              ],
            );
            const pixel = new PrismaClient({ datasourceUrl: pixelUrl });
            try {
              assert.equal(
                await pixel.card.count({ where: { deletedAt: null } }),
                manifest.liveCards,
              );
              assert.equal(await pixel.label.count(), 0);
            } finally {
              await pixel.$disconnect();
            }
          });
        },
      );
    } finally {
      await Promise.all([prisma.$disconnect(), dev.$disconnect()]);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
