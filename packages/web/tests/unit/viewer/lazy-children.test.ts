// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { LazyChildren, UNMOUNT_DELAY_MS } from "../../../src/viewer/components/prd-tree/lazy-children.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => {
    render(vnode, root);
  });
  return root;
}

/** Render LazyChildren with a simple child div for assertions. */
function makeLazy(isOpen: boolean) {
  return h(LazyChildren, {
    isOpen,
    renderChildren: () => h("div", { class: "test-child" }, "child content"),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LazyChildren", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial render", () => {
    it("does not render children when initially collapsed", () => {
      const root = renderToDiv(makeLazy(false));
      expect(root.querySelector(".test-child")).toBeNull();
      expect(root.querySelector(".prd-children")).toBeNull();
    });

    it("renders children when initially expanded", () => {
      const root = renderToDiv(makeLazy(true));
      expect(root.querySelector(".test-child")).not.toBeNull();
      expect(root.textContent).toContain("child content");
    });

    it("applies prd-children class when expanded", () => {
      const root = renderToDiv(makeLazy(true));
      const wrapper = root.querySelector(".prd-children");
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains("prd-children-collapsed")).toBe(false);
    });

    it("has role=group on the wrapper", () => {
      const root = renderToDiv(makeLazy(true));
      const wrapper = root.querySelector(".prd-children");
      expect(wrapper!.getAttribute("role")).toBe("group");
    });
  });

  describe("expand (false → true)", () => {
    it("mounts children when parent is expanded", () => {
      const root = document.createElement("div");

      // Start collapsed
      act(() => {
        render(makeLazy(false), root);
      });
      expect(root.querySelector(".test-child")).toBeNull();

      // Expand
      act(() => {
        render(makeLazy(true), root);
      });
      expect(root.querySelector(".test-child")).not.toBeNull();
      expect(root.textContent).toContain("child content");
    });

    it("does not have collapsed class when expanded", () => {
      const root = document.createElement("div");
      act(() => {
        render(makeLazy(false), root);
      });
      act(() => {
        render(makeLazy(true), root);
      });

      const wrapper = root.querySelector(".prd-children");
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains("prd-children-collapsed")).toBe(false);
    });

    it("does not set aria-hidden when expanded", () => {
      const root = document.createElement("div");
      act(() => {
        render(makeLazy(false), root);
      });
      act(() => {
        render(makeLazy(true), root);
      });

      const wrapper = root.querySelector(".prd-children");
      expect(wrapper!.hasAttribute("aria-hidden")).toBe(false);
    });
  });

  describe("collapse (true → false)", () => {
    it("hides children immediately via CSS class", () => {
      const root = document.createElement("div");

      // Start expanded
      act(() => {
        render(makeLazy(true), root);
      });
      expect(root.querySelector(".test-child")).not.toBeNull();

      // Collapse
      act(() => {
        render(makeLazy(false), root);
      });

      // Children are still mounted but hidden via CSS class
      const wrapper = root.querySelector(".prd-children");
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains("prd-children-collapsed")).toBe(true);
    });

    it("sets aria-hidden when collapsed", () => {
      const root = document.createElement("div");
      act(() => {
        render(makeLazy(true), root);
      });
      act(() => {
        render(makeLazy(false), root);
      });

      const wrapper = root.querySelector(".prd-children");
      expect(wrapper!.getAttribute("aria-hidden")).toBe("true");
    });

    it("unmounts children after delay", () => {
      const root = document.createElement("div");
      act(() => {
        render(makeLazy(true), root);
      });
      act(() => {
        render(makeLazy(false), root);
      });

      // Still mounted during delay
      expect(root.querySelector(".prd-children")).not.toBeNull();

      // Advance past delay
      act(() => {
        vi.advanceTimersByTime(UNMOUNT_DELAY_MS);
      });

      // Now unmounted
      expect(root.querySelector(".prd-children")).toBeNull();
      expect(root.querySelector(".test-child")).toBeNull();
    });

    it("does not unmount before delay expires", () => {
      const root = document.createElement("div");
      act(() => {
        render(makeLazy(true), root);
      });
      act(() => {
        render(makeLazy(false), root);
      });

      // Advance to just before the delay
      act(() => {
        vi.advanceTimersByTime(UNMOUNT_DELAY_MS - 1);
      });

      // Still mounted
      expect(root.querySelector(".prd-children")).not.toBeNull();
    });
  });

  describe("rapid toggle (state preservation)", () => {
    it("cancels unmount when re-expanded before delay", () => {
      const root = document.createElement("div");

      // Expand
      act(() => {
        render(makeLazy(true), root);
      });
      // Collapse
      act(() => {
        render(makeLazy(false), root);
      });

      // Re-expand before unmount delay fires
      act(() => {
        vi.advanceTimersByTime(UNMOUNT_DELAY_MS / 2);
      });
      act(() => {
        render(makeLazy(true), root);
      });

      // Children should be visible (no collapsed class)
      const wrapper = root.querySelector(".prd-children");
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains("prd-children-collapsed")).toBe(false);

      // Advance past the original unmount time — should NOT unmount
      act(() => {
        vi.advanceTimersByTime(UNMOUNT_DELAY_MS);
      });

      expect(root.querySelector(".test-child")).not.toBeNull();
    });

    it("preserves child content across rapid expand/collapse/expand", () => {
      // Use a stateful child to verify state is preserved
      let renderCount = 0;
      function StatefulChild() {
        renderCount++;
        return h("div", { class: "stateful-child" }, `render-${renderCount}`);
      }

      const root = document.createElement("div");

      function renderWithState(isOpen: boolean) {
        return h(LazyChildren, {
          isOpen,
          renderChildren: () => h(StatefulChild, null),
        });
      }

      // Expand — first render
      act(() => {
        render(renderWithState(true), root);
      });
      const firstRender = renderCount;
      expect(root.querySelector(".stateful-child")).not.toBeNull();

      // Collapse
      act(() => {
        render(renderWithState(false), root);
      });

      // Re-expand before unmount — should reuse existing DOM
      act(() => {
        render(renderWithState(true), root);
      });

      // Child was NOT unmounted and remounted — render count should be
      // predictable (no extra mount/unmount cycle)
      expect(root.querySelector(".stateful-child")).not.toBeNull();
      // The component was never unmounted, so no extra initial mount
      expect(renderCount).toBeGreaterThan(firstRender);
    });
  });

  describe("component unmount cleanup", () => {
    it("clears pending timer when LazyChildren is unmounted", () => {
      const root = document.createElement("div");

      // Expand then collapse (starts unmount timer)
      act(() => {
        render(makeLazy(true), root);
      });
      act(() => {
        render(makeLazy(false), root);
      });

      // Unmount the entire component
      act(() => {
        render(null, root);
      });

      // Advancing timers should not throw or cause issues
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(UNMOUNT_DELAY_MS * 2);
        });
      }).not.toThrow();
    });
  });

  describe("UNMOUNT_DELAY_MS", () => {
    it("is a positive number", () => {
      expect(UNMOUNT_DELAY_MS).toBeGreaterThan(0);
    });

    it("is less than 1 second", () => {
      expect(UNMOUNT_DELAY_MS).toBeLessThan(1000);
    });
  });
});
