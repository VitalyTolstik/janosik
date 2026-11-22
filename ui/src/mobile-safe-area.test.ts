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
const cardDialog = source("src/components/board/CardDialog.tsx");
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
const globalSearch = source("src/components/GlobalSearch.tsx");
const adminSearch = source("src/admin/GlobalSearch.tsx");
const publicBoardPage = source("src/share/PublicBoardPage.tsx");
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
    // iPad standalone (>=640) grows the fixed row instead of squeezing it.
    expect(header).toContain("sm:pt-[env(safe-area-inset-top)]");
    expect(header).toContain("sm:h-[calc(52px_+_env(safe-area-inset-top))]");
    expect(header).toContain(
      "sm:min-h-[calc(52px_+_env(safe-area-inset-top))]",
    );
  });

  it("pads both public share headers and the shell for safe areas", () => {
    // The public contour mounts outside the app shell, so it cannot inherit
    // the header's safe-area classes. F3: the brand used to sit at y=13.5
    // under a 47 px status bar; both the ready state and the pre-payload
    // chrome must grow by the top inset and keep the notch insets.
    const headers = publicBoardPage.match(
      /<header className="sticky top-0[^"]*"/g,
    );
    expect(headers).toHaveLength(2);
    // Both ready and loading/error shells use the dynamic viewport unit and
    // leave the home indicator clear at the bottom.
    expect(publicBoardPage.match(/className="flex h-dvh /g)).toHaveLength(2);
    expect(
      publicBoardPage.match(/pb-\[env\(safe-area-inset-bottom\)\]/g),
    ).toHaveLength(2);
    for (const headerClassName of headers ?? []) {
      expect(headerClassName).toContain("pt-[env(safe-area-inset-top)]");
      expect(headerClassName).toContain(
        "h-[calc(3.5rem_+_env(safe-area-inset-top))]",
      );
      expect(headerClassName).toContain(
        "pl-[max(1rem,env(safe-area-inset-left))]",
      );
      expect(headerClassName).toContain(
        "pr-[max(1rem,env(safe-area-inset-right))]",
      );
      expect(headerClassName).toContain(
        "sm:pl-[max(1.5rem,env(safe-area-inset-left))]",
      );
      expect(headerClassName).toContain(
        "sm:pr-[max(1.5rem,env(safe-area-inset-right))]",
      );
    }
  });

  it("keeps dialog bodies and full-screen sheets inside the safe area", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(dialog).toContain(`env(safe-area-inset-${side})`);
    }
    expect(accountDialog).toContain("pt-[env(safe-area-inset-top)]");
    // Below `md` the full-screen sheet owns the top inset; from `md` the
    // header-aware `top`/height calculation handles it (no double padding).
    expect(boardSettingsShell).toContain(
      "max-md:pt-[env(safe-area-inset-top)]",
    );
    expect(boardSettingsShell).toContain(
      "pl-[max(0px,env(safe-area-inset-left))]",
    );
    expect(boardSettingsShell).toContain(
      "md:top-[calc(56px_+_env(safe-area-inset-top))]",
    );
    expect(boardSettingsShell).toContain(
      "h-[min(47.25rem,calc(100dvh_-_4.75rem_-_env(safe-area-inset-top)))]",
    );
    expect(agentControlCss).toContain("padding-top: env(safe-area-inset-top)");
    expect(agentControlCss).toContain(
      "padding-right: env(safe-area-inset-right)",
    );
    // Card-dialog header: the close button and the ⋮ menu both respect the
    // status bar/notch. Mobile close is 44 px with a 12 px inset (+4 px gap
    // → 3rem). From `md` to `lg` the close is also 44 px: 16 px inset + 44 px
    // + 8 px gap = 68 px (→ 3.25rem), which clears the 32 px trigger instead
    // of overlapping it; at `lg` the close returns to 32 px (16 + 32 + 4 = 52
    // px → 2.25rem). The mobile 32 px trigger drops 6 px so both icons share
    // a centre line.
    expect(cardDialog).toContain(
      "right-[calc(max(0.75rem,env(safe-area-inset-right))_+_3rem)]",
    );
    expect(cardDialog).toContain(
      "md:right-[calc(max(1rem,env(safe-area-inset-right))_+_3.25rem)]",
    );
    expect(cardDialog).toContain(
      "lg:right-[calc(max(1rem,env(safe-area-inset-right))_+_2.25rem)]",
    );
    expect(cardDialog).toContain(
      "top-[calc(max(0.75rem,env(safe-area-inset-top))_+_0.375rem)]",
    );
    expect(cardDialog).toContain("md:top-[max(1rem,env(safe-area-inset-top))]");
    expect(cardDialog).toContain(
      'closeClassName="right-[max(0.75rem,env(safe-area-inset-right))]',
    );
    expect(cardDialog).toContain(
      "flex h-11 w-11 items-center justify-center md:h-11 md:w-11 lg:h-8 lg:w-8",
    );
    // Tablet/landscape sheet (761–1279) keeps the horizontal insets and
    // starts below the safe-area-aware header; its height subtracts the same
    // inset, as does the ≤1100 override. The scrim follows the header too.
    expect(agentControlCss).toMatch(
      /@media \(min-width: 761px\) and \(max-width: 1279px\) \{[\s\S]*?padding-left: max\(0px, env\(safe-area-inset-left\)\)/,
    );
    expect(agentControlCss).toContain(
      "top: calc(56px + env(safe-area-inset-top));",
    );
    expect(agentControlCss).toContain(
      "height: calc(100dvh - 70px - env(safe-area-inset-top));",
    );
    expect(agentControlCss).toContain(
      "top: calc(52px + env(safe-area-inset-top));",
    );
    expect(agentControlCss).toContain(
      "height: min(722px, calc(100dvh - 70px - env(safe-area-inset-top)));",
    );
    // The full-screen command palettes override p-0, so re-add the insets.
    expect(globalSearch).toContain("max-sm:pb-[env(safe-area-inset-bottom)]");
    expect(adminSearch).toContain("max-sm:h-screen");
    expect(adminSearch).toContain("max-sm:pb-[env(safe-area-inset-bottom)]");
    expect(adminSearch).toContain("max-sm:pt-[env(safe-area-inset-top)]");
  });

  it("keeps sticky footers above the home indicator", () => {
    expect(workflowSettings).toContain(
      "pb-[max(11px,env(safe-area-inset-bottom))]",
    );
    expect(agentsAutomation).toContain(
      "pb-[max(9px,env(safe-area-inset-bottom))]",
    );
    expect(sessionUi).toContain("pb-[max(10px,env(safe-area-inset-bottom))]");
    // The base rule exists…
    expect(agentControlCss).toContain(
      "padding-bottom: max(9px, env(safe-area-inset-bottom))",
    );
    expect(agentControlCss).toContain(
      "padding-left: max(12px, env(safe-area-inset-left))",
    );
    expect(agentControlCss).toContain(
      "padding-right: max(12px, env(safe-area-inset-right))",
    );
    // …and the ≤900/≤760 media rules re-apply them after their padding
    // shorthand, so the absolutely positioned footer respects the notch.
    for (const [maxWidth, pad] of [
      [900, 10],
      [760, 9],
    ] as const) {
      const media = new RegExp(
        `@media \\(max-width: ${maxWidth}px\\) \\{[\\s\\S]*?\\.agent-control-surface \\.ac-foot \\{[\\s\\S]*?padding-left: max\\(${pad}px, env\\(safe-area-inset-left\\)\\)`,
      );
      expect(agentControlCss).toMatch(media);
      const right = new RegExp(
        `@media \\(max-width: ${maxWidth}px\\) \\{[\\s\\S]*?\\.agent-control-surface \\.ac-foot \\{[\\s\\S]*?padding-right: max\\(${pad}px, env\\(safe-area-inset-right\\)\\)`,
      );
      expect(agentControlCss).toMatch(right);
    }
    expect(agentControlCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.agent-control-surface \.ac-foot \{[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("gives the card labels a readable lane clear of the hover actions", () => {
    // Only labelled cards need the wider lane; no-label cards keep 75%.
    expect(cardItem).toContain('labels.length > 0 && "max-md:w-1/2"');
    // The hover quick-action wrappers moved from the title/label row (`top-1.5`)
    // to the due row. The foreign-change dot keeps its own top-1.5 corner.
    expect(cardItem).toContain(
      "no-hover:hidden absolute right-1.5 top-8 z-10 opacity-0",
    );
    expect(cardItem).toContain("absolute right-8 top-8 z-10");
  });
});
