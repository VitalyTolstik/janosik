import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * TASK-147 (B13): the shipped self-host defaults must not silently disable
 * the Secure cookie. The runtime default already favours production
 * (`config/security.ts`); this guards the compose file and the example env,
 * which are what a self-hoster actually copies.
 */
describe("self-host cookie defaults", () => {
  const read = (relative: string): string =>
    readFileSync(resolve(__dirname, "../../..", relative), "utf8");

  it("defaults COOKIE_SECURE=true when the compose var is unset", () => {
    expect(read("docker-compose.yml")).toMatch(
      /COOKIE_SECURE:\s*\$\{COOKIE_SECURE:-true\}/,
    );
  });

  it("ships COOKIE_SECURE=true in .env.example", () => {
    expect(read(".env.example")).toMatch(/^COOKIE_SECURE=true$/m);
  });
});
