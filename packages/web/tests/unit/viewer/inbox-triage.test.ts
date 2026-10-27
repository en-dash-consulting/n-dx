// @vitest-environment jsdom
/**
 * The Inbox's own page: the queue beside the selected change's placement,
 * Place & next, Skip, the visit count and the keyboard shortcuts.
 *
 * @see src/viewer/views/inbox-triage.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { InboxTriagePage, isTypingTarget, shortcutFor } from "../../../src/viewer/views/inbox-triage.js";
import { renderActiveView } from "../../../src/viewer/views/view-registry.js";
import { takeTitleFocus } from "../../../src/viewer/components/prd-tree/change-placement.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ChangePlacement, ChangeRow, PlacementCandidate, ProductMap } from "../../../src/viewer/views/product-model.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

function change(id: string, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id, title: `Change ${id}`, stage: "proposed", awaitsPlacement: true, needsPlacement: true,
    amends: [], touches: [], taskCount: 2, completedTaskCount: 0, ...extra,
  };
}

function candidate(target: string, extra: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return {
    target, type: "capability", title: `Home ${target}`, area: "Checkout",
    criteria: [], score: 5, strength: "strong", reasons: [], ...extra,
  };
}

function placement(id: string, shortlist: PlacementCandidate[], tags?: string[]): ChangePlacement {
  return {
    layout: "v2",
    change: { id, title: `Change ${id}`, status: "pending", taskCount: 2, ...(tags ? { tags } : {}) },
    relation: "touches",
    tied: false,
    shortlist,
  };
}

const MAP: ProductMap = {
  areas: [{ id: "area-pay", title: "Payments", capabilities: [
    { id: "cap-refund", title: "Refunds", status: "met", health: "ok", criteriaCount: 0, openChanges: [] },
  ] }],
  constraints: [],
};

// ── Harness ──────────────────────────────────────────────────────────

let root: HTMLDivElement;
let changes: ChangeRow[];
let shortlists: ChangePlacement[];
let posts: Array<{ url: string; body: Record<string, unknown> }>;

/** Serve the Inbox; a successful place takes the change out of it. */
function serve(next: ChangeRow[], lists: ChangePlacement[]): void {
  changes = next;
  shortlists = lists;
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      const id = decodeURIComponent(url.split("/")[4]);
      changes = changes.map((c) => (c.id === id ? { ...c, awaitsPlacement: undefined, needsPlacement: false } : c));
      return json({ change: id, target: body.target, relation: body.relation });
    }
    if (url === "/api/project") return json({ cliName: "ndx" });
    if (url === "/api/rex/changes") return json({ layout: "v2", changes });
    if (url === "/api/rex/product") return json({ layout: "v2", map: MAP });
    if (url === "/api/rex/changes/placements") {
      return json({ layout: "v2", placements: Object.fromEntries(shortlists.map((p) => [p.change.id, p])) });
    }
    return json({ error: "not found" }, 404);
  }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
const queue = () => $$(".inbox-qitem").map((el) => el.dataset.changeId);
const selectedId = () => $(".inbox-qitem.is-selected")?.dataset.changeId;
const counts = () => $(".inbox-crumb-counts")?.textContent;

async function mountPage(navigateTo = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
  await act(async () => { render(h(InboxTriagePage, { navigateTo }), root); });
  await settle();
  return navigateTo;
}

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("element missing");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

/** A key press on `target` (the body unless given), as the browser sends it. */
async function key(k: string, target: Element = document.body): Promise<void> {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
  await settle();
}

const checked = () => $<HTMLInputElement>(".cp-target input:checked")?.value;
const relation = () => $<HTMLInputElement>(".cp-relation input:checked")?.value;

/** Three changes; strongest first gives the queue c, a, b. */
function serveThree(): void {
  serve([change("a"), change("b", { taskCount: 1 }), change("c")], [
    placement("a", [candidate("cap-a1", { strength: "possible", score: 3 }), candidate("cap-a2", { strength: "weak", score: 1 })], ["deferred"]),
    placement("b", [candidate("cap-b", { strength: "weak", score: 1 })]),
    placement("c", [candidate("cap-c1", { score: 9 }), candidate("cap-c2", { score: 4, strength: "possible" })]),
  ]);
}

