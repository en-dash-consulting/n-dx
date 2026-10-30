// @vitest-environment jsdom
/**
 * PRDView reports the task picked in its tree, which the route never carries,
 * so Sidecar can attach it (main.ts folds it into the page selection).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { PRDView, type PRDViewProps } from "../../../src/viewer/views/prd.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

const doc: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [{
    id: "epic-1", title: "Authentication", status: "in_progress", level: "epic",
    children: [
      { id: "task-1", title: "Login form", status: "pending", level: "task" },
      { id: "task-2", title: "Logout button", status: "pending", level: "task" },
    ],
  }],
};

let root: HTMLDivElement | null = null;

afterEach(() => {
  if (root) { act(() => { render(null, root!); }); root.remove(); root = null; }
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
}

describe("PRDView selection report", () => {
  it("reports the item picked in the tree, then null when the view goes away", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const seen: Array<string | null> = [];
    const onSelectedItemChange = (id: string | null) => { seen.push(id); };
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => {
      render(h(PRDView, { prdData: doc, onSelectedItemChange, onSelectItem: vi.fn(), onDetailContent: vi.fn() }), root!);
    });
    await settle();
    expect(seen.at(-1)).toBeNull();

    const row = [...root.querySelectorAll<HTMLElement>(".prd-item, [role='treeitem']")]
      .find((el) => el.textContent?.includes("Authentication"));
    expect(row).toBeTruthy();
    await act(async () => { row!.click(); });
    await settle();
    expect(seen.at(-1)).toBe("epic-1");

    await act(async () => { render(null, root!); });
    expect(seen.at(-1)).toBeNull();
  });

  it("the prd view renderer hands main.ts's setOpenTask to PRDView", () => {
    const setOpenTask = vi.fn();
    const vnode = renderActiveView("prd", { selectedTaskId: null, setOpenTask } as unknown as ViewRenderContext) as VNode<PRDViewProps>;
    expect(vnode.type).toBe(PRDView);
    expect(vnode.props.onSelectedItemChange).toBe(setOpenTask);
  });
});
