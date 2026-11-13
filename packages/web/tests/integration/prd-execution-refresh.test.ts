// @vitest-environment jsdom
/** Server-derived eligibility through the real refresh hook and task controls. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { markRunnableUnits } from "../../src/server/runnable-units.js";
import type { PRDItem, RuleNode } from "../../src/server/rex-gateway.js";
import { usePRDData } from "../../src/viewer/hooks/use-prd-data.js";
import { TaskDetail } from "../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDDocumentData } from "../../src/viewer/components/prd-tree/types.js";
import { cleanupRenderedDiv, renderToDiv } from "../helpers/preact-test-support.js";

const product: RuleNode[] = [{ id: "cap", type: "capability", title: "Capability", slug: "capability" }];

function snapshot(state: "inbox" | "placed" | "applied"): PRDDocumentData {
  const items = [{
    id: "change", type: "change", title: "Change", status: "pending",
    needsPlacement: state === "inbox",
    ...(state === "applied" ? { appliedAt: "2026-11-12T00:00:00Z" } : {}),
    children: [
      { id: "task-a", type: "task", title: "Task A", status: "pending" },
      { id: "task-b", type: "task", title: "Task B", status: "deferred" },
    ],
  }] as unknown as PRDItem[];
  // This is the production projection used by /data/prd.json. Only ancestor
  // state changes; task status and content stay identical across refreshes.
  markRunnableUnits(items, product);
  return { schema: "rex/v2", title: "Refresh fixture", items };
}

describe("PRD execution refresh", () => {
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["placing an Inbox change reveals Start on its tasks", "inbox", "placed", false, true],
    ["applying a change removes Start from its tasks", "placed", "applied", true, false],
  ] as const)("%s without remounting", async (_name, before, after, initiallyOffered, finallyOffered) => {
    vi.useFakeTimers();
    const initial = snapshot(before);
    const next = snapshot(after);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/data/prd.json") return {
        ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(next)),
      };
      if (url === "/api/live") return {
        ok: true, status: 200,
        json: async () => ({ runs: [], jobs: [], counts: { running: 0, stale: 0, jobs: 0 } }),
      };
      return { ok: false, status: 404, json: async () => ({ error: "Not in this fixture" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    let refresh!: () => Promise<void>;
    function View() {
      const { data, fetchPRDData } = usePRDData(initial);
      refresh = fetchPRDData;
      return h("div", null, data!.items[0].children!.map((item) =>
        h("section", { key: item.id, "data-task": item.id },
          h(TaskDetail, { item, allItems: data!.items }),
        ),
      ));
    }

    await act(async () => {
      root = renderToDiv(h(View, {}));
      await vi.advanceTimersByTimeAsync(0);
    });
    const panels = [...root!.querySelectorAll("[data-task]")];
    expect(panels).toHaveLength(2);
    function expectControls(offered: boolean): void {
      for (const panel of panels) {
        expect(panel.querySelector(".start-task-primary")?.textContent ?? null).toBe(offered ? "Start" : null);
        expect(panel.querySelector(".start-task-caret") !== null).toBe(offered);
      }
    }
    expectControls(initiallyOffered);

    await act(async () => {
      await refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/data/prd.json")).toHaveLength(1);
    expect(root!.querySelectorAll("[data-task]")[0]).toBe(panels[0]);
    expect(root!.querySelectorAll("[data-task]")[1]).toBe(panels[1]);
    expectControls(finallyOffered);
  });
});
