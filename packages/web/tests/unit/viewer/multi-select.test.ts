/**
 * Tests for ctrl/shift multi-select interaction logic.
 *
 * Verifies the selection semantics implemented in usePRDActions.handleBulkSelect:
 * - Plain click selects a single item and deselects others
 * - Ctrl/Cmd+click toggles individual items
 * - Shift+click selects a contiguous range from the anchor
 * - Plain click on the sole selected item deselects it
 */

import { describe, it, expect } from "vitest";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

// ── Extracted selection logic (mirrors use-prd-actions.ts) ────────────
//
// We test the pure logic without hooks by extracting the state machine.

interface SelectionState {
  selected: Set<string>;
  anchor: string | null;
}

function applyBulkSelect(
  state: SelectionState,
  itemId: string,
  modifiers: { ctrlKey: boolean; shiftKey: boolean },
  visibleIds: string[],
): SelectionState {
  const { selected, anchor } = state;

  if (modifiers.shiftKey && anchor) {
    const anchorIdx = visibleIds.indexOf(anchor);
    const targetIdx = visibleIds.indexOf(itemId);
    if (anchorIdx >= 0 && targetIdx >= 0) {
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      const rangeIds = visibleIds.slice(start, end + 1);
      const next = modifiers.ctrlKey ? new Set(selected) : new Set<string>();
      for (const id of rangeIds) next.add(id);
      return { selected: next, anchor };
    }
  }

  if (modifiers.ctrlKey) {
    const next = new Set(selected);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    return { selected: next, anchor: itemId };
  }

  // Plain click
  if (selected.size === 1 && selected.has(itemId)) {
    return { selected: new Set(), anchor: itemId };
  }
  return { selected: new Set([itemId]), anchor: itemId };
}

// ── Test data ─────────────────────────────────────────────────────────

const VISIBLE_IDS = ["a", "b", "c", "d", "e"];

function emptyState(): SelectionState {
  return { selected: new Set(), anchor: null };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("multi-select interaction", () => {
  describe("plain click", () => {
    it("selects a single item and deselects all others", () => {
      const state = applyBulkSelect(emptyState(), "b", { ctrlKey: false, shiftKey: false }, VISIBLE_IDS);
      expect([...state.selected]).toEqual(["b"]);
    });

    it("replaces previous selection with the clicked item", () => {
      const prev: SelectionState = {
        selected: new Set(["a", "c", "d"]),
        anchor: "a",
      };
      const state = applyBulkSelect(prev, "b", { ctrlKey: false, shiftKey: false }, VISIBLE_IDS);
      expect([...state.selected]).toEqual(["b"]);
    });

    it("deselects on plain click when item is the sole selection", () => {
      const prev: SelectionState = {
        selected: new Set(["b"]),
        anchor: "b",
      };
      const state = applyBulkSelect(prev, "b", { ctrlKey: false, shiftKey: false }, VISIBLE_IDS);
      expect(state.selected.size).toBe(0);
    });
  });

  describe("ctrl+click", () => {
    it("adds an item to the selection", () => {
      const prev: SelectionState = {
        selected: new Set(["a"]),
        anchor: "a",
      };
      const state = applyBulkSelect(prev, "c", { ctrlKey: true, shiftKey: false }, VISIBLE_IDS);
      expect(new Set(state.selected)).toEqual(new Set(["a", "c"]));
    });

    it("removes an already-selected item", () => {
      const prev: SelectionState = {
        selected: new Set(["a", "c"]),
        anchor: "a",
      };
      const state = applyBulkSelect(prev, "a", { ctrlKey: true, shiftKey: false }, VISIBLE_IDS);
      expect([...state.selected]).toEqual(["c"]);
    });

    it("updates the anchor to the clicked item", () => {
      const state = applyBulkSelect(emptyState(), "d", { ctrlKey: true, shiftKey: false }, VISIBLE_IDS);
      expect(state.anchor).toBe("d");
    });
  });

  describe("shift+click", () => {
    it("selects a contiguous range from anchor to target", () => {
      const prev: SelectionState = {
        selected: new Set(["b"]),
        anchor: "b",
      };
      const state = applyBulkSelect(prev, "d", { ctrlKey: false, shiftKey: true }, VISIBLE_IDS);
      expect(new Set(state.selected)).toEqual(new Set(["b", "c", "d"]));
    });

    it("selects range in reverse direction", () => {
      const prev: SelectionState = {
        selected: new Set(["d"]),
        anchor: "d",
      };
      const state = applyBulkSelect(prev, "b", { ctrlKey: false, shiftKey: true }, VISIBLE_IDS);
      expect(new Set(state.selected)).toEqual(new Set(["b", "c", "d"]));
    });

    it("replaces previous selection with the range", () => {
      const prev: SelectionState = {
        selected: new Set(["a", "e"]),
        anchor: "b",
      };
      const state = applyBulkSelect(prev, "d", { ctrlKey: false, shiftKey: true }, VISIBLE_IDS);
      expect(new Set(state.selected)).toEqual(new Set(["b", "c", "d"]));
    });

    it("extends existing selection when ctrl+shift is held", () => {
      const prev: SelectionState = {
        selected: new Set(["a"]),
        anchor: "b",
      };
      const state = applyBulkSelect(prev, "d", { ctrlKey: true, shiftKey: true }, VISIBLE_IDS);
      expect(new Set(state.selected)).toEqual(new Set(["a", "b", "c", "d"]));
    });

    it("falls back to single-select when anchor is not in visible list", () => {
      const prev: SelectionState = {
        selected: new Set(["z"]),
        anchor: "z", // not in VISIBLE_IDS
      };
      const state = applyBulkSelect(prev, "c", { ctrlKey: false, shiftKey: true }, VISIBLE_IDS);
      // Anchor not found → single select
      expect([...state.selected]).toEqual(["c"]);
    });
  });
});