beforeEach(() => {
  for (const id of ["a", "b", "c"]) takeTitleFocus(id);
  clearProjectMetadataCache();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

// ── Shortcut table ───────────────────────────────────────────────────

describe("shortcutFor", () => {
  const press = (k: string, target: EventTarget = document.body, mods: Partial<KeyboardEvent> = {}) =>
    shortcutFor({ key: k, target, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it("maps each key to its action, letters in either case", () => {
    expect(press("j")).toEqual({ kind: "move", delta: 1 });
    expect(press("K")).toEqual({ kind: "move", delta: -1 });
    expect(press("3")).toEqual({ kind: "pick", n: 3 });
    expect(press("6")).toBeNull();
    expect(press("t")).toEqual({ kind: "relation", relation: "touches" });
    expect(press("a")).toEqual({ kind: "relation", relation: "amends" });
    expect(press("Enter")).toEqual({ kind: "place" });
    expect(press("s")).toEqual({ kind: "skip" });
    expect(press("n")).toEqual({ kind: "nothing-fits" });
    expect(press("/")).toEqual({ kind: "search" });
    expect(press("x")).toBeNull();
  });

  it("is inactive in a text field and with a modifier, live on a radio, and leaves Enter to a focused button", () => {
    const text = document.createElement("input");
    const area = document.createElement("textarea");
    const radio = Object.assign(document.createElement("input"), { type: "radio" });
    const btn = document.createElement("button");
    expect(isTypingTarget(text)).toBe(true);
    expect(press("j", text)).toBeNull();
    expect(press("j", area)).toBeNull();
    expect(press("j", radio)).toEqual({ kind: "move", delta: 1 });
    expect(press("j", document.body, { metaKey: true })).toBeNull();
    expect(press("Enter", btn)).toBeNull();
    expect(press("s", btn)).toEqual({ kind: "skip" });
  });
});

// ── The page ─────────────────────────────────────────────────────────

describe("the Inbox page", () => {
  it("is the routed inbox view; the Plan section keeps the short list", () => {
    const page = renderActiveView("inbox", { navigateTo: vi.fn() } as never);
    const section = renderActiveView("inbox", { navigateTo: vi.fn(), inSection: true } as never);
    expect((page as { type: unknown }).type).toBe(InboxTriagePage);
    expect((section as { type: unknown }).type).not.toBe(InboxTriagePage);
  });

  it("lists the queue in the section's order with strength, task count and tags, and selects the first", async () => {
    serveThree();
    await mountPage();
    expect(queue()).toEqual(["c", "a", "b"]);
    const a = $('.inbox-qitem[data-change-id="a"]')!;
    expect(a.querySelector(".inbox-strength")?.textContent).toBe("possible");
    expect(a.querySelector(".inbox-qitem-tasks")?.textContent).toBe("2 tasks");
    expect(a.querySelector(".inbox-tag")?.textContent).toBe("deferred");
    expect($('.inbox-qitem[data-change-id="b"] .inbox-qitem-tasks')?.textContent).toBe("1 task");

    expect(selectedId()).toBe("c");
    expect($(".inbox-detail-title")?.textContent).toBe("Change c");
    expect($$(".inbox-detail .cp-target").map((el) => el.dataset.target)).toEqual(["cap-c1", "cap-c2"]);
    expect(counts()).toBe(" · 3 to place · 0 placed this visit");
    expect($(".inbox-keys")?.textContent).toContain("place & next");
  });

  it("selects a change by clicking it, and the breadcrumb returns to Plan", async () => {
    serveThree();
    const navigateTo = await mountPage();
    await click($('.inbox-qitem[data-change-id="b"]'));
    expect(selectedId()).toBe("b");
    expect($(".inbox-detail-title")?.textContent).toBe("Change b");
    await click($$("button").find((b) => b.textContent === "Plan")!);
    expect(navigateTo).toHaveBeenCalledWith("plan");
  });

  it("Place & next places the selected change, selects the next and counts it", async () => {
    serveThree();
    await mountPage();
    await click($('.cp-target[data-target="cap-c1"] input'));
    await click($(".cp-place-next"));

    expect(posts).toEqual([{ url: "/api/rex/changes/c/place", body: { target: "cap-c1", relation: "touches" } }]);
    expect(selectedId()).toBe("a");
    expect(queue()).toEqual(["a", "b"]);
    expect(counts()).toBe(" · 2 to place · 1 placed this visit");
    // The page keeps focus on the queue rather than leaving a title request pending.
    expect(takeTitleFocus("a")).toBe(false);
    expect(document.activeElement).toBe($(".inbox-queue-list"));
  });

  it("Skip leaves the change in the Inbox and moves on, wrapping at the end", async () => {
    serveThree();
    await mountPage();
    await click($(".inbox-skip"));
    expect(selectedId()).toBe("a");
    await key("s");
    expect(selectedId()).toBe("b");
    await key("s");
    expect(selectedId()).toBe("c");
    expect(posts).toEqual([]);
    expect(queue()).toEqual(["c", "a", "b"]);
    expect(counts()).toBe(" · 3 to place · 0 placed this visit");
  });

  it("shows the empty state when nothing waits", async () => {
    serve([change("x", { awaitsPlacement: undefined })], []);
    await mountPage();
    expect($(".inbox-empty")?.textContent).toBe("Inbox is empty");
    expect(counts()).toBe(" · 0 to place · 0 placed this visit");
  });
});

describe("the page's keyboard", () => {
  it("J and K move the selection and wrap", async () => {
    serveThree();
    await mountPage();
    await key("j");
    expect(selectedId()).toBe("a");
    await key("J");
    expect(selectedId()).toBe("b");
    await key("j");
    expect(selectedId()).toBe("c");
    await key("k");
    expect(selectedId()).toBe("b");
  });

  it("the arrows move the selection on the focused queue, and only there", async () => {
    serveThree();
    await mountPage();
    const list = $(".inbox-queue-list")!;
    await key("ArrowDown", list);
    expect(selectedId()).toBe("a");
    await key("ArrowUp", list);
    expect(selectedId()).toBe("c");
    await key("ArrowDown");
    expect(selectedId()).toBe("c");
  });

  it("1–5 pick a candidate, T and A set the relation", async () => {
    serveThree();
    await mountPage();
    await key("2");
    expect(checked()).toBe("cap-c2");
    await key("1");
    expect(checked()).toBe("cap-c1");
    await key("5");
    expect(checked()).toBe("cap-c1");
    await key("a");
    expect(relation()).toBe("amends");
    expect($(".cp-amends")).not.toBeNull();
    await key("t");
    expect(relation()).toBe("touches");
    expect($(".cp-amends")).toBeNull();
  });

  it("Enter places and moves on; with no pick it does nothing", async () => {
    serveThree();
    await mountPage();
    await key("Enter");
    expect(posts).toEqual([]);
    await key("1");
    await key("Enter");
    expect(posts.map((p) => p.url)).toEqual(["/api/rex/changes/c/place"]);
    expect(selectedId()).toBe("a");
    expect(counts()).toBe(" · 2 to place · 1 placed this visit");
  });

  it("Enter places the last change too, where there is no next", async () => {
    serve([change("a")], [placement("a", [candidate("cap-a")])]);
    await mountPage();
    expect($(".cp-place-next")).toBeNull();
    await key("1");
    await key("Enter");
    expect(posts.map((p) => p.url)).toEqual(["/api/rex/changes/a/place"]);
    expect(counts()).toBe(" · 0 to place · 1 placed this visit");
  });

  it("N opens Nothing fits, and / focuses the search", async () => {
    serveThree();
    await mountPage();
    await key("/");
    expect(document.activeElement).toBe($(".cp-search-input"));
    // Typing in the search is text, not shortcuts.
    await key("n", $(".cp-search-input")!);
    await key("j", $(".cp-search-input")!);
    expect($(".cp-propose")).toBeNull();
    expect(selectedId()).toBe("c");
    (document.activeElement as HTMLElement).blur();
    await key("n");
    expect($(".cp-propose")).not.toBeNull();
  });

  it("no shortcut fires while a text field has focus", async () => {
    serveThree();
    await mountPage();
    await key("1");
    await key("a");
    const summary = $<HTMLInputElement>(".cp-amends input[type=text]")!;
    for (const k of ["j", "k", "2", "t", "s", "n", "/", "Enter"]) await key(k, summary);
    expect(selectedId()).toBe("c");
    expect(checked()).toBe("cap-c1");
    expect(relation()).toBe("amends");
    expect($(".cp-propose")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("stands down while a dialog is open", async () => {
    serveThree();
    await mountPage();
    const dialog = Object.assign(document.createElement("div"), {});
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    try {
      await key("j");
      expect(selectedId()).toBe("c");
    } finally {
      dialog.remove();
    }
  });
});
