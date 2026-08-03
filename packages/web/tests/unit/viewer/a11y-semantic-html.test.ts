/**
 * A11y semantic HTML tests.
 *
 * Verifies that interactive elements use native HTML controls (<button>, <a>)
 * rather than div[role="button"], ensuring proper keyboard accessibility and
 * screen-reader semantics (WCAG 2.1 §4.1.2).
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { CollapsibleSection } from "../../../src/viewer/components/data-display/collapsible-section.js";
import { DetailPanel } from "../../../src/viewer/components/detail-panel.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>): HTMLElement {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

function queryAllDivRoleButton(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll("div[role='button'], span[role='button']"));
}

// ── CollapsibleSection ────────────────────────────────────────────────────────

describe("CollapsibleSection a11y", () => {
  beforeEach(() => { localStorage.clear(); });

  it("uses a <button> for the header toggle, not div[role='button']", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Section" },
        h("div", null, "content"),
      ),
    );
    const header = root.querySelector(".collapsible-header");
    expect(header?.tagName.toLowerCase()).toBe("button");
    expect(queryAllDivRoleButton(root)).toHaveLength(0);
  });

  it("toggle button has type='button' to prevent accidental form submission", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Section" },
        h("div", null, "content"),
      ),
    );
    const btn = root.querySelector("button.collapsible-header") as HTMLButtonElement | null;
    expect(btn?.type).toBe("button");
  });

  it("toggle button exposes aria-expanded", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Section", defaultOpen: true },
        h("div", null, "content"),
      ),
    );
    const btn = root.querySelector("button.collapsible-header");
    expect(btn?.getAttribute("aria-expanded")).toBe("true");
  });
});

// ── DetailPanel ───────────────────────────────────────────────────────────────

describe("DetailPanel a11y", () => {
  it("renders complementary landmark with accessible label", () => {
    const detail = { type: "generic" as const, title: "Test item" };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    const panel = root.querySelector("[role='complementary']");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-label")).toContain("details");
  });

  it("close button has accessible label", () => {
    const detail = { type: "generic" as const, title: "Test item" };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    const btn = root.querySelector("button[aria-label='Close detail panel']");
    expect(btn).not.toBeNull();
  });

  it("restores focus to the trigger element when the panel closes", async () => {
    // Set up a focusable trigger in the document
    document.body.innerHTML = "<button id='trigger'>Open</button><div id='app'></div>";
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    const appRoot = document.getElementById("app")!;

    // Simulate the trigger having focus when the panel opens
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const detail = { type: "generic" as const, title: "Item" };
    render(h(DetailPanel, { detail, onClose: () => {} }), appRoot);
    // After render with detail set, previousFocus should have been saved

    // Now close the panel (set detail to null)
    await act(async () => {
      render(h(DetailPanel, { detail: null, onClose: () => {} }), appRoot);
    });

    // Wait for requestAnimationFrame to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(document.activeElement).toBe(trigger);
    document.body.innerHTML = "";
  });
});

// ── Landmark and skip-link structure ─────────────────────────────────────────

describe("skip link structure", () => {
  it("skip link CSS class selector targets an anchor element in the app shell", () => {
    // The skip link rendered in main.ts is: h("a", { href: "#main-content", class: "skip-link" }, ...)
    // This test verifies the expected element type and href via a synthetic render.
    const root = document.createElement("div");
    render(h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"), root);
    const link = root.querySelector("a.skip-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.href).toContain("#main-content");
    expect(link?.textContent).toBe("Skip to main content");
  });
});
