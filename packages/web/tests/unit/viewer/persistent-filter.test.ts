// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { usePersistentFilter } from "../../../src/viewer/hooks/use-persistent-filter.js";
import type { ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";
import { defaultStatusFilter } from "../../../src/viewer/views/status-filter.js";

/**
 * Captures the hook's return value via a ref callback pattern.
 * The harness renders immediately and exposes the hook state
 * through the captured object.
 */
let captured: ReturnType<typeof usePersistentFilter> | null = null;

function FilterTestHarness() {
  const state = usePersistentFilter();
  captured = state;
  return h("div", {
    "data-testid": "harness",
    "data-statuses": JSON.stringify([...state.activeStatuses].sort()),
  });
}

function getStatuses(root: HTMLElement): string[] {
  const el = root.querySelector("[data-testid='harness']") as HTMLElement;
  return JSON.parse(el.getAttribute("data-statuses") ?? "[]");
}

describe("usePersistentFilter", () => {
  it("returns default Active Work filter on first mount", () => {
    const root = document.createElement("div");
    render(h(FilterTestHarness, null), root);

    const statuses = getStatuses(root);
    const expected = [...defaultStatusFilter()].sort();
    expect(statuses).toEqual(expected);

    // Unmount
    render(null, root);
  });

  it("persists filter state across unmount/remount cycles", () => {
    const root = document.createElement("div");

    // First mount
    render(h(FilterTestHarness, null), root);
    expect(captured).not.toBeNull();

    // Update filter state to "completed" only
    captured!.setActiveStatuses(new Set<ItemStatus>(["completed"]));

    // Re-render to reflect the state change
    render(h(FilterTestHarness, null), root);
    let statuses = getStatuses(root);
    expect(statuses).toEqual(["completed"]);

    // Unmount
    render(null, root);
    captured = null;

    // Remount — should restore "completed" from module-level persistence
    render(h(FilterTestHarness, null), root);
    statuses = getStatuses(root);
    expect(statuses).toEqual(["completed"]);

    // Cleanup: reset to default so other tests aren't affected
    captured!.setActiveStatuses(defaultStatusFilter());
    render(null, root);
    captured = null;
  });
});
