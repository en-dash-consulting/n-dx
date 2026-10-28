// @vitest-environment jsdom
/**
 * Changes view renders a v2 fixture grouped by planned release, then by stage,
 * with the unscheduled backlog last.
 *
 * @see src/viewer/views/changes.ts
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { ChangesView } from "../../../src/viewer/views/changes.js";
import {
  CHANGE_STAGE_ORDER,
  UNSCHEDULED_RELEASE_LABEL,
  groupChangesByRelease,
  type ChangeRow,
} from "../../../src/viewer/views/product-model.js";
import { CHANGES_FIXTURE } from "../../fixtures/v2-product-map.js";

let root: HTMLDivElement | null = null;

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = renderToDiv(vnode);
  return root;
}

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = null;
});

function releaseHeadings(el: HTMLElement): string[] {
  return [...el.querySelectorAll(".ch-release > .section-header")]
    .map((h2) => h2.firstChild?.textContent?.trim() ?? "");
}

describe("ChangesView: Needs placement tag", () => {
  const held = { ...CHANGES_FIXTURE[0], id: "held", stage: "proposed", awaitsPlacement: true } as ChangeRow;
  const flagged = { ...CHANGES_FIXTURE[0], id: "flagged", stage: "applied", needsPlacement: true } as ChangeRow;
  const plain = { ...CHANGES_FIXTURE[0], id: "plain", stage: "proposed" } as ChangeRow;

  it("shows only on rows that await placement, not on flagged applied history", () => {
    const el = mount(h(ChangesView, { changes: [held, flagged, plain], onSelectChange: () => {} }));
    const tagged = [...el.querySelectorAll(".ch-needs-placement")]
      .map((t) => t.closest("[data-change-id]")?.getAttribute("data-change-id"));
    expect(tagged).toEqual(["held"]);
  });

  it("opens the change's detail panel", () => {
    const seen: string[] = [];
    const el = mount(h(ChangesView, { changes: [held], onSelectChange: (id: string) => seen.push(id) }));
    (el.querySelector("button.ch-needs-placement") as HTMLButtonElement).click();
    expect(seen).toEqual(["held"]);
  });
});

/** Choose a filter chip by its data-filter value. */
function pick(el: HTMLElement, value: string): void {
  act(() => { el.querySelector<HTMLButtonElement>(`[data-filter="${value}"]`)!.click(); });
}

/** Show applied history: the Applied filter, with every group expanded. */
function showApplied(el: HTMLElement): void {
  pick(el, "applied");
  act(() => {
    for (const toggle of el.querySelectorAll<HTMLButtonElement>(".ch-applied-toggle")) toggle.click();
  });
}

beforeEach(() => { localStorage.clear(); });

