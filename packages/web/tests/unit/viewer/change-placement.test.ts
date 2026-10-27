// @vitest-environment jsdom
/**
 * "Where it goes": the placement section at the top of an Inbox change's
 * detail panel — its note, shortlist, search, relation and actions, the
 * writes through `/place` and `/propose`, and every refusal kind.
 *
 * @see src/viewer/components/prd-tree/change-placement.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import {
  ChangePlacementSection,
  REFUSAL_HINTS,
  criteriaDelta,
  inboxPosition,
  nextCriterionId,
  placedLine,
  takeTitleFocus,
} from "../../../src/viewer/components/prd-tree/change-placement.js";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type {
  ChangePlacement,
  ChangeRow,
  PlacementCandidate,
  PlacementRefusalKind,
  ProductMap,
} from "../../../src/viewer/views/product-model.js";

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

function candidate(target: string, extra: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return {
    target, type: "capability", title: `Home ${target}`, area: "Checkout",
    criteria: [], score: 5, strength: "strong", reasons: ["words: gift, card"], ...extra,
  };
}

function placement(id: string, shortlist: PlacementCandidate[], opts: { tied?: boolean; relation?: "touches" | "amends" } = {}): ChangePlacement {
  return {
    layout: "v2",
    change: { id, title: `Change ${id}`, status: "pending", taskCount: 1 },
    relation: opts.relation ?? "touches",
    tied: opts.tied ?? false,
    shortlist,
  };
}

const MAP: ProductMap = {
  areas: [
    { id: "area-pay", title: "Payments", capabilities: [
      { id: "cap-refund", title: "Refunds", statement: "Refund an order", status: "met", health: "ok", criteriaCount: 1, openChanges: [] },
      { id: "cap-gift", title: "Gift cards", status: "met", health: "ok", criteriaCount: 0, openChanges: [] },
    ] },
    { id: "area-ship", title: "Shipping", capabilities: [
      { id: "cap-label", title: "Shipping labels", status: "met", health: "ok", criteriaCount: 0, openChanges: [] },
    ] },
  ],
  constraints: [{ id: "con-pci", title: "PCI scope", health: "ok", appliesTo: "all" }],
};

// ── Harness ──────────────────────────────────────────────────────────

interface Post { url: string; body: Record<string, unknown> }

let root: HTMLDivElement;
let routes: Record<string, unknown>;
let answers: Record<string, { status: number; body: unknown }>;
let posts: Post[];

function serve(changes: ChangeRow[], shortlists: ChangePlacement[], extra: Record<string, unknown> = {}): void {
  routes = {
    "/api/project": { cliName: "ndx" },
    "/api/rex/changes": { layout: "v2", changes },
    "/api/rex/product": { layout: "v2", map: MAP },
    ...Object.fromEntries(shortlists.map((p) => [`/api/rex/changes/${p.change.id}/placement`, p])),
    ...extra,
  };
  answers = {};
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      const answer = answers[url] ?? { status: 200, body: { change: "x", target: "t", relation: "touches" } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
    }
    const body = routes[url];
    return new Response(JSON.stringify(body ?? { error: "not found" }), {
      status: body === undefined ? 404 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

/** Answer the next POST to `/api/rex/changes/<id>/<action>`. */
function answer(id: string, action: "place" | "propose", status: number, body: unknown): void {
  answers[`/api/rex/changes/${id}/${action}`] = { status, body };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

async function mount(vnode: VNode): Promise<void> {
  await act(async () => { render(vnode, root); });
  await settle();
}

interface Spies {
  onOpenChange: ReturnType<typeof vi.fn>;
  onWritten: ReturnType<typeof vi.fn>;
  onInboxState: ReturnType<typeof vi.fn>;
}

async function mountSection(changeId: string): Promise<Spies> {
  const spies = { onOpenChange: vi.fn(), onWritten: vi.fn(), onInboxState: vi.fn() };
  await mount(h(ChangePlacementSection, { changeId, changeTitle: `Change ${changeId}`, ...spies }));
  return spies;
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("element missing");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

async function type(el: Element | null, value: string, event = "input"): Promise<void> {
  if (!el) throw new Error("element missing");
  await act(async () => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
  await settle();
}

const pick = (target: string) => click($(`.cp-target[data-target="${target}"] input`));
const button = (label: string) => $$<HTMLButtonElement>("button").find((b) => b.textContent === label) ?? null;

beforeEach(() => {
  // A focus request is module state: no case may start with one pending.
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

// ── Helpers ──────────────────────────────────────────────────────────

describe("placement helpers", () => {
  it("criteriaDelta names added, replaced and removed criteria, and nothing when untouched", () => {
    expect(criteriaDelta([{ id: "c1", text: "a", original: "a" }])).toBeUndefined();
    expect(criteriaDelta([
      { id: "c1", text: "a2", original: "a" },
      { id: "c2", text: "b", original: "b", removed: true },
      { id: "c3", text: "c" },
    ])).toEqual({ add: [{ id: "c3", text: "c" }], replace: [{ id: "c1", text: "a2" }], remove: ["c2"] });
  });

  it("nextCriterionId follows the highest cN id", () => {
    expect(nextCriterionId([])).toBe("c1");
    expect(nextCriterionId(["c2", "c9", "x4"])).toBe("c10");
  });

  it("inboxPosition counts from one, follows the order, and wraps after the last", () => {
    expect(inboxPosition(["a", "b", "c"], "b")).toEqual({ index: 1, total: 3, next: "c" });
    expect(inboxPosition(["a", "b", "c"], "c")).toEqual({ index: 2, total: 3, next: "a" });
    expect(inboxPosition(["a"], "a")).toEqual({ index: 0, total: 1, next: null });
  });

  it("placedLine names each place, or nothing for an unplaced change", () => {
    expect(placedLine(change("a"))).toBeNull();
    expect(placedLine(change("a", { touches: [{ id: "t", title: "Refunds" }] }))).toBe("Placed: touches Refunds");
    expect(placedLine(change("a", { amends: [{ id: "m", title: "Gift cards", delta: "modified" }] }))).toBe("Placed: amends Gift cards");
  });
});

// ── States ───────────────────────────────────────────────────────────

describe("an Inbox change's panel", () => {
  it("shows the note with its Inbox position, the shortlist with strength and area, search, relation and actions", async () => {
    serve([change("a"), change("b")], [
      placement("a", [candidate("cap-1"), candidate("cap-2", { strength: "possible", score: 3, area: "Billing", reasons: [] })]),
      placement("b", [candidate("cap-3", { strength: "weak", score: 1 })]),
    ]);
    const spies = await mountSection("a");

    expect($(".cp-note")?.textContent).toContain("In the Inbox. ndx work skips its tasks until it has a place on the product map.");
    expect($(".cp-position")?.textContent).toBe("1 of 2 · Next ›");
    const rows = $$(".cp-target");
    expect(rows.map((r) => r.dataset.target)).toEqual(["cap-1", "cap-2"]);
    expect(rows[0].querySelector(".cp-target-title")?.textContent).toBe("Home cap-1");
    expect(rows[0].querySelector<HTMLElement>(".inbox-strength")?.dataset.strength).toBe("strong");
    expect(rows[0].querySelector(".cp-target-detail")?.textContent).toBe("Checkout · matched gift, card");
    expect(rows[1].querySelector(".cp-target-detail")?.textContent).toBe("Billing");
    expect($(".cp-search-input")?.getAttribute("aria-label")).toBe("Search capabilities and constraints");
    expect($$<HTMLInputElement>('.cp-relation input[type="radio"]').map((r) => r.value)).toEqual(["touches", "amends"]);
    expect(["Place", "Place & next", "Place & add another", "Nothing fits"].map((l) => button(l) !== null)).toEqual([true, true, true, true]);
    // Nothing is chosen for the person: Place waits for a pick.
    expect(button("Place")?.disabled).toBe(true);
    expect(spies.onInboxState).toHaveBeenLastCalledWith(true);
  });

  it("is a single Placed line for a change that has left the Inbox", async () => {
    serve([change("a", { awaitsPlacement: false, needsPlacement: false, touches: [{ id: "cap-1", title: "Refunds" }] })], []);
    const spies = await mountSection("a");
    expect($('[data-change-placement="placed"]')?.textContent).toBe("Placed: touches Refunds");
    expect($(".cp-note")).toBeNull();
    expect($(".cp-target")).toBeNull();
    expect(spies.onInboxState).toHaveBeenLastCalledWith(false);
  });

  it("renders nothing on a v1 project", async () => {
    serve([], [], { "/api/rex/changes": { layout: "v1" } });
    await mountSection("a");
    expect(root.innerHTML).toBe("");
  });

  it("warns when the top matches are tied", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1"), candidate("cap-2")], { tied: true })]);
    await mountSection("a");
    expect($$(".cp-shortlist-warning").map((w) => w.dataset.warning)).toEqual(["tied"]);
  });

  it("warns when every match is weak", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1", { strength: "weak" }), candidate("cap-2", { strength: "weak" })])]);
    await mountSection("a");
    expect($$(".cp-shortlist-warning").map((w) => w.dataset.warning)).toEqual(["weak"]);
  });

  it("gives no warning for a clear shortlist", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1"), candidate("cap-2", { strength: "weak" })])]);
    await mountSection("a");
    expect($(".cp-shortlist-warning")).toBeNull();
  });

  it("searches every capability and constraint, grouped by area, and a pick joins the list checked", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    await type($(".cp-search-input"), "s");
    const groups = $$(".cp-search-group").map((g) => [
      g.querySelector(".cp-search-area")?.textContent,
      [...g.querySelectorAll(".cp-search-result")].map((b) => b.textContent),
    ]);
    expect(groups).toEqual([
      ["Payments", ["Refunds", "Gift cards"]],
      ["Shipping", ["Shipping labels"]],
      ["Constraints", ["PCI scope"]],
    ]);
    await click(button("Shipping labels"));
    expect($<HTMLInputElement>('.cp-target[data-target="cap-label"] input')?.checked).toBe(true);
    expect($(".cp-search-group")).toBeNull();
    expect(button("Place")?.disabled).toBe(false);
  });
});

// ── Writes ───────────────────────────────────────────────────────────

describe("placing", () => {
  it("Place writes through /place, refreshes, and shows the placed line with rex's pending warnings", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    const spies = await mountSection("a");
    answer("a", "place", 200, { change: "a", target: "cap-1", relation: "touches", warnings: ["Another change removes Home cap-1"] });
    await pick("cap-1");
    await click(button("Place"));

    expect(posts).toEqual([{ url: "/api/rex/changes/a/place", body: { target: "cap-1", relation: "touches" } }]);
    expect(spies.onWritten).toHaveBeenCalledTimes(1);
    expect($(".cp-placed-line")?.textContent).toBe("Placed: touches Home cap-1");
    expect($(".cp-warnings")?.textContent).toContain("Another change removes Home cap-1");
    expect($(".cp-target")).toBeNull();
  });

  it("Place & next opens the next change in the Inbox's order and asks for its title's focus", async () => {
    // List order a, b, c; the Inbox orders strongest first: c, a, b.
    serve([change("a"), change("b"), change("c")], [
      placement("a", [candidate("cap-a", { strength: "possible", score: 3 })]),
      placement("b", [candidate("cap-b", { strength: "weak", score: 1 })]),
      placement("c", [candidate("cap-c", { strength: "strong", score: 9 })]),
    ]);
    const spies = await mountSection("a");
    expect($(".cp-position")?.textContent).toBe("2 of 3 · Next ›");
    await pick("cap-a");
    await click(button("Place & next"));

    expect(posts.map((p) => p.url)).toEqual(["/api/rex/changes/a/place"]);
    expect(spies.onOpenChange).toHaveBeenCalledWith("b");
    expect(takeTitleFocus("b")).toBe(true);
  });

  it("Next › moves on without writing", async () => {
    serve([change("a"), change("b")], [placement("a", [candidate("cap-1")]), placement("b", [candidate("cap-2", { score: 1 })])]);
    const spies = await mountSection("a");
    await click($(".cp-next"));
    expect(posts).toEqual([]);
    expect(spies.onOpenChange).toHaveBeenCalledWith("b");
    expect(takeTitleFocus("b")).toBe(true);
  });

  it("Place & add another keeps the shortlist open for an extra touches", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1"), candidate("cap-2")], { relation: "amends" })]);
    await mountSection("a");
    await pick("cap-1");
    await click($('.cp-relation input[value="touches"]'));
    await click(button("Place & add another"));

    expect($('[data-change-placement="another"]')).not.toBeNull();
    expect($(".cp-shortlist legend")?.textContent).toBe("Add another place");
    expect($(".cp-relation")).toBeNull();
    expect($(".cp-placed-line")?.textContent).toBe("Placed: touches Home cap-1");

    await pick("cap-2");
    await click(button("Place"));
    expect(posts.map((p) => p.body)).toEqual([
      { target: "cap-1", relation: "touches" },
      { target: "cap-2", relation: "touches" },
    ]);
    expect($('[data-change-placement="placed"]')).not.toBeNull();
  });

  it("Amends sends the summary, the replacement statement and the criteria delta", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1", {
      criteria: [{ id: "c1", text: "Refunds post" }, { id: "c2", text: "Refunds email" }],
    })])]);
    await mountSection("a");
    await pick("cap-1");
    await click($('.cp-relation input[value="amends"]'));

    expect($$(".cp-amends .task-criterion-text").map((c) => c.textContent)).toEqual(["Refunds post", "Refunds email"]);
    await type($(".cp-amends input.cp-input"), "Cover gift cards");
    // Edit c1 in place, remove c2, add one.
    await click($$(".cp-amends .task-criterion")[0]);
    await type($(".cp-amends .task-criterion-input"), "Refunds post to the ledger");
    await act(async () => { $(".cp-amends .task-criterion-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await click($$(".cp-amends .task-criterion-remove")[1]);
    await click(button("+ criterion"));
    await type($(".cp-amends .task-criterion-add-input"), "Gift cards refund");
    await click($(".cp-amends .task-criterion-add-confirm"));
    await type($(".cp-amends textarea.cp-input"), "Refund any tender");
    await click(button("Place"));

    expect(posts[0].body).toEqual({
      target: "cap-1",
      relation: "amends",
      summary: "Cover gift cards",
      proposed: "Refund any tender",
      criteria: {
        add: [{ id: "c3", text: "Gift cards refund" }],
        replace: [{ id: "c1", text: "Refunds post to the ledger" }],
        remove: ["c2"],
      },
    });
  });

  it("reads a search pick's own criteria when it is amended", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])], {
      "/api/rex/product/capability/cap-refund": { layout: "v2", capability: { criteria: [
        { id: "c1", text: "Refund an order" }, { id: "c2", text: "Inherited", inheritedFrom: "Payments" },
      ] } },
    });
    await mountSection("a");
    await type($(".cp-search-input"), "refund");
    await click(button("Refunds"));
    await click($('.cp-relation input[value="amends"]'));
    expect($$(".cp-amends .task-criterion-text").map((c) => c.textContent)).toEqual(["Refund an order"]);
  });

  it("Amends with neither statement nor criteria is refused inline in rex's words, pointing at the criteria", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1", { criteria: [{ id: "c1", text: "x" }] })])]);
    await mountSection("a");
    const message = "Cannot place change a: amendment of \"Home cap-1\" has nothing to modify";
    answer("a", "place", 422, { error: message, kind: "nothing-to-modify" });
    await pick("cap-1");
    await click($('.cp-relation input[value="amends"]'));
    await click(button("Place"));

    expect(posts[0].body).toEqual({ target: "cap-1", relation: "amends" });
    expect($('.cp-refusal[role="alert"] .cp-refusal-message')?.textContent).toBe(message);
    expect($(".cp-refusal-hint")?.textContent).toBe(REFUSAL_HINTS["nothing-to-modify"]);
    expect($(".cp-amends .task-acceptance-criteria")?.classList.contains("is-invalid")).toBe(true);
    expect($(".cp-amends")?.contains(document.activeElement)).toBe(true);
    expect($(".cp-placed-line")).toBeNull();
  });

  const KINDS = Object.keys(REFUSAL_HINTS) as PlacementRefusalKind[];

  it.each(KINDS)("shows a %s refusal with rex's message and its hint", async (kind) => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    answer("a", "place", 422, { error: `rex says ${kind}`, kind });
    await pick("cap-1");
    await click(button("Place"));
    expect($(".cp-refusal-message")?.textContent).toBe(`rex says ${kind}`);
    const hint = $(".cp-refusal-hint");
    expect(hint?.dataset.kind).toBe(kind);
    expect(hint?.textContent).toBe(REFUSAL_HINTS[kind]);
  });

  it("shows a refusal without a kind as its message alone", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    answer("a", "place", 409, { error: "Could not acquire PRD lock: held by PID 42" });
    await pick("cap-1");
    await click(button("Place"));
    expect($(".cp-refusal-message")?.textContent).toBe("Could not acquire PRD lock: held by PID 42");
    expect($(".cp-refusal-hint")).toBeNull();
  });
});

