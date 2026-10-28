// @vitest-environment jsdom
/**
 * The Inbox: open changes awaiting placement, strongest guess first, on the
 * Plan page right after the capture bar.
 *
 * @see src/viewer/views/inbox.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { InboxPage, sortInbox, type InboxRow } from "../../../src/viewer/views/inbox.js";
import { StagePage } from "../../../src/viewer/views/stage-pages.js";
import { STAGES, viewBlurb, viewLabel } from "../../../src/viewer/views/index.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ChangePlacement, ChangeRow, PlacementStrength } from "../../../src/viewer/views/product-model.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

function change(id: string, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id, title: `Change ${id}`, stage: "proposed", awaitsPlacement: true, needsPlacement: true,
    amends: [], touches: [], taskCount: 1, completedTaskCount: 0, ...extra,
  };
}

/** A shortlist whose best candidate has `strength`; `tied` marks a shared top score. */
function placement(id: string, strength: PlacementStrength | null, opts: { tied?: boolean; score?: number; tags?: string[] } = {}): ChangePlacement {
  return {
    layout: "v2",
    change: { id, title: `Change ${id}`, status: "pending", taskCount: 1, tags: opts.tags },
    relation: "touches",
    tied: opts.tied ?? false,
    shortlist: strength === null ? [] : [{
      target: `cap-${id}`, type: "capability", title: `Home for ${id}`, area: "Checkout",
      criteria: [], score: opts.score ?? 1, strength, reasons: [],
    }],
  };
}

