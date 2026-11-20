import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { manifest, relations } from "../fixtures/task176-demo.mjs";
import { DemoError } from "./target.mjs";

const compoundKeys = {
  cardLabel: ["cardId", "labelId"],
};

const hashRows = (rows) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");

export async function seedRelations(prisma) {
  await prisma.$transaction(async (tx) => {
    for (const [model, data] of Object.entries(relations)) {
      await tx[model].createMany({ data });
    }
  });
}

/** Verify and return the selected live database values in manifest row order. */
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
  return expected.map((row) => {
    const id = key(row);
    const found = byKey.get(id);
    if (!found) throw new DemoError(`Missing fixture ${model} ${id}.`);
    const fields = Object.keys(row)
      .sort()
      .map((field) => {
        const value = row[field];
        const actualValue = found[field];
        // A true timestamp pin checks presence. Wall-clock values vary on reset.
        const canonical =
          value === true && field.endsWith("At")
            ? actualValue instanceof Date
            : actualValue;
        if (!isDeepStrictEqual(canonical, value))
          throw new DemoError(`Fixture ${model} ${id} differs at ${field}.`);
        return [field, canonical];
      });
    return Object.fromEntries(fields);
  });
}

export async function verifyFixture(prisma) {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const verified = {};
    for (const model of Object.keys(manifest.rows).sort()) {
      const expected = manifest.rows[model];
      const fields = Object.keys(expected[0] ?? { id: true });
      const select = Object.fromEntries(fields.map((field) => [field, true]));
      verified[model] = assertFixtureRows(
        model,
        await tx[model].findMany({ select }),
      );
    }
    return verified;
  });
  console.log(
    `Verified TASK-176 fixture v${manifest.version} (${manifest.liveCards} live cards, live rows SHA-256 ${hashRows(rows)}, manifest SHA-256 ${hashRows(manifest.rows)}).`,
  );
}
