// @vitest-environment jsdom
/**
 * Tests for the ActiveOperationsTray component.
 *
 * Covers: empty-state rendering, expand/collapse toggle, summary text
 * per status mix, and per-row rendering for running/done/failed operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { ActiveOperationsTray } from "../../../src/viewer/components/active-operations-tray.js";
import type { ActiveOperation } from "../../../src/viewer/hooks/use-active-operations.js";

function makeOp(overrides: Partial<ActiveOperation> = {}): ActiveOperation {
  return {
    id: "sv-analyze:singleton",
    kind: "sv-analyze",
    label: "Full codebase analysis",
    status: "running",
    startedAt: "2026-08-26T10:00:00.000Z",
    finishedAt: null,
    detail: undefined,
    error: null,
    ...overrides,
  };
}

describe("ActiveOperationsTray", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing when there are no operations", () => {
    render(h(ActiveOperationsTray, { operations: [] }), root);
    expect(root.children.length).toBe(0);
  });

  it("renders the toggle when operations exist", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    const toggle = root.querySelector(".active-operations-toggle");
    expect(toggle).not.toBeNull();
  });

  it("shows a running-count summary", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp(), makeOp({ id: "ci:singleton", kind: "ci" })] }), root);
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("2 running");
  });

  it("shows a 'Finished' summary when nothing is running and nothing failed", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp({ status: "done", detail: "Complete" })] }), root);
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("Finished");
  });

  it("shows a 'Finished with errors' summary when a failure exists and nothing is running", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp({ status: "failed", error: "boom" })] }), root);
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("Finished with errors");
    expect(root.querySelector(".active-operations-toggle-error")).not.toBeNull();
  });

  it("does not render the list until expanded", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    expect(root.querySelector(".active-operations-list")).toBeNull();
  });

  it("expands to show the operation list on click", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    toggle.click();
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);

    const list = root.querySelector(".active-operations-list");
    expect(list).not.toBeNull();
    expect(root.querySelectorAll(".active-op-row").length).toBe(1);
  });

  it("collapses again on a second click", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    toggle.click();
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    toggle.click();
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);

    expect(root.querySelector(".active-operations-list")).toBeNull();
  });

  it("renders a running row with the elapsed-time detail", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click();
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);

    const row = root.querySelector(".active-op-row-running")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-label")!.textContent).toBe("Full codebase analysis");
    expect(row.querySelector(".active-op-detail")!.textContent).toContain("running…");
  });

  it("renders a done row with its detail text", () => {
    const op = makeOp({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z", detail: "4/4 modules analyzed" });
    render(h(ActiveOperationsTray, { operations: [op] }), root);
    (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click();
    render(h(ActiveOperationsTray, { operations: [op] }), root);

    const row = root.querySelector(".active-op-row-done")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-detail")!.textContent).toBe("4/4 modules analyzed");
  });

  it("renders a failed row with its error text", () => {
    const op = makeOp({ status: "failed", finishedAt: "2026-08-26T10:05:00.000Z", error: "build failed", detail: undefined });
    render(h(ActiveOperationsTray, { operations: [op] }), root);
    (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click();
    render(h(ActiveOperationsTray, { operations: [op] }), root);

    const row = root.querySelector(".active-op-row-failed")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-detail")!.textContent).toBe("build failed");
  });

  it("renders multiple concurrent operations as separate rows", () => {
    const ops = [makeOp({ id: "a" }), makeOp({ id: "b", kind: "ci", label: "ndx ci" })];
    render(h(ActiveOperationsTray, { operations: ops }), root);
    (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click();
    render(h(ActiveOperationsTray, { operations: ops }), root);

    expect(root.querySelectorAll(".active-op-row").length).toBe(2);
  });

  it("sets aria-expanded to reflect toggle state", () => {
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    render(h(ActiveOperationsTray, { operations: [makeOp()] }), root);
    const toggleAfter = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    expect(toggleAfter.getAttribute("aria-expanded")).toBe("true");
  });
});
