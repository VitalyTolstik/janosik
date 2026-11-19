import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_AUDIT_ACTIONS } from "@janosik/shared";

/**
 * TASK-180.3: the monitoring page claims to list every `AdminAuditLog`
 * action. Keep the documented table and the shared union from drifting —
 * notably `share.updated` belongs to `BoardShareAuditLog` (bare `updated`),
 * not to the master audit log.
 */
describe("audit action documentation", () => {
  const read = (relative: string): string =>
    readFileSync(resolve(__dirname, "../../..", relative), "utf8");

  const section = (relative: string, heading: string): string => {
    const body = read(relative);
    const start = body.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = body.indexOf("\n## ", start);
    return body.slice(start, end === -1 ? undefined : end);
  };

  const tableActions = (relative: string, heading: string): string[] => {
    const actions = [
      ...section(relative, heading).matchAll(/`([a-z]+\.[a-z_]+)`/g),
    ].map((match) => match[1]!);
    return [...new Set(actions)].sort();
  };

  it.each([
    ["site/src/content/docs/docs/admin/monitoring.md", "### Audit actions"],
    [
      "site/src/content/docs/ru/docs/admin/monitoring.md",
      "### Действия аудита",
    ],
  ])("lists exactly ADMIN_AUDIT_ACTIONS in %s", (relative, heading) => {
    expect(tableActions(relative, heading)).toEqual(
      [...ADMIN_AUDIT_ACTIONS].sort(),
    );
  });

  it.each([
    ["site/src/content/docs/docs/admin/monitoring.md", "### Audit actions"],
    [
      "site/src/content/docs/ru/docs/admin/monitoring.md",
      "### Действия аудита",
    ],
  ])("names the separate share trail in %s", (relative, heading) => {
    const body = section(relative, heading);
    expect(body).toContain("BoardShareAuditLog");
    expect(body).not.toMatch(/`share\.updated`/);
  });
});
