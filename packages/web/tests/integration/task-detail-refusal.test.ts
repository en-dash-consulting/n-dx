// @vitest-environment jsdom
/** Real server projection through the detail panel, including ancestor holds. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { findItem } from "../../src/server/rex-gateway.js";
import type { PRDItem, RuleNode } from "../../src/server/rex-gateway.js";
import { markRunnableUnits, unitRefusal } from "../../src/server/runnable-units.js";
import { TaskDetail } from "../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDDocumentData, PRDItemData } from "../../src/viewer/components/prd-tree/types.js";
import { usePRDData } from "../../src/viewer/hooks/use-prd-data.js";
import { cleanupRenderedDiv, renderToDiv } from "../helpers/preact-test-support.js";

const product = [{ id: "cap", type: "capability", title: "Capability" }] as RuleNode[];
const change = (extra: Record<string, unknown> = {}) => ({
  id: "change", type: "change", title: "Change", status: "pending", ...extra,
});
const task = (extra: Record<string, unknown> = {}) => ({
  id: "task", type: "task", title: "Task", status: "pending", ...extra,
});
const appliedAt = "2026-11-12T00:00:00Z";

function project(node: Record<string, unknown>, targets?: readonly RuleNode[]): PRDDocumentData {
  const items = [node] as unknown as PRDItem[];
  markRunnableUnits(items, targets && [...targets]);
  return { schema: node.type ? "rex/v2" : "rex/v1", title: "Refusal fixture", items };
}

describe("task detail actionable refusals", () => {
  let root: HTMLDivElement | undefined;
  let style: HTMLStyleElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../../src/viewer/styles/prd-tree.css"), "utf8");
    document.head.appendChild(style);
  });
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    style.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["Inbox change", change({ needsPlacement: true }), "change", /needs placement/i],
    ["completed change", change({ status: "completed" }), "change", /closed.*completed/i],
    ["cancelled change", change({ status: "cancelled" }), "change", /closed.*cancelled/i],
    ["task in closed change", change({ status: "completed", children: [task()] }), "task", /change.*closed/i],
    ["task in Inbox change", change({ needsPlacement: true, children: [task()] }), "task", /change.*needs placement/i],
    ["nested inherited closure", change({ status: "cancelled", children: [change({ id: "inner", children: [task()] })] }), "task", /change.*closed/i],
    ["v2 subtask", change({ children: [task({ children: [task({ id: "sub", type: "subtask" })] })] }), "sub", /parent task.*task/i],
  ] as const)("explains %s in the status block without offering Start", async (_name, node, id, reason) => {
    const doc = project(node, product);
    const item = findItem(doc.items as PRDItem[], id)!.item as PRDItemData;
    await act(async () => {
      root = renderToDiv(h(TaskDetail, { item, allItems: doc.items }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const hint = root!.querySelector(".task-execution-refusal")!;
    expect(hint?.textContent).toMatch(reason);
    const section = hint.closest(".task-section")!;
    expect(section.querySelector(".task-section-label")?.textContent).toBe("Status");
    expect(section.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(root!.querySelector(".start-task-primary")).toBeNull();
    expect(root!.querySelector(".start-task-caret")).toBeNull();
    // The actual stylesheet applies compact, readable supporting text to the
    // rendered hint, with the same neutral color and font as status controls.
    const hintStyle = getComputedStyle(hint);
    const buttonStyle = getComputedStyle(section.querySelector(".task-status-btn")!);
    expect(hintStyle.fontSize).toBe(buttonStyle.fontSize);
    expect(hintStyle.color).toBe(buttonStyle.color);
    expect(hintStyle.lineHeight).toBe("1.5");
    expect(parseFloat(hintStyle.marginBottom)).toBe(0);
  });

  it.each([
    ["v1 epic", { id: "legacy", level: "epic", title: "Epic", status: "pending" }, "legacy"],
    ["v1 feature", { id: "legacy", level: "feature", title: "Feature", status: "pending" }, "legacy"],
    ["change with tasks", change({ children: [task()] }), "change"],
    ["change with nested changes", change({ children: [change({ id: "inner" })] }), "change"],
    ["applied change", change({ appliedAt }), "change"],
    ["task of applied change", change({ appliedAt, children: [task()] }), "task"],
    ["task of completed applied change", change({ appliedAt, status: "completed", children: [task()] }), "task"],
    ["task below applied ancestor", change({ appliedAt, children: [change({ id: "inner", children: [task()] })] }), "task"],
    ["completed subtask of applied change", change({ appliedAt, status: "completed", children: [task({ status: "completed", children: [task({ id: "sub", type: "subtask", status: "completed" })] })] }), "sub"],
  ] as const)("keeps %s quiet and ineligible", async (_name, node, id) => {
    const doc = project(node);
    const item = findItem(doc.items as PRDItem[], id)!.item as PRDItemData;
    // Hiding prose must never remove the actual execution/settings guard.
    expect(unitRefusal(doc.items as PRDItem[])(item as PRDItem)).toEqual(expect.any(String));
    expect(item.executionEligible).toBe(false);
    await act(async () => {
      root = renderToDiv(h(TaskDetail, { item, allItems: doc.items }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(root!.querySelector('[aria-label="Task status"]')).not.toBeNull();
    expect(root!.querySelector(".task-execution-refusal")).toBeNull();
    expect(root!.querySelector(".start-task-primary")).toBeNull();
    expect(root!.querySelector(".start-task-caret")).toBeNull();
  });

  it.each([
    ["v1 task", { id: "task", level: "task", title: "Task", status: "pending" }, "task", undefined],
    ["v1 subtask", { id: "sub", level: "subtask", title: "Sub", status: "pending" }, "sub", undefined],
    ["taskless change", change(), "change", product],
    ["empty-product Inbox", change({ needsPlacement: true }), "change", []],
    ["ordinary task", change({ children: [task()] }), "task", product],
  ] as const)("keeps %s runnable without a refusal", async (_name, node, id, targets) => {
    const doc = project(node, targets);
    const item = findItem(doc.items as PRDItem[], id)!.item as PRDItemData;
    await act(async () => {
      root = renderToDiv(h(TaskDetail, { item, allItems: doc.items }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(root!.querySelector(".task-execution-refusal")).toBeNull();
    expect(root!.querySelector(".start-task-primary")?.textContent).toBe("Start");
    expect(root!.querySelector(".start-task-caret")).not.toBeNull();
  });

  it("clears an inherited hold on refresh without making an applied task runnable", async () => {
    const initial = project(change({ status: "completed", children: [task()] }), product);
    const next = project(change({ status: "completed", appliedAt, children: [task()] }), product);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => next })));
    let refresh!: () => Promise<void>;
    function View() {
      const { data, fetchPRDData } = usePRDData(initial);
      refresh = fetchPRDData;
      return h(TaskDetail, { item: data!.items[0].children![0], allItems: data!.items });
    }
    await act(async () => {
      root = renderToDiv(h(View, {}));
      await vi.advanceTimersByTimeAsync(0);
    });
    const status = root!.querySelector('[aria-label="Task status"]');
    expect(root!.querySelector(".task-execution-refusal")?.textContent).toMatch(/closed/i);
    await act(async () => {
      await refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(root!.querySelector('[aria-label="Task status"]')).toBe(status);
    expect(root!.querySelector(".task-execution-refusal")).toBeNull();
    expect(root!.querySelector(".start-task-primary")).toBeNull();
    expect(root!.querySelector(".start-task-caret")).toBeNull();
  });
});
