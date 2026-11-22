import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import agentsPage from "./AgentsPage.tsx?raw";
import agentDetailPage from "./AgentDetailPage.tsx?raw";
import attention from "./AttentionApprovals.tsx?raw";
import runUi from "./run-ui.tsx?raw";
import sessionUi from "./session-ui.tsx?raw";
import agentActionDialog from "./AgentActionDialog.tsx?raw";
import agentConfirmDialog from "./AgentConfirmDialog.tsx?raw";
import boardScope from "./BoardScopeSelect.tsx?raw";
import agentControlDialog from "../agent-control/AgentControlDialog.tsx?raw";
import approvalsPanel from "../agent-control/ApprovalsPanel.tsx?raw";
import pausePanel from "../agent-control/PausePanel.tsx?raw";
import runsPanel from "../agent-control/RunsPanel.tsx?raw";
import approvalUi from "../approvals/approval-ui.tsx?raw";
import boardSettingsShell from "../board/settings/BoardSettingsShell.tsx?raw";
import agentsAutomation from "../board/settings/AgentsAutomation.tsx?raw";

const indexCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const agentControlCss = readFileSync(
  resolve(process.cwd(), "src/components/agent-control/agent-control.css"),
  "utf8",
);

const SURFACES = {
  AgentsPage: agentsPage,
  AgentDetailPage: agentDetailPage,
  AttentionApprovals: attention,
  "run-ui": runUi,
  "session-ui": sessionUi,
  BoardScopeSelect: boardScope,
  AgentControlDialog: agentControlDialog,
  ApprovalsPanel: approvalsPanel,
  PausePanel: pausePanel,
  RunsPanel: runsPanel,
  "approval-ui": approvalUi,
  BoardSettingsShell: boardSettingsShell,
  AgentsAutomation: agentsAutomation,
};

