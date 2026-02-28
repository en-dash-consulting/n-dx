// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

// ─── jsdom polyfills ─────────────────────────────────────────────────────────

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// ─── IntersectionObserver mock ───────────────────────────────────────────────

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (entries: Partial<IntersectionObserverEntry>[]) => void;
  callback: ObserverCallback;
  observedElements: Set<Element>;
}

let mockObserverInstances: MockObserverInstance[] = [];

function installMockIntersectionObserver() {
  mockObserverInstances = [];

  (globalThis as any).IntersectionObserver = class MockIntersectionObserver {
    readonly mock: MockObserverInstance;

    constructor(callback: ObserverCallback, _options?: IntersectionObserverInit) {
      const observedElements = new Set<Element>();
      const observe = vi.fn((el: Element) => observedElements.add(el));
      const unobserve = vi.fn((el: Element) => observedElements.delete(el));
      const disconnect = vi.fn(() => observedElements.clear());

      this.mock = {
        observe,
        unobserve,
        disconnect,
        trigger: (entries) => callback(entries as IntersectionObserverEntry[]),
        callback,
        observedElements,
      };

      (this as any).observe = observe;
      (this as any).unobserve = unobserve;
      (this as any).disconnect = disconnect;

      mockObserverInstances.push(this.mock);
    }
  };
}

function makeEntry(
  target: Element,
  isIntersecting: boolean,
  height: number = 40,
): Partial<IntersectionObserverEntry> {
  return {
    target,
    isIntersecting,
    boundingClientRect: { height, width: 200, x: 0, y: 0, top: 0, left: 0, bottom: height, right: 200 } as DOMRectReadOnly,
    intersectionRatio: isIntersecting ? 1 : 0,
  };
}

// ─── Test data ───────────────────────────────────────────────────────────────

