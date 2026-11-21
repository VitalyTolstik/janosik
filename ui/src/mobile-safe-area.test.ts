import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Read the source from disk instead of `?raw` imports: the Vitest config runs
// with `css: false`, and the existing design-system test uses the same
// readFileSync pattern for its tokens.
const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const indexHtml = source("index.html");
const accountDialog = source("src/components/account/AccountDialog.tsx");
const sessionUi = source("src/components/agents/session-ui.tsx");
const cardItem = source("src/components/board/CardItem.tsx");
const agentsAutomation = source(
  "src/components/board/settings/AgentsAutomation.tsx",
);
const boardSettingsShell = source(
  "src/components/board/settings/BoardSettingsShell.tsx",
);
const workflowSettings = source(
  "src/components/board/workflow/WorkflowSettings.tsx",
);
const header = source("src/components/Header.tsx");
const dialog = source("src/components/ui/dialog.tsx");
const agentControlCss = source(
  "src/components/agent-control/agent-control.css",
);

/**
 * TASK-177.18 (U-07): standalone iOS paints the app under the status bar and
 * the landscape notch. These assertions keep the `viewport-fit=cover` opt-in
 * and the `env(safe-area-inset-*)` paddings from being dropped again:
 * - `max(base, env(...))` means every desktop browser (env = 0) keeps the
 *   existing spacing token instead of getting double padding;
 * - full-screen phone sheets pad the surface; centred dialogs pad the body;
 * - sticky footers keep their buttons above the home indicator.
 */
describe("mobile safe areas (TASK-177.18)", () => {
  it("opts the viewport into the iOS safe-area insets", () => {
    expect(indexHtml).toMatch(
      /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover/,
    );
    // black-translucent is what actually lets the page paint edge to edge.
    expect(indexHtml).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(indexHtml).toContain('content="black-translucent"');
  });

  it("pads the header for the status bar and the landscape notch", () => {
    expect(header).toContain("env(safe-area-inset-top)");
    expect(header).toContain("env(safe-area-inset-left)");
    expect(header).toContain("env(safe-area-inset-right)");
    // The fallback is the old mobile token, so a desktop header is untouched.
    expect(header).toContain("max(0.375rem,env(safe-area-inset-top))");
    expect(header).toContain("max(0.75rem,env(safe-area-inset-left))");
    expect(header).toContain("sm:pl-[max(1.5rem,env(safe-area-inset-left))]");
  });

  it("keeps dialog bodies and full-screen sheets inside the safe area", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(dialog).toContain(`env(safe-area-inset-${side})`);
    }
    expect(accountDialog).toContain("pt-[env(safe-area-inset-top)]");
    expect(boardSettingsShell).toContain(
      "max-md:pt-[env(safe-area-inset-top)]",
    );
    expect(boardSettingsShell).toContain(
      "max-md:pl-[env(safe-area-inset-left)]",
    );
    expect(agentControlCss).toContain("padding-top: env(safe-area-inset-top)");
    expect(agentControlCss).toContain(
      "padding-right: env(safe-area-inset-right)",
    );
  });

  it("keeps sticky footers above the home indicator", () => {
    expect(workflowSettings).toContain(
      "pb-[max(11px,env(safe-area-inset-bottom))]",
    );
    expect(agentsAutomation).toContain(
      "pb-[max(9px,env(safe-area-inset-bottom))]",
    );
    expect(sessionUi).toContain("pb-[max(10px,env(safe-area-inset-bottom))]");
    expect(agentControlCss).toContain(
      "padding-bottom: max(9px, env(safe-area-inset-bottom))",
    );
  });

  it("gives the card labels a readable lane clear of the hover actions", () => {
    expect(cardItem).toContain("max-sm:w-1/2");
    // The hover quick-action wrappers moved from the title/label row (`top-1.5`)
    // to the due row. The foreign-change dot keeps its own top-1.5 corner.
    expect(cardItem).toContain(
      "no-hover:hidden absolute right-1.5 top-8 z-10 opacity-0",
    );
    expect(cardItem).toContain("absolute right-8 top-8 z-10");
  });
});
