// @vitest-environment jsdom
/**
 * Assigning Inbox and backlog changes: the picker on each row writes the
 * `assignee` field, and the filter opens on Mine when the current user has
 * open work assigned, hiding rows only.
 *
 * @see src/viewer/components/assignee.ts
 * @see src/viewer/views/inbox.ts
 * @see src/viewer/views/changes.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { InboxView, type InboxRow } from "../../../src/viewer/views/inbox.js";
import { ChangesView } from "../../../src/viewer/views/changes.js";
import { _resetPeopleForTests } from "../../../src/viewer/components/assignee.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ChangeRow } from "../../../src/viewer/views/product-model.js";
import type { KnownPerson } from "../../../src/viewer/external.js";

const ME = "Ann Lee <ann@shop.io>";
const PEOPLE: KnownPerson[] = [
  { id: ME, name: "Ann Lee", email: "ann@shop.io", sources: ["git"] },
  { id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["git", "steward"] },
];

function change(id: string, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id, title: `Change ${id}`, stage: "proposed", awaitsPlacement: true, inbox: true, needsPlacement: true,
    amends: [], touches: [], taskCount: 1, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...extra,
  };
}

const rows = (changes: ChangeRow[]): InboxRow[] => changes.map((c) => ({ change: c }));

let root: HTMLDivElement;
let patches: Array<{ url: string; body: unknown }>;

function serve(people: { me: string | null; people: KnownPerson[] }): void {
  patches = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url === "/api/rex/people") return new Response(JSON.stringify(people), { status: 200 });
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }));
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

const filterSelect = () => root.querySelector<HTMLSelectElement>(".assignee-filter-select")!;

async function pickFilter(value: string): Promise<void> {
  await act(async () => {
    filterSelect().value = value;
    filterSelect().dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  _resetPeopleForTests();
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

describe("the Inbox assignee filter", () => {
  const inbox = [
    change("mine", { assignee: "ann@shop.io" }),
    change("bos", { assignee: "Bo Chen <bo@shop.io>" }),
    change("nobody"),
  ];
  const ids = () => [...root.querySelectorAll<HTMLElement>(".inbox-row")].map((r) => r.dataset.changeId);

  it("opens on Mine when the current user has a change here, and All shows every row again", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(InboxView, { rows: rows(inbox), appliedUnplaced: 0, onOpenChange: vi.fn() }));
    expect(filterSelect().value).toBe("mine");
    expect(ids()).toEqual(["mine"]);

    await pickFilter("all");
    expect(ids()).toEqual(["mine", "bos", "nobody"]);

    await pickFilter("person:bo@shop.io");
    expect(ids()).toEqual(["bos"]);
    expect([...filterSelect().options].map((o) => o.textContent)).toEqual(["Mine", "All", "Ann Lee", "Bo Chen"]);
  });

  it("flags a row that is the current user by email but not in the spelling ndx work --mine matches", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(InboxView, { rows: rows([change("loose", { assignee: "ann@shop.io" }), change("exact", { assignee: ME })]), appliedUnplaced: 0, onOpenChange: vi.fn() }));
    // Both count as Mine here; only the exact spelling is one the CLI selects.
    expect(ids()).toEqual(["loose", "exact"]);
    const flag = (id: string) => root.querySelector(`.inbox-row[data-change-id="${id}"] .assignee-mismatch`)?.textContent;
    // The project's CLI name fills the command; this harness serves no /api/project.
    expect(flag("loose")).toMatch(/^not matched by \S+ work --mine$/);
    expect(flag("exact")).toBeUndefined();
  });

  it("opens on All when nothing here is assigned to the current user", async () => {
    serve({ me: "Cy <cy@shop.io>", people: PEOPLE });
    await mount(h(InboxView, { rows: rows(inbox), appliedUnplaced: 0, onOpenChange: vi.fn() }));
    expect(filterSelect().value).toBe("all");
    expect(ids()).toEqual(["mine", "bos", "nobody"]);
  });
});

describe("while the people list is being read", () => {
  /** Serve `routes`, holding `/api/rex/people` until `release` is called. */
  function serveHeld(routes: Record<string, unknown>): { release: () => void } {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/rex/people") {
        await held;
        return new Response(JSON.stringify({ me: ME, people: PEOPLE }), { status: 200 });
      }
      const body = routes[url];
      return new Response(JSON.stringify(body ?? { error: "not found" }), { status: body === undefined ? 404 : 200 });
    }));
    return { release };
  }

  const inbox = [change("bos", { assignee: "Bo Chen <bo@shop.io>" }), change("mine", { assignee: ME })];
  const ids = () => [...root.querySelectorAll<HTMLElement>(".inbox-row")].map((r) => r.dataset.changeId);

  it("holds the Inbox rows, then opens straight on Mine, never showing All first", async () => {
    const { release } = serveHeld({});
    await mount(h(InboxView, { rows: rows(inbox), appliedUnplaced: 0, onOpenChange: vi.fn() }));
    // Nothing filtered yet: no rows and no filter control, only a status.
    expect(ids()).toEqual([]);
    expect(root.querySelector(".assignee-filter-select")).toBeNull();
    expect(root.querySelector(".assignee-filter-pending")?.getAttribute("role")).toBe("status");

    await act(async () => { release(); });
    await settle();
    expect(filterSelect().value).toBe("mine");
    expect(ids()).toEqual(["mine"]);
  });

  it("makes the Inbox page's first pick from the list as filtered once people load", async () => {
    const { InboxTriagePage } = await import("../../../src/viewer/views/inbox-triage.js");
    const placement = (id: string, score: number) => ({
      layout: "v2", change: { id, title: `Change ${id}`, status: "pending", taskCount: 1 }, relation: "touches",
      relationRule: "a rule", tied: false,
      shortlist: [{ target: `cap-${id}`, type: "capability", title: `Home ${id}`, area: "Checkout", criteria: [], score, strength: "strong", reasons: [] }],
    });
    // Bo's change has the stronger guess, so it leads the unfiltered queue.
    const { release } = serveHeld({
      "/api/rex/changes": { layout: "v2", changes: inbox },
      "/api/rex/changes/placements": { layout: "v2", placements: { bos: placement("bos", 9), mine: placement("mine", 3) } },
    });
    await mount(h(InboxTriagePage, { navigateTo: vi.fn() }));
    // Shortlists are in; people are not: no queue and no pick yet.
    expect(root.querySelectorAll(".inbox-qitem")).toHaveLength(0);
    expect(root.querySelector(".inbox-detail-title")).toBeNull();

    await act(async () => { release(); });
    await settle();
    expect([...root.querySelectorAll<HTMLElement>(".inbox-qitem")].map((el) => el.dataset.changeId)).toEqual(["mine"]);
    expect(root.querySelector<HTMLElement>(".inbox-qitem.is-selected")?.dataset.changeId).toBe("mine");
    expect(root.querySelector(".inbox-detail-title")?.textContent).toBe("Change mine");
  });
});

