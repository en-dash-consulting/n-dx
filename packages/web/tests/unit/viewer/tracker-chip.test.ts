// @vitest-environment jsdom
/**
 * A change's tracker chip and "Create in tracker" (SP8): a linked change shows
 * the tracker, the state sync set and a link; an unlinked one offers Create,
 * which raises the card and draws its form, and Run is the only call that
 * reaches the tracker; with `web.sidecar` off or no tracker connection
 * neither draws. The server side is tracker-routes.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ChangeTrackerChip, TrackerChip, asTrackerChipRead } from "../../../src/viewer/components/tracker-chip.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

let root: HTMLDivElement;
let calls: Array<{ url: string; method: string }>;
let sidecar: boolean;
let chips: unknown;
let liveState: unknown;
let decided: unknown;

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
  liveState = { state: null, problem: "not stubbed" };
  decided = { result: "ok" };
  clearProjectMetadataCache();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method });
    let body: unknown = {};
    if (u.startsWith("/api/features")) body = { toggles: [{ key: "web.sidecar", enabled: sidecar }] };
    else if (u === "/api/tracker/changes") body = chips;
    else if (u.endsWith("/state")) body = liveState;
    else if (u === "/api/project") body = { cliName: "ndx" };
    else if (u.endsWith("/create")) {
      body = { requestId: "ndx:ndx:ch-1:change-captured", entry: { call: { tool: "create_work_item", args: { title: "T" } } } };
    } else if (u === "/api/tracker/cards/decide") {
      body = { entry: decided };
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

describe("TrackerChip on an Open changes row", () => {
  it("reads a linked change with no state from the log as linked, state unknown, and never calls the tracker", async () => {
    const read = { label: "CAOS", changes: { "ch-1": { refs: ["WM-9"], state: null } } };
    act(() => { render(h(TrackerChip, { changeId: "ch-1", read }), root); });
    await settle();
    expect(root.querySelector(".tracker-chip")?.textContent).toBe("CAOS WM-9linked · state unknown");
    expect(calls.filter((c) => c.url.startsWith("/api/tracker"))).toEqual([]);
  });

  it("labels a state from the log as the one the project's CLI set", async () => {
    const read = { label: "CAOS", changes: { "ch-1": { refs: ["WM-9"], state: "readyForReview" } } };
    act(() => { render(h(TrackerChip, { changeId: "ch-1", read }), root); });
    await settle();
    const state = root.querySelector(".tracker-chip-state");
    expect(state?.textContent).toBe("readyForReview · set by ndx");
    expect(state?.getAttribute("title")).toContain("may have moved");
  });
});

describe("ChangeTrackerChip", () => {
  it("shows the tracker, the state and a link for a linked change, and no Create", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: ["https://caos.example/WM-7"], state: "inProgress" } } };
    await mount();
    const link = root.querySelector<HTMLAnchorElement>(".tracker-chip a.tracker-link");
    expect(link?.href).toBe("https://caos.example/WM-7");
    expect(link?.textContent).toBe("CAOS caos.example");
    expect(root.querySelector(".tracker-chip-state")?.textContent).toBe("inProgress · set by ndx");
    expect(create()).toBeNull();
  });

  it("shows a change sync created but has not linked as created, never offering Create again, and reads nothing live", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: [], state: "backlog" } } };
    await mount();
    expect(root.querySelector(".tracker-chip")?.textContent).toBe("CAOSbacklog · set by ndx");
    expect(create()).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/state"))).toBe(false);
  });

  it("reads the linked item's current state once when the detail opens", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: ["WM-9"], state: null } } };
    liveState = { ref: "WM-9", state: "inReview", readAt: "2026-11-05T12:00:00.000Z" };
    await mount();
    expect(root.querySelector(".tracker-chip-state")?.textContent).toBe("linked · state unknown");
    expect(root.querySelector(".tracker-live-state")?.textContent).toBe("Now in CAOS: inReview");
    expect(calls.filter((c) => c.url === "/api/tracker/changes/ch-1/state")).toHaveLength(1);
  });

  it("says the state is unknown, keeping the ref and link, when the tracker cannot be read", async () => {
    chips = { tracker: { label: "CAOS" }, changes: { "ch-1": { refs: ["https://caos.example/WM-7"], state: null } } };
    liveState = { ref: "https://caos.example/WM-7", state: null, problem: "connection unavailable: caos: refused" };
    await mount();
    expect(root.querySelector<HTMLAnchorElement>(".tracker-chip a.tracker-link")?.href).toBe("https://caos.example/WM-7");
    const live = root.querySelector(".tracker-live-state");
    expect(live?.textContent).toBe("CAOS state unknown");
    expect(live?.getAttribute("title")).toBe("connection unavailable: caos: refused");
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
    // The open form takes the full width beneath a flex row (stage-tiles.css), not a column of it.
    expect(root.querySelector(".create-in-tracker")?.classList.contains("create-in-tracker-open")).toBe(true);
  });

  const run = async (): Promise<void> => {
    await mount();
    act(() => { create()!.click(); });
    await settle();
    act(() => { (root.querySelector('[data-action="send"]') as HTMLButtonElement).click(); });
    await settle();
  };

  it("keeps the form open and shows the problem when the tracker refuses the create", async () => {
    decided = { result: "refused", problems: [{ message: "title is required" }] };
    await run();
    expect(root.querySelector('[data-action="send"]')).not.toBeNull();
    expect(root.querySelector(".live-error")?.textContent).toContain("title is required");
  });

  it("says to link by hand when an ok create's link failed", async () => {
    decided = { result: "ok", problems: [{ message: "created WM-9, but could not link ch-1 to it: locked" }] };
    await run();
    expect(root.querySelector('[data-action="send"]')).not.toBeNull();
    expect(root.querySelector(".live-error")?.textContent).toContain("Link it by hand");
  });

  it("closes the form on an ok create with no problems", async () => {
    await run();
    expect(root.querySelector('[data-action="send"]')).toBeNull();
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

describe("tracker chip styles (stage-tiles.css)", () => {
  const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf8");

  it("styles the chip and opens the form full width beneath its row", () => {
    expect(css).toMatch(/\.tracker-chip\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.create-in-tracker-open\s*\{[^}]*flex:\s*1 0 100%/);
  });

  it("leaves an unlinked label in plain text: only a.tracker-link takes the link colour", () => {
    expect(css).not.toMatch(/\.tracker-chip\s+\.tracker-link/);
  });
});
