import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { backend } from "./lifecycle.mjs";
import { DemoError } from "./target.mjs";

const require = createRequire(join(backend, "package.json"));
const verifiedSeeds = new WeakMap();

async function cleanupMarkers(prisma, userWhere, boardWhere) {
  await prisma.$transaction([
    prisma.boardMember.deleteMany({
      where: { OR: [{ user: userWhere }, { board: boardWhere }] },
    }),
    prisma.board.deleteMany({ where: boardWhere }),
    prisma.user.deleteMany({ where: userWhere }),
  ]);
}

export async function sweepMarkers(prisma) {
  const where = {
    OR: ["task176-marker-", "t176-marker-"].map((prefix) => ({
      id: { startsWith: prefix },
    })),
  };
  await cleanupMarkers(prisma, where, where);
}

export async function probeIdentity(
  prisma,
  target,
  lifecycle,
  secret,
  { authorizeSeed = false } = {},
) {
  const id = `task176-marker-${randomBytes(16).toString("hex")}`;
  lifecycle.assertListening();
  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { id, email: `${id}@example.invalid`, emailVerifiedAt: new Date() },
    });
    await tx.board.create({ data: { id, title: "TASK-176 identity marker" } });
    await tx.boardMember.create({
      data: { boardId: id, userId: id, role: "ADMIN", acceptedAt: new Date() },
    });
    return user;
  });
  try {
    const { securityStamp } = require(
      join(backend, "dist/auth/security-stamp-hmac.js"),
    );
    const { JwtService } = require("@nestjs/jwt");
    const token = new JwtService().sign(
      {
        sub: user.id,
        aud: "janosik-user",
        stamp: securityStamp(user, secret),
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      { secret, noTimestamp: true },
    );
    lifecycle.assertListening();
    const response = await fetch(`${target.apiUrl}/api/v1/boards/${id}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DemoError(
        `TASK-176 API identity probe returned HTTP ${response.status}.`,
      );
    }
    if ((await response.json()).id !== id)
      throw new DemoError("TASK-176 API identity marker did not match.");
    lifecycle.assertListening();
    console.log("TASK-176 API identity verified.");
  } finally {
    // This runs before any drop. A wrapper SIGKILL leaves the marker for the
    // next successful probe and stale-marker sweep.
    await cleanupMarkers(prisma, { id }, { id });
  }
  if (!authorizeSeed) return;
  const ticket = {};
  const nonce = randomBytes(32).toString("hex");
  verifiedSeeds.set(ticket, { nonce, target, lifecycle });
  return { ticket, nonce };
}

export function consumeSeedNonce(grant, target, lifecycle) {
  const expected = grant && verifiedSeeds.get(grant.ticket);
  if (
    !expected ||
    expected.target !== target ||
    expected.lifecycle !== lifecycle ||
    expected.nonce !== grant.nonce
  ) {
    throw new DemoError(
      "TASK-176 seed requires a fresh reset-issued API identity nonce.",
    );
  }
  lifecycle.assertListening();
  verifiedSeeds.delete(grant.ticket);
}
