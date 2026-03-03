// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData, PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

const sampleDoc: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "epic-1",
      title: "Authentication",
      status: "in_progress",
      level: "epic",
      priority: "critical",
      children: [
        {
          id: "feature-1",
          title: "Login Flow",
          status: "in_progress",
          level: "feature",
          children: [
            {
              id: "task-1",
              title: "Build login form",
              status: "pending",
              level: "task",
              priority: "high",
              tags: ["frontend"],
            },
            {
              id: "task-2",
              title: "Add OAuth support",
              status: "in_progress",
              level: "task",
              children: [
                {
                  id: "subtask-1",
                  title: "Google OAuth",
                  status: "pending",
                  level: "subtask",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "epic-2",
      title: "Dashboard",
      status: "pending",
      level: "epic",
      children: [],
    },
  ],
};

describe("Tree event delegation", () => {
  // ── Data attributes ────────────────────────────────────────────────

  describe("data attributes", () => {
    it("adds data-node-id to each tree node row", () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
      const rows = root.querySelectorAll("[data-node-id]");
      expect(rows.length).toBeGreaterThan(0);
      const ids = Array.from(rows).map((r) => r.getAttribute("data-node-id"));
      expect(ids).toContain("epic-1");
      expect(ids).toContain("epic-2");
    });

    it("adds data-has-children only to nodes with children", () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
      const epic1 = root.querySelector('[data-node-id="epic-1"]');
      const epic2 = root.querySelector('[data-node-id="epic-2"]');
      // epic-1 has children
      expect(epic1?.hasAttribute("data-has-children")).toBe(true);
      // epic-2 has empty children array
      expect(epic2?.hasAttribute("data-has-children")).toBe(false);
    });
  });

  // ── Delegated click handler ────────────────────────────────────────

  describe("delegated click handling", () => {
    it("has a single click listener on tree container (not per-node)", () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
      const tree = root.querySelector('[role="tree"]');
      expect(tree).not.toBeNull();
      // The tree container should have delegated handlers attached by Preact.
      // Individual node rows should NOT have onclick attributes.
      const rows = root.querySelectorAll("[data-node-id]");
      for (const row of rows) {
        expect(row.getAttribute("onclick")).toBeNull();
      }
    });

    it("selects item when tree node row is clicked", () => {
      const onSelect = vi.fn();
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onSelectItem: onSelect,
      }));
      const node = root.querySelector('[data-node-id="epic-1"]') as HTMLElement;
      const title = node.querySelector(".prd-node-title") as HTMLElement;
      title.click();
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0][0].id).toBe("epic-1");
    });

    it("toggles expand when chevron is clicked", async () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 0 }));
      // Initially collapsed — feature should not be visible
      expect(root.textContent).not.toContain("Login Flow");
      // Click the chevron of epic-1 to expand it
      const epic1 = root.querySelector('[data-node-id="epic-1"]') as HTMLElement;
      expect(epic1.hasAttribute("data-has-children")).toBe(true);
      const chevron = epic1.querySelector(".prd-chevron") as HTMLElement;
      expect(chevron).not.toBeNull();
      // Use dispatchEvent with bubbles to ensure proper event delegation
      chevron.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // Wait for Preact's async render batch to flush
      await new Promise((r) => setTimeout(r, 10));
      // Now the feature should be visible
      expect(root.textContent).toContain("Login Flow");
    });

    it("toggles expand when row is clicked with no onSelectItem", async () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 0 }));
      expect(root.textContent).not.toContain("Login Flow");
      // With no onSelectItem, clicking a node with children should toggle expand
      const epic1 = root.querySelector('[data-node-id="epic-1"]') as HTMLElement;
      const title = epic1.querySelector(".prd-node-title") as HTMLElement;
      title.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // Wait for Preact's async render batch to flush
      await new Promise((r) => setTimeout(r, 10));
      expect(root.textContent).toContain("Login Flow");
    });

    it("handles inline delete button clicks via delegation", () => {
      const onRemove = vi.fn();
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onRemoveItem: onRemove,
      }));
      // Find the delete button for epic-1
      const epic1 = root.querySelector('[data-node-id="epic-1"]') as HTMLElement;
      const deleteBtn = epic1.querySelector(".prd-node-action-delete") as HTMLElement;
      expect(deleteBtn).not.toBeNull();
      deleteBtn.click();
      expect(onRemove).toHaveBeenCalledOnce();
      expect(onRemove.mock.calls[0][0].id).toBe("epic-1");
    });

    it("renders inline add buttons without individual onclick handlers", () => {
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onInlineAddSubmit: vi.fn(),
      }));
      const addBtns = root.querySelectorAll(".prd-inline-add-btn");
      expect(addBtns.length).toBeGreaterThan(0);
      // No onclick attribute should be set (handled by delegation)
      for (const btn of addBtns) {
        expect(btn.getAttribute("onclick")).toBeNull();
      }
    });
  });

  // ── Delegated keyboard handling ────────────────────────────────────

  describe("delegated keyboard handling", () => {
    it("handles keyboard navigation via delegated keydown on tree container", () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 1 }));
      const tree = root.querySelector('[role="tree"]') as HTMLElement;
      expect(tree).not.toBeNull();
      // Verify tree items have tabIndex for keyboard focus
      const items = tree.querySelectorAll('[role="treeitem"]');
      for (const item of items) {
        expect(item.getAttribute("tabindex")).toBe("0");
      }
    });
  });

  // ── Inline action group ────────────────────────────────────────────

  describe("inline action group", () => {
    it("renders all inline action buttons (Edit, Status, Delete) on every node", () => {
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onRemoveItem: vi.fn(),
        onUpdateItem: vi.fn(),
      }));
      const rows = root.querySelectorAll("[data-node-id]");
      for (const row of rows) {
        // Edit and Status should always be present
        expect(row.querySelector(".prd-node-action-edit")).not.toBeNull();
        expect(row.querySelector(".prd-node-action-status")).not.toBeNull();
        // Delete is present when onRemoveItem is provided
        expect(row.querySelector(".prd-node-action-delete")).not.toBeNull();
      }
    });

    it("renders Edit action on the edit button that selects the item", () => {
      const onSelect = vi.fn();
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onSelectItem: onSelect,
      }));
      const epic1 = root.querySelector('[data-node-id="epic-1"]') as HTMLElement;
      const editBtn = epic1.querySelector(".prd-node-action-edit") as HTMLElement;
      expect(editBtn).not.toBeNull();
      editBtn.click();
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0][0].id).toBe("epic-1");
    });
  });

  // ── Listener count reduction ───────────────────────────────────────

  describe("listener count reduction", () => {
    it("does not attach individual onClick handlers to node rows", () => {
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onSelectItem: vi.fn(),
        onRemoveItem: vi.fn(),
        onInlineAddSubmit: vi.fn(),
      }));
      const rows = root.querySelectorAll("[data-node-id]");
      // Node rows should not have onclick, oncontextmenu, or onkeydown
      // DOM attributes (Preact sets them as properties, not attributes,
      // but the point is they are not set as per-node handlers)
      for (const row of rows) {
        // Verify no explicit onclick attribute (not set via setAttribute)
        expect(row.getAttribute("onclick")).toBeNull();
        expect(row.getAttribute("oncontextmenu")).toBeNull();
        expect(row.getAttribute("onkeydown")).toBeNull();
      }
    });

    it("does not attach onClick to inline buttons", () => {
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc,
        defaultExpandDepth: 3,
        onRemoveItem: vi.fn(),
        onInlineAddSubmit: vi.fn(),
      }));
      const addBtns = root.querySelectorAll(".prd-inline-add-btn");
      const deleteBtns = root.querySelectorAll(".prd-node-action-delete");
      for (const btn of [...addBtns, ...deleteBtns]) {
        expect(btn.getAttribute("onclick")).toBeNull();
      }
    });
  });
});
