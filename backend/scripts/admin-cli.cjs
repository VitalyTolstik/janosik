#!/usr/bin/env node
/**
 * Master-account CLI (TASK-36) — the only way to create or re-key an admin.
 *
 *   npm run admin:create -w backend -- --email me@example.com
 *   npm run admin:passwd -w backend -- --email me@example.com
 *   npm run admin:list   -w backend
 *
 * Security properties (see §7.0):
 * - there is no HTTP endpoint that creates a master account;
 * - the password is never taken from argv (it would leak into `ps` output
 *   and shell history) — it is either prompted with hidden input or read
 *   from the `ADMIN_PASSWORD` environment variable for automation;
 * - only the argon2id hash is stored; the CLI also writes an audit row so
 *   the creation/re-key is visible in the panel.
 */
const readline = require("node:readline");
const path = require("node:path");
const fs = require("node:fs");

const dotenv = require("dotenv");
for (const file of [".env", ".env.local"]) {
  const full = path.resolve(__dirname, "..", file);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: true });
}

const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 100;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

/** Hidden prompt: the typed password never echoes to the terminal. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "No TTY for a hidden prompt — set ADMIN_PASSWORD for non-interactive use",
        ),
      );
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = () => {};
    process.stdout.write(question);
    rl.question("", (answer) => {
      rl._writeToOutput = write;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const first = await promptHidden("Password: ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

function assertPassword(password) {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(
      `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`,
    );
  }
}

function normalizeEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error(`Invalid email: ${value}`);
  return email;
}

async function audit(action, adminId, adminEmail, details) {
  await prisma.adminAuditLog.create({
    data: {
      adminId: adminId ?? null,
      adminEmail,
      action,
      targetType: "admin",
      targetId: adminId ?? null,
      details: details ?? {},
    },
  });
}

async function createAdmin(args) {
  const email = normalizeEmail(args.email ?? args._[0]);
  const displayName =
    typeof args["display-name"] === "string" ? args["display-name"] : null;
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    throw new Error(
      `${email} already exists — use \`admin:passwd\` to change the password`,
    );
  }
  // The first master is an OWNER unless told otherwise; later CLI masters
  // are OPERATOR unless --owner is passed explicitly.
  const ownerCount = await prisma.adminUser.count({
    where: { role: "OWNER" },
  });
  const role = args.owner === true || ownerCount === 0 ? "OWNER" : "OPERATOR";
  const password = await readPassword();
  assertPassword(password);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.adminUser.create({
    data: { email, displayName, passwordHash, role },
  });
  await audit("admin.create", admin.id, admin.email, { via: "cli", role });
  console.log(`Master account created: ${admin.email} (${role.toLowerCase()})`);
}

async function changePassword(args) {
  const email = normalizeEmail(args.email ?? args._[0]);
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new Error(`No master account for ${email}`);
  const password = await readPassword();
  assertPassword(password);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  // Re-keying also kills every existing session and clears any lockout.
  await prisma.$transaction([
    prisma.adminRefreshToken.updateMany({
      where: { adminId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    }),
  ]);
  await audit("admin.password_changed", admin.id, admin.email, {
    via: "cli",
    sessionsRevoked: true,
  });
  console.log(`Password updated for ${admin.email}; all sessions revoked.`);
}

async function listAdmins() {
  const admins = await prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      email: true,
      displayName: true,
      role: true,
      disabledAt: true,
      lockedUntil: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  if (admins.length === 0) {
    console.log("No master accounts yet — run `admin:create`.");
    return;
  }
  for (const admin of admins) {
    const flags = [
      admin.disabledAt ? "disabled" : null,
      admin.lockedUntil && admin.lockedUntil > new Date() ? "locked" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      [
        admin.email,
        admin.role.toLowerCase(),
        admin.displayName ?? "-",
        admin.lastLoginAt
          ? `last login ${admin.lastLoginAt.toISOString()}`
          : "never logged in",
        flags ? `[${flags}]` : "",
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
}

function printUsage() {
  console.log(`Master-account CLI — the only way to create admin accounts.

Usage:
  npm run admin:create -w backend -- --email <email> [--display-name <name>] [--owner]
  npm run admin:passwd -w backend -- --email <email>
  npm run admin:list   -w backend

Commands:
  create   Create a master account. The email is required and normalized to
           lowercase. The FIRST master in an empty database becomes OWNER
           automatically; every later one is OPERATOR unless --owner is
           passed. --display-name is optional (shown in the panel).
  passwd   Set a new password for an existing master: re-keys the account,
           revokes all of its refresh sessions and clears any lockout.
  list     Print every master (email, role, display name, last login,
           disabled/locked flags). No secrets are shown.

Password (create/passwd):
  - 8-100 characters. Never passed in argv — it would leak into \`ps\`
    output and shell history.
  - Interactive: a hidden "Password:" prompt, then a confirmation prompt
    (they must match). Needs a TTY; without one the CLI refuses.
  - Non-interactive/CI: set the ADMIN_PASSWORD environment variable.
    Prefer \`read -s ADMIN_PASSWORD && export ADMIN_PASSWORD\` so the value
    never reaches the shell history, then \`unset ADMIN_PASSWORD\`.

Examples:
  npm run admin:create -w backend -- --email me@example.com
  npm run admin:create -w backend -- --email me@example.com --display-name "Ops" --owner
  ADMIN_PASSWORD='...' npm run admin:create -w backend -- --email ci@example.com
  npm run admin:passwd -w backend -- --email me@example.com
  npm run admin:list -w backend

Requirements: run from the repository root with backend dependencies
installed and backend/.env present (DATABASE_URL must point at the
database that the API uses).`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (command === "create") await createAdmin(args);
    else if (command === "passwd") await changePassword(args);
    else if (command === "list") await listAdmins();
    else if (
      command === undefined ||
      command === "help" ||
      command === "--help" ||
      command === "-h"
    ) {
      printUsage();
      if (command === undefined) process.exitCode = 1;
    } else {
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
