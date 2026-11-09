import { readFile } from "node:fs/promises";
import {
  expect,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * UI helpers for the data menu (export/import) and the board switcher.
 *
 * The export is a browser download, so the helper reads the downloaded file
 * back and parses the shared Janosik envelope. Import goes through the real
 * menu item and the file chooser — tests never set the hidden input directly.
 */

export interface ExportCard {
  id: string;
  title: string;
  description?: string;
  labelIds?: string[];
  priority?: string;
  dueDate?: number;
  archivedAt?: number;
  cover?: { type: string; value: string };
  checklists?: Array<{
    id: string;
    title: string;
    items: Array<{ id: string; text: string; done: boolean }>;
  }>;
  links?: Array<{ id: string; type: string; targetCardId: string }>;
  [key: string]: unknown;
}

export interface ExportColumn {
  id: string;
  title: string;
  cardIds: string[];
  wipLimit?: number;
  [key: string]: unknown;
}

export interface ExportLabel {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface ExportBoard {
  id: string;
  title: string;
  columns: ExportColumn[];
  cards: Record<string, ExportCard>;
  labels: ExportLabel[];
  archivedAt?: number;
  [key: string]: unknown;
}

export interface BoardEnvelope {
  app: string;
  schemaVersion: number;
  exportedAt: number;
  boards: ExportBoard[];
}

export interface BoardSummary {
  id: string;
  title: string;
  archivedAt?: number;
  role: string;
}

export interface ImportFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface DownloadedExport {
  filename: string;
  text: string;
  envelope: BoardEnvelope;
}

export interface ImportRequestTracker {
  /** Number of import POSTs seen so far. */
  count: () => number;
}

/** Open the header data menu and return the rendered menu. */
export async function openDataMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Data & backups" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Click "Export JSON" and return the downloaded, parsed file. */
export async function exportJsonFromMenu(
  page: Page,
): Promise<DownloadedExport> {
  const menu = await openDataMenu(page);
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "Export JSON" }).click();
  const download: Download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error("Export download has no local path");
  const text = await readFile(path, "utf8");
  return {
    filename: download.suggestedFilename(),
    text,
    envelope: JSON.parse(text) as BoardEnvelope,
  };
}

/** Click "Import JSON" and hand the file to the real file chooser. */
export async function chooseImportFile(
  page: Page,
  file: ImportFile,
): Promise<void> {
  const menu = await openDataMenu(page);
  const chooserPromise = page.waitForEvent("filechooser");
  await menu.getByRole("menuitem", { name: "Import JSON" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
}

/** A small fixture file from `e2e/data/`, served through the file chooser. */
export async function dataFile(
  fileName: string,
  uploadName = fileName,
): Promise<ImportFile> {
  const url = new URL(`../data/${fileName}`, import.meta.url);
  return {
    name: uploadName,
    mimeType: "application/json",
    buffer: await readFile(url),
  };
}

/** A file larger than the 5 MB import limit, built without committing it. */
export function oversizedDataFile(): ImportFile {
  return {
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x20),
  };
}

/** Wait for a toast whose text contains `text`. */
export async function expectToast(page: Page, text: string): Promise<Locator> {
  // In a dialog several toasts may carry the same message (e.g. a debounced
  // edit and the close flush both fail offline); the first one is enough.
  const toast = page.getByRole("status").filter({ hasText: text }).first();
  await expect(toast).toBeVisible();
  return toast;
}

/** Open the board switcher and return its listbox. */
export async function openBoardSwitcher(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Switch board" }).click();
  const list = page.getByRole("listbox", { name: "Switch board" });
  await expect(list).toBeVisible();
  return list;
}

/** Open the switcher, assert the board is there, and close it again. */
export async function expectBoardInSwitcher(
  page: Page,
  title: string,
): Promise<void> {
  await openBoardSwitcher(page);
  await expect(page.getByRole("option").filter({ hasText: title })).toBeVisible(
    { timeout: 10_000 },
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Switch board" }),
  ).toBeHidden();
}

/** Open a board from the switcher by its title. */
export async function openBoardFromSwitcher(
  page: Page,
  title: string,
): Promise<void> {
  await openBoardSwitcher(page);
  await page.getByRole("option").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Count import POSTs so a client-side rejection can be told from a server one. */
export function trackImportRequests(page: Page): ImportRequestTracker {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/v1/boards/import")
    ) {
      count += 1;
    }
  });
  return { count: () => count };
}
