// @vitest-environment jsdom
/**
 * A change's tracker chip and "Create in tracker" (SP8): a linked change shows
 * the tracker, the state sync set and a link; an unlinked one offers Create,
 * which raises the card and draws its form, and Run is the only call that
 * reaches the tracker; with `web.sidecar` off or no tracker connection
 * neither draws. The server side is tracker-routes.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ChangeTrackerChip, asTrackerChipRead } from "../../../src/viewer/components/tracker-chip.js";

let root: HTMLDivElement;
let calls: Array<{ url: string; method: string }>;
let sidecar: boolean;
let chips: unknown;

/** The toggle's read, then the chips' read, each settle a few turns after the render. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
}

async function mount(changeId = "ch-1"): Promise<void> {
  act(() => { render(h(ChangeTrackerChip, { changeId }), root); });
  await settle();
}

const create = (): HTMLButtonElement | null => root.querySelector(".create-in-tracker-button");

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  calls = [];
  sidecar = true;
  chips = { tracker: { label: "CAOS" }, changes: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method });
    let body: unknown = {};
    if (u.startsWith("/api/features")) body = { toggles: [{ key: "web.sidecar", enabled: sidecar }] };
    else if (u === "/api/tracker/changes") body = chips;
    else if (u.endsWith("/create")) {
      body = { requestId: "ndx:ndx:ch-1:change-captured", entry: { call: { tool: "create_work_item", args: { title: "T" } } } };
    } else if (u.startsWith("/api/tracker/cards/form")) {
      body = { externalCall: { tool: "create_work_item", label: "CAOS", inputSchema: { type: "object", properties: { title: { type: "string" } } } } };
    }
    return { ok: true, status: 200, json: async () => body };
  }));
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("asTrackerChipRead", () => {
  it("reads no tracker as nothing to draw", () => {
    expect(asTrackerChipRead({ tracker: null, changes: {} })).toEqual({ label: null, changes: {} });
    expect(asTrackerChipRead("nope")).toEqual({ label: null, changes: {} });
  });

  it("keeps a linked change, and a created one with no ref yet, and drops one with neither", () => {
    const read = asTrackerChipRead({
      tracker: { label: "CAOS" },
      changes: { a: { refs: ["WM-1"], state: null }, b: { refs: [], state: "backlog" }, c: { refs: [], state: null } },
    });
    expect(read.changes).toEqual({ a: { refs: ["WM-1"], state: null }, b: { refs: [], state: "backlog" } });
  });
});

describe("ChangeTrackerChip", () => {
  it("shows the tracker, the state and a link for a linked change, and no Create", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: ["https://caos.example/WM-7"], state: "inProgress" } } };
    await mount();
    const link = root.querySelector<HTMLAnchorElement>(".tracker-chip a.tracker-link");
    expect(link?.href).toBe("https://caos.example/WM-7");
    expect(link?.textContent).toBe("CAOS caos.example");
    expect(root.querySelector(".tracker-chip-state")?.textContent).toBe("inProgress");
    expect(create()).toBeNull();
  });

  it("shows a change sync created but has not linked as created, never offering Create again", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: [], state: "backlog" } } };
    await mount();
    expect(root.querySelector(".tracker-chip")?.textContent).toBe("CAOSbacklog");
    expect(create()).toBeNull();
  });

  it("raises the card on Create and draws its form; nothing is decided until Run", async () => {
    await mount();
    expect(root.querySelector(".tracker-chip")).toBeNull();
    expect(create()?.textContent).toBe("Create in CAOS");
    act(() => { create()!.click(); });
    await settle();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/tracker/changes/ch-1/create"]);
    expect(root.querySelector('[data-action="send"]')?.textContent).toBe("Run create_work_item");
    expect(calls.some((c) => c.url === "/api/tracker/cards/decide")).toBe(false);
  });

  it("draws nothing without a tracker connection", async () => {
    chips = { tracker: null, changes: {} };
    await mount();
    expect(root.innerHTML).toBe('<div class="change-tracker-chip"></div>');
  });

  it("draws nothing, and reads nothing, with web.sidecar off", async () => {
    sidecar = false;
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: ["WM-1"], state: null } } };
    await mount();
    expect(root.querySelector(".tracker-chip, .create-in-tracker-button")).toBeNull();
    expect(calls.some((c) => c.url === "/api/tracker/changes")).toBe(false);
  });
});
