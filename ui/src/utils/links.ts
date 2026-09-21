import type { Board, Card, CardLink, CardLinkType } from "@janosik/shared";
import {
  blocksReaches,
  hasLinkedPair,
  linkedNeighbourIds,
} from "@janosik/shared";

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
 *
 * The rules a link must satisfy (known type, one link per pair, acyclic
 * `blocks`) are not here: they live in `@janosik/shared`'s `card-links`
 * module, shared with the reducer and the server's command guards.
 */

/** An incoming link plus the card that holds it. */
export interface IncomingLink {
  fromCardId: string;
  link: CardLink;
}

/** Everything a view needs about one card's relations. */
export interface CardLinkFacts {
  /**
   * Every row stored on the card itself, dangling ones included. The card
   * dialog has to render those: they occupy the card's row cap, so leaving
   * them out would strand a card at "50 links" with nothing on screen to
   * remove (the row renders with a "deleted" tag instead).
   */
  outgoing: CardLink[];
  /** Rows other cards hold towards this one (dangling sources skipped). */
  incoming: IncomingLink[];
  /**
   * Live relations only — outgoing rows whose target still exists, plus
   * incoming ones. This is the card-front badge's number and the `hasLinks`
   * filter's predicate: a row pointing at a deleted card is not a relation
   * the board can show.
   */
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
  /** How many of `outgoing` still point at a card that exists. */
  liveOutgoing: number;
  incoming: IncomingLink[];
  blocked: boolean;
}

const indexCache = new WeakMap<Board["cards"], CardLinkIndex>();

/**
 * The link index of one `board.cards` snapshot — one scan per version,
 * shared by every consumer (WeakMap-cached). Dangling rows stay in
 * `outgoing` (the dialog must be able to remove them) but are excluded from
 * `degree`, `incoming` and `blocked`.
 */
export function cardLinkIndex(cards: Board["cards"]): CardLinkIndex {
  const cached = indexCache.get(cards);
  if (cached) return cached;

  const drafts = new Map<string, FactsDraft>();
  const draftOf = (cardId: string): FactsDraft => {
    let draft = drafts.get(cardId);
    if (!draft) {
      draft = { outgoing: [], liveOutgoing: 0, incoming: [], blocked: false };
      drafts.set(cardId, draft);
    }
    return draft;
  };

  for (const card of Object.values(cards)) {
    for (const link of card.links ?? []) {
      // The outgoing side is stored on the card itself — kept whether or
      // not the target survives, so the dialog can offer to remove it.
      const draft = draftOf(card.id);
      draft.outgoing.push(link);
      const target = cards[link.targetCardId];
      if (!target || target.id === card.id) continue;
      draft.liveOutgoing += 1;
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
      degree: draft.liveOutgoing + draft.incoming.length,
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
 * circular dependency? Runs the reducer's own DFS (`blocksReaches`, shared),
 * so the UI can refuse with a toast instead of dispatching a silent no-op.
 */
export function wouldCreateCycle(
  cards: Board["cards"],
  fromCardId: string,
  targetCardId: string,
): boolean {
  if (fromCardId === targetCardId) return true;
  return blocksReaches(cards, targetCardId, fromCardId);
}

/** Is the unordered pair {a, b} already linked in any direction/type? */
export function isPairLinked(
  cards: Board["cards"],
  a: string,
  b: string,
): boolean {
  return hasLinkedPair(cards, a, b);
}

/**
 * Suggestions for the link autocomplete: non-archived cards whose title
 * matches the query (case-insensitive substring), self and already-linked
 * pairs excluded. Cheapest-first ordering: title match start > earlier
 * creation, so the list is stable while typing.
 *
 * The already-linked test reads a neighbour set built in **one** pass over
 * the board. Asking `isPairLinked` per candidate instead made the function
 * quadratic, and it runs in the render phase on every keystroke: measured
 * at 65 ms on a 1 000-card board and 621 ms on 3 000 for a broad query.
 */
export function suggestLinkTargets(
  cards: Board["cards"],
  cardId: string,
  query: string,
  limit = 8,
): Card[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const linked = linkedNeighbourIds(cards, cardId);
  const matches: Card[] = [];
  for (const card of Object.values(cards)) {
    if (card.id === cardId) continue;
    if (card.archivedAt !== undefined) continue;
    if (!card.title.toLowerCase().includes(needle)) continue;
    if (linked.has(card.id)) continue;
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

/** One navigable linked-card row, shared by the dialog and the popover. */
export interface LinkRow {
  linkId: string;
  /** The other end of the relation — where a click navigates. */
  targetCardId: string;
  type: CardLinkType;
  /** Target title, or the localized "Deleted card" for a dangling row. */
  title: string;
  /** False for a row whose target card no longer exists. */
  live: boolean;
}

/** Row group keyed by how the relation reads from the card. */
export type LinkGroupKey =
  | "blocks"
  | "blockedBy"
  | "relatesTo"
  | "duplicates"
  | "duplicatedBy"
  | "dangling";

/**
 * A card's relations grouped the way they read from *this* card (the same
 * order the card dialog lists them in). Typed groups hold only live rows;
 * rows pointing at a deleted card land in the tail `dangling` group with
 * their "Deleted card" title — they still occupy the card's link cap, so
 * every view that lists relations must render them.
 */
export function linkRowGroups(
  cards: Board["cards"],
  facts: CardLinkFacts,
  deletedCardTitle: string,
): { key: LinkGroupKey; rows: LinkRow[] }[] {
  const outOf = (type: CardLinkType): LinkRow[] =>
    facts.outgoing
      .filter((link) => link.type === type && link.targetCardId in cards)
      .map((link) => ({
        linkId: link.id,
        targetCardId: link.targetCardId,
        type,
        title: cards[link.targetCardId]?.title ?? "",
        live: true,
      }));
  const inOf = (type: CardLinkType): LinkRow[] =>
    facts.incoming
      .filter((entry) => entry.link.type === type)
      .map((entry) => ({
        linkId: entry.link.id,
        targetCardId: entry.fromCardId,
        type: entry.link.type,
        title: cards[entry.fromCardId]?.title ?? "",
        live: true,
      }));
  const dangling = (): LinkRow[] =>
    facts.outgoing
      .filter((link) => !(link.targetCardId in cards))
      .map((link) => ({
        linkId: link.id,
        targetCardId: link.targetCardId,
        type: link.type,
        title: deletedCardTitle,
        live: false,
      }));
  const build = (key: LinkGroupKey, rows: LinkRow[]) =>
    rows.length === 0
      ? null
      : { key, rows: rows.sort((a, b) => a.title.localeCompare(b.title)) };
  return [
    build("blocks", outOf("blocks")),
    build("blockedBy", inOf("blocks")),
    build("relatesTo", [...outOf("relates_to"), ...inOf("relates_to")]),
    build("duplicates", outOf("duplicates")),
    build("duplicatedBy", inOf("duplicates")),
    build("dangling", dangling()),
  ].filter((group) => group !== null);
}
