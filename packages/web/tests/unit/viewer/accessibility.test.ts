// @vitest-environment jsdom
/**
 * Comprehensive accessibility tests for the web dashboard.
 *
 * Tests keyboard navigation, ARIA attributes, focus management,
 * live regions, and semantic structure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { Guide } from "../../../src/viewer/components/guide.js";
import { SidebarThemeToggle } from "../../../src/viewer/components/theme-toggle.js";
import { StatusFilter, defaultStatusFilter } from "../../../src/viewer/views/status-filter.js";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0)).then(
    () => new Promise((r) => setTimeout(r, 0))
  );
}

/** Wait for a condition to become true, polling up to maxMs. */
async function waitFor(
  condition: () => boolean,
  maxMs = 500,
  interval = 10,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
}

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(vnode, root);
  return root;
}

// ── Guide Modal Accessibility ────────────────────────────────────────

describe("Guide modal accessibility", () => {
  let root: HTMLDivElement;

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
  });

  it("guide button has aria-label", () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector(".guide-btn");
    expect(btn?.getAttribute("aria-label")).toBe("View guide for this page");
  });

  it("guide button has aria-expanded=false when closed", () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector(".guide-btn");
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
  });

  it("guide button has aria-expanded=true when open", async () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector<HTMLElement>(".guide-btn");
    btn?.click();
    await flush();
    expect(btn?.getAttribute("aria-expanded")).toBe("true");
  });

  it("open guide modal has role=dialog and aria-modal", async () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector<HTMLElement>(".guide-btn");
    btn?.click();
    await flush();
    const overlay = root.querySelector(".guide-overlay");
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
  });

  it("guide modal has descriptive aria-label", async () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector<HTMLElement>(".guide-btn");
    btn?.click();
    await flush();
    const overlay = root.querySelector(".guide-overlay");
    expect(overlay?.getAttribute("aria-label")).toContain("Guide:");
  });

  it("close button has aria-label", async () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector<HTMLElement>(".guide-btn");
    btn?.click();
    await flush();
    const closeBtn = root.querySelector(".guide-close");
    expect(closeBtn?.getAttribute("aria-label")).toBe("Close guide");
  });

  it("Escape key closes the guide modal", async () => {
    root = renderToDiv(h(Guide, { view: "overview" }));
    const btn = root.querySelector<HTMLElement>(".guide-btn");
    btn?.click();
    // Wait for the modal to open
    await waitFor(() => root.querySelector(".guide-overlay") !== null);
    expect(root.querySelector(".guide-overlay")).not.toBeNull();

    // Give the useEffect time to register the Escape handler
    // Preact schedules effects via rAF -> needs multiple event loop ticks
    await new Promise((r) => setTimeout(r, 50));

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );

    // Wait for the modal to close
    await new Promise((r) => setTimeout(r, 50));
    await flush();
    expect(root.querySelector(".guide-overlay")).toBeNull();
  });
});

// ── ThemeToggle Accessibility ────────────────────────────────────────

describe("ThemeToggle accessibility", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
  });

  it("SidebarThemeToggle has aria-label describing the action", () => {
    root = renderToDiv(h(SidebarThemeToggle, null));
    const btn = root.querySelector(".sidebar-control-btn");
    expect(btn?.getAttribute("aria-label")).toBeTruthy();
    expect(btn?.getAttribute("aria-label")).toContain("Switch to");
  });
});

// ── Status Filter Accessibility ──────────────────────────────────────

