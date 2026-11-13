import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Docker build uses this reserved origin only for generated site URLs.
// A distinctive value avoids rewriting examples of localhost in the docs.
const BUILD_ORIGIN = "https://site-origin.invalid";
const URL_CANDIDATE = /https?:\/\/[^\s"'<>()]+/g;

/** True only for the exact build origin (no userinfo, lookalike host or port). */
function isBuildOrigin(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.origin === BUILD_ORIGIN &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.href.startsWith(`${BUILD_ORIGIN}/`)
    );
  } catch {
    return false;
  }
}

/** Replace only URLs whose parsed origin is exactly BUILD_ORIGIN. */
function rewriteBuildOrigin(text: string, origin: string): string {
  return text.replace(URL_CANDIDATE, (candidate) => {
    if (!isBuildOrigin(candidate)) return candidate;
    const rest = candidate.slice(BUILD_ORIGIN.length);
    return origin + (rest === "" || rest.startsWith("/") ? rest : `/${rest}`);
  });
}

function containsBuildOrigin(text: string): boolean {
  return text.replace(URL_CANDIDATE, (candidate) =>
    isBuildOrigin(candidate) ? "" : candidate,
  ).length < text.length;
}

/** Materialize the built site's URLs for this installation, leaving its image read-only. */
export function prepareRuntimeSite(
  siteDir: string,
  publicOrigin: string,
): string {
  if (!siteDir || !fs.existsSync(path.join(siteDir, "index.html")))
    return siteDir;
  if (
    !containsBuildOrigin(
      fs.readFileSync(path.join(siteDir, "index.html"), "utf8"),
    )
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
          if (containsBuildOrigin(source)) {
            fs.writeFileSync(file, rewriteBuildOrigin(source, origin));
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