describe("Nothing fits", () => {
  it("swaps in the proposal form, and Propose writes through /propose", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    const spies = await mountSection("a");
    answer("a", "propose", 200, { change: "a", proposed: { target: "n", under: "area-pay", title: "Store credit", type: "capability" } });
    await click(button("Nothing fits"));

    expect($(".cp-shortlist")).toBeNull();
    const selects = $$<HTMLSelectElement>(".cp-propose select");
    expect([...selects[1].options].map((o) => o.textContent)).toEqual(["Choose an area", "Payments", "Shipping"]);
    await type(selects[1], "area-pay", "change");
    const [title, statement, criteria] = [
      $(".cp-propose input.cp-input"),
      ...$$(".cp-propose textarea.cp-input"),
    ];
    await type(title, "Store credit");
    await type(statement, "Pay with store credit");
    await type(criteria, "Credit applies at checkout\n\nCredit expires");
    await click(button("Propose"));

    expect(posts).toEqual([{ url: "/api/rex/changes/a/propose", body: {
      type: "capability", under: "area-pay", title: "Store credit", proposed: "Pay with store credit",
      criteria: { add: [{ id: "c1", text: "Credit applies at checkout" }, { id: "c2", text: "Credit expires" }] },
    } }]);
    expect(spies.onWritten).toHaveBeenCalledTimes(1);
    expect($(".cp-placed-line")?.textContent).toBe("Placed: proposes capability Store credit");
  });

  it("a constraint proposal carries no criteria field", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    await click(button("Nothing fits"));
    await type($$<HTMLSelectElement>(".cp-propose select")[0], "constraint", "change");
    expect($$(".cp-propose textarea.cp-input")).toHaveLength(1);
  });

  it("Propose & next opens the next Inbox change", async () => {
    serve([change("a"), change("b")], [placement("a", [candidate("cap-1")]), placement("b", [candidate("cap-2", { score: 1 })])]);
    const spies = await mountSection("a");
    answer("a", "propose", 200, { change: "a", proposed: { target: "n", under: "area-pay", title: "X", type: "capability" } });
    await click(button("Nothing fits"));
    await type($$<HTMLSelectElement>(".cp-propose select")[1], "area-pay", "change");
    await click(button("Propose & next"));
    expect(posts[0].url).toBe("/api/rex/changes/a/propose");
    expect(spies.onOpenChange).toHaveBeenCalledWith("b");
    // Consumed here, or it would satisfy a later test's focus check for "b".
    expect(takeTitleFocus("b")).toBe(true);
  });

  it("waits for an area before Propose", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    await click(button("Nothing fits"));
    expect(button("Propose")?.disabled).toBe(true);
    await type($$<HTMLSelectElement>(".cp-propose select")[1], "area-ship", "change");
    expect(button("Propose")?.disabled).toBe(false);
  });

  it("shows a proposal refusal inline with its hint, and Back returns to the shortlist", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mountSection("a");
    answer("a", "propose", 422, { error: "A proposed capability or constraint needs a title", kind: "empty-title" });
    await click(button("Nothing fits"));
    await type($$<HTMLSelectElement>(".cp-propose select")[1], "area-pay", "change");
    await click(button("Propose"));
    expect(posts[0].body).toEqual({ type: "capability", under: "area-pay", title: "" });
    expect($(".cp-refusal-message")?.textContent).toBe("A proposed capability or constraint needs a title");
    expect($(".cp-refusal-hint")?.textContent).toBe(REFUSAL_HINTS["empty-title"]);
    await click(button("Back to the shortlist"));
    expect($(".cp-shortlist")).not.toBeNull();
  });
});