describe("ChangesView", () => {
  it("groups by planned release, unscheduled open work first, then newest version first", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    expect(releaseHeadings(el)).toEqual([UNSCHEDULED_RELEASE_LABEL, "1.0.0", "0.9.0"]);
  });

  it("orders stages within a release by lifecycle and drops empty ones", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    pick(el, "release:0.9.0");
    act(() => { el.querySelector<HTMLButtonElement>(".ch-applied-toggle")!.click(); });

    const release = el.querySelector('[data-release="0.9.0"]');
    const stages = [...(release?.querySelectorAll(".ch-stage") ?? [])]
      .map((s) => s.getAttribute("data-stage"));

    expect(stages).toEqual(["ready", "applied", "shipped"]);
    // "proposed" and "in-progress" have no 0.9.0 change, so they do not render.
    expect(stages).not.toContain("proposed");
  });

  it("collapses applied and shipped changes behind a count until asked", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    pick(el, "release:0.9.0");
    const release = el.querySelector('[data-release="0.9.0"]')!;
    const toggle = release.querySelector<HTMLButtonElement>(".ch-applied-toggle")!;

    const stages = () => [...release.querySelectorAll(".ch-stage")].map((s) => s.getAttribute("data-stage"));
    expect(stages()).toEqual(["ready"]);
    expect(toggle.textContent).toBe("2 applied ▸");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector('[data-change-id="change-jev-client"]')).toBeNull();

    act(() => { toggle.click(); });
    expect(stages()).toEqual(["ready", "applied", "shipped"]);
    expect(toggle.textContent).toBe("2 applied ▾");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector('[data-change-id="change-jev-client"]')).not.toBeNull();

    act(() => { toggle.click(); });
    expect(stages()).toEqual(["ready"]);
  });

  it("shows no applied toggle on a release with no applied history", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    pick(el, "release:1.0.0");
    expect(el.querySelector('[data-release="1.0.0"] .ch-applied-toggle')).toBeNull();
  });

  it("clamps a long intent to two lines with a more control", () => {
    const long = { ...CHANGES_FIXTURE[0], id: "long", intent: "First paragraph.\n\nSecond paragraph." } as ChangeRow;
    const el = mount(h(ChangesView, { changes: [long] }));
    const intent = el.querySelector('[data-change-id="long"] .ch-intent')!;
    const more = el.querySelector<HTMLButtonElement>('[data-change-id="long"] .ch-intent-toggle')!;

    expect(intent.classList.contains("ch-intent-clamped")).toBe(true);
    expect(more.textContent).toBe("more");
    expect(more.getAttribute("aria-expanded")).toBe("false");

    act(() => { more.click(); });
    expect(intent.classList.contains("ch-intent-clamped")).toBe(false);
    expect(intent.getAttribute("data-expanded")).toBe("true");
    expect(more.textContent).toBe("less");
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("clamps an intent past the length limit even on one line", () => {
    const long = { ...CHANGES_FIXTURE[0], id: "long", intent: "word ".repeat(40).trim() } as ChangeRow;
    const el = mount(h(ChangesView, { changes: [long] }));
    expect(el.querySelector('[data-change-id="long"] .ch-intent-clamped')).not.toBeNull();
  });

  it("gives a short intent no more control", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    expect(el.querySelector(".ch-intent-toggle")).toBeNull();
    expect(el.querySelector(".ch-intent-clamped")).toBeNull();
  });

  it("renders each change under its own release and stage", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const change = el.querySelector('[data-change-id="change-placement-engine"]');
    expect(change).not.toBeNull();
    expect(change?.getAttribute("data-stage")).toBe("in-progress");
    expect(change?.closest(".ch-release")?.getAttribute("data-release")).toBe("1.0.0");
    expect(change?.textContent).toContain("CH-142");
    expect(change?.textContent).toContain("Placement engine for changes");
  });

  it("labels an awaiting-apply change as waiting for a steward, between in-progress and applied", () => {
    const row = (id: string, stage: ChangeRow["stage"]): ChangeRow => ({
      id, title: id, stage, plannedRelease: "2.0.0", amends: [], touches: [], taskCount: 0, completedTaskCount: 0,
    });
    const el = mount(h(ChangesView, {
      changes: [row("a", "applied"), row("b", "awaiting-apply"), row("c", "in-progress")],
    }));
    pick(el, "release:2.0.0");
    act(() => { el.querySelector<HTMLButtonElement>(".ch-applied-toggle")!.click(); });
    const stages = [...el.querySelectorAll(".ch-stage")];
    expect(stages.map((s) => s.getAttribute("data-stage"))).toEqual(["in-progress", "awaiting-apply", "applied"]);
    expect(stages[1].querySelector(".ch-stage-header")?.textContent).toContain("Waiting for a steward to apply it");
  });

  it("puts a change with no planned release in the unscheduled group", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const spike = el.querySelector('[data-change-id="change-forked-sessions"]');
    const group = spike?.closest(".ch-release");
    expect(group?.getAttribute("data-release-unscheduled")).toBe("true");
    expect(group?.hasAttribute("data-release")).toBe(false);
  });

  it("shows what each change does to the map", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const amending = el.querySelector('[data-change-id="change-run-field"]');
    expect(amending?.querySelector(".ch-amends")?.textContent).toContain("modified");
    expect(amending?.querySelector(".ch-amends")?.textContent).toContain("Autonomous task runs");

    const unplaced = el.querySelector('[data-change-id="change-timeline"]');
    expect(unplaced?.querySelector(".ch-map-none")?.textContent).toBe("Unplaced");

    showApplied(el);
    const touching = el.querySelector('[data-change-id="change-jev-client"]');
    expect(touching?.querySelector(".ch-touches")?.textContent).toContain("Architecture integrity");
    expect(touching?.querySelector(".ch-amends")).toBeNull();
  });

  it("surfaces task progress, effort, spike and needs-placement", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const placement = el.querySelector('[data-change-id="change-placement-engine"]');
    expect(placement?.querySelector(".ch-progress")?.textContent).toBe("1/4 tasks");
    expect(placement?.querySelector(".ch-loe")?.textContent).toBe("2w");

    const stewards = el.querySelector('[data-change-id="change-stewards"]');
    expect(stewards?.querySelector(".ch-progress-empty")?.textContent).toBe("no tasks");

    expect(el.querySelector('[data-change-id="change-forked-sessions"] .ch-spike')).not.toBeNull();
    expect(el.querySelector('[data-change-id="change-placement-engine"] .ch-spike')).toBeNull();
  });

  it("shows the release a shipped change landed in", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    showApplied(el);
    const shipped = el.querySelector('[data-change-id="change-jev-client"]');
    expect(shipped?.querySelector(".ch-shipped-in")?.textContent).toBe("shipped in 0.9.0");
  });

  it("opens a change when a handler is given", () => {
    const opened: string[] = [];
    const el = mount(h(ChangesView, {
      changes: CHANGES_FIXTURE,
      onSelectChange: (id: string) => opened.push(id),
    }));

    const link = el.querySelector('[data-change-id="change-stewards"] button.ch-change-link');
    expect((link as HTMLButtonElement).type).toBe("button");
    (link as HTMLButtonElement).click();
    expect(opened).toEqual(["change-stewards"]);
  });

  it("shows an empty state when there are no changes", () => {
    const el = mount(h(ChangesView, { changes: [] }));
    expect(el.querySelector(".empty-state")?.textContent).toContain("No changes yet");
    expect(el.querySelectorAll(".ch-release")).toHaveLength(0);
  });
});

