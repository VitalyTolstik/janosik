import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoardAgentPolicy,
  BoardAgentPolicyAction,
  BoardAgentPolicyStateDto,
} from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import {
  draftOf,
  isDefaultPolicy,
  isDestructivePolicyAction,
  localPolicyFields,
  mergePolicyDraft,
  policyOfDraft,
  resolvePolicyConflict,
  setDraftField,
  togglePolicyAction,
  validatePolicyDraft,
  type PolicyDraft,
  type PolicyDraftValidation,
  type PolicyField,
  type PolicyFieldConflict,
  type PolicyFieldValue,
} from "./policy-model";

export type PolicySaveErrorKind =
  "offline" | "forbidden" | "pat" | "conflict" | "generic";

export interface PolicySaveError {
  kind: PolicySaveErrorKind;
  version?: number;
}

export type PolicySaveOutcome = "saved" | "conflict" | "error" | "invalid";

export interface PolicyResetOutcome {
  kind: "saved" | "conflict" | "error";
  version?: number;
}

interface PolicySession {
  state: BoardAgentPolicyStateDto;
  /** The server policy the user first loaded; conflicts stay relative to it. */
  base: BoardAgentPolicy;
  /** The server policy the draft was last synced against. */
  lastSynced: BoardAgentPolicy;
  draft: PolicyDraft;
  /** Fields whose draft value differs from the latest server policy. */
  localFields: PolicyField[];
  conflicts: PolicyFieldConflict[];
}

export interface UsePolicyDraftOptions {
  boardId: string | undefined;
  enabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

export interface UsePolicyDraftResult {
  status: "loading" | "error" | "ready";
  state: BoardAgentPolicyStateDto | null;
  draft: PolicyDraft | null;
  version: number | null;
  validation: PolicyDraftValidation | null;
  dirty: boolean;
  saving: boolean;
  conflicts: PolicyFieldConflict[];
  error: PolicySaveError | null;
  usingDefaults: boolean;
  canSave: boolean;
  load: () => void;
  reload: () => Promise<void>;
  setField: (field: PolicyField, value: PolicyFieldValue) => void;
  toggleAction: (action: BoardAgentPolicyAction) => void;
  resolveConflict: (field: PolicyField, choice: "mine" | "server") => void;
  save: () => Promise<PolicySaveOutcome>;
  discard: () => void;
  reset: () => Promise<PolicyResetOutcome>;
}

function policyFromState(state: BoardAgentPolicyStateDto): BoardAgentPolicy {
  return state.policy ?? state.effective;
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === "version_conflict" || error.conflict === "version")
  );
}

function errorOf(error: unknown): PolicySaveError {
  if (error instanceof ApiError) {
    if (error.offline) return { kind: "offline" };
    if (error.code === "pat_forbidden") return { kind: "pat" };
    if (error.code === "scope_denied" || error.status === 403) {
      return { kind: "forbidden" };
    }
    if (isVersionConflict(error)) return { kind: "conflict" };
  }
  return { kind: "generic" };
}

/**
 * TASK-179.7 — policy draft with field-level CAS.
 *
 * The hook keeps three snapshots: `base` (the server policy the draft was
 * loaded from), `draft` (local edits) and the latest server policy in
 * `state`. A 409 never resends the stale draft: it reloads the server policy,
 * merges only the fields in `localFields` and retries with the new version.
 * A field changed on both sides stays in `conflicts` until the admin chooses.
 */
