// @vitest-environment jsdom
/**
 * The Work page's branch work set: "On this branch" first, grouped by change with
 * Remove, then "Not on a branch" with Add; a task on the branch through its change
 * says so; a refusal shows inline; an empty set names `--any` through the CLI name;
 * main and an unassigned branch render Ready to run alone.
 *
 * @see src/viewer/components/work-set.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

vi.mock("../../../src/viewer/hooks/use-hench-runs-live-refresh.js", () => ({
  useHenchRunsLiveRefresh: () => {},
}));
vi.mock("../../../src/viewer/hooks/use-project-metadata.js", async (orig) => ({
  ...(await orig<object>()),
  useCliName: () => "ndx-test",
}));

import { WorkQueue } from "../../../src/viewer/components/work-set.js";

const OWN = { id: "t-own", displayId: "T-1", title: "Own task", status: "pending", inherited: false };
const VIA = { id: "t-via", title: "Inherited task", status: "in_progress", inherited: true };
const OFF = { id: "t-off", title: "Elsewhere task", status: "pending", inherited: false };
const CHANGE = { id: "c-1", displayId: "CH-1", title: "Add Apple Pay" };
const OTHER = { id: "c-2", title: "Rework billing" };

const READY = { tasks: [{ id: "t-own", title: "Own task", status: "pending", priority: "high", parentChain: [], criteriaCount: 1, resume: false }], total: 1, dir: "/p" };

const feature = (over: Record<string, unknown> = {}) => ({
  branch: "feat/x",
  workSet: true,
  groups: [{ change: CHANGE, units: [OWN, VIA] }],
  others: [{ change: OTHER, units: [OFF] }],
  ...over,
});

interface Call { url: string; method: string; body: unknown }

let root: HTMLDivElement | undefined;
let calls: Call[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** `read` is what GET work-set answers; `write` answers an add or remove. */
async function mount(read: unknown, write: { status: number; body: unknown } = { status: 200, body: {} }, ready: unknown = READY) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const answer = url.startsWith("/api/rex/work-set/") ? write : url === "/api/rex/work-set" ? { status: 200, body: read } : { status: 200, body: ready };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  }));
  root = renderToDiv(h(WorkQueue, { onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn() }));
  await flush();
}

const heads = () => Array.from(document.querySelectorAll("h2")).map((e) => e.textContent?.trim());
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const writes = () => calls.filter((c) => c.method === "POST");

describe("Work set sections", () => {
  it("shows On this branch first, by change with Remove, then Not on a branch with Add", async () => {
    await mount(feature());
    expect(heads()).toEqual(["On this branch feat/x", "Not on a branch", "Ready to run"]);
    const on = document.querySelector('[data-change-id="c-1"]')!;
    expect(on.querySelector("h3")?.textContent).toBe("CH-1 · Add Apple Pay");
    expect(Array.from(on.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Remove", "Remove", "Remove"]);
    expect(on.querySelector('[data-unit-id="t-own"]')?.textContent).toContain("T-1 · Own task");
    const off = document.querySelector('[data-change-id="c-2"]')!;
    expect(Array.from(off.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Add", "Start a branch", "Add"]);
  });

  it("says a task is on the branch through its change, and Remove on it explains instead of writing", async () => {
    await mount(feature());
    expect(document.querySelector('[data-unit-id="t-via"]')?.textContent).toContain("via its change");
    expect(document.querySelector('[data-unit-id="t-own"]')?.textContent).not.toContain("via its change");
    await click(button("Remove Inherited task"));
    expect(document.querySelector(".work-set-message")?.textContent).toContain("Remove the change to take it off");
    expect(writes()).toEqual([]);
  });

  it("Add posts the id, then reloads the sections and Ready to run", async () => {
    await mount(feature());
    const reads = () => calls.filter((c) => c.url === "/api/rex/work-set").length;
    const readies = () => calls.filter((c) => c.url.startsWith("/api/hench/ready")).length;
    const [r0, y0] = [reads(), readies()];
    await click(button("Add Elsewhere task"));
    expect(writes()).toEqual([{ url: "/api/rex/work-set/add", method: "POST", body: { ids: ["t-off"] } }]);
    expect(reads()).toBe(r0 + 1);
    expect(readies()).toBe(y0 + 1);
  });

  it("Remove on a change header posts the change id", async () => {
    await mount(feature());
    await click(button("Remove change Add Apple Pay"));
    expect(writes()).toEqual([{ url: "/api/rex/work-set/remove", method: "POST", body: { ids: ["c-1"] } }]);
  });

  it("says so when Remove on a change takes nothing off, because an enclosing change holds the branch", async () => {
    const nested = { id: "c-n", title: "Nested unit", status: "pending", inherited: true };
    await mount(feature({ groups: [{ change: { id: "c-n", title: "Nested unit" }, units: [nested] }] }), { status: 200, body: { branch: "feat/x", removed: [] } });
    expect(document.querySelector('[data-change-id="c-n"]')?.textContent).toContain("via its change");
    await click(button("Remove change Nested unit"));
    expect(document.querySelector(".work-set-message")?.textContent).toContain("Nothing was removed");
  });

  it("shows a refused Remove inline and reloads nothing", async () => {
    await mount(feature(), { status: 409, body: { error: "task t-own is running in this checkout", code: "RUN_LIVE" } });
    const reads = calls.length;
    await click(button("Remove Own task"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("task t-own is running in this checkout");
    expect(calls.length).toBe(reads + 1);
    expect(document.querySelector('[data-unit-id="t-own"]')).not.toBeNull();
  });

  it("an empty set says so and names --any through the CLI name", async () => {
    await mount(feature({ groups: [], others: [{ change: OTHER, units: [OFF] }] }), undefined, { tasks: [], total: 0, dir: "/p" });
    const empty = Array.from(document.querySelectorAll(".ready-empty")).map((e) => e.textContent);
    expect(empty).toContain("No open work is on this branch.");
    expect(empty).toContain("Nothing left in this branch's work set. To pick outside it, run ndx-test work --any.");
    expect(document.body.textContent).not.toContain("Open the PRD");
  });

  it("Ready to run lists what the server returned for the set", async () => {
    await mount(feature());
    expect(Array.from(document.querySelectorAll(".ready-row")).map((r) => (r as HTMLElement).dataset.taskId)).toEqual(["t-own"]);
  });
});

describe("Work page without a work set", () => {
  const plain = (read: unknown) => async () => {
    await mount(read);
    expect(heads()).toEqual(["Ready to run"]);
    expect(document.querySelector(".work-set")).toBeNull();
  };

  it("renders Ready to run alone on the default branch or a detached HEAD", plain({ branch: null, workSet: false, groups: [], others: [] }));
  it("renders Ready to run alone on a branch nothing is assigned to", plain({ branch: "feat/x", workSet: false, groups: [], others: [] }));

  it("keeps the usual empty state when the server has no work-set route", async () => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = url.startsWith("/api/hench/ready");
      return { ok, status: ok ? 200 : 404, json: async () => (ok ? { tasks: [], total: 0, dir: "/p" } : {}) };
    }));
    root = renderToDiv(h(WorkQueue, { onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn() }));
    await flush();
    expect(heads()).toEqual(["Ready to run"]);
    expect(document.body.textContent).toContain("Nothing ready to run.");
  });
});
