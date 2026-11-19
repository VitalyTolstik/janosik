import { existsSync } from "node:fs";
import { join } from "node:path";
import helmet from "helmet";
import { frontendCspDirectives } from "../backend/dist/common/csp.js";

const [appDir, siteDir] = process.argv.slice(2);
if (!appDir || !siteDir) {
  throw new Error(
    "Usage: node scripts/generate-nginx-csp.mjs APP_DIST SITE_DIST",
  );
}
for (const directory of [appDir, siteDir]) {
  if (!existsSync(join(directory, "index.html"))) {
    throw new Error(`No frontend build at ${directory}`);
  }
}
const directives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  ...frontendCspDirectives([appDir, siteDir]),
};

function policy(frameAncestors) {
  return Object.entries({ ...directives, "frame-ancestors": [frameAncestors] })
    .filter(([, sources]) => sources !== null)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join(";");
}

process.stdout.write(`# Generated from the served builds and Helmet's CSP.
map $uri $janosik_csp {
  ~^/api/ "";
  default "${policy("'self'")}";
}

map $uri $janosik_share_csp {
  default "${policy("*")}";
}
`);