describe("ChangesView filters", () => {
  const row = (id: string, stage: ChangeRow["stage"], plannedRelease?: string): ChangeRow => ({
    id, title: id, stage, plannedRelease, amends: [], touches: [], taskCount: 0, completedTaskCount: 0,
  });
  const MIXED = [
    row("o1", "ready", "1.0.0"), row("a1", "applied", "1.0.0"), row("a2", "shipped", "1.0.0"),
    row("o2", "proposed"), row("a3", "applied"), row("a4", "applied", "0.9.0"),
  ];
  const chip = (el: HTMLElement, value: string) =>
    el.querySelector<HTMLButtonElement>(`[data-filter="${value}"]`)!;
  const ids = (el: HTMLElement) =>
    [...el.querySelectorAll("[data-change-id]")].map((n) => n.getAttribute("data-change-id"));

  it("defaults to Open: the first screen holds only open changes", () => {
    const el = mount(h(ChangesView, { changes: MIXED }));
    expect(chip(el, "open").getAttribute("aria-pressed")).toBe("true");
    expect(ids(el)).toEqual(["o2", "o1"]);
    // 0.9.0 has nothing open, so it has no group.
    expect(releaseHeadings(el)).toEqual([UNSCHEDULED_RELEASE_LABEL, "1.0.0"]);
  });

  it("shows counts on Open, Applied and each release chip", () => {
    const el = mount(h(ChangesView, { changes: MIXED }));
    const text = (v: string) => chip(el, v).textContent;
    expect(text("open")).toBe("Open2");
    expect(text("applied")).toBe("Applied4");
    expect(text("release:1.0.0")).toBe("1.0.03");
    expect(text("release:0.9.0")).toBe("0.9.01");
    expect(text("unscheduled")).toBe(`${UNSCHEDULED_RELEASE_LABEL}2`);
  });

  it("Applied lists groups collapsed, and mounts no rows until one is expanded", () => {
    const el = mount(h(ChangesView, { changes: MIXED }));
    pick(el, "applied");
    expect(el.querySelectorAll(".ch-release")).toHaveLength(3);
    expect(ids(el)).toEqual([]);
    expect(el.querySelectorAll(".ch-change")).toHaveLength(0);

    act(() => { el.querySelector<HTMLButtonElement>('[data-release="1.0.0"] .ch-applied-toggle')!.click(); });
    expect(ids(el)).toEqual(["a1", "a2"]);
  });

  it("a release filter shows that release alone, open rows plus collapsed applied", () => {
    const el = mount(h(ChangesView, { changes: MIXED }));
    pick(el, "release:1.0.0");
    expect(releaseHeadings(el)).toEqual(["1.0.0"]);
    expect(ids(el)).toEqual(["o1"]);
    expect(el.querySelector(".ch-applied-toggle")!.textContent).toBe("2 applied ▸");
  });

  it("remembers the choice per viewer in localStorage", () => {
    const first = mount(h(ChangesView, { changes: MIXED }));
    pick(first, "release:1.0.0");
    expect(localStorage.getItem("ndx.changes.filter")).toBe("release:1.0.0");
    cleanupRenderedDiv(first);

    const again = mount(h(ChangesView, { changes: MIXED }));
    expect(chip(again, "release:1.0.0").getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to Open when the remembered release no longer exists", () => {
    localStorage.setItem("ndx.changes.filter", "release:9.9.9");
    const el = mount(h(ChangesView, { changes: MIXED }));
    expect(chip(el, "open").getAttribute("aria-pressed")).toBe("true");
  });

  it("still works when localStorage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      const el = mount(h(ChangesView, { changes: MIXED }));
      expect(chip(el, "open").getAttribute("aria-pressed")).toBe("true");
      pick(el, "applied");
      expect(chip(el, "applied").getAttribute("aria-pressed")).toBe("true");
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("mounts no rows for a large collapsed applied group", () => {
    const many = Array.from({ length: 1241 }, (_, i) => row(`a${i}`, "applied"));
    const el = mount(h(ChangesView, { changes: [...many, row("open", "proposed")] }));
    pick(el, "unscheduled");
    expect(el.querySelectorAll(".ch-change")).toHaveLength(1);
    expect(el.querySelector(".ch-applied-toggle")!.textContent).toBe("1241 applied ▸");
  });
});

describe("groupChangesByRelease", () => {
  const change = (over: Partial<ChangeRow>): ChangeRow => ({
    id: "c",
    title: "c",
    stage: "proposed",
    amends: [],
    touches: [],
    taskCount: 0,
    completedTaskCount: 0,
    ...over,
  });

  it("sorts releases newest first as versions, not as strings", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "0.10.0" }),
      change({ id: "b", plannedRelease: "0.9.0" }),
      change({ id: "c", plannedRelease: "1.0.0" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["1.0.0", "0.10.0", "0.9.0"]);
  });

  it("falls back to reverse string order for releases that are not versions", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "2026-Q4" }),
      change({ id: "b", plannedRelease: "next" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["next", "2026-Q4"]);
  });

  // Number.parseInt stops at the first non-digit, so a guard that parsed and
  // checked for NaN would read both of these as 2026, compare them equal, and
  // leave them in arrival order.
  it("orders quarter labels as text rather than reading them as numbers", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "2026-Q1" }),
      change({ id: "b", plannedRelease: "2026-Q4" }),
      change({ id: "c", plannedRelease: "2026-Q2" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["2026-Q4", "2026-Q2", "2026-Q1"]);
  });

  it("orders a prerelease below its release, by semver precedence", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0-rc.1" }),
      change({ id: "b", plannedRelease: "1.0.0" }),
      change({ id: "c", plannedRelease: "2.0.0" }),
      change({ id: "d", plannedRelease: "1.0.0-rc.10" }),
      change({ id: "e", plannedRelease: "1.0.0-beta" }),
      change({ id: "f", plannedRelease: "0.9.0" }),
    ]);
    // rc.10 > rc.1 numerically; "rc" > "beta" as text; any prerelease < 1.0.0.
    expect(groups.map((g) => g.label))
      .toEqual(["2.0.0", "1.0.0", "1.0.0-rc.10", "1.0.0-rc.1", "1.0.0-beta", "0.9.0"]);
  });

  it("orders v-prefixed labels by semver, not as text", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "v0.9.0" }),
      change({ id: "b", plannedRelease: "v0.10.0" }),
      change({ id: "c", plannedRelease: "v1.0.0" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["v1.0.0", "v0.10.0", "v0.9.0"]);
  });

  it("orders a v-prefixed prerelease below its release", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "v1.0.0-rc.1" }),
      change({ id: "b", plannedRelease: "v1.0.0" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["v1.0.0", "v1.0.0-rc.1"]);
  });

  it("gives bare and v-prefixed labels of one version equal precedence, each its own group", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "0.9.0" }),
      change({ id: "b", plannedRelease: "v1.0.0" }),
      change({ id: "c", plannedRelease: "1.0.0" }),
    ]);
    expect(groups.map((g) => g.label).sort()).toEqual(["0.9.0", "1.0.0", "v1.0.0"]);
    // Both 1.0.0 spellings outrank 0.9.0 and neither outranks the other.
    expect(groups.slice(0, 2).map((g) => g.label).sort()).toEqual(["1.0.0", "v1.0.0"]);
    expect(groups[2]!.label).toBe("0.9.0");
  });

  it("leads with unscheduled while it holds open work", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0" }),
      change({ id: "b", stage: "applied" }),
      change({ id: "c", stage: "ready" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([UNSCHEDULED_RELEASE_LABEL, "1.0.0"]);
  });

  it("puts unscheduled last once all of it is applied or shipped", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0" }),
      change({ id: "b", stage: "applied" }),
      change({ id: "c", stage: "shipped" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["1.0.0", UNSCHEDULED_RELEASE_LABEL]);
  });

  it("counts every change in a release across its stages, and the applied ones", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0", stage: "ready" }),
      change({ id: "b", plannedRelease: "1.0.0", stage: "shipped" }),
      change({ id: "c", plannedRelease: "1.0.0", stage: "ready" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].changeCount).toBe(3);
    expect(groups[0].appliedCount).toBe(1);
    expect(groups[0].stages.map((s) => s.stage)).toEqual(["ready", "shipped"]);
    expect(groups[0].stages[0].changes.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("keeps stages in lifecycle order regardless of input order", () => {
    const groups = groupChangesByRelease(
      [...CHANGE_STAGE_ORDER].reverse().map((stage, i) =>
        change({ id: `c${i}`, stage, plannedRelease: "1.0.0" })),
    );
    expect(groups[0].stages.map((s) => s.stage)).toEqual([...CHANGE_STAGE_ORDER]);
  });

  // The v2 schema only requires plannedRelease to be a string, so a blank one
  // reaches here as "" or "   ". Bucketing it by value gave the backlog a
  // nameless heading of its own instead of folding it into Unscheduled.
  it("treats an empty planned release as unscheduled", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "" }),
      change({ id: "b", plannedRelease: "next" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([UNSCHEDULED_RELEASE_LABEL, "next"]);
    expect(groups[0].changeCount).toBe(1);
  });

  it("treats a whitespace-only planned release as unscheduled", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "   " }),
      change({ id: "b", plannedRelease: "\t\n" }),
      change({ id: "c", plannedRelease: "next" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([UNSCHEDULED_RELEASE_LABEL, "next"]);
    expect(groups[0].changeCount).toBe(2);
  });

  it("groups blank and missing planned releases together", () => {
    const groups = groupChangesByRelease([
      change({ id: "a" }),
      change({ id: "b", plannedRelease: "" }),
      change({ id: "c", plannedRelease: " " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe(UNSCHEDULED_RELEASE_LABEL);
    expect(groups[0].changeCount).toBe(3);
  });

  it("trims surrounding whitespace so a padded label is the same release", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: " 1.0.0 " }),
      change({ id: "b", plannedRelease: "1.0.0" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("1.0.0");
    expect(groups[0].release).toBe("1.0.0");
    expect(groups[0].changeCount).toBe(2);
  });

  it("returns no groups for no changes", () => {
    expect(groupChangesByRelease([])).toEqual([]);
  });
});