const sampleDoc: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "epic-1",
      title: "Authentication",
      status: "in_progress",
      level: "epic",
      children: [
        {
          id: "task-1",
          title: "Build login form",
          status: "in_progress",
          level: "task",
        },
        {
          id: "task-2",
          title: "Add OAuth support",
          status: "pending",
          level: "task",
        },
      ],
    },
    {
      id: "epic-2",
      title: "Dashboard",
      status: "pending",
      level: "epic",
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => {
    render(vnode, root);
  });
  return root;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PRDTree node culling integration", () => {
  beforeEach(() => {
    installMockIntersectionObserver();
  });

  afterEach(() => {
    mockObserverInstances = [];
    delete (globalThis as any).IntersectionObserver;
  });

  it("renders all nodes initially (before observer fires)", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    expect(root.textContent).toContain("Authentication");
    expect(root.textContent).toContain("Dashboard");
  });

  it("creates a NodeCuller (IntersectionObserver) on mount", () => {
    renderToDiv(h(PRDTree, { document: sampleDoc }));
    // At least one observer should be created (the culler)
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
  });

  it("observes tree node elements after effects flush", () => {
    renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    // After act() flushes effects, the culler's observer should have observed elements
    const cullerObserver = mockObserverInstances[0];
    expect(cullerObserver.observe).toHaveBeenCalled();
    expect(cullerObserver.observedElements.size).toBeGreaterThan(0);
  });

  it("replaces node content with placeholder when culled", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    // Initially the task titles should be visible
    expect(root.textContent).toContain("Add OAuth support");

    // Find a node element that's being observed and cull it
    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Find the element containing "Add OAuth support"
    const targetEl = observedEls.find(el => el.textContent?.includes("Add OAuth support"));
    expect(targetEl).toBeDefined();

    // Trigger it as off-screen
    act(() => {
      cullerObserver.trigger([makeEntry(targetEl!, false, 40)]);
    });

    // After culling, the culled node should have placeholder class
    const culledNodes = root.querySelectorAll(".prd-node-culled");
    expect(culledNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("re-creates node content when scrolled back into view", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Find the Dashboard node
    const dashboardEl = observedEls.find(el => el.textContent?.includes("Dashboard"));
    expect(dashboardEl).toBeDefined();

    // Cull it
    act(() => {
      cullerObserver.trigger([makeEntry(dashboardEl!, false, 40)]);
    });

    // Content should be removed
    const culledNode = root.querySelector(".prd-node-culled");
    expect(culledNode).not.toBeNull();
    expect(culledNode!.textContent).toBe(""); // Placeholder is empty

    // Bring it back — the culled node is now the observed element
    act(() => {
      cullerObserver.trigger([makeEntry(culledNode!, true)]);
    });

    // Content should be re-created
    expect(root.textContent).toContain("Dashboard");
  });

  it("culled placeholders preserve height via inline style", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Find the Dashboard node
    const dashboardEl = observedEls.find(el => el.textContent?.includes("Dashboard"));
    expect(dashboardEl).toBeDefined();

    // Cull with known height
    act(() => {
      cullerObserver.trigger([makeEntry(dashboardEl!, false, 56)]);
    });

    const culledNode = root.querySelector(".prd-node-culled") as HTMLElement;
    expect(culledNode).not.toBeNull();
    expect(culledNode.style.height).toBe("56px");
  });

  it("culled placeholders have aria-hidden attribute", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    const dashboardEl = observedEls.find(el => el.textContent?.includes("Dashboard"));
    expect(dashboardEl).toBeDefined();

    act(() => {
      cullerObserver.trigger([makeEntry(dashboardEl!, false, 40)]);
    });

    const culledNode = root.querySelector(".prd-node-culled");
    expect(culledNode).not.toBeNull();
    expect(culledNode!.getAttribute("aria-hidden")).toBe("true");
  });

  it("disconnects observer when component unmounts", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(PRDTree, { document: sampleDoc }), root);
    });

    const cullerObserver = mockObserverInstances[0];

    // Unmount
    act(() => {
      render(null, root);
    });

    expect(cullerObserver.disconnect).toHaveBeenCalled();
  });

  it("does not cull highlighted (deep-link) nodes", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      highlightedItemId: "epic-2",
      deepLinkExpandIds: new Set<string>(),
    }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // The highlighted node (Dashboard) should NOT be observed
    // because neverCull=true skips the observer registration
    const dashboardEl = observedEls.find(el => el.textContent?.includes("Dashboard"));
    expect(dashboardEl).toBeUndefined();

    // Dashboard should still be visible
    expect(root.textContent).toContain("Dashboard");
  });

  it("event listeners are removed when nodes are culled", () => {
    const onSelectItem = vi.fn();
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      onSelectItem,
    }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Find the Dashboard node
    const dashboardEl = observedEls.find(el => el.textContent?.includes("Dashboard"));
    expect(dashboardEl).toBeDefined();

    // Cull it
    act(() => {
      cullerObserver.trigger([makeEntry(dashboardEl!, false, 40)]);
    });

    // The culled node should have no interactive children
    const culledNode = root.querySelector(".prd-node-culled");
    expect(culledNode).not.toBeNull();
    // Placeholder should have no treeitem children (NodeRow is removed)
    const treeItems = culledNode!.querySelectorAll("[role='treeitem']");
    expect(treeItems.length).toBe(0);
  });

  it("listener lifecycle manager is disposed on tree unmount", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(PRDTree, { document: sampleDoc }), root);
    });

    // Unmount
    act(() => {
      render(null, root);
    });

    // The culler observer should have been disconnected (verifies cleanup path)
    const cullerObserver = mockObserverInstances[0];
    expect(cullerObserver.disconnect).toHaveBeenCalled();
  });

  it("culled nodes have no residual interactive elements", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      onSelectItem: vi.fn(),
      onRemoveItem: vi.fn(),
    }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Cull all observed elements
    act(() => {
      const entries = observedEls.map(el => makeEntry(el, false, 40));
      cullerObserver.trigger(entries);
    });

    // All culled nodes should have no treeitem children, buttons, or inputs
    const culledNodes = root.querySelectorAll(".prd-node-culled");
    for (const node of culledNodes) {
      expect(node.querySelectorAll("[role='treeitem']").length).toBe(0);
      expect(node.querySelectorAll("button").length).toBe(0);
      expect(node.querySelectorAll("input").length).toBe(0);
    }
  });

  it("listener count remains proportional during cull/uncull cycles", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      onSelectItem: vi.fn(),
    }));

    const cullerObserver = mockObserverInstances[0];
    const observedEls = Array.from(cullerObserver.observedElements);

    // Count initial treeitem elements
    const initialTreeItems = root.querySelectorAll("[role='treeitem']").length;
    expect(initialTreeItems).toBeGreaterThan(0);

    // Cull first element
    const firstEl = observedEls[0];
    act(() => {
      cullerObserver.trigger([makeEntry(firstEl, false, 40)]);
    });

    const afterCullItems = root.querySelectorAll("[role='treeitem']").length;
    expect(afterCullItems).toBeLessThan(initialTreeItems);

    // Uncull it
    const culledNode = root.querySelector(".prd-node-culled");
    act(() => {
      cullerObserver.trigger([makeEntry(culledNode!, true)]);
    });

    const afterUncullItems = root.querySelectorAll("[role='treeitem']").length;
    expect(afterUncullItems).toBe(initialTreeItems);
  });
});