describe("StatusFilter accessibility", () => {
  let root: HTMLDivElement;
  const onChange = vi.fn();

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    onChange.mockClear();
  });

  it("filter group has aria-label", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const group = root.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Filter by status");
  });

  it("status chip buttons have aria-pressed", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const chips = root.querySelectorAll<HTMLElement>(".prd-status-chip");
    chips.forEach((chip) => {
      expect(chip.hasAttribute("aria-pressed")).toBe(true);
      expect(["true", "false"]).toContain(chip.getAttribute("aria-pressed"));
    });
  });

  it("status chips container has toolbar role", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const toolbar = root.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("aria-label")).toBe("Status chip toggles");
  });

  it("Arrow right moves focus to next chip", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const chips = root.querySelectorAll<HTMLElement>(".prd-status-chip");
    expect(chips.length).toBeGreaterThan(1);

    // Focus first chip
    chips[0].focus();

    // Create and dispatch ArrowRight event
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    });
    chips[0].dispatchEvent(event);

    // Check that focus moved to next chip
    expect(document.activeElement).toBe(chips[1]);
  });

  it("Arrow left moves focus to previous chip", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const chips = root.querySelectorAll<HTMLElement>(".prd-status-chip");

    // Focus second chip
    chips[1].focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
    });
    chips[1].dispatchEvent(event);

    expect(document.activeElement).toBe(chips[0]);
  });

  it("preset buttons have aria-pressed", () => {
    root = renderToDiv(
      h(StatusFilter, { activeStatuses: defaultStatusFilter(), onChange })
    );
    const presets = root.querySelectorAll<HTMLElement>(".prd-status-preset");
    presets.forEach((preset) => {
      expect(preset.hasAttribute("aria-pressed")).toBe(true);
    });
  });
});

// ── PRD Tree Accessibility ───────────────────────────────────────────

describe("PRDTree accessibility", () => {
  let root: HTMLDivElement;

  const sampleDoc: PRDDocumentData = {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        status: "in_progress",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature One",
            status: "completed",
            level: "feature",
          },
          {
            id: "feature-2",
            title: "Feature Two",
            status: "pending",
            level: "feature",
          },
        ],
      },
      {
        id: "epic-2",
        title: "Epic Two",
        status: "pending",
        level: "epic",
      },
    ],
  };

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
  });

  it("tree container has role=tree and aria-label", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const tree = root.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree?.getAttribute("aria-label")).toBe("PRD hierarchy");
  });

  it("tree items have role=treeitem", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(0);
  });

  it("expandable tree items have aria-expanded", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const expandableItems = root.querySelectorAll(
      '[role="treeitem"][aria-expanded]'
    );
    expect(expandableItems.length).toBeGreaterThan(0);
    expandableItems.forEach((item) => {
      expect(["true", "false"]).toContain(item.getAttribute("aria-expanded"));
    });
  });

  it("tree items are focusable via tabIndex", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll('[role="treeitem"]');
    items.forEach((item) => {
      expect(item.getAttribute("tabindex")).toBe("0");
    });
  });

  it("progress bars have proper ARIA attributes", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const progressBars = root.querySelectorAll('[role="progressbar"]');
    progressBars.forEach((bar) => {
      expect(bar.hasAttribute("aria-valuenow")).toBe(true);
      expect(bar.hasAttribute("aria-valuemin")).toBe(true);
      expect(bar.hasAttribute("aria-valuemax")).toBe(true);
      expect(bar.hasAttribute("aria-label")).toBe(true);
    });
  });

  it("Arrow Down moves focus to next treeitem", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll<HTMLElement>('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(1);

    items[0].focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    items[0].dispatchEvent(event);
    expect(document.activeElement).toBe(items[1]);
  });

  it("Arrow Up moves focus to previous treeitem", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll<HTMLElement>('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(1);

    items[1].focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
    });
    items[1].dispatchEvent(event);
    expect(document.activeElement).toBe(items[0]);
  });

  it("Arrow Down on last item does not crash", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const lastItem = items[items.length - 1];

    lastItem.focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    // Should not throw
    lastItem.dispatchEvent(event);
    expect(document.activeElement).toBe(lastItem);
  });

  it("Arrow Up on first item does not crash", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const items = root.querySelectorAll<HTMLElement>('[role="treeitem"]');

    items[0].focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
    });
    items[0].dispatchEvent(event);
    expect(document.activeElement).toBe(items[0]);
  });

  it("tree container has role=tree", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const tree = root.querySelector('[role="tree"]');
    // StatusFilter (which had role=group) is now rendered by PRDView,
    // not by PRDTree. Verify the tree container is still present.
    expect(tree).not.toBeNull();
  });

  it("chevrons are aria-hidden", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const chevrons = root.querySelectorAll(".prd-chevron");
    chevrons.forEach((chevron) => {
      expect(chevron.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("status indicators have aria-label", () => {
    root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const statusIcons = root.querySelectorAll(".prd-status-icon");
    statusIcons.forEach((icon) => {
      expect(icon.hasAttribute("aria-label")).toBe(true);
      expect(icon.getAttribute("aria-label")).toBeTruthy();
    });
  });
});