describe("agent design system (TASK-179.9)", () => {
  it("uses no native select in the agent surfaces", () => {
    for (const [name, source] of Object.entries(SURFACES)) {
      expect(source, name).not.toMatch(/<select\b/);
    }
  });

  it("keeps the mockup's 10 px minimum in every agent surface", () => {
    // The current prototype uses 10/10.5 px for dense metadata (Live row
    // actions, reject label, Load more); nothing may fall below that floor.
    for (const [name, source] of Object.entries(SURFACES)) {
      expect(source, name).not.toMatch(/text-\[(8|9)(?:\.5)?px\]/);
    }
  });

  it("ships the Latin display face and the Russian body-stack override", () => {
    expect(indexCss).toContain(".font-agent-display");
    expect(indexCss).toContain('html[lang="ru"] .font-agent-display');
    expect(agentsPage).toContain("font-agent-display");
    expect(boardSettingsShell).toContain("font-agent-display");
    // Agent control mirrors the prototype's own heading styles instead of
    // the generic DialogTitle defaults: 16/700 display face, 1.25 leading.
    expect(agentControlDialog).toContain('import "./agent-control.css"');
    expect(agentControlCss).toContain("font-size: 16px");
    expect(agentControlCss).toContain("font-weight: 700");
    expect(agentControlCss).toContain("line-height: 1.25");
    expect(agentControlCss).toContain(".ac-description");
    expect(agentControlCss).toContain("font-size: 11px");
    expect(agentControlCss).toContain("line-height: 1.45");
    expect(agentControlCss).toContain(
      'html[lang="ru"] .agent-control-surface .ac-title',
    );
  });

  it("keeps the mockup's icon vocabulary on the shared detail surfaces", () => {
    expect(runUi).toContain("Link as LinkIcon");
    expect(runUi).not.toContain("Link2");
    expect(attention).not.toContain("Link2");
    expect(approvalUi).not.toContain("Link2");
    expect(sessionUi).toContain("GitCommit");
    expect(sessionUi).not.toContain("agents-session-token-settings");
    expect(sessionUi).not.toContain("agents-token-settings-");
  });

  it("defines AA status tones for both themes", () => {
    expect(indexCss).toContain("--agent-tone-success");
    expect(indexCss).toContain("--agent-tone-warning");
    expect(indexCss).toContain("--agent-tone-danger");
    expect(indexCss).toContain("--agent-tone-primary");
    expect(indexCss).toContain("--agent-primary-strong");
    expect(indexCss).toContain("html.light");
  });

  it("keeps the 390 full-screen shell, the 1024 sheet and safe-area padding", () => {
    // TASK-177.18: the tablet sheet starts below a header that grows by the
    // iOS top inset. `env()` is 0 on desktop, so the calc still resolves to
    // the previous 56 px top.
    expect(agentControlCss).toContain(
      "top: calc(56px + env(safe-area-inset-top));",
    );
    expect(agentControlCss).toContain("height: 100dvh");
    expect(agentControlCss).toContain("safe-area-inset-bottom");
    expect(boardSettingsShell).toContain("max-md:h-[100dvh]");
    expect(boardSettingsShell).toContain(
      "md:top-[calc(56px_+_env(safe-area-inset-top))]",
    );
    expect(boardSettingsShell).not.toContain("md:top-[56px]");
  });

  it("uses the large-screen width caps on the global agents page", () => {
    expect(agentsPage).toContain("max-w-[980px]");
    expect(agentsPage).toContain("min-[1600px]:max-w-[1200px]");
    expect(agentsPage).toContain("min-[1181px]:w-[352px]");
    expect(agentsPage).toContain("min-[1600px]:w-[400px]");
  });

  it("adds the large-screen modal width only at >=1600", () => {
    const marker = "@media (min-width: 1600px)";
    const start = agentControlCss.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const block = agentControlCss.slice(start);
    expect(block).toContain(".agent-control-surface.ac-modal");
    expect(block).toContain("top: 0");
    expect(block).toContain("bottom: 0");
    expect(block).toContain("width: min(1400px, calc(100vw - 96px))");
    expect(block).toContain("height: min(860px, calc(100dvh - 96px))");
    expect(block).toContain(".agent-control-surface .ac-rail");
    expect(block).toContain("width: 220px");
    expect(block).toContain(".agent-control-surface .ac-list");
    expect(block).toContain('data-testid="agent-run-list"');
    expect(block).toContain("width: 360px");
  });

  it("keeps the board pause/resume footer reachable on the phone Live tab", () => {
    // F4: zero live sessions used to leave the footer with its note and its
    // actions both `display:none`, so a paused board had no Resume button.
    // The note may stay hidden, but the actions row must remain laid out.
    const mobileStart = agentControlCss.indexOf("@media (max-width: 760px)");
    const mobileEnd = agentControlCss.indexOf("@media (max-width: 480px)");
    const mobileBlock = agentControlCss.slice(mobileStart, mobileEnd);
    expect(mobileStart).toBeGreaterThan(-1);
    expect(mobileBlock).toContain(
      ".agent-control-surface .ac-foot .ac-foot-note {",
    );
    expect(mobileBlock).not.toMatch(
      /\.agent-control-surface \.ac-foot \.ac-foot-actions \{[^}]*display:\s*none/,
    );
    expect(mobileBlock).toMatch(
      /\.agent-control-surface \.ac-foot \.ac-foot-actions \{\s*display: flex;\s*width: 100%;/,
    );
    expect(mobileBlock).toMatch(
      /\.agent-control-surface \.ac-foot \.ac-foot-actions \.btn \{[^}]*min-height: 44px/,
    );
    // The Live footer is a flex sibling now, so its own height is natural;
    // Runs still overlays and reserves the notched 61 px + bottom inset.
    expect(pausePanel).toContain("ac-foot ac-foot-static");
    expect(agentControlDialog).toContain(
      'tab === "runs" && "ac-body--overlay-footer"',
    );
    expect(mobileBlock).toContain(
      "padding-bottom: calc(61px + env(safe-area-inset-bottom));",
    );
    // The Pause/Resume (and member Close) controls live outside the
    // `sessions.length > 0` branch, so the empty Live state inherits them.
    expect(pausePanel).toContain('data-testid="board-pause-status"');
    expect(pausePanel).toContain('data-testid="board-pause"');
    expect(pausePanel).toContain('data-testid="board-resume"');
    // With sessions the card owns the action; the admin footer is hidden so
    // it cannot duplicate it or leave a blank bar on a phone.
    expect(mobileBlock).toContain(
      '.agent-control-surface .ac-foot[data-live-status="true"][data-admin="true"]',
    );
  });

  it("keeps tablet touch controls at 44 px", () => {
    // F7: at 768 px `md` resets the mobile minimum back to 16 px. These four
    // controls are touch targets on a tablet, so the 44 px floor is kept at
    // every width instead of only below 768.
    expect(attention).toContain(
      '"inline-flex max-xl:min-h-11 items-center gap-1 text-[11px] transition-colors"',
    );
    expect(attention).not.toContain("md:min-h-0");
    expect(agentsPage).toContain(
      'className="ml-auto inline-flex max-xl:min-h-11 items-center gap-[3px] text-[11px] text-muted-foreground hover:text-foreground"',
    );
    expect(agentsPage).not.toContain("min-[761px]:min-h-0");
    expect(agentsAutomation).toContain(
      "inline-flex max-xl:min-h-11 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap",
    );
    expect(agentsAutomation).toContain(
      'className="ml-auto inline-flex max-xl:min-h-11 items-center gap-1 text-[11px] leading-[1.45] text-muted-foreground',
    );
    // Session Pause/Resume/End and the token-settings trigger keep the
    // 44 px floor up to 1279 px too; only the 1280 px desktop row shrinks.
    expect(pausePanel).toContain("min-[1280px]:h-[26px]");
    expect(pausePanel).toContain("min-[1280px]:h-6");
    expect(pausePanel).not.toContain("min-[761px]:h-[26px]");
    expect(pausePanel).not.toContain("min-[761px]:h-6");
    expect(sessionUi).toContain("min-[1280px]:min-h-6");
    expect(sessionUi).not.toContain("min-[761px]:min-h-6");
    // The live footer and the approval/pause confirmation dialogs are the
    // other touch actions named by F7. They keep the 44 px floor up to the
    // 1280 px desktop breakpoint; above it the compact 28/32 px mockup row
    // returns.
    const tabletStart = agentControlCss.indexOf(
      "@media (min-width: 761px) and (max-width: 1279px)",
    );
    const tabletEnd = agentControlCss.indexOf(
      "@media (min-width: 761px) and (max-width: 1279px)",
      tabletStart + 1,
    );
    expect(tabletStart).toBeGreaterThan(-1);
    expect(tabletEnd).toBeGreaterThan(tabletStart);
    const tabletBlock = agentControlCss.slice(tabletStart, tabletEnd);
    expect(tabletBlock).toContain(
      ".agent-control-surface .ac-foot .ac-foot-actions .btn",
    );
    expect(tabletBlock).toContain(
      ".agent-control-surface .live-status-actions .btn",
    );
    expect(tabletBlock).toContain("min-height: 44px");
    expect(tabletBlock).toMatch(
      /\.agent-control-surface \.ac-toolbar \.icon-btn-sm \{\s*width: 44px;\s*height: 44px;/,
    );
    expect(tabletBlock).toContain(
      "padding-bottom: calc(61px + env(safe-area-inset-bottom));",
    );
    for (const [name, source] of [
      ["approval-ui", approvalUi],
      ["AgentActionDialog", agentActionDialog],
      ["AgentConfirmDialog", agentConfirmDialog],
    ] as const) {
      expect(source, name).toContain("max-xl:min-h-11");
    }
  });

  it("gives every primary control a 44 px mobile target", () => {
    const controls = [
      [pausePanel, "agent-live-refresh"],
      [pausePanel, "agent-session-pause"],
      [pausePanel, "agent-session-resume"],
      [pausePanel, "agent-session-end"],
      [pausePanel, "board-pause"],
      [approvalUi, "approval-approve"],
      [approvalUi, "approval-reject"],
      [runUi, "run-revert-confirm"],
      [agentsPage, "agents-refresh"],
    ] as const;
    for (const [source, testId] of controls) {
      expect(source, testId).toContain(testId);
    }
    expect(pausePanel).toContain("min-h-11");
    expect(pausePanel).toContain("agent-live-token-settings-");
    // Tie the 44 px rule to the actual approval actions, not to an unrelated
    // 22 px chip elsewhere in the same file.
    expect(approvalUi).toMatch(
      /data-testid="approval-approve"[\s\S]{0,400}?max-xl:min-h-11/,
    );
    expect(approvalUi).toMatch(
      /data-testid="approval-reject"[\s\S]{0,400}?max-xl:min-h-11/,
    );
    expect(agentsPage).toContain("min-h-11");
  });

  it("disables motion under prefers-reduced-motion", () => {
    expect(indexCss).toContain("prefers-reduced-motion: reduce");
    expect(indexCss).toContain(".animate-spin");
  });
});
