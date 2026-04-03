// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";

// ── Module under test ─────────────────────────────────────────────────────

import {
  SearchOverlay,
  useSearchOverlay,
} from "../../../src/viewer/components/search-overlay.js";
import { cleanupRenderedDiv, renderToDiv } from "../../helpers/preact-test-support.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function pressKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...opts }),
  );
}

// ── SearchOverlay Component Tests ─────────────────────────────────────────

describe("SearchOverlay", () => {
  let root: HTMLDivElement;
  const onClose = vi.fn();
  const navigateTo = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    navigateTo.mockClear();
  });

  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
  });

  // ── Visibility ──────────────────────────────────────────────────

  it("renders nothing when not visible", () => {
    root = renderToDiv(
      h(SearchOverlay, { visible: false, onClose, navigateTo }),
    );
    expect(root.querySelector(".search-overlay")).toBeNull();
  });

  it("renders overlay when visible", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const overlay = root.querySelector(".search-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("role")).toBe("dialog");
    expect(overlay!.getAttribute("aria-modal")).toBe("true");
  });

  it("renders search input with correct attributes", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const input = root.querySelector(".search-overlay-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe("search");
    expect(input.getAttribute("aria-label")).toBe("Search PRD items");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
  });

  // ── Keyboard: Escape ───────────────────────────────────────────

  it("calls onClose when Escape is pressed", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    act(() => {
      pressKey("Escape");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when Escape pressed while hidden", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: false, onClose, navigateTo }),
      );
    });
    act(() => {
      pressKey("Escape");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Filter Toggle ─────────────────────────────────────────────

  it("toggles filter panel on button click", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    // Initially no filter panel
    expect(root.querySelector("#search-filters")).toBeNull();

    // Click filter button
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    // Now filter panel should be visible
    const filters = root.querySelector("#search-filters");
    expect(filters).not.toBeNull();
    expect(filters!.getAttribute("role")).toBe("group");
  });

  it("renders filter groups for type, status, and priority", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    // Open filters
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    const groups = root.querySelectorAll(".search-filter-group");
    expect(groups.length).toBe(3);

    const labels = Array.from(groups).map(
      (g) => g.querySelector(".search-filter-group-label")?.textContent,
    );
    expect(labels).toContain("Type");
    expect(labels).toContain("Status");
    expect(labels).toContain("Priority");
  });

  it("renders 4 type filter chips", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    const groups = root.querySelectorAll(".search-filter-group");
    // First group is Type
    const typeChips = groups[0].querySelectorAll(".search-filter-chip");
    expect(typeChips.length).toBe(4);
    const chipLabels = Array.from(typeChips).map((c) => c.textContent);
    expect(chipLabels).toContain("Epic");
    expect(chipLabels).toContain("Feature");
    expect(chipLabels).toContain("Task");
    expect(chipLabels).toContain("Subtask");
  });

  it("renders 4 status filter chips", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    const groups = root.querySelectorAll(".search-filter-group");
    const statusChips = groups[1].querySelectorAll(".search-filter-chip");
    expect(statusChips.length).toBe(4);
    const chipLabels = Array.from(statusChips).map((c) => c.textContent);
    expect(chipLabels).toContain("Pending");
    expect(chipLabels).toContain("In Progress");
    expect(chipLabels).toContain("Completed");
    expect(chipLabels).toContain("Blocked");
  });

  it("renders 4 priority filter chips", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    const groups = root.querySelectorAll(".search-filter-group");
    const priorityChips = groups[2].querySelectorAll(".search-filter-chip");
    expect(priorityChips.length).toBe(4);
    const chipLabels = Array.from(priorityChips).map((c) => c.textContent);
    expect(chipLabels).toContain("Critical");
    expect(chipLabels).toContain("High");
    expect(chipLabels).toContain("Medium");
    expect(chipLabels).toContain("Low");
  });

  it("toggles filter chip active state on click", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    const groups = root.querySelectorAll(".search-filter-group");
    const firstChip = groups[0].querySelector(".search-filter-chip") as HTMLLabelElement;
    expect(firstChip.classList.contains("active")).toBe(false);

    // Click the checkbox inside the chip to activate
    act(() => {
      (firstChip.querySelector("input") as HTMLInputElement).click();
    });

    // Should now be active
    const updatedChip = root.querySelectorAll(".search-filter-group")[0].querySelector(".search-filter-chip") as HTMLLabelElement;
    expect(updatedChip.classList.contains("active")).toBe(true);
  });

  it("shows active filter count badge", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    // Open filters
    act(() => {
      (root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement).click();
    });

    // Initially no badge
    expect(root.querySelector(".search-overlay-filter-badge")).toBeNull();

    // Activate a filter
    act(() => {
      const groups = root.querySelectorAll(".search-filter-group");
      (groups[0].querySelector("input") as HTMLInputElement).click();
    });

    // Badge should appear with count "1"
    const badge = root.querySelector(".search-overlay-filter-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("1");
  });

  // ── Results list ──────────────────────────────────────────────

  it("renders results list container with listbox role", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const list = root.querySelector("#search-results-list");
    expect(list).not.toBeNull();
    expect(list!.getAttribute("role")).toBe("listbox");
  });

  // ── Footer with keyboard hints ────────────────────────────────

  it("renders footer with keyboard navigation hints", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const footer = root.querySelector(".search-overlay-footer");
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain("navigate");
    expect(footer!.textContent).toContain("select");
    expect(footer!.textContent).toContain("close");
  });

  // ── Backdrop click closes ─────────────────────────────────────

  it("closes when clicking the overlay backdrop", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const overlay = root.querySelector(".search-overlay") as HTMLElement;
    overlay.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking the panel (not the backdrop)", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const panel = root.querySelector(".search-overlay-panel") as HTMLElement;
    panel.click();
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Escape kbd hint ───────────────────────────────────────────

  it("shows esc key hint in input row", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const kbd = root.querySelector(".search-overlay-kbd");
    expect(kbd).not.toBeNull();
    expect(kbd!.textContent).toBe("esc");
  });

  // ── ARIA attributes ───────────────────────────────────────────

  it("sets aria-expanded on filter toggle button", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const btn = root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      btn.click();
    });
    const btn2 = root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement;
    expect(btn2.getAttribute("aria-expanded")).toBe("true");
  });

  it("sets aria-controls on filter toggle button", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const btn = root.querySelector(".search-overlay-filter-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-controls")).toBe("search-filters");
  });

  // ── Search icon ───────────────────────────────────────────────

  it("renders search icon with aria-hidden", () => {
    act(() => {
      root = renderToDiv(
        h(SearchOverlay, { visible: true, onClose, navigateTo }),
      );
    });
    const icon = root.querySelector(".search-overlay-icon");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });
});

