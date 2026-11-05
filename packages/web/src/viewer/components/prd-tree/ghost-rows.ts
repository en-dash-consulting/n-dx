/**
 * Ghost rows (UX5): while a Sidecar change-set card waits, the Plan tree
 * shows each proposed item as a dimmed "proposed" row under its parent. An
 * item under an existing item hangs below that item's row; one under an
 * earlier item of the same card hangs below that item's ghost; one with no
 * parent sits with the tree's roots. The rows go when the card is denied and
 * give way to the real items once approval has written them.
 */

import type { SidecarChangeSet } from "../../external.js";

export interface PRDGhostRow {
  key: string;
  cardId: string;
  title: string;
  type: string;
  /** Levels below the row it hangs under (0: directly under it). */
  depth: number;
  /** The proposal matches an existing item. */
  duplicate: boolean;
}

/** A card the rows are drawn from: its id and change set. */
export interface GhostSource {
  id: string;
  changeSet?: SidecarChangeSet;
}

interface Node {
  key: string;
  cardId: string;
  item: SidecarChangeSet["items"][number];
  children: Node[];
}

/**
 * Each card's items as ghost rows, keyed by the existing item they hang
 * under (`null`: with the roots), each subtree flattened in card order.
 */
export function ghostRowsByParent(cards: readonly GhostSource[]): Map<string | null, PRDGhostRow[]> {
  const anchored = new Map<string | null, Node[]>();
  for (const card of cards) {
    const items = card.changeSet?.items ?? [];
    const nodes: Node[] = items.map((item, i) => ({ key: `${card.id}:${i}`, cardId: card.id, item, children: [] }));
    nodes.forEach((node) => {
      const { parent, parentId } = node.item;
      if (parent !== undefined && nodes[parent]) nodes[parent].children.push(node);
      else {
        const anchor = parentId ?? null;
        anchored.set(anchor, [...(anchored.get(anchor) ?? []), node]);
      }
    });
  }
  const rows = new Map<string | null, PRDGhostRow[]>();
  for (const [anchor, roots] of anchored) {
    const flat: PRDGhostRow[] = [];
    const walk = (node: Node, depth: number): void => {
      flat.push({ key: node.key, cardId: node.cardId, title: node.item.title, type: node.item.type, depth, duplicate: !!node.item.duplicate });
      node.children.forEach((child) => walk(child, depth + 1));
    };
    roots.forEach((root) => walk(root, 0));
    rows.set(anchor, flat);
  }
  return rows;
}
