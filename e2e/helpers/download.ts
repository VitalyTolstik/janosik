import {
  expect,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";

export interface DownloadedFile {
  suggestedFilename: string;
  path: string;
}

/**
 * Run a UI action that starts a download and resolve once the file is on disk.
 * The caller owns cleanup of the Playwright temporary download directory.
 */
export async function expectDownload(
  page: Page,
  action: () => Promise<void>,
): Promise<DownloadedFile> {
  const downloadPromise = page.waitForEvent("download");
  await action();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path, "download path").not.toBeNull();
  return { suggestedFilename: download.suggestedFilename(), path: path! };
}

export async function expectDownloadFrom(
  page: Page,
  locator: Locator,
): Promise<DownloadedFile> {
  return expectDownload(page, () => locator.click());
}

export async function readJsonDownload<T>(
  page: Page,
  action: () => Promise<void>,
): Promise<{ file: DownloadedFile; json: T }> {
  const file = await expectDownload(page, action);
  const json = JSON.parse(await readFile(file.path, "utf8")) as T;
  return { file, json };
}

/** The download object (useful for `download.delete()` in a finally block). */
export async function downloadAndDelete(
  page: Page,
  action: () => Promise<void>,
): Promise<{ download: Download; file: DownloadedFile }> {
  const downloadPromise = page.waitForEvent("download");
  await action();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path, "download path").not.toBeNull();
  return {
    download,
    file: { suggestedFilename: download.suggestedFilename(), path: path! },
  };
}