function status(inbox?: { open: number; appliedUnplaced: number }) {
  return {
    initialized: true,
    sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
    rex: {
      exists: true, percentComplete: 0, stats: { total: 1, completed: 0, inProgress: 0, pending: 1, deferred: 0, blocked: 0 },
      hasInProgress: false, hasPending: true, nextTaskTitle: null, ...(inbox ? { inbox } : {}),
    },
    hench: { configured: true, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
  };
}

// ── Harness ──────────────────────────────────────────────────────────

let root: HTMLDivElement;
let routes: Record<string, unknown>;

function stub(next: Record<string, unknown>): void {
  routes = next;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = routes[url];
    return new Response(JSON.stringify(body ?? { error: "not found" }), {
      status: body === undefined ? 404 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

/** Serve `changes` and each listed shortlist, with the status counts. */
function serveInbox(changes: ChangeRow[], shortlists: ChangePlacement[], inbox = { open: changes.length, appliedUnplaced: 0 }): void {
  stub({
    "/api/rex/changes": { layout: "v2", changes },
    "/api/status": status(inbox),
    "/api/rex/changes/placements": { layout: "v2", placements: Object.fromEntries(shortlists.map((p) => [p.change.id, p])) },
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

async function mount(vnode: VNode): Promise<void> {
  await act(async () => { render(vnode, root); });
  await settle();
}

const rowIds = () => [...root.querySelectorAll<HTMLElement>(".inbox-row")].map((r) => r.dataset.changeId);

beforeEach(() => {
  // `/api/project` is cached per module; each case reads its own.
  clearProjectMetadataCache();
  localStorage.clear();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

// ── Placement on Plan ────────────────────────────────────────────────

describe("the Plan section", () => {
  it("sits after the capture bar and before Tasks, server-backed, with the Inbox badge", () => {
    const views = STAGES.plan.sections.map((s) => s.view);
    expect(views.slice(0, 3)).toEqual(["analysis", "inbox", "prd"]);
    expect(STAGES.plan.sections[1]).toEqual({ view: "inbox", requiresServer: true, badge: "inbox", openWhenNonEmpty: true });
    expect(buildValidViews("rex").has("inbox")).toBe(true);
    expect(viewLabel("inbox")).toBe("Inbox");
    expect(viewBlurb("inbox")).toBe("Changes with no place on the product map yet. {cli} work skips their tasks until each is placed.");
  });

  it("shows the open Inbox count and its blurb, with the CLI name, in its header while collapsed", async () => {
    serveInbox([], [], { open: 19, appliedUnplaced: 156 });
    routes["/api/project"] = { cliName: "ndx" };
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "plan:inbox": false }));
    await mount(h(StagePage, {
      stage: "plan", validViews: buildValidViews(null), navigateTo: vi.fn(),
      renderView: (view) => h("div", { "data-rendered": view }),
    }));
    const section = root.querySelector<HTMLElement>('.stage-section[data-view="inbox"]')!;
    expect(section.querySelector(".stage-section-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(section.querySelector<HTMLElement>(".stage-section-badge")?.dataset.count).toBe("19");
    expect(section.querySelector(".stage-section-blurb")?.textContent).toContain("ndx work skips their tasks");
    expect(section.previousElementSibling?.getAttribute("data-view")).toBe("analysis");
    expect(section.nextElementSibling?.getAttribute("data-view")).toBe("prd");
  });
});

// ── Ordering ─────────────────────────────────────────────────────────

describe("sortInbox", () => {
  const row = (id: string, p: ChangePlacement | null): InboxRow =>
    ({ change: change(id), shortlist: p ? { placement: p } : undefined });

  it("orders strong, possible, tied, weak, then rows with no guess", () => {
    const rows = [
      row("weak", placement("weak", "weak")),
      row("none", placement("none", null)),
      row("loading", null),
      row("tied", placement("tied", "strong", { tied: true })),
      row("possible", placement("possible", "possible")),
      row("strong", placement("strong", "strong")),
    ];
    expect(sortInbox(rows).map((r) => r.change.id)).toEqual(["strong", "possible", "tied", "weak", "none", "loading"]);
  });

  it("breaks a strength tie by score, then keeps the read's order", () => {
    const rows = [
      row("a", placement("a", "possible", { score: 2 })),
      row("b", placement("b", "possible", { score: 5 })),
      row("c", placement("c", "possible", { score: 2 })),
    ];
    expect(sortInbox(rows).map((r) => r.change.id)).toEqual(["b", "a", "c"]);
  });
});

// ── The page ─────────────────────────────────────────────────────────

describe("InboxPage on a v2 project", () => {
  it("lists only changes awaiting placement, strongest guess first, with guess and strength", async () => {
    serveInbox(
      [change("w", { priority: "high", displayId: "CH-1" }), change("placed", { awaitsPlacement: undefined }), change("s")],
      [placement("w", "weak", { tags: ["web"] }), placement("s", "strong")],
    );
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(rowIds()).toEqual(["s", "w"]);
    const first = root.querySelector(".inbox-row")!;
    expect(first.querySelector(".inbox-guess-title")?.textContent).toBe("Home for s");
    expect(first.querySelector(".inbox-strength")?.textContent).toBe("strong");
    expect(first.querySelector(".inbox-strength-dot")).not.toBeNull();
    const second = root.querySelectorAll(".inbox-row")[1]!;
    expect(second.querySelector(".ch-display-id")?.textContent).toBe("CH-1");
    expect(second.querySelector(".ch-priority")?.textContent).toBe("high");
    expect(second.querySelector(".inbox-tag")?.textContent).toBe("web");
    expect(second.querySelector(".inbox-strength")?.textContent).toBe("weak");
  });

  it("shows five rows in a section, and opens the rest on the Inbox page", async () => {
    const changes = ["a", "b", "c", "d", "e", "f", "g"].map((id) => change(id));
    serveInbox(changes, changes.map((c) => placement(c.id, "possible")));
    const navigateTo = vi.fn();
    await mount(h(InboxPage, { navigateTo, limit: 5 }));
    expect(rowIds()).toHaveLength(5);
    const more = root.querySelector<HTMLButtonElement>(".inbox-more")!;
    expect(more.textContent).toBe("2 more · Open ↗");
    act(() => { more.click(); });
    expect(navigateTo).toHaveBeenCalledWith("inbox");
  });

  it("shows every row on its own page", async () => {
    const changes = ["a", "b", "c", "d", "e", "f", "g"].map((id) => change(id));
    serveInbox(changes, []);
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(rowIds()).toHaveLength(7);
    expect(root.querySelector(".inbox-more")).toBeNull();
  });

  it("a row, or its Place button, opens the change's detail panel in Tasks", async () => {
    serveInbox([change("x")], [placement("x", "strong")]);
    const navigateTo = vi.fn();
    await mount(h(InboxPage, { navigateTo }));
    act(() => { root.querySelector<HTMLElement>(".inbox-row")!.click(); });
    act(() => { root.querySelector<HTMLButtonElement>(".inbox-place")!.click(); });
    expect(navigateTo.mock.calls).toEqual([["prd", { taskId: "x" }], ["prd", { taskId: "x" }]]);
  });

  it("names a shortlist that failed to load instead of a guess", async () => {
    serveInbox([change("x")], []);
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(root.querySelector(".inbox-guess-error")?.textContent).toContain("No shortlist");
  });

  it("reads every shortlist in one request, however many rows", async () => {
    const changes = Array.from({ length: 12 }, (_, i) => change(`c${i}`));
    serveInbox(changes, changes.map((c) => placement(c.id, "possible")));
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes("placement"))).toEqual(["/api/rex/changes/placements"]);
    expect(rowIds()).toHaveLength(12);
  });

  it("says 'Inbox is empty' at zero", async () => {
    serveInbox([change("placed", { awaitsPlacement: undefined })], []);
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(root.querySelector(".inbox-empty")?.textContent).toBe("Inbox is empty");
    expect(rowIds()).toEqual([]);
  });

  it("shows applied-but-unplaced history as a collapsed count until its list is read", async () => {
    serveInbox([], [], { open: 0, appliedUnplaced: 156 });
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    const applied = root.querySelector<HTMLDetailsElement>(".inbox-applied")!;
    expect(applied.open).toBe(false);
    expect(applied.querySelector("summary")?.textContent).toBe("156 applied changes were never placed");
    expect(applied.querySelector("button, a")).toBeNull();
  });
});

describe("applied changes never placed", () => {
  const applied = (id: string, appliedAt: string) =>
    change(id, { awaitsPlacement: undefined, stage: "applied", appliedAt });

  it("expand to a list with title, applied date, best guess and strength, strongest first", async () => {
    const changes = [
      change("open1"),
      applied("old", "2026-03-04T10:00:00.000Z"),
      applied("new", "2026-09-30T08:00:00.000Z"),
    ];
    serveInbox(changes, [placement("open1", "weak"), placement("old", "possible"), placement("new", "strong")],
      { open: 1, appliedUnplaced: 2 });
    await mount(h(InboxPage, { navigateTo: vi.fn() }));

    const section = root.querySelector<HTMLDetailsElement>(".inbox-applied")!;
    expect(section.open).toBe(false);
    expect(section.querySelector("summary")?.textContent).toBe("2 applied changes were never placed");
    const rows = [...section.querySelectorAll<HTMLElement>(".inbox-applied-row")];
    expect(rows.map((r) => r.dataset.changeId)).toEqual(["new", "old"]);
    expect(rows[0].querySelector(".inbox-row-title")?.textContent).toBe("Change new");
    expect(rows[0].querySelector(".inbox-applied-at")?.textContent).toBe("applied 2026-09-30");
    expect(rows[0].querySelector(".inbox-guess-title")?.textContent).toBe("Home for new");
    expect(rows[0].querySelector<HTMLElement>(".inbox-strength")?.dataset.strength).toBe("strong");
    expect(rows[1].querySelector<HTMLElement>(".inbox-strength")?.dataset.strength).toBe("possible");
    // The open Inbox lists only the open change.
    expect(rowIds().filter((id) => id === "open1")).toEqual(["open1"]);
    expect(root.querySelectorAll(".inbox-list:not(.inbox-applied-list) > .inbox-row")).toHaveLength(1);
  });

  it("open the change's detail panel when clicked", async () => {
    const navigateTo = vi.fn();
    serveInbox([applied("old", "2026-03-04T10:00:00.000Z")], [placement("old", "strong")], { open: 0, appliedUnplaced: 1 });
    await mount(h(InboxPage, { navigateTo }));
    await act(async () => { root.querySelector<HTMLElement>(".inbox-applied-row")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "old" });
  });

  it("leave the list once placed, and the count drops", async () => {
    serveInbox([applied("old", "2026-03-04T10:00:00.000Z")], [placement("old", "strong")], { open: 0, appliedUnplaced: 1 });
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(root.querySelectorAll(".inbox-applied-row")).toHaveLength(1);

    serveInbox([change("old", { awaitsPlacement: undefined, needsPlacement: undefined, stage: "applied", appliedAt: "2026-03-04T10:00:00.000Z" })],
      [], { open: 0, appliedUnplaced: 0 });
    await act(async () => { render(null, root); });
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(root.querySelector(".inbox-applied")).toBeNull();
  });
});

describe("InboxPage on a v1 project", () => {
  it("renders nothing", async () => {
    stub({ "/api/rex/changes": { layout: "v1" }, "/api/status": status() });
    await mount(h(InboxPage, { navigateTo: vi.fn() }));
    expect(root.innerHTML).toBe("");
  });
});
