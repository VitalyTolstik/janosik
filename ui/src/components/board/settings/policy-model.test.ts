import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_AGENT_POLICY,
  type BoardAgentPolicy,
} from "@janosik/shared";

import {
  DESTRUCTIVE_POLICY_ACTIONS,
  EDITABLE_POLICY_ACTIONS,
  POLICY_TRIGGER_ORDER,
  draftOf,
  isDefaultPolicy,
  isDestructivePolicyAction,
  localPolicyFields,
  mergePolicyDraft,
  policyEquals,
  policyOfDraft,
  resolvePolicyConflict,
  togglePolicyAction,
  validatePolicyDraft,
} from "./policy-model";

function policy(overrides: Partial<BoardAgentPolicy> = {}): BoardAgentPolicy {
  return {
    ...DEFAULT_BOARD_AGENT_POLICY,
    requireApprovalFor: [...DEFAULT_BOARD_AGENT_POLICY.requireApprovalFor],
    ...overrides,
  };
}

describe("policy model (TASK-179.7)", () => {
  it("classifies destructive and editable policy triggers from the server model", () => {
    expect(DESTRUCTIVE_POLICY_ACTIONS).toHaveLength(15);
    expect(EDITABLE_POLICY_ACTIONS).toEqual([
      "move_to_done",
      "workflow.update",
    ]);
    expect(isDestructivePolicyAction("delete_card")).toBe(true);
    expect(isDestructivePolicyAction("member.invite")).toBe(true);
    expect(isDestructivePolicyAction("attachment.delete")).toBe(true);
    expect(isDestructivePolicyAction("move_to_done")).toBe(false);
    expect(isDestructivePolicyAction("workflow.update")).toBe(false);
    expect(POLICY_TRIGGER_ORDER.slice(0, 2)).toEqual([
      "move_to_done",
      "workflow.update",
    ]);
  });

  it("round-trips a policy through the editable draft", () => {
    const source = policy({ approvalTtlMinutes: 90, maxCardsPerRun: 20 });
    const roundTripped = policyOfDraft(draftOf(source));
    expect(roundTripped).not.toBeNull();
    expect(policyEquals(roundTripped as BoardAgentPolicy, source)).toBe(true);
  });

  it("merges non-conflicting local and server changes field by field", () => {
    const base = policy();
    const latest = policy({ destructive: "deny", maxCardsPerRun: 40 });
    const draft = {
      ...draftOf(base),
      approvalTtlMinutes: "90",
    };

    const result = mergePolicyDraft({
      base,
      latest,
      draft,
      localFields: ["approvalTtlMinutes"],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.draft.destructive).toBe("deny");
    expect(result.draft.maxCardsPerRun).toBe("40");
    expect(result.draft.approvalTtlMinutes).toBe("90");
    expect(result.localFields).toEqual(["approvalTtlMinutes"]);
  });

  it("keeps a same-field conflict explicit instead of overwriting either side", () => {
    const base = policy();
    const latest = policy({ approvalTtlMinutes: 120 });
    const draft = { ...draftOf(base), approvalTtlMinutes: "90" };

    const result = mergePolicyDraft({
      base,
      latest,
      draft,
      localFields: ["approvalTtlMinutes"],
    });

    expect(result.draft.approvalTtlMinutes).toBe("90");
    expect(result.conflicts).toEqual([
      {
        field: "approvalTtlMinutes",
        local: "90",
        server: "120",
      },
    ]);
    expect(result.localFields).toEqual(["approvalTtlMinutes"]);
  });

  it("drops a conflict when both sides chose the same value", () => {
    const base = policy();
    const latest = policy({ approvalTtlMinutes: 90 });
    const draft = { ...draftOf(base), approvalTtlMinutes: "90" };

    const result = mergePolicyDraft({
      base,
      latest,
      draft,
      localFields: ["approvalTtlMinutes"],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.draft.approvalTtlMinutes).toBe("90");
    expect(result.localFields).toEqual([]);
  });

  it("keeps a local-only change when the server did not touch the field", () => {
    const base = policy();
    const latest = policy({ destructive: "deny" });
    const draft = {
      ...draftOf(base),
      requireApprovalFor: ["move_to_done"] as const,
    };

    const result = mergePolicyDraft({
      base,
      latest,
      draft: { ...draft, requireApprovalFor: [...draft.requireApprovalFor] },
      localFields: ["requireApprovalFor"],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.draft.requireApprovalFor).toEqual(["move_to_done"]);
    expect(result.draft.destructive).toBe("deny");
  });

  it("detects a server change back to the base between two syncs", () => {
    const base = policy();
    const previous = policy({ destructive: "deny" });
    const latest = policy();
    const draft = { ...draftOf(base), destructive: "deny" as const };

    const result = mergePolicyDraft({
      base,
      previous,
      latest,
      draft,
      localFields: ["destructive"],
    });

    expect(result.conflicts).toEqual([
      {
        field: "destructive",
        local: "deny",
        server: "approval",
      },
    ]);
  });

  it("accepts the server value and drops the local field", () => {
    const conflict = {
      field: "approvalTtlMinutes" as const,
      local: "90",
      server: "120",
    };
    const draft = { ...draftOf(policy()), approvalTtlMinutes: "90" };
    const resolved = resolvePolicyConflict(draft, conflict, "server");
    expect(resolved.approvalTtlMinutes).toBe("120");
    expect(
      localPolicyFields(resolved, policy({ approvalTtlMinutes: 120 })),
    ).toEqual([]);
  });

  it("validates the numeric ranges and the canonical action order", () => {
    const draft = {
      ...draftOf(policy()),
      maxCommandsPerRun: "0",
      maxCardsPerRun: "51",
      approvalTtlMinutes: "1441",
    };
    expect(validatePolicyDraft(draft)).toMatchObject({
      ok: false,
      maxCommandsPerRun: null,
      maxCardsPerRun: null,
      approvalTtlMinutes: null,
    });
    expect(policyOfDraft(draft)).toBeNull();
  });

  it("recognizes the safe defaults", () => {
    expect(isDefaultPolicy(policy())).toBe(true);
    expect(isDefaultPolicy(policy({ destructive: "deny" }))).toBe(false);
  });

  it("never toggles a destructive trigger and keeps the wire order", () => {
    const actions = togglePolicyAction(
      ["workflow.update", "move_to_done"],
      "workflow.update",
    );
    expect(actions).toEqual(["move_to_done"]);
    expect(togglePolicyAction(actions, "delete_card")).toEqual([
      "move_to_done",
    ]);
    expect(togglePolicyAction(actions, "workflow.update")).toEqual([
      "move_to_done",
      "workflow.update",
    ]);
  });
});
