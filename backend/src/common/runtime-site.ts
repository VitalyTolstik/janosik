import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Docker build uses this reserved origin only for generated site URLs.
// A distinctive value avoids rewriting examples of localhost in the docs.
const BUILD_ORIGIN = "https://site-origin.invalid";

/** Materialize the built site's URLs for this installation, leaving its image read-only. */
export function prepareRuntimeSite(
  siteDir: string,
  publicOrigin: string,
): string {
  if (!siteDir || !fs.existsSync(path.join(siteDir, "index.html")))
    return siteDir;
  if (
    !fs
      .readFileSync(path.join(siteDir, "index.html"), "utf8")
      .includes(BUILD_ORIGIN)
  ) {
    return siteDir;
  }

  const origin = new URL(publicOrigin).origin;
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "janosik-site-"));
  try {
    fs.cpSync(siteDir, destination, { recursive: true });
    const rewrite = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) rewrite(file);
        else if (
          entry.isFile() &&
          /(?:\.html|\.xml|^robots\.txt)$/i.test(entry.name)
        ) {
          const source = fs.readFileSync(file, "utf8");
          if (source.includes(BUILD_ORIGIN)) {
            fs.writeFileSync(file, source.replaceAll(BUILD_ORIGIN, origin));
          }
        }
      }
    };
    rewrite(destination);
    process.once("exit", () =>
      fs.rmSync(destination, { recursive: true, force: true }),
    );
    return destination;
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
