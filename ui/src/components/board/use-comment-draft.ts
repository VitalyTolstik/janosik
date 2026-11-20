import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_COMMENT_KIND, type CommentKind } from "@janosik/shared";

interface CommentDraft {
  text: string;
  kind: CommentKind;
}

interface ComposerState {
  draft: CommentDraft | null;
  sendToken: symbol | null;
  editorNonce: number;
}

const MAX_CACHED_DRAFTS = 50;
const empty: ComposerState = { draft: null, sendToken: null, editorNonce: 0 };
const drafts = new Map<string, ComposerState>();
const listeners = new Map<string, Set<() => void>>();

function publish(key: string, state: ComposerState) {
  const subscribers = listeners.get(key);
  drafts.delete(key);
  if (
    state.draft !== null ||
    state.sendToken !== null ||
    (subscribers !== undefined && state.editorNonce !== 0)
  ) {
    drafts.set(key, state);
    if (drafts.size > MAX_CACHED_DRAFTS) {
      const oldest = drafts.keys().next().value!;
      drafts.delete(oldest);
      listeners.get(oldest)?.forEach((notify) => notify());
    }
  }
  subscribers?.forEach((notify) => notify());
}

export function clearCommentDrafts(): void {
  drafts.clear();
  listeners.forEach((subscribers) => subscribers.forEach((notify) => notify()));
}

export function useCommentDraft(cardId: string, userId?: string) {
  // Keep drafts in this tab and scope them to the signed-in author.
  const key = userId === undefined ? null : JSON.stringify([userId, cardId]);
  const getSnapshot = useCallback(
    () => (key === null ? empty : (drafts.get(key) ?? empty)),
    [key],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      if (key === null) return () => {};
      const subscribers = listeners.get(key) ?? new Set();
      listeners.set(key, subscribers);
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
        if (subscribers.size > 0) return;
        listeners.delete(key);
        const state = drafts.get(key);
        if (state) publish(key, state);
      };
    },
    [key],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot);

  function update(change: Partial<Pick<CommentDraft, "text" | "kind">>) {
    if (key === null) return;
    const current = getSnapshot();
    const previous = current.draft ?? {
      text: "",
      kind: DEFAULT_COMMENT_KIND,
    };
    const draft = { ...previous, ...change };
    if (draft.text === previous.text && draft.kind === previous.kind) return;
    publish(key, {
      ...current,
      draft:
        draft.text.trim() === "" && draft.kind === DEFAULT_COMMENT_KIND
          ? null
          : draft,
    });
  }

  function discard() {
    if (key === null) return;
    const current = getSnapshot();
    if (current.sendToken !== null) return;
    publish(key, {
      ...current,
      draft: null,
      editorNonce: current.editorNonce + 1,
    });
  }

  function startSend() {
    if (key === null) return null;
    const current = getSnapshot();
    if (
      current.sendToken !== null ||
      current.draft === null ||
      current.draft !== state.draft
    ) {
      return null;
    }
    const sent = current.draft;
    const sendToken = Symbol();
    publish(key, { ...current, sendToken });

    return (saved: boolean) => {
      const latest = getSnapshot();
      if (latest.sendToken !== sendToken) return;
      // Edits made during the request belong to the next draft.
      if (saved && latest.draft === sent) {
        publish(key, {
          draft: null,
          sendToken: null,
          editorNonce: latest.editorNonce + 1,
        });
      } else {
        publish(key, { ...latest, sendToken: null });
      }
    };
  }

  return {
    draft: state.draft,
    sending: state.sendToken !== null,
    editorNonce: state.editorNonce,
    update,
    discard,
    startSend,
  };
}
