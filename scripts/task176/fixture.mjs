import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { manifest, relations } from "../fixtures/task176-demo.mjs";
import { DemoError } from "./target.mjs";

const compoundKeys = {
  cardLabel: ["cardId", "labelId"],
};

export async function seedRelations(prisma) {
  await prisma.$transaction(async (tx) => {
    for (const [model, data] of Object.entries(relations)) {
      await tx[model].createMany({ data });
    }
  });
}

/** Include deleted rows and report only expected identifiers and field names. */
export function assertFixtureRows(model, actual) {
  const expected = manifest.rows[model];
  if (actual.length !== expected.length) {
    throw new DemoError(
      `Fixture ${model} count: expected ${expected.length}, found ${actual.length}.`,
    );
  }
  const keys = compoundKeys[model] ?? ["id"];
  const key = (row) => keys.map((field) => row[field]).join("/");
  const byKey = new Map(actual.map((row) => [key(row), row]));
  for (const row of expected) {
    const id = key(row);
    const found = byKey.get(id);
    if (!found) throw new DemoError(`Missing fixture ${model} ${id}.`);
    for (const [field, value] of Object.entries(row)) {
      const actualValue = found[field];
      const matches =
        value === true && field.endsWith("At")
          ? actualValue instanceof Date
          : isDeepStrictEqual(actualValue, value);
      if (!matches)
        throw new DemoError(`Fixture ${model} ${id} differs at ${field}.`);
    }
  }
}

export async function verifyFixture(prisma) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    for (const [model, expected] of Object.entries(manifest.rows)) {
      const fields = Object.keys(expected[0] ?? { id: true });
      const select = Object.fromEntries(fields.map((field) => [field, true]));
      assertFixtureRows(model, await tx[model].findMany({ select }));
    }
  });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(manifest.rows))
    .digest("hex");
  console.log(
    `Verified TASK-176 fixture v${manifest.version} (${manifest.liveCards} live cards, SHA-256 ${fingerprint}).`,
  );
}