export function usePolicyDraft({
  boardId,
  enabled,
  onDirtyChange,
}: UsePolicyDraftOptions): UsePolicyDraftResult {
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [session, setSession] = useState<PolicySession | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<PolicySaveError | null>(null);
  const [revision, setRevision] = useState(0);
  const sessionRef = useRef<PolicySession | null>(null);

  const applySession = useCallback((next: PolicySession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const applyServerState = useCallback(
    (next: BoardAgentPolicyStateDto) => {
      const policy = policyFromState(next);
      applySession({
        state: next,
        base: policy,
        lastSynced: policy,
        draft: draftOf(policy),
        localFields: [],
        conflicts: [],
      });
      setError(null);
    },
    [applySession],
  );

  const load = useCallback(async () => {
    if (!enabled || boardId === undefined || !isApiEnabled()) {
      applySession(null);
      setStatus("loading");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const next = await api.getBoardAgentPolicy(boardId);
      const policy = policyFromState(next);
      applySession({
        state: next,
        base: policy,
        lastSynced: policy,
        draft: draftOf(policy),
        localFields: [],
        conflicts: [],
      });
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(errorOf(loadError));
    }
  }, [applySession, boardId, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the request with a clean loading state
    void load();
  }, [load, revision]);

  const dirty =
    session !== null &&
    (localPolicyFields(session.draft, policyFromState(session.state)).length >
      0 ||
      session.conflicts.length > 0);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const setField = useCallback(
    (field: PolicyField, value: PolicyFieldValue) => {
      const current = sessionRef.current;
      if (current === null) return;
      const draft = setDraftField(current.draft, field, value);
      const conflicts = current.conflicts.filter(
        (conflict) => conflict.field !== field,
      );
      const localFields = localPolicyFields(
        draft,
        policyFromState(current.state),
      );
      applySession({
        ...current,
        draft,
        localFields,
        conflicts,
      });
      if (conflicts.length === 0) {
        setError((currentError) =>
          currentError?.kind === "conflict" ? null : currentError,
        );
      }
    },
    [applySession],
  );

  const toggleAction = useCallback(
    (action: BoardAgentPolicyAction) => {
      const current = sessionRef.current;
      if (current === null || isDestructivePolicyAction(action)) return;
      setField(
        "requireApprovalFor",
        togglePolicyAction(current.draft.requireApprovalFor, action),
      );
    },
    [setField],
  );

  const resolveConflict = useCallback(
    (field: PolicyField, choice: "mine" | "server") => {
      const current = sessionRef.current;
      if (current === null) return;
      const conflict = current.conflicts.find((entry) => entry.field === field);
      if (conflict === undefined) return;
      const draft = resolvePolicyConflict(current.draft, conflict, choice);
      const conflicts = current.conflicts.filter(
        (entry) => entry.field !== field,
      );
      applySession({
        ...current,
        draft,
        localFields: localPolicyFields(draft, policyFromState(current.state)),
        conflicts,
      });
      if (conflicts.length === 0) {
        setError((currentError) =>
          currentError?.kind === "conflict" ? null : currentError,
        );
      }
    },
    [applySession],
  );

  const reload = useCallback(async () => {
    const current = sessionRef.current;
    if (current === null || boardId === undefined) return;
    setError(null);
    try {
      const fetched = await api.getBoardAgentPolicy(boardId);
      const active = sessionRef.current;
      if (active === null) return;
      const latest = policyFromState(fetched);
      const merged = mergePolicyDraft({
        base: active.base,
        previous: active.lastSynced,
        latest,
        draft: active.draft,
        localFields: active.localFields,
      });
      applySession({
        state: fetched,
        base: active.base,
        lastSynced: latest,
        draft: merged.draft,
        localFields: merged.localFields,
        conflicts: merged.conflicts,
      });
      if (merged.conflicts.length > 0) {
        setError({ kind: "conflict", version: fetched.version });
      }
    } catch (reloadError) {
      setError(errorOf(reloadError));
    }
  }, [applySession, boardId]);

  const save = useCallback(async (): Promise<PolicySaveOutcome> => {
    const current = sessionRef.current;
    if (
      current === null ||
      boardId === undefined ||
      saving ||
      savingRef.current
    ) {
      return "error";
    }
    if (current.conflicts.length > 0) {
      setError({ kind: "conflict", version: current.state.version });
      return "conflict";
    }
    if (policyOfDraft(current.draft) === null) return "invalid";

    const persist = async (
      draft: PolicyDraft,
      version: number,
      retriesLeft: number,
    ): Promise<PolicySaveOutcome> => {
      const policy = policyOfDraft(draft);
      if (policy === null) return "invalid";
      try {
        const next = await api.updateBoardAgentPolicy(boardId, {
          policy,
          version,
        });
        applyServerState(next);
        return "saved";
      } catch (saveError) {
        if (!isVersionConflict(saveError)) {
          setError(errorOf(saveError));
          return "error";
        }

        let fetched: BoardAgentPolicyStateDto;
        try {
          fetched = await api.getBoardAgentPolicy(boardId);
        } catch (reloadError) {
          setError(errorOf(reloadError));
          return "error";
        }

        const active = sessionRef.current;
        if (active === null) {
          setError({ kind: "generic" });
          return "error";
        }
        const latest = policyFromState(fetched);
        const merged = mergePolicyDraft({
          base: active.base,
          previous: active.lastSynced,
          latest,
          draft: active.draft,
          localFields: active.localFields,
        });
        applySession({
          state: fetched,
          base: active.base,
          lastSynced: latest,
          draft: merged.draft,
          localFields: merged.localFields,
          conflicts: merged.conflicts,
        });

        if (merged.conflicts.length > 0 || retriesLeft <= 0) {
          setError({ kind: "conflict", version: fetched.version });
          return "conflict";
        }
        if (merged.localFields.length === 0) {
          // The server already has every value the draft wanted; reloading
          // is the save, and a no-op PATCH would only bump the version.
          applySession({
            state: fetched,
            base: latest,
            lastSynced: latest,
            draft: draftOf(latest),
            localFields: [],
            conflicts: [],
          });
          setError(null);
          return "saved";
        }
        return persist(merged.draft, fetched.version, retriesLeft - 1);
      }
    };

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      return await persist(current.draft, current.state.version, 2);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [applyServerState, applySession, boardId, saving]);

  const discard = useCallback(() => {
    const current = sessionRef.current;
    if (current === null) return;
    const latest = policyFromState(current.state);
    applySession({
      ...current,
      base: latest,
      lastSynced: latest,
      draft: draftOf(latest),
      localFields: [],
      conflicts: [],
    });
    setError(null);
  }, [applySession]);

  const reset = useCallback(async (): Promise<PolicyResetOutcome> => {
    const current = sessionRef.current;
    if (
      current === null ||
      boardId === undefined ||
      saving ||
      savingRef.current
    ) {
      return { kind: "error" };
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateBoardAgentPolicy(boardId, {
        policy: null,
        version: current.state.version,
      });
      applyServerState(next);
      return { kind: "saved" };
    } catch (resetError) {
      if (!isVersionConflict(resetError)) {
        setError(errorOf(resetError));
        return { kind: "error" };
      }

      let fetched: BoardAgentPolicyStateDto;
      try {
        fetched = await api.getBoardAgentPolicy(boardId);
      } catch (reloadError) {
        setError(errorOf(reloadError));
        return { kind: "error" };
      }
      const active = sessionRef.current;
      if (active === null) {
        setError({ kind: "generic" });
        return { kind: "error" };
      }
      const latest = policyFromState(fetched);
      // A reset is a whole-policy operation, but the draft must still be
      // merged so cancelling the second confirmation cannot send a stale
      // draft with the new version.
      const merged = mergePolicyDraft({
        base: active.base,
        previous: active.lastSynced,
        latest,
        draft: active.draft,
        localFields: active.localFields,
      });
      applySession({
        state: fetched,
        base: active.base,
        lastSynced: latest,
        draft: merged.draft,
        localFields: merged.localFields,
        conflicts: merged.conflicts,
      });
      setError({ kind: "conflict", version: fetched.version });
      return { kind: "conflict", version: fetched.version };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [applyServerState, applySession, boardId, saving]);

  const validation =
    session === null ? null : validatePolicyDraft(session.draft);
  const canSave =
    session !== null &&
    !saving &&
    dirty &&
    session.conflicts.length === 0 &&
    validation?.ok === true;

  return {
    status,
    state: session?.state ?? null,
    draft: session?.draft ?? null,
    version: session?.state.version ?? null,
    validation,
    dirty,
    saving,
    conflicts: session?.conflicts ?? [],
    error,
    usingDefaults: session !== null && isDefaultPolicy(session.state.effective),
    canSave,
    load: () => setRevision((value) => value + 1),
    reload,
    setField,
    toggleAction,
    resolveConflict,
    save,
    discard,
    reset,
  };
}