// ── useSearchOverlay Hook Tests ───────────────────────────────────────────

describe("useSearchOverlay", () => {
  let root: HTMLDivElement;
  let lastIsOpen: boolean;

  function TestComponent() {
    const [open] = useSearchOverlay();
    lastIsOpen = open;
    return null;
  }

  beforeEach(() => {
    lastIsOpen = false;
  });

  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
  });

  it("opens on Ctrl+K", () => {
    act(() => {
      root = renderToDiv(h(TestComponent, null));
    });
    expect(lastIsOpen).toBe(false);

    act(() => {
      pressKey("k", { ctrlKey: true });
    });
    expect(lastIsOpen).toBe(true);
  });

  it("opens on Cmd+K (metaKey)", () => {
    act(() => {
      root = renderToDiv(h(TestComponent, null));
    });
    expect(lastIsOpen).toBe(false);

    act(() => {
      pressKey("k", { metaKey: true });
    });
    expect(lastIsOpen).toBe(true);
  });

  it("toggles on repeated Ctrl+K", () => {
    act(() => {
      root = renderToDiv(h(TestComponent, null));
    });

    act(() => {
      pressKey("k", { ctrlKey: true });
    });
    expect(lastIsOpen).toBe(true);

    act(() => {
      pressKey("k", { ctrlKey: true });
    });
    expect(lastIsOpen).toBe(false);
  });

  it("does not open on plain K without modifier", () => {
    act(() => {
      root = renderToDiv(h(TestComponent, null));
    });

    act(() => {
      pressKey("k");
    });
    expect(lastIsOpen).toBe(false);
  });
});
