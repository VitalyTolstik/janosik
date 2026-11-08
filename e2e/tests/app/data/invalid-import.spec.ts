import { test, expect } from "@/fixtures/data.js";
import {
  chooseImportFile,
  dataFile,
  expectToast,
  oversizedDataFile,
  trackImportRequests,
} from "@/helpers/data.js";

test("rejects a file that is not valid JSON", async ({ page, board, data }) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(
    page,
    await dataFile("invalid-json.txt", "invalid-json.json"),
  );

  await expectToast(
    page,
    "Import failed — the file is not a valid Janosik export.",
  );
  expect(imports.count()).toBe(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});

test("rejects a file that is not a Janosik export", async ({
  page,
  board,
  data,
}) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(page, await dataFile("not-janosik.json"));

  await expectToast(page, "Import failed");
  expect(imports.count()).toBe(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});

test("rejects an unsupported schema version", async ({ page, board, data }) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(page, await dataFile("unsupported-version.json"));

  await expectToast(page, "Import failed");
  expect(imports.count()).toBe(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});

test("rejects structurally invalid board data", async ({
  page,
  board,
  data,
}) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(page, await dataFile("invalid-board.json"));

  await expectToast(page, "Import failed");
  expect(imports.count()).toBe(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});

test("rejects a file over the size limit before reading it", async ({
  page,
  board,
  data,
}) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(page, oversizedDataFile());

  await expectToast(page, "File is too large — the limit is 5 MB.");
  expect(imports.count()).toBe(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});

test("shows no success toast when the server refuses an empty envelope", async ({
  page,
  board,
  data,
}) => {
  await board.open(page);
  const before = await data.listBoards();
  const imports = trackImportRequests(page);

  await chooseImportFile(page, await dataFile("empty.json"));

  await expectToast(page, "Import failed");
  expect(imports.count()).toBe(1);
  // The success toast (if the guard regressed) is pushed in the same promise
  // continuation as the error, so it is already settled once the error is up.
  await expect(
    page.getByRole("status").filter({ hasText: "Board imported" }),
  ).toHaveCount(0);
  expect((await data.listBoards()).map((entry) => entry.id)).toEqual(
    before.map((entry) => entry.id),
  );
});
