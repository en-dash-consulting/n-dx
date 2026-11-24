// @vitest-environment jsdom
/**
 * The Queue panel (Work › Now, Plan › Preparation) and Ready to run's "Add to
 * run queue": every change sends the whole order to `PUT /api/hench/queue`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { QUEUE_CHANGED_NOTE, RunQueuePanel, _resetRunQueueForTests, addToRunQueue } from "../../../src/viewer/views/run-queue.js";
import { ReadyToRun } from "../../../src/viewer/components/ready-to-run.js";

interface Item { taskId: string; addedAt: string; title?: string; status?: string; priority?: string | null; missing?: true }

let root: HTMLDivElement;
let queue: Item[];
let puts: string[][];

const item = (taskId: string, title = `Task ${taskId}`): Item => ({ taskId, addedAt: "2026-11-23T00:00:00Z", title, status: "pending", priority: null });

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  _resetRunQueueForTests();
  queue = [item("a"), item("b"), item("c")];
  puts = [];
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/hench/queue" && init?.method === "PUT") {
      const ids = (JSON.parse(String(init.body)) as { taskIds: string[] }).taskIds;
      puts.push(ids);
      queue = ids.map((id) => queue.find((q) => q.taskId === id) ?? item(id, id === "r1" ? "Ready one" : `Task ${id}`));
      return { ok: true, status: 200, json: async () => ({ items: queue }) } as Response;
    }
    if (url === "/api/hench/queue") return { ok: true, status: 200, json: async () => ({ items: queue }) } as Response;
    if (url.startsWith("/api/hench/ready")) {
      return { ok: true, status: 200, json: async () => ({ dir: "/repo", total: 2, tasks: [
        { id: "r1", title: "Ready one", status: "pending", priority: null, parentChain: [], criteriaCount: 0, resume: false },
        { id: "a", title: "Task a", status: "pending", priority: null, parentChain: [], criteriaCount: 0, resume: false },
      ] }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  _resetRunQueueForTests();
  vi.unstubAllGlobals();
});

const rows = () => [...root.querySelectorAll<HTMLElement>(".rq-item")].map((r) => r.dataset.taskId);

describe("the Queue panel", () => {
  it("lists the queue in order, numbered, each title opening its task", async () => {
    const navigateTo = vi.fn();
    await act(async () => { render(h(RunQueuePanel, { navigateTo }), root); });
    await flush();
    expect(rows()).toEqual(["a", "b", "c"]);
    expect([...root.querySelectorAll(".rq-pos")].map((e) => e.textContent)).toEqual(["1", "2", "3"]);
    act(() => { root.querySelector<HTMLButtonElement>(".rq-item .rq-title")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "a" });
  });

  it("moves an item and removes one by saving the whole order", async () => {
    await act(async () => { render(h(RunQueuePanel, { navigateTo: vi.fn() }), root); });
    await flush();
    const first = root.querySelectorAll<HTMLElement>(".rq-item")[0]!;
    expect(first.querySelector<HTMLButtonElement>('[aria-label="Move Task a up"]')!.disabled).toBe(true);
    await act(async () => { first.querySelector<HTMLButtonElement>('[aria-label="Move Task a down"]')!.click(); });
    await flush(2);
    expect(puts.at(-1)).toEqual(["b", "a", "c"]);
    expect(rows()).toEqual(["b", "a", "c"]);
    await act(async () => { root.querySelector<HTMLButtonElement>('[aria-label="Remove Task c from the queue"]')!.click(); });
    await flush(2);
    expect(puts.at(-1)).toEqual(["b", "a"]);
    expect(rows()).toEqual(["b", "a"]);
  });

  it("adds a ready task that is not queued yet from its picker", async () => {
    await act(async () => { render(h(RunQueuePanel, { navigateTo: vi.fn() }), root); });
    await flush();
    act(() => { root.querySelector<HTMLButtonElement>(".rq-add-open")!.click(); });
    await flush();
    const select = root.querySelector<HTMLSelectElement>(".rq-select")!;
    // Already-queued tasks are not offered.
    expect([...select.options].map((o) => o.value)).toEqual(["", "r1"]);
    await act(async () => {
      select.value = "r1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { root.querySelector<HTMLButtonElement>(".rq-add .prep-btn-primary")!.click(); });
    await flush(2);
    expect(puts.at(-1)).toEqual(["a", "b", "c", "r1"]);
    expect(rows()).toEqual(["a", "b", "c", "r1"]);
  });

  it("says what a missing item means, and when the queue is empty", async () => {
    queue = [{ taskId: "gone", addedAt: "", missing: true }];
    await act(async () => { render(h(RunQueuePanel, { navigateTo: vi.fn() }), root); });
    await flush();
    expect(root.querySelector(".rq-item--missing .rq-meta")?.textContent).toBe("No longer in the PRD; the next run drops it");
    await act(async () => { root.querySelector<HTMLButtonElement>('[aria-label="Remove gone from the queue"]')!.click(); });
    await flush(2);
    expect(root.querySelector(".rq-note")?.textContent).toContain("Nothing queued.");
  });
});

describe("saving safely", () => {
  it("sends the order it last read as the base", async () => {
    const bodies: unknown[] = [];
    const inner = fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") bodies.push(JSON.parse(String(init.body)));
      return inner(input, init);
    }));
    await addToRunQueue("r1");
    expect(bodies).toEqual([{ taskIds: ["a", "b", "c", "r1"], base: ["a", "b", "c"] }]);
  });

  it("never replaces the queue when it could not be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(["unexpected"]);
      return { ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response;
    }));
    expect(await addToRunQueue("r1")).toBe(false);
    expect(puts).toEqual([]);
    await act(async () => { render(h(RunQueuePanel, { navigateTo: vi.fn() }), root); });
    await flush();
    expect(root.querySelector(".rq-error")?.textContent).toContain("Could not read the run queue");
    expect(root.querySelector(".rq-note")?.textContent ?? "").not.toContain("Nothing queued");
  });

  it("shows the queue as it stands, with a note, when a save is refused as stale", async () => {
    await act(async () => { render(h(RunQueuePanel, { navigateTo: vi.fn() }), root); });
    await flush();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? { ok: false, status: 409, json: async () => ({ error: "changed", items: [item("b"), item("c")] }) } as Response
        : { ok: true, status: 200, json: async () => ({ items: [item("b"), item("c")] }) } as Response));
    await act(async () => { root.querySelector<HTMLButtonElement>('[aria-label="Remove Task c from the queue"]')!.click(); });
    await flush(2);
    expect(rows()).toEqual(["b", "c"]);
    expect(root.querySelector(".rq-error")?.textContent).toBe(QUEUE_CHANGED_NOTE);
  });
});

describe("Ready to run's queue actions", () => {
  it("offers Add to run queue in a card's menu, and marks a queued card", async () => {
    const add = vi.fn();
    await act(async () => {
      render(h(ReadyToRun, { heading: false, onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn(), queue: { has: (id) => id === "a", add } }), root);
    });
    await flush();
    const card = (id: string) => root.querySelector<HTMLElement>(`.ready-row[data-task-id="${id}"]`)!;
    expect(card("a").querySelector(".ready-queued")?.textContent).toBe("Queued");
    expect(card("r1").querySelector(".ready-queued")).toBeNull();
    act(() => { card("r1").querySelector<HTMLButtonElement>(".ready-caret")!.click(); });
    const addItem = [...card("r1").querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Add to run queue")!;
    act(() => { addItem.click(); });
    expect(add).toHaveBeenCalledWith("r1");
    act(() => { card("a").querySelector<HTMLButtonElement>(".ready-caret")!.click(); });
    const queuedItem = [...card("a").querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "In the run queue")!;
    expect(queuedItem.disabled).toBe(true);
  });
});
