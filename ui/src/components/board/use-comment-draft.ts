import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_COMMENT_KIND, type CommentKind } from "@janosik/shared";

interface CommentDraft {
  text: string;
  kind: CommentKind;
}

interface ComposerState {
  draft: CommentDraft | null;
  sending: boolean;
  editorNonce: number;
}

const empty: ComposerState = { draft: null, sending: false, editorNonce: 0 };
const drafts = new Map<string, ComposerState>();
const listeners = new Map<string, Set<() => void>>();

function publish(key: string, state: ComposerState) {
  const subscribers = listeners.get(key);
  if (subscribers === undefined && state.draft === null && !state.sending) {
    drafts.delete(key);
  } else {
    drafts.set(key, state);
  }
  subscribers?.forEach((notify) => notify());
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
      draft,
    });
  }

  function discard() {
    if (key === null) return;
    const current = getSnapshot();
    if (current.sending) return;
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
      current.sending ||
      current.draft === null ||
      current.draft !== state.draft
    ) {
      return null;
    }
    const sent = current.draft;
    publish(key, { ...current, sending: true });

    return (saved: boolean) => {
      const latest = getSnapshot();
      // Edits made during the request belong to the next draft.
      if (saved && latest.draft === sent) {
        publish(key, {
          draft: null,
          sending: false,
          editorNonce: latest.editorNonce + 1,
        });
      } else {
        publish(key, { ...latest, sending: false });
      }
    };
  }

  return { ...state, update, discard, startSend };
}