describe("the Inbox row's assignee picker", () => {
  it("saves a free-form email for someone not in the repository, without opening the row", async () => {
    serve({ me: ME, people: PEOPLE });
    const onOpenChange = vi.fn();
    const onAssigned = vi.fn();
    await mount(h(InboxView, { rows: rows([change("c1")]), appliedUnplaced: 0, onOpenChange, onAssigned }));

    const row = root.querySelector<HTMLElement>('.inbox-row[data-change-id="c1"]')!;
    await act(async () => { row.querySelector<HTMLButtonElement>(".assignee-button")!.click(); });
    // The known people are the suggestions.
    expect([...row.querySelectorAll("datalist option")].map((o) => (o as HTMLOptionElement).value)).toEqual(PEOPLE.map((p) => p.id));

    const input = row.querySelector<HTMLInputElement>(".assignee-input")!;
    await act(async () => {
      input.value = " new.person@shop.io ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { row.querySelector<HTMLButtonElement>(".assignee-save")!.click(); });
    await settle();

    expect(patches).toEqual([{ url: "/api/rex/items/c1", body: { assignee: "new.person@shop.io" } }]);
    expect(onAssigned).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(row.querySelector(".assignee-button")?.textContent).toBe("new.person@shop.io");
  });

  it("clears the assignee with an empty value", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(InboxView, { rows: rows([change("c1", { assignee: "Bo Chen <bo@shop.io>" })]), appliedUnplaced: 0, onOpenChange: vi.fn() }));
    await pickFilter("all");
    await act(async () => { root.querySelector<HTMLButtonElement>(".assignee-button")!.click(); });
    await act(async () => { root.querySelector<HTMLButtonElement>(".assignee-clear")!.click(); });
    await settle();
    expect(patches).toEqual([{ url: "/api/rex/items/c1", body: { assignee: "" } }]);
    expect(root.querySelector(".assignee-button")?.textContent).toBe("Assign");
  });
});

describe("the backlog (Changes view)", () => {
  const backlog = [
    change("open-mine", { stage: "in-progress", awaitsPlacement: false, inbox: false, assignee: ME }),
    change("open-other", { stage: "ready", awaitsPlacement: false, inbox: false, assignee: "bo@shop.io" }),
    change("open-none", { stage: "proposed", awaitsPlacement: false, inbox: false }),
  ];
  const ids = () => [...root.querySelectorAll<HTMLElement>(".ch-change")].map((r) => r.dataset.changeId).sort();

  it("defaults to Mine, offers a picker on open rows, and All restores every row", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(ChangesView, { changes: backlog }));
    expect(filterSelect().value).toBe("mine");
    expect(ids()).toEqual(["open-mine"]);
    expect(root.querySelector('.ch-change[data-change-id="open-mine"] .assignee-button')?.textContent).toBe("Ann Lee");

    await pickFilter("all");
    expect(ids()).toEqual(["open-mine", "open-none", "open-other"]);
  });

  it("counts a change as Mine when only one of its open tasks is assigned to the user", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(ChangesView, { changes: [
      change("task-mine", { stage: "in-progress", awaitsPlacement: false, inbox: false, taskAssignees: [ME] }),
      ...backlog.slice(1),
    ] }));
    // The default follows the task: Mine, showing the change that holds it.
    expect(filterSelect().value).toBe("mine");
    expect(ids()).toEqual(["task-mine"]);
    // The change itself stays unassigned.
    expect(root.querySelector('.ch-change[data-change-id="task-mine"] .assignee-button')?.textContent).toBe("Assign");
  });

  it("defaults to All when the user's only assigned change is applied", async () => {
    serve({ me: ME, people: PEOPLE });
    await mount(h(ChangesView, { changes: [
      change("applied-mine", { stage: "applied", awaitsPlacement: false, inbox: false, assignee: ME }),
      ...backlog.slice(1),
    ] }));
    expect(filterSelect().value).toBe("all");
  });
});
