import { useCallback } from "react";

import type { Label } from "@/types/kanban";

const NO_LABELS: Label[] = [];

interface Resolved {
  byId: Map<string, Label>;
  /** Resolved tuples, keyed by the joined label ids. */
  tuples: Map<string, Label[]>;
}

/**
 * Resolution cache, keyed by the board's `labels` array itself: a new array
 * (a rename, a recolor, a label added or removed) starts a fresh entry and
 * the old one becomes garbage along with the array it belonged to.
 */
const CACHE = new WeakMap<Label[], Resolved>();

function resolve(labels: Label[], labelIds: string[]): Label[] {
  if (labelIds.length === 0) return NO_LABELS;
  let resolved = CACHE.get(labels);
  if (!resolved) {
    resolved = {
      byId: new Map(labels.map((label) => [label.id, label])),
      tuples: new Map(),
    };
    CACHE.set(labels, resolved);
  }
  const key = labelIds.join(" ");
  const cached = resolved.tuples.get(key);
  if (cached) return cached;
  const tuple = labelIds
    .map((labelId) => resolved.byId.get(labelId))
    .filter((label): label is Label => label !== undefined);
  resolved.tuples.set(key, tuple);
  return tuple;
}

/**
 * Resolves a card's `labelIds` into `Label` objects.
 *
 * Two reasons this is shared instead of a `.map().find()` at the call site
 * (TASK-21.4):
 *  - **stable arrays**: a fresh `Label[]` on every render defeats `memo` on
 *    the card components, so a single keystroke anywhere on the board would
 *    re-render every card. Identical id tuples resolve to the very same
 *    array until `labels` itself changes — which is exactly when the cards
 *    *should* re-render;
 *  - **lookup cost**: an id-to-label map instead of a linear `find` per
 *    label per card.
 */
export function useCardLabels(
  labels: Label[],
): (labelIds: string[]) => Label[] {
  return useCallback(
    (labelIds: string[]) => resolve(labels, labelIds),
    [labels],
  );
}
