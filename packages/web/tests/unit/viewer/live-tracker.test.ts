// @vitest-environment jsdom
/**
 * Live's Tracker activity section: every log entry with its result (a dry-run
 * `would`, a refusal's problems, a card), Approve running a card's call with
 * the operator's edits and Dismiss recording it, 'sign in again' for a revoked
 * connection, and nothing at all with `web.sidecar` off or no tracker
 * connection configured. The server is a stub; its own tests cover the calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { LiveView } from "../../../src/viewer/views/live.js";
import { TrackerActivitySection } from "../../../src/viewer/views/live-tracker.js";
import type { NavigateTo } from "../../../src/viewer/types.js";
import {
  activityRows,
  asTrackerActivity,
  resultLabel,
  trackerConnectionLabel,
} from "../../../src/viewer/views/live-tracker-model.js";

const SNAPSHOT = {
  generatedAt: new Date().toISOString(),
  runs: [], jobs: [],
  queue: { next: [], starting: [] },
  machine: {
    slots: { scope: "repository", inUse: 0, max: 3, available: 3, queued: 0 },
    memory: { freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, pressure: "normal", floorBytes: 2 * 1024 ** 3, belowFloor: false },
    llm: { vendor: "claude", model: "sonnet" },
    worktrees: { total: 1, withLiveRun: 0 },
    spend: { todayUsd: 0, todayTokens: 0, inFlightUsd: 0, inFlightTokens: 0 },
  },
  recent: [],
  counts: { running: 0, stale: 0, jobs: 0 },
};

const AT = "2026-11-05T12:00:00.000Z";
const CARD_ID = "ndx:ndx:rex-2:change-captured";
const entry = (over: Record<string, unknown>) => ({
  at: AT, event: "run-started", rexId: "rex-1", rule: "move", mode: "on",
  requestId: "ndx:ndx:rex-1:run-started", call: { tool: "move_work_item", args: { workItemId: "WM-1" } }, result: "ok", ...over,
});
const WOULD = entry({ result: "would", mode: "dry-run" });
const REFUSED = entry({
  event: "pr-merged", requestId: "ndx:ndx:rex-1:pr-merged", result: "refused",
  problems: [{ field: "toStatus", message: "not a status of this board" }],
});
const CARD = entry({
  event: "change-captured", rexId: "rex-2", rule: "create", requestId: CARD_ID, result: "card",
  call: { tool: "create_work_item", args: { title: "Sidecar tracker sync", requestId: CARD_ID } },
  problems: [{ message: "missing epicId" }],
});
const FORM = {
  externalCall: {
    label: "CAOS",
    host: "caos.example",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, requestId: { type: "string" } },
    },
  },
};
const CONNECTED = { id: "caos", label: "CAOS", state: "connected" };

describe("Live Tracker activity", () => {
  let root: HTMLDivElement;
  let calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
  let activity: { entries: unknown[]; cards: string[]; connection: unknown } | null;
  let navigateTo: ReturnType<typeof vi.fn<NavigateTo>>;
  let decided: unknown = {};

  function stub(sidecar = true): void {
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      calls.push({ url: path, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
      let body: unknown = {};
      if (path.startsWith("/api/features")) body = { toggles: [{ key: "web.sidecar", enabled: sidecar }] };
      else if (path.includes("/api/live")) body = SNAPSHOT;
      else if (path.startsWith("/api/tracker/activity")) body = activity ?? { entries: [], cards: [], connection: null };
      else if (path.startsWith("/api/tracker/cards/form")) body = FORM;
      else if (path.startsWith("/api/tracker/cards/decide")) {
        // The card closes once decided.
        if (activity) activity = { ...activity, cards: [] };
        body = { entry: decided };
      }
      return { ok: true, status: 200, json: async () => body };
    }));
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }

  async function mount(): Promise<void> {
    navigateTo = vi.fn<NavigateTo>();
    act(() => { render(h(LiveView, { navigateTo, analyzedAt: null, jobs: { refresh: vi.fn(async () => {}), operations: [] } as never }), root); });
    await settle();
  }

  const section = () => root.querySelector(".live-tracker");
  const rows = () => [...root.querySelectorAll<HTMLElement>(".live-tracker-row")];
  const click = async (el: Element | null) => {
    act(() => { (el as HTMLElement).click(); });
    await settle();
  };
  const decisions = () => calls.filter((c) => c.url.startsWith("/api/tracker/cards/decide"));

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    calls = [];
    decided = {};
    activity = { entries: [WOULD, REFUSED, CARD], cards: [CARD_ID], connection: CONNECTED };
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("lists each entry newest first with its item, event, call and result, a dry-run would and a refusal's problems among them", async () => {
    stub();
    await mount();
    expect(rows().map((r) => r.getAttribute("data-result"))).toEqual(["card", "refused", "would"]);
    const [card, refused, would] = rows();
    expect(would.textContent).toContain("rex-1");
    expect(would.textContent).toContain("run started");
    expect(would.textContent).toContain("move_work_item");
    expect(would.textContent).toContain("would call (dry run)");
    expect(refused.textContent).toContain("refused");
    expect(refused.textContent).toContain("toStatus");
    expect(refused.textContent).toContain("not a status of this board");
    expect(card.textContent).toContain("needs a decision");
    expect(card.textContent).toContain("missing epicId");
    expect(section()!.textContent).toContain("CAOS · connected");
  });

  it("offers Approve and Dismiss on a waiting card only", async () => {
    stub();
    await mount();
    const [card, refused, would] = rows();
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Approve", "Dismiss"]);
    expect(refused.querySelector("button")).toBeNull();
    expect(would.querySelector("button")).toBeNull();
  });

  it("approves a card with the operator's edits: one decision, carrying the edited arguments", async () => {
    stub();
    await mount();
    await click(root.querySelector('[data-action="approve"]'));
    expect(calls.some((c) => c.url === `/api/tracker/cards/form?requestId=${encodeURIComponent(CARD_ID)}`)).toBe(true);

    const title = root.querySelector<HTMLInputElement>('input[data-field="title"]')!;
    expect(title.value).toBe("Sidecar tracker sync");
    act(() => {
      title.value = "Edited title";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(root.querySelector('[data-action="send"]'));

    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ method: "POST", body: { requestId: CARD_ID, action: "approve", args: { title: "Edited title" } } });
    // The card is closed and the list read again: no Approve left.
    expect(root.querySelector('[data-action="approve"]')).toBeNull();
    expect(root.querySelector(".live-tracker-form")).toBeNull();
  });

  it("refreshes the row when a refused approval closed the card: no Approve to answer 409, and the problem stays", async () => {
    stub();
    decided = { result: "refused", problems: [{ message: "epicId is not on this board" }] };
    await mount();
    const reads = () => calls.filter((c) => c.url.startsWith("/api/tracker/activity")).length;
    const before = reads();
    await click(root.querySelector('[data-action="approve"]'));
    await click(root.querySelector('[data-action="send"]'));
    expect(decisions()).toHaveLength(1);
    expect(reads()).toBeGreaterThan(before);
    expect(root.querySelector('[data-action="approve"]')).toBeNull();
    expect(root.querySelector(".live-tracker-form")).toBeNull();
    expect(root.querySelector(".live-error")?.textContent).toContain("epicId is not on this board");
  });

  it("keeps an open card form and its edits when a new entry arrives above it", async () => {
    stub();
    navigateTo = vi.fn<NavigateTo>();
    const draw = (refreshKey: string) => act(() => { render(h(TrackerActivitySection, { refreshKey, navigateTo }), root); });
    draw("1");
    await settle();
    await click(root.querySelector('[data-action="approve"]'));
    const title = root.querySelector<HTMLInputElement>('input[data-field="title"]')!;
    act(() => {
      title.value = "Edited title";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });

    activity = { ...activity!, entries: [...activity!.entries, entry({ rexId: "rex-9", requestId: "ndx:ndx:rex-9:run-started", at: "2026-11-05T12:05:00.000Z" })] };
    draw("2");
    await settle();
    expect(rows()[0].textContent).toContain("rex-9");
    expect(root.querySelector<HTMLInputElement>('input[data-field="title"]')?.value).toBe("Edited title");
  });

  it("dismisses a card without a form", async () => {
    stub();
    await mount();
    await click(root.querySelector('[data-action="dismiss"]'));
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0].body).toEqual({ requestId: CARD_ID, action: "dismiss" });
    expect(calls.some((c) => c.url.startsWith("/api/tracker/cards/form"))).toBe(false);
    expect(root.querySelector('[data-action="dismiss"]')).toBeNull();
  });

  it("shows 'sign in again' with a link to Settings > Connections for a connection whose sign-in was revoked", async () => {
    activity = {
      entries: [entry({ result: "needs-sign-in", problems: [{ message: "refresh token revoked" }] })],
      cards: [],
      connection: { id: "caos", label: "CAOS", state: "needs-sign-in", signIn: "again", reason: "refresh token revoked" },
    };
    stub();
    await mount();
    expect(section()!.querySelector(".live-tracker-state")!.textContent).toBe("sign in again");
    expect(rows()[0].textContent).toContain("sign in again");
    await click(root.querySelector(".live-tracker-signin"));
    expect(navigateTo).toHaveBeenCalledWith("project");
  });

  it("shows no section, and reads no log, with web.sidecar off", async () => {
    stub(false);
    await mount();
    expect(section()).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/tracker"))).toBe(false);
  });

  it("shows no section when no trackerSync connection is configured", async () => {
    activity = null;
    stub();
    await mount();
    expect(section()).toBeNull();
  });
});

describe("tracker activity model", () => {
  it("reads only an answer that names a connection", () => {
    expect(asTrackerActivity({ entries: [], cards: [], connection: null })).toBeNull();
    expect(asTrackerActivity({})).toBeNull();
    expect(asTrackerActivity({ entries: [WOULD, { junk: true }], cards: [CARD_ID], connection: CONNECTED })).toMatchObject({ cards: [CARD_ID], entries: [{ result: "would" }] });
  });

  it("waits only on a card's latest entry, and only while the server says it waits", () => {
    const first = entry({ result: "card", requestId: CARD_ID, at: "2026-11-05T11:00:00.000Z" });
    const rows = activityRows({ entries: [first, CARD] as never, cards: [CARD_ID], connection: CONNECTED as never });
    expect(rows.map((r) => r.waiting)).toEqual([true, false]);
    expect(activityRows({ entries: [CARD] as never, cards: [], connection: CONNECTED as never })[0].waiting).toBe(false);
  });

  it("words results and connection states as Settings does", () => {
    expect(resultLabel("needs-sign-in")).toBe("sign in again");
    expect(trackerConnectionLabel({ id: "c", label: "C", state: "needs-sign-in", signIn: "first" })).toBe("sign in");
    expect(trackerConnectionLabel({ id: "c", label: "C", state: "unavailable", reason: "down" })).toBe("connection unavailable: down");
  });
});
