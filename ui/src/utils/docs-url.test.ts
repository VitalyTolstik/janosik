import { describe, expect, it } from "vitest";

import { agentRollbackDocsUrl, docsPageUrl, docsUrl } from "./docs-url";

describe("docs URLs", () => {
  it("keeps the language root and appends a page and anchor", () => {
    expect(docsUrl("en")).toMatch(/\/docs\/$/);
    expect(docsUrl("ru")).toMatch(/\/ru\/docs\/$/);

    const en = docsPageUrl("en", "user-guide/agents/", "run-rollback");
    expect(en).toMatch(/\/docs\/user-guide\/agents\/#run-rollback$/);

    const ru = docsPageUrl("ru", "user-guide/agents/", "run-rollback");
    expect(ru).toMatch(/\/ru\/docs\/user-guide\/agents\/#run-rollback$/);
  });

  it("normalises slashes in the page and has no anchor when omitted", () => {
    const page = docsPageUrl("en", "/user-guide/agents/");
    expect(page).toMatch(/\/docs\/user-guide\/agents\/$/);
  });

  it("builds the localized rollback section anchor", () => {
    expect(agentRollbackDocsUrl("en")).toMatch(
      /\/docs\/user-guide\/agents\/#rollback-and-run-recovery$/,
    );
    expect(agentRollbackDocsUrl("ru")).toMatch(
      /\/ru\/docs\/user-guide\/agents\/#откат-и-восстановление-запусков$/,
    );
  });
});
