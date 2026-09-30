// @vitest-environment jsdom
/**
 * Tests for the ActiveOperationsTray component.
 *
 * Covers: empty-state rendering, expand/collapse toggle, summary text
 * per status mix, per-row rendering for running/done/failed operations,
 * the per-row Stop, and the finished-run result card.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ActiveOperationsTray } from "../../../src/viewer/components/active-operations-tray.js";
import type { ActiveOperation } from "../../../src/viewer/hooks/use-active-operations.js";
import { makeOperation as makeOp } from "../../helpers/job-tray.js";

describe("ActiveOperationsTray", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing when there are no operations", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [] }), root); });
    expect(root.children.length).toBe(0);
  });

  it("renders the toggle when operations exist", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    const toggle = root.querySelector(".active-operations-toggle");
    expect(toggle).not.toBeNull();
  });

  it("shows a running-count summary", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp(), makeOp({ id: "ci:singleton", kind: "ci" })] }), root); });
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("2 running");
  });

  it("shows a 'Finished' summary when nothing is running and nothing failed", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp({ status: "done", detail: "Complete" })] }), root); });
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("Finished");
  });

  it("shows a 'Finished with errors' summary when a failure exists and nothing is running", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp({ status: "failed", error: "boom" })] }), root); });
    const summary = root.querySelector(".active-operations-summary");
    expect(summary!.textContent).toBe("Finished with errors");
    expect(root.querySelector(".active-operations-toggle-error")).not.toBeNull();
  });

  it("does not render the list until expanded", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    expect(root.querySelector(".active-operations-list")).toBeNull();
  });

  it("expands to show the operation list on click", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    act(() => { toggle.click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });

    const list = root.querySelector(".active-operations-list");
    expect(list).not.toBeNull();
    expect(root.querySelectorAll(".active-op-row").length).toBe(1);
  });

  it("collapses again on a second click", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    act(() => { toggle.click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    act(() => { toggle.click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });

    expect(root.querySelector(".active-operations-list")).toBeNull();
  });

  it("renders a running row with the elapsed-time detail", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });

    const row = root.querySelector(".active-op-row-running")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-label")!.textContent).toBe("Full codebase analysis");
    expect(row.querySelector(".active-op-detail")!.textContent).toContain("running…");
  });

  it("renders a done row with its detail text", () => {
    const op = makeOp({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z", detail: "4/4 modules analyzed" });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });

    const row = root.querySelector(".active-op-row-done")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-detail")!.textContent).toBe("4/4 modules analyzed");
  });

  it("renders a failed row with 'Task failed' plus the reason as a secondary line", () => {
    const op = makeOp({ status: "failed", finishedAt: "2026-08-26T10:05:00.000Z", error: "build failed", detail: undefined });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });

    const row = root.querySelector(".active-op-row-failed")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".active-op-detail")!.textContent).toBe("Task failed");
    expect(row.querySelector(".active-op-reason")!.textContent).toBe("build failed");
  });

  it("shows a 'View details' link for a failed hench task execution, and it navigates to Activity", () => {
    const navigated: string[] = [];
    const op = makeOp({
      id: "hench:task-1", kind: "hench", label: "Add dark mode toggle",
      status: "failed", finishedAt: "2026-08-26T10:05:00.000Z",
      error: "Stopping after 1 iteration(s) due to failed status.",
    });
    act(() => { render(h(ActiveOperationsTray, { operations: [op], navigateTo: (view) => navigated.push(view) }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [op], navigateTo: (view) => navigated.push(view) }), root); });

    const link = root.querySelector(".active-op-details-link") as HTMLButtonElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("View details");
    act(() => { link.click(); });
    expect(navigated).toEqual(["activity"]);
  });

  it("does not show a 'View details' link for a failed non-hench operation", () => {
    const op = makeOp({ status: "failed", error: "boom" });
    act(() => { render(h(ActiveOperationsTray, { operations: [op], navigateTo: () => {} }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [op], navigateTo: () => {} }), root); });

    expect(root.querySelector(".active-op-details-link")).toBeNull();
  });

  it("does not show a 'View details' link when navigateTo is not provided", () => {
    const op = makeOp({ id: "hench:task-1", kind: "hench", status: "failed", error: "boom" });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [op] }), root); });

    expect(root.querySelector(".active-op-details-link")).toBeNull();
  });

  it("renders multiple concurrent operations as separate rows", () => {
    const ops = [makeOp({ id: "a" }), makeOp({ id: "b", kind: "ci", label: "ndx ci" })];
    act(() => { render(h(ActiveOperationsTray, { operations: ops }), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: ops }), root); });

    expect(root.querySelectorAll(".active-op-row").length).toBe(2);
  });

  // ── Stop ───────────────────────────────────────────────────────────

  /** Render expanded — the rows only exist once the tray is open. */
  function renderExpanded(props: Parameters<typeof ActiveOperationsTray>[0]) {
    act(() => { render(h(ActiveOperationsTray, props), root); });
    act(() => { (root.querySelector(".active-operations-toggle") as HTMLButtonElement).click(); });
    act(() => { render(h(ActiveOperationsTray, props), root); });
  }

  it("offers Stop on a running row and reports which operation was stopped", () => {
    const stopped: ActiveOperation[] = [];
    const op = makeOp();
    renderExpanded({ operations: [op], onStop: (o) => stopped.push(o) });

    const stop = root.querySelector(".active-op-stop") as HTMLButtonElement;
    expect(stop).not.toBeNull();
    expect(stop.getAttribute("aria-label")).toBe("Stop Full codebase analysis");
    act(() => { stop.click(); });
    expect(stopped).toEqual([op]);
  });

  it("offers no Stop on a finished row", () => {
    renderExpanded({
      operations: [makeOp({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z" })],
      onStop: () => {},
    });
    expect(root.querySelector(".active-op-stop")).toBeNull();
  });

  it("offers no Stop when the caller supplies no handler", () => {
    renderExpanded({ operations: [makeOp()] });
    expect(root.querySelector(".active-op-stop")).toBeNull();
  });

  // ── Result card ────────────────────────────────────────────────────

  it("shows a result card on a completed run, linking to where its output landed", () => {
    const navigated: string[] = [];
    renderExpanded({
      operations: [makeOp({
        status: "done",
        finishedAt: "2026-08-26T10:05:00.000Z",
        detail: "4/4 modules analyzed",
      })],
      navigateTo: (view) => navigated.push(view),
    });

    const card = root.querySelector(".active-op-result");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".active-op-result-text")!.textContent).toBe("4/4 modules analyzed");

    const link = card!.querySelector(".active-op-result-link") as HTMLButtonElement;
    expect(link.textContent).toBe("View analysis");
    act(() => { link.click(); });
    expect(navigated).toEqual(["analysis"]);
  });

  it("routes each kind's result card to that kind's own view", () => {
    const navigated: string[] = [];
    renderExpanded({
      operations: [makeOp({
        id: "ci:singleton", kind: "ci", label: "n-dx ci",
        status: "done", finishedAt: "2026-08-26T10:05:00.000Z",
        result: { view: "validation", label: "View report" },
      })],
      navigateTo: (view) => navigated.push(view),
    });
    act(() => { (root.querySelector(".active-op-result-link") as HTMLButtonElement).click(); });
    expect(navigated).toEqual(["validation"]);
  });

  it("shows no result card for a failed run", () => {
    renderExpanded({
      operations: [makeOp({ status: "failed", finishedAt: "2026-08-26T10:05:00.000Z", error: "boom" })],
      navigateTo: () => {},
    });
    expect(root.querySelector(".active-op-result")).toBeNull();
  });

  it("shows no result card for a stopped run", () => {
    // A stop leaves the output half-written; linking to it would promise a
    // result that is not there.
    renderExpanded({
      operations: [makeOp({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z", stopped: true })],
      navigateTo: () => {},
    });
    expect(root.querySelector(".active-op-result")).toBeNull();
  });

  it("shows no result card on a running row", () => {
    renderExpanded({ operations: [makeOp()], navigateTo: () => {} });
    expect(root.querySelector(".active-op-result")).toBeNull();
  });

  it("sets aria-expanded to reflect toggle state", () => {
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    const toggle = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => { toggle.click(); });
    act(() => { render(h(ActiveOperationsTray, { operations: [makeOp()] }), root); });
    const toggleAfter = root.querySelector(".active-operations-toggle") as HTMLButtonElement;
    expect(toggleAfter.getAttribute("aria-expanded")).toBe("true");
  });
});
