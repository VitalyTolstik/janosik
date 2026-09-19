import type { Board, Card, CardLink, CardLinkType } from "@janosik/shared";

/**
 * Card-link lookups (TASK-46).
 *
 * A `CardLink` row lives on its source card and is directional — "blocks",
 * "relates to" or "duplicates" the target. Views that show the *other*
 * side of a relation ("is blocked by") would otherwise have to scan the
 * whole board per card, so this module builds one index per `board.cards`
 * snapshot and caches it on a `WeakMap`: every consumer — card fronts, the
 * filter, the dialog — shares a single scan per board change, and the
 * cached object keeps a stable identity so memoized card components only
 * re-render when the data they show actually changed.
 */

/** An incoming link plus the card that holds it. */
export interface IncomingLink {
  fromCardId: string;
  link: CardLink;
}

/** Everything a view needs about one card's relations. */
export interface CardLinkFacts {
  /** Outgoing rows stored on the card itself. */
  outgoing: CardLink[];
  /** Rows other cards hold towards this one (dangling sources skipped). */
  incoming: IncomingLink[];
  /** Outgoing + incoming, the number a card-front badge shows. */
  degree: number;
  /**
   * An incoming "blocks" from a live, non-archived card — the red
   * "Blocked" badge. Archived blockers don't count: nothing can progress
   * on an archived card anyway.
   */
  blocked: boolean;
}

/** Per-card facts for the whole board, keyed by card id. */
export interface CardLinkIndex {
  factsOf(cardId: string): CardLinkFacts;
}

const EMPTY_FACTS: CardLinkFacts = {
  outgoing: [],
  incoming: [],
  degree: 0,
  blocked: false,
};

interface FactsDraft {
  outgoing: CardLink[];
  incoming: IncomingLink[];
  blocked: boolean;
}

const indexCache = new WeakMap<Board["cards"], CardLinkIndex>();

/**
 * The link index of one `board.cards` snapshot — one scan per version,
 * shared by every consumer (WeakMap-cached). Dangling rows (the target no
 * longer exists) never surface: they are skipped once, here.
 */
export function cardLinkIndex(cards: Board["cards"]): CardLinkIndex {
  const cached = indexCache.get(cards);
  if (cached) return cached;

  const drafts = new Map<string, FactsDraft>();
  const draftOf = (cardId: string): FactsDraft => {
    let draft = drafts.get(cardId);
    if (!draft) {
      draft = { outgoing: [], incoming: [], blocked: false };
      drafts.set(cardId, draft);
    }
    return draft;
  };

  for (const card of Object.values(cards)) {
    for (const link of card.links ?? []) {
      // The outgoing side is stored on the card itself.
      if (link.targetCardId in cards) draftOf(card.id).outgoing.push(link);
      // The incoming side of the row, when the target still exists.
      const target = cards[link.targetCardId];
      if (!target || target.id === card.id) continue;
      draftOf(target.id).incoming.push({ fromCardId: card.id, link });
      if (link.type === "blocks" && card.archivedAt === undefined) {
        draftOf(target.id).blocked = true;
      }
    }
  }

  const facts = new Map<string, CardLinkFacts>();
  for (const [cardId, draft] of drafts) {
    facts.set(cardId, {
      outgoing: draft.outgoing,
      incoming: draft.incoming,
      degree: draft.outgoing.length + draft.incoming.length,
      blocked: draft.blocked,
    });
  }

  const index: CardLinkIndex = {
    factsOf: (cardId: string) => facts.get(cardId) ?? EMPTY_FACTS,
  };
  indexCache.set(cards, index);
  return index;
}

/**
 * A change signature of everything the link facts derive from: each card's
 * link rows, its archived flag (an archived blocker stops counting) and
 * the card id set (a deletion dangles rows). Ordinary edits — a title, a
 * description, a due date — leave it untouched, so callers can hold one
 * index object stable across them and memoized card fronts keep their
 * render isolation (TASK-21.4.1).
 */
export function linkSignature(cards: Board["cards"]): string {
  let signature = "";
  for (const id of Object.keys(cards).sort()) {
    const card = cards[id];
    signature += `${id}${card.archivedAt !== undefined ? "!" : ""}`;
    for (const link of card.links ?? []) {
      signature += `|${link.id}:${link.type}:${link.targetCardId}`;
    }
    signature += ";";
  }
  return signature;
}

/**
 * Would adding a `blocks` edge `fromCardId → targetCardId` close a
 * circular dependency? True exactly when the target can already reach the
 * source over existing blocks edges — the same DFS the reducer runs, so
 * the UI can refuse with a toast instead of dispatching a silent no-op.
 */
export function wouldCreateCycle(
  cards: Board["cards"],
  fromCardId: string,
  targetCardId: string,
): boolean {
  if (fromCardId === targetCardId) return true;
  const stack = [targetCardId];
  const seen = new Set<string>([targetCardId]);
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const link of cards[current]?.links ?? []) {
      if (link.type !== "blocks") continue;
      if (link.targetCardId === fromCardId) return true;
      if (!(link.targetCardId in cards) || seen.has(link.targetCardId)) {
        continue;
      }
      seen.add(link.targetCardId);
      stack.push(link.targetCardId);
    }
  }
  return false;
}

/** Is the unordered pair {a, b} already linked in any direction/type? */
export function isPairLinked(
  cards: Board["cards"],
  a: string,
  b: string,
): boolean {
  for (const card of Object.values(cards)) {
    for (const link of card.links ?? []) {
      if (
        (card.id === a && link.targetCardId === b) ||
        (card.id === b && link.targetCardId === a)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Suggestions for the link autocomplete: non-archived cards whose title
 * matches the query (case-insensitive substring), self and already-linked
 * pairs excluded. Cheapest-first ordering: title match start > earlier
 * creation, so the list is stable while typing.
 */
export function suggestLinkTargets(
  cards: Board["cards"],
  cardId: string,
  query: string,
  limit = 8,
): Card[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: Card[] = [];
  for (const card of Object.values(cards)) {
    if (card.id === cardId) continue;
    if (card.archivedAt !== undefined) continue;
    if (!card.title.toLowerCase().includes(needle)) continue;
    if (isPairLinked(cards, cardId, card.id)) continue;
    matches.push(card);
  }
  matches.sort((a, b) => {
    const aStarts = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.createdAt - b.createdAt;
  });
  return matches.slice(0, limit);
}

/**
 * How the card being edited phrases a link of `type` — and which command
 * realizes it. Jira's five options map onto three stored types: choosing
 * "is blocked by X" stores a "blocks" row on X pointing back at this card.
 */
export const LINK_TYPE_OPTIONS: {
  /** Key into the i18n catalog (`card.links.type.*`). */
  option: "blocks" | "blockedBy" | "relatesTo" | "duplicates" | "duplicatedBy";
  /** The wire type of the row this option creates. */
  linkType: CardLinkType;
  /** Whose card holds the row: the card being edited or the target's. */
  holder: "source" | "target";
}[] = [
  { option: "relatesTo", linkType: "relates_to", holder: "source" },
  { option: "blocks", linkType: "blocks", holder: "source" },
  { option: "blockedBy", linkType: "blocks", holder: "target" },
  { option: "duplicates", linkType: "duplicates", holder: "source" },
  { option: "duplicatedBy", linkType: "duplicates", holder: "target" },
];
