// @vitest-environment jsdom
/**
 * The task and change pages show the item's tracker links (story 44) with the
 * tracker's label from its profile, and Link / Unlink write through
 * `POST` / `DELETE /api/rex/items/:id/links`. The server reads the refs from
 * the item's `issues` (v2) or `links[]` (v1): tracker-item-links.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { resetTrackerLabel } from "../../../src/viewer/components/tracker-links.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

let root: HTMLDivElement;
let calls: Array<{ url: string; method: string; body?: unknown }>;
let label: string | null;
/** What GET /api/rex/items/:id/links answers. */
let refs: string[];
/** What POST and DELETE answer. */
let answer: { ok: boolean; status: number; body: Record<string, unknown> };

const item = (over: Partial<PRDItemData>): PRDItemData => ({ id: "t1", title: "Task", status: "pending", ...over });

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function mount(it: PRDItemData, onPrdChanged = vi.fn()): Promise<void> {
  await act(async () => { render(h(TaskDetail, { item: it, allItems: [it], onPrdChanged }), root); await flush(); });
  // The label's and the refs' reads start in effects, so they settle one turn after the first render.
  await act(async () => { await flush(); });
}

const section = (): Element | null => root.querySelector('[data-section="tracker-links"]');
const texts = (): string[] => [...root.querySelectorAll('[data-section="tracker-links"] .tracker-link')].map((l) => l.textContent ?? "");

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  calls = [];
  label = "CAOS";
  refs = [];
  answer = { ok: true, status: 200, body: { ok: true, changed: true, refs: [] } };
  resetTrackerLabel();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/connections/tracker") return { ok: true, status: 200, json: async () => ({ label }) };
    if (u.endsWith("/links")) {
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") return { ok: true, status: 200, json: async () => ({ refs }) };
      return { ok: answer.ok, status: answer.status, json: async () => answer.body };
    }
    // A change page reads the Inbox's list of changes awaiting placement.
    if (u.startsWith("/api/rex/changes")) return { ok: true, status: 200, json: async () => ({ changes: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("tracker links on a task page", () => {
  it("shows the refs the server holds with the tracker's label, a URL as a link", async () => {
    refs = ["WM-2054", "https://tracker.example/items/9"];
    await mount(item({ type: "task" }));
    expect(calls).toEqual([{ url: "/api/rex/items/t1/links", method: "GET", body: undefined }]);
    expect(texts()).toEqual(["CAOS WM-2054", "CAOS tracker.example"]);
    expect(section()!.querySelector("a")?.getAttribute("href")).toBe("https://tracker.example/items/9");
  });

  it("reads as the bare key while no connection names a tracker profile", async () => {
    label = null;
    refs = ["WM-2054"];
    await mount(item({ type: "task" }));
    expect(texts()).toEqual(["WM-2054"]);
  });

  it("shows no link and offers Link when the item has none", async () => {
    await mount(item({ type: "task" }));
    expect(texts()).toEqual([]);
    expect(section()!.querySelector(".tracker-link-add")).not.toBeNull();
  });
});

describe("tracker links on a change page", () => {
  it("shows the section for a change, and not for a capability", async () => {
    refs = ["WM-1"];
    await mount(item({ id: "c1", type: "change" }));
    expect(texts()).toEqual(["CAOS WM-1"]);
    render(null, root);
    await mount(item({ id: "cap", type: "capability", title: "Cap" }));
    expect(section()).toBeNull();
  });
});

describe("Link and Unlink", () => {
  async function typeRef(value: string): Promise<void> {
    await act(async () => { (section()!.querySelector(".tracker-link-add") as HTMLElement).click(); });
    const input = section()!.querySelector<HTMLInputElement>(".tracker-link-input")!;
    await act(async () => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (section()!.querySelector(".tracker-link-confirm") as HTMLElement).click(); await flush(); });
  }

  it("links a typed key through the links route and reloads the item", async () => {
    answer.body = { ok: true, changed: true, refs: ["WM-2054"] };
    const onPrdChanged = vi.fn();
    await mount(item({ type: "task" }), onPrdChanged);
    await typeRef(" WM-2054 ");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([{ url: "/api/rex/items/t1/links", method: "POST", body: { ref: "WM-2054" } }]);
    expect(texts()).toEqual(["CAOS WM-2054"]);
    expect(onPrdChanged).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal of a ref that is no key or URL and writes nothing", async () => {
    answer = { ok: false, status: 400, body: { error: `"ref" must be a tracker key (WM-2054) or an http(s) URL` } };
    const onPrdChanged = vi.fn();
    await mount(item({ type: "task" }), onPrdChanged);
    await typeRef("owner/repo#12");
    expect(section()!.querySelector(".tracker-link-error")?.textContent).toMatch(/tracker key/);
    expect(texts()).toEqual([]);
    expect(onPrdChanged).not.toHaveBeenCalled();
  });

  it("unlinks a ref through the links route", async () => {
    refs = ["WM-2054"];
    answer.body = { ok: true, changed: true, refs: [] };
    await mount(item({ type: "task" }));
    await act(async () => { (section()!.querySelector(".tracker-unlink") as HTMLElement).click(); await flush(); });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([{ url: "/api/rex/items/t1/links", method: "DELETE", body: { ref: "WM-2054" } }]);
    expect(texts()).toEqual([]);
  });

  it("keeps the links and says why when the server refuses", async () => {
    refs = ["WM-2054"];
    answer = { ok: false, status: 409, body: { error: "Could not acquire PRD lock (held by PID 9)" } };
    await mount(item({ type: "task" }));
    await act(async () => { (section()!.querySelector(".tracker-unlink") as HTMLElement).click(); await flush(); });
    expect(texts()).toEqual(["CAOS WM-2054"]);
    expect(section()!.querySelector(".tracker-link-error")?.textContent).toContain("PID 9");
  });

  it("reads the refs again once the page reloaded the item", async () => {
    refs = ["WM-1"];
    const first = item({ type: "task" });
    await mount(first);
    expect(texts()).toEqual(["CAOS WM-1"]);
    refs = ["WM-1", "WM-2"];
    // As the page does after a prd-changed: the same item, a new object.
    await mount({ ...first });
    expect(texts()).toEqual(["CAOS WM-1", "CAOS WM-2"]);
  });
});
