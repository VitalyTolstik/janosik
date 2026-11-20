import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { seedPixelScene, writeSeedSecrets } from "./seed-agent-pixel-demo.mjs";
import {
  hasCompleteSchema,
  migrateReset,
  resetFixtureAndAccounts,
  terminateOtherConnections,
  withDatabase,
  withResetLease,
} from "./task176/database.mjs";
import { seedRelations, verifyFixture } from "./task176/fixture.mjs";
import {
  consumeSeedNonce,
  probeIdentity,
  sweepMarkers,
} from "./task176/identity.mjs";
import {
  assertFreePort,
  backend,
  createBackendLifecycle,
  lockDemo,
  sweepStale,
} from "./task176/lifecycle.mjs";
import {
  childEnv,
  DemoError,
  demoTarget,
  reportError,
} from "./task176/target.mjs";

async function reset(target, { fallback, dryRun }) {
  if (dryRun) {
    console.log(
      `Validated TASK-176 target ${target.host}/${target.database}, API port ${target.port}.`,
    );
    return;
  }
  const buildFiles = [
    "dist/main.js",
    "dist/config/demo-reset-env.js",
    "dist/auth/security-stamp-hmac.js",
  ];
  if (
    buildFiles.some(
      (file) =>
        !statSync(join(backend, file), { throwIfNoEntry: false })?.isFile(),
    )
  )
    throw new DemoError("Build the backend before running the TASK-176 reset.");
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32)
    throw new DemoError(
      "Set JWT_SECRET (at least 32 characters) for the TASK-176 backend.",
    );
  let publicOrigin;
  try {
    publicOrigin = new URL(process.env.PUBLIC_ORIGIN ?? target.apiUrl);
    if (
      !["http:", "https:"].includes(publicOrigin.protocol) ||
      publicOrigin.username ||
      publicOrigin.password
    ) {
      throw new Error();
    }
  } catch {
    throw new DemoError("Set PUBLIC_ORIGIN to a valid HTTP(S) origin.");
  }
  const lock = lockDemo(target);
  let lifecycle;
  let phase = "starting";
  let destructive = false;
  const interrupt = new AbortController();
  const onSignal = () =>
    interrupt.abort(new DemoError("TASK-176 reset interrupted."));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const checkpoint = () => interrupt.signal.throwIfAborted();
  try {
    console.log(
      `TASK-176 target ${target.host}/${target.database}, API port ${target.port}.`,
    );
    await sweepStale(lock.stateDir);
    await assertFreePort(target.port);
    lifecycle = createBackendLifecycle(lock, target, {
      jwtSecret,
      settingsSecret: process.env.SETTINGS_SECRET ?? "",
      publicOrigin: publicOrigin.origin,
    });
    await withResetLease(target, async (leasePid) => {
      phase = "schema inspection";
      const repair = await withDatabase(
        target,
        async (prisma) => {
          checkpoint();
          const repair = !(await hasCompleteSchema(prisma));
          if (repair) {
            if (fallback)
              throw new DemoError(
                "The demo schema is incomplete. Rerun without --fallback to recreate the schema and clear global settings.",
              );
            console.log(
              `Repairing incomplete TASK-176 schema on ${target.host}/${target.database}.`,
            );
          } else {
            phase = "pre-reset identity";
            await sweepMarkers(prisma);
            checkpoint();
            await lifecycle.start();
            await probeIdentity(prisma, target, lifecycle, jwtSecret);
            await lifecycle.stop();
          }
          checkpoint();
          await terminateOtherConnections(prisma, target.database, leasePid);
          checkpoint();
          if (fallback) {
            phase = "fixture and account reset";
            destructive = true;
            await resetFixtureAndAccounts(prisma);
          }
          return repair;
        },
        { allowMissingSchema: true },
      );
      if (!fallback) {
        phase = repair ? "schema repair" : "schema reset";
        checkpoint();
        destructive = true;
        await migrateReset(target, lock);
      }

      phase = "seed";
      checkpoint();
      // Reconnect after migration and re-prove ownership before the seed can
      // send any commands. The in-process nonce is consumed exactly once.
      await withDatabase(target, async (prisma) => {
        await sweepMarkers(prisma);
        checkpoint();
        await lifecycle.start();
        const grant = await probeIdentity(
          prisma,
          target,
          lifecycle,
          jwtSecret,
          {
            authorizeSeed: true,
          },
        );
        const checkSeedApi = () => {
          checkpoint();
          lifecycle.assertListening();
        };
        consumeSeedNonce(grant, target, lifecycle);
        const summary = await seedPixelScene(
          prisma,
          target.apiUrl,
          checkSeedApi,
        );
        await seedRelations(prisma);
        console.log(JSON.stringify(summary));
      });

      phase = "verification";
      await lifecycle.stop();
      checkpoint();
      await withDatabase(target, verifyFixture);
      destructive = false;
    });
    if (process.env.SEED_SECRETS_FILE) {
      try {
        writeSeedSecrets(process.env.SEED_SECRETS_FILE);
      } catch {
        throw new DemoError(
          "Fixture verified. Could not export seed credentials to a new 0600 file.",
        );
      }
    }
  } catch (error) {
    if (destructive)
      console.error("The fixture may be partial. Rerun the TASK-176 reset.");
    throw error instanceof DemoError
      ? error
      : new DemoError(
          `TASK-176 reset failed during ${phase}. Check that migrations and prerequisites are in place.`,
        );
  } finally {
    try {
      await lifecycle?.dispose();
    } finally {
      lock.close();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  }
}

async function admin(target, args) {
  if (
    args.length !== 2 ||
    args[0] !== "--email" ||
    !/^[^\s@:/=]+@[^\s@:/=]+\.[^\s@:/=]+$/.test(args[1])
  ) {
    throw new DemoError(
      "Usage: npm run demo:task176:admin -- --email <master>. Set ADMIN_PASSWORD in the environment for automation.",
    );
  }
  const lock = lockDemo(target);
  try {
    console.log(`TASK-176 master target ${target.host}/${target.database}.`);
    const child = spawn(
      process.execPath,
      [
        join(backend, "scripts/admin-cli.cjs"),
        "create",
        "--demo-task176",
        ...args,
      ],
      {
        cwd: backend,
        env: {
          ...childEnv(target),
          DEMO_DATABASE_URL: target.databaseUrl,
          DEMO_ALLOW_OTHER_DB: process.env.DEMO_ALLOW_OTHER_DB ?? "",
          ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
        },
        stdio: ["inherit", "inherit", "inherit", lock.fd],
      },
    );
    const status = await new Promise((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", resolve);
    });
    if (status !== 0) throw new DemoError("TASK-176 master creation failed.");
  } finally {
    lock.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "reset") {
    if (
      new Set(args).size !== args.length ||
      args.some((arg) => !["--fallback", "--dry-run"].includes(arg))
    ) {
      throw new DemoError(
        "Usage: npm run demo:task176:reset [-- --fallback | --dry-run].",
      );
    }
    await reset(demoTarget(process.env, { api: true, reset: true }), {
      fallback: args.includes("--fallback"),
      dryRun: args.includes("--dry-run"),
    });
  } else if (command === "verify" && args.length === 0) {
    const target = demoTarget(process.env);
    console.log(`TASK-176 verify target ${target.host}/${target.database}.`);
    await withDatabase(target, verifyFixture);
  } else if (command === "admin") {
    await admin(demoTarget(process.env), args);
  } else {
    throw new DemoError(
      "TASK-176 supports reset, verify and admin. The overlay can only run inside an authorized reset.",
    );
  }
}

await main().catch((error) => reportError(error, "TASK-176 command"));
