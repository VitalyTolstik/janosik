import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import agentsPage from "./AgentsPage.tsx?raw";
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

const SURFACES = {
  AgentsPage: agentsPage,
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

  it("keeps the 11 px type floor in every agent surface", () => {
    for (const [name, source] of Object.entries(SURFACES)) {
      expect(source, name).not.toMatch(/text-\[(8|9|10)(?:\.5)?px\]/);
    }
  });

  it("ships the Latin display face and the Russian body-stack override", () => {
    expect(indexCss).toContain(".font-agent-display");
    expect(indexCss).toContain('html[lang="ru"] .font-agent-display');
    expect(agentsPage).toContain("font-agent-display");
    expect(agentControlDialog).toContain("font-agent-display");
    expect(boardSettingsShell).toContain("font-agent-display");
  });

  it("defines AA status tones for both themes", () => {
    expect(indexCss).toContain("--agent-tone-success");
    expect(indexCss).toContain("--agent-tone-warning");
    expect(indexCss).toContain("--agent-tone-danger");
    expect(indexCss).toContain("--agent-tone-primary");
    expect(indexCss).toContain("html.light");
  });

  it("keeps the 390 full-screen shell, the 1024 sheet and safe-area padding", () => {
    expect(agentControlDialog).toContain("max-md:h-[100dvh]");
    expect(agentControlDialog).toContain("md:top-[56px]");
    expect(agentControlDialog).toContain("safe-area-inset-bottom");
    expect(boardSettingsShell).toContain("max-md:h-[100dvh]");
    expect(boardSettingsShell).toContain("md:top-[56px]");
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