// ── In the detail panel ──────────────────────────────────────────────

describe("the change detail panel", () => {
  const item = (id: string): PRDItemData => ({ id, title: `Change ${id}`, status: "pending", level: "epic", type: "change" } as PRDItemData);

  it("puts the section right after the title, and notes on + Add Task that the tasks won't run", async () => {
    serve([change("a")], [placement("a", [candidate("cap-1")])]);
    await mount(h(TaskDetail, { item: item("a"), allItems: [item("a")], onUpdate: vi.fn(), onAddChild: vi.fn() }));
    const title = $(".task-title-display")!.closest(".task-section")!;
    expect(title.nextElementSibling?.classList.contains("cp-section")).toBe(true);
    expect($(".task-add-child-note")?.textContent).toBe("Its tasks won't run until the change is placed.");
  });

  it("has no section and no note for a placed change", async () => {
    serve([change("a", { awaitsPlacement: false, needsPlacement: false, touches: [{ id: "t", title: "Refunds" }] })], []);
    await mount(h(TaskDetail, { item: item("a"), allItems: [item("a")], onUpdate: vi.fn(), onAddChild: vi.fn() }));
    expect($(".cp-section")).toBeNull();
    expect($(".cp-placed-line")?.textContent).toBe("Placed: touches Refunds");
    expect($(".task-add-child-note")).toBeNull();
  });

  it("lands focus on the next change's title after Place & next", async () => {
    serve([change("a"), change("b")], [placement("a", [candidate("cap-1")]), placement("b", [candidate("cap-2", { score: 1 })])]);
    const items = [item("a"), item("b")];
    const onNavigateToItem = vi.fn();
    const show = (id: string) => mount(h(TaskDetail, {
      item: items.find((i) => i.id === id)!, allItems: items, onUpdate: vi.fn(), onNavigateToItem,
    }));
    await show("a");
    await pick("cap-1");
    await click(button("Place & next"));
    // The host opens the item it was asked for, as the tree's selection does.
    expect(onNavigateToItem).toHaveBeenCalledWith("b");
    await show("b");
    expect(document.activeElement?.classList.contains("task-title-display")).toBe(true);
    expect(document.activeElement?.textContent).toContain("Change b");
  });
});
