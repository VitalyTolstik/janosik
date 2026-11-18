import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import agentsPage from "./AgentsPage.tsx?raw";
import agentDetailPage from "./AgentDetailPage.tsx?raw";
import attention from "./AttentionApprovals.tsx?raw";
import runUi from "./run-ui.tsx?raw";
import sessionUi from "./session-ui.tsx?raw";
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
    expect(agentControlCss).toContain("top: 56px");
    expect(agentControlCss).toContain("height: 100dvh");
    expect(agentControlCss).toContain("safe-area-inset-bottom");
    expect(boardSettingsShell).toContain("max-md:h-[100dvh]");
    expect(boardSettingsShell).toContain("md:top-[56px]");
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

  it("gives every primary control a 44 px mobile target", () => {
    const controls = [
      [pausePanel, "agent-live-refresh"],
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
    expect(approvalUi).toContain("max-md:min-h-11");
    expect(agentsPage).toContain("min-h-11");
  });

  it("disables motion under prefers-reduced-motion", () => {
    expect(indexCss).toContain("prefers-reduced-motion: reduce");
    expect(indexCss).toContain(".animate-spin");
  });
});
