// @vitest-environment jsdom
/**
 * Tests for useFacetState hook.
 *
 * Covers: initial state (empty and URL-seeded), tag/status toggle, reset,
 * searchFacets derivation, and hasFacets flag.
 *
 * The hook reads window.location.hash on mount and writes back on state
 * changes. jsdom provides both, so no mocking is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  useFacetState,
  type FacetState,
} from "../../../src/viewer/hooks/use-facet-state.js";

// ── Test harness ─────────────────────────────────────────────────────────────

let state: FacetState;

function Harness() {
  state = useFacetState();
  return h("div", null);
}

function renderHarness(root: HTMLDivElement): void {
  act(() => {
    render(h(Harness, null), root);
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("useFacetState", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash = "";
  });

  afterEach(() => {
    act(() => {
      render(null, root);
    });
    if (root.parentNode) root.parentNode.removeChild(root);
    window.location.hash = "";
  });

  // ── Initial state ───────────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts with empty sets and no active facets when hash is empty", () => {
      renderHarness(root);
      expect(state.activeTags.size).toBe(0);
      expect(state.activeSearchStatuses.size).toBe(0);
      expect(state.hasFacets).toBe(false);
      expect(state.searchFacets).toBeUndefined();
    });

    it("parses tag facets from URL hash on mount", () => {
      window.location.hash = "facets=tag:foo,tag:bar";
      renderHarness(root);
      expect(state.activeTags).toEqual(new Set(["foo", "bar"]));
      expect(state.activeSearchStatuses.size).toBe(0);
      expect(state.hasFacets).toBe(true);
    });

    it("parses status facets from URL hash on mount", () => {
      window.location.hash = "facets=status:pending,status:completed";
      renderHarness(root);
      expect(state.activeSearchStatuses).toEqual(new Set(["pending", "completed"]));
      expect(state.activeTags.size).toBe(0);
      expect(state.hasFacets).toBe(true);
    });

    it("parses mixed tags and statuses from URL hash", () => {
      window.location.hash = "facets=tag:auth,status:failing";
      renderHarness(root);
      expect(state.activeTags).toEqual(new Set(["auth"]));
      expect(state.activeSearchStatuses).toEqual(new Set(["failing"]));
      expect(state.hasFacets).toBe(true);
    });

    it("populates searchFacets when URL hash has active facets", () => {
      window.location.hash = "facets=tag:backend";
      renderHarness(root);
      expect(state.searchFacets).toBeDefined();
      expect(state.searchFacets!.tags).toEqual(new Set(["backend"]));
    });
  });

  // ── setActiveTags ────────────────────────────────────────────────────────

  describe("setActiveTags", () => {
    it("updates activeTags and sets hasFacets", () => {
      renderHarness(root);
      act(() => {
        state.setActiveTags(new Set(["backend"]));
      });
      expect(state.activeTags).toEqual(new Set(["backend"]));
      expect(state.hasFacets).toBe(true);
    });

    it("populates searchFacets with the new tags", () => {
      renderHarness(root);
      act(() => {
        state.setActiveTags(new Set(["api"]));
      });
      expect(state.searchFacets).toBeDefined();
      expect(state.searchFacets!.tags).toEqual(new Set(["api"]));
    });

    it("clears hasFacets when set to empty", () => {
      renderHarness(root);
      act(() => {
        state.setActiveTags(new Set(["foo"]));
      });
      expect(state.hasFacets).toBe(true);
      act(() => {
        state.setActiveTags(new Set());
      });
      expect(state.hasFacets).toBe(false);
      expect(state.searchFacets).toBeUndefined();
    });
  });

  // ── setActiveSearchStatuses ──────────────────────────────────────────────

  describe("setActiveSearchStatuses", () => {
    it("updates activeSearchStatuses and sets hasFacets", () => {
      renderHarness(root);
      act(() => {
        state.setActiveSearchStatuses(new Set(["pending", "blocked"]));
      });
      expect(state.activeSearchStatuses).toEqual(new Set(["pending", "blocked"]));
      expect(state.hasFacets).toBe(true);
    });

    it("populates searchFacets.statuses", () => {
      renderHarness(root);
      act(() => {
        state.setActiveSearchStatuses(new Set(["failing"]));
      });
      expect(state.searchFacets!.statuses).toEqual(new Set(["failing"]));
    });

    it("clears hasFacets when set to empty", () => {
      renderHarness(root);
      act(() => {
        state.setActiveSearchStatuses(new Set(["completed"]));
      });
      expect(state.hasFacets).toBe(true);
      act(() => {
        state.setActiveSearchStatuses(new Set());
      });
      expect(state.hasFacets).toBe(false);
    });
  });

  // ── clearFacets ──────────────────────────────────────────────────────────

  describe("clearFacets", () => {
    it("resets tags and statuses to empty", () => {
      window.location.hash = "facets=tag:foo,status:pending";
      renderHarness(root);
      expect(state.hasFacets).toBe(true);

      act(() => {
        state.clearFacets();
      });
      expect(state.activeTags.size).toBe(0);
      expect(state.activeSearchStatuses.size).toBe(0);
    });

    it("sets hasFacets to false after clear", () => {
      renderHarness(root);
      act(() => {
        state.setActiveTags(new Set(["auth"]));
      });
      act(() => {
        state.clearFacets();
      });
      expect(state.hasFacets).toBe(false);
    });

    it("sets searchFacets to undefined after clear", () => {
      renderHarness(root);
      act(() => {
        state.setActiveSearchStatuses(new Set(["in_progress"]));
      });
      act(() => {
        state.clearFacets();
      });
      expect(state.searchFacets).toBeUndefined();
    });
  });

  // ── searchFacets derivation ──────────────────────────────────────────────

  describe("searchFacets", () => {
    it("is undefined when no facets are active", () => {
      renderHarness(root);
      expect(state.searchFacets).toBeUndefined();
    });

    it("contains both tags and statuses when both are active", () => {
      renderHarness(root);
      act(() => {
        state.setActiveTags(new Set(["frontend"]));
      });
      act(() => {
        state.setActiveSearchStatuses(new Set(["in_progress"]));
      });
      expect(state.searchFacets).toBeDefined();
      expect(state.searchFacets!.tags).toEqual(new Set(["frontend"]));
      expect(state.searchFacets!.statuses).toEqual(new Set(["in_progress"]));
    });
  });
});
