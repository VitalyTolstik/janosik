/**
 * Word-diff for the history feed's "from → to" halves (TASK-37): the two
 * stored snapshots are usually near-identical walls of text, so the reader
 * needs the changed fragment, not both values in full. The changed middle
 * is highlighted by the caller; the unchanged head/tail stay as context
 * and collapse to an ellipsis once they run long.
 *
 * The split is character-level common prefix + suffix — one contiguous
 * change region. That is exactly what a paused editing session produces
 * (a few typed or deleted characters somewhere), it needs no dependency
 * and it works on the unbroken digit runs a description full of ids
 * produces just as well as on prose.
 */

export interface DiffSegment {
  text: string;
  kind: "same" | "removed" | "added";
}

/** Unchanged runs longer than this collapse to a `…`-headed/tailed stub. */
const CONTEXT_MAX = 24;

/** How many characters survive on each side of a collapsed context run. */
const CONTEXT_KEEP = 12;

/** A changed fragment longer than this collapses its middle. */
const CHANGE_MAX = 160;

/** How much of an oversized changed fragment survives at each end. */
const CHANGE_KEEP = 60;

export interface DiffSides {
  /** The "was" half: context + removed fragment. */
  left: DiffSegment[];
  /** The "became" half: context + added fragment. */
  right: DiffSegment[];
}

/** The two halves with the change highlighted, or `null` for equal texts. */
export function diffSides(from: string, to: string): DiffSides | null {
  if (from === to) return null;

  const prefix = commonPrefix(from, to);
  const suffix = commonSuffix(from, to, from.length - prefix);
  const head = from.slice(0, prefix);
  const tail = from.slice(from.length - suffix);
  const removed = from.slice(prefix, from.length - suffix);
  const added = to.slice(prefix, to.length - suffix);

  return {
    left: assemble(head, tail, removed, "removed"),
    right: assemble(head, tail, added, "added"),
  };
}

function assemble(
  head: string,
  tail: string,
  changed: string,
  kind: "removed" | "added",
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  pushContext(segments, head, "lead");
  pushChanged(segments, changed, kind);
  pushContext(segments, tail, "tail");
  return segments;
}

function pushContext(
  segments: DiffSegment[],
  text: string,
  side: "lead" | "tail",
): void {
  if (!text) return;
  if (text.length <= CONTEXT_MAX) {
    segments.push({ text, kind: "same" });
    return;
  }
  segments.push({
    text:
      side === "lead"
        ? `…${text.slice(text.length - CONTEXT_KEEP)}`
        : `${text.slice(0, CONTEXT_KEEP)}…`,
    kind: "same",
  });
}

function pushChanged(
  segments: DiffSegment[],
  text: string,
  kind: "removed" | "added",
): void {
  if (!text) return;
  if (text.length <= CHANGE_MAX) {
    segments.push({ text, kind });
    return;
  }
  segments.push({
    text: `${text.slice(0, CHANGE_KEEP)}…${text.slice(-CHANGE_KEEP)}`,
    kind,
  });
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a: string, b: string, limit: number): number {
  const n = Math.min(a.length, b.length, limit);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}
