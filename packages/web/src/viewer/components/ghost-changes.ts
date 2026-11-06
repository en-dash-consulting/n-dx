/**
 * Ghosts outside the tree (SP5): while a Sidecar change-set card waits, its
 * items show wherever a change appears on Plan, as dashed, uncounted marks —
 * rows in Open changes, "+N" markers on the map blocks they target and a
 * "+N waiting on a card" note under the strip. Real counts never include them;
 * they go when the card is denied and give way to the real items on approval,
 * because the cards are read again on every `sidecar:card` announcement.
 *
 * main.ts provides {@link GhostCardsContext} only while `web.sidecar` is on, so
 * with it off the list is empty and every surface draws nothing extra.
 */

import { createContext } from "preact";
import type { GhostSource } from "./prd-tree/ghost-rows.js";

/** The waiting cards the ghosts are drawn from; empty while `web.sidecar` is off. */
export const GhostCardsContext = createContext<readonly GhostSource[]>([]);

/** One change a waiting card proposes. */
export interface GhostChange {
  key: string;
  cardId: string;
  title: string;
  /** The capability, constraint or existing item it goes on; null: the Inbox. */
  target: string | null;
}

/**
 * The target of each item of a card: its own `parentId`, else the root of its
 * `parent` chain's, else where the card's placement puts the change. Null for
 * an item bound for the Inbox.
 */
function itemTargets(source: GhostSource): Array<string | null> {
  const { items = [], placement } = source.changeSet ?? {};
  const fallback = placement && "target" in placement ? placement.target : null;
  const resolve = (index: number, seen: Set<number>): string | null => {
    const item = items[index];
    if (!item) return fallback;
    if (item.parentId !== undefined) return item.parentId;
    if (item.parent !== undefined && items[item.parent] && !seen.has(item.parent)) {
      return resolve(item.parent, seen.add(index));
    }
    return fallback;
  };
  return items.map((_, i) => resolve(i, new Set()));
}

/** The v2 changes the waiting cards propose, in card order. Tasks hang under them and are not changes. */
export function ghostChanges(cards: readonly GhostSource[]): GhostChange[] {
  return cards.flatMap((card) => {
    if (card.changeSet?.layout !== "v2") return [];
    const targets = itemTargets(card);
    return card.changeSet.items.flatMap((item, i) =>
      item.type === "change" ? [{ key: `${card.id}:${i}`, cardId: card.id, title: item.title, target: targets[i] ?? null }] : []);
  });
}

/** Every item the waiting v2 cards propose, counted once against the node it targets. */
export function ghostCountsByTarget(cards: readonly GhostSource[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.changeSet?.layout !== "v2") continue;
    for (const target of itemTargets(card)) {
      if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

/** How many waiting changes the strip notes under Inbox and under Proposed. */
export function ghostStripCounts(cards: readonly GhostSource[]): { inbox: number; proposed: number } {
  const changes = ghostChanges(cards);
  const inbox = changes.filter((c) => c.target === null).length;
  return { inbox, proposed: changes.length - inbox };
}
