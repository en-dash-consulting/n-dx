// @vitest-environment jsdom
/**
 * Changes view renders a v2 fixture grouped by planned release, then by stage,
 * with the unscheduled backlog last.
 *
 * @see src/viewer/views/changes.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
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

describe("ChangesView", () => {
  it("groups by planned release, lowest version first and unscheduled last", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
    expect(releaseHeadings(el)).toEqual(["0.9.0", "1.0.0", UNSCHEDULED_RELEASE_LABEL]);
  });

  it("orders stages within a release by lifecycle and drops empty ones", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const release = el.querySelector('[data-release="0.9.0"]');
    const stages = [...(release?.querySelectorAll(".ch-stage") ?? [])]
      .map((s) => s.getAttribute("data-stage"));

    expect(stages).toEqual(["ready", "applied", "shipped"]);
    // "proposed" and "in-progress" have no 0.9.0 change, so they do not render.
    expect(stages).not.toContain("proposed");
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

    const touching = el.querySelector('[data-change-id="change-jev-client"]');
    expect(touching?.querySelector(".ch-touches")?.textContent).toContain("Architecture integrity");
    expect(touching?.querySelector(".ch-amends")).toBeNull();

    const unplaced = el.querySelector('[data-change-id="change-timeline"]');
    expect(unplaced?.querySelector(".ch-map-none")?.textContent).toBe("Unplaced");
  });

  it("surfaces task progress, effort, spike and needs-placement", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));

    const placement = el.querySelector('[data-change-id="change-placement-engine"]');
    expect(placement?.querySelector(".ch-progress")?.textContent).toBe("1/4 tasks");
    expect(placement?.querySelector(".ch-loe")?.textContent).toBe("2w");

    const stewards = el.querySelector('[data-change-id="change-stewards"]');
    expect(stewards?.querySelector(".ch-progress-empty")?.textContent).toBe("no tasks");
    expect(stewards?.querySelector(".ch-needs-placement")).not.toBeNull();

    expect(el.querySelector('[data-change-id="change-forked-sessions"] .ch-spike')).not.toBeNull();
    expect(el.querySelector('[data-change-id="change-placement-engine"] .ch-spike')).toBeNull();
  });

  it("shows the release a shipped change landed in", () => {
    const el = mount(h(ChangesView, { changes: CHANGES_FIXTURE }));
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

  it("sorts releases as versions, not as strings", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "0.10.0" }),
      change({ id: "b", plannedRelease: "0.9.0" }),
      change({ id: "c", plannedRelease: "1.0.0" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["0.9.0", "0.10.0", "1.0.0"]);
  });

  it("falls back to string order for releases that are not versions", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "next" }),
      change({ id: "b", plannedRelease: "2026-Q4" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["2026-Q4", "next"]);
  });

  // Number.parseInt stops at the first non-digit, so a guard that parsed and
  // checked for NaN would read both of these as 2026, compare them equal, and
  // leave them in arrival order — Q4 above Q1.
  it("orders quarter labels as text rather than reading them as numbers", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "2026-Q4" }),
      change({ id: "b", plannedRelease: "2026-Q1" }),
      change({ id: "c", plannedRelease: "2026-Q2" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["2026-Q1", "2026-Q2", "2026-Q4"]);
  });

  it("does not read a prerelease suffix as another version segment", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0-rc.1" }),
      change({ id: "b", plannedRelease: "1.0.0" }),
      change({ id: "c", plannedRelease: "2.0.0" }),
    ]);
    // "1.0.0-rc.1" is not all-numeric, so it is ordered as text — which keeps
    // it next to 1.0.0 rather than letting a parsed trailing 1 push it past
    // 1.0.0 as a fourth segment. Semver prerelease precedence (rc *before*
    // 1.0.0) is deliberately not implemented; see compareReleases.
    expect(groups.map((g) => g.label)).toEqual(["1.0.0", "1.0.0-rc.1", "2.0.0"]);
  });

  it("counts every change in a release across its stages", () => {
    const groups = groupChangesByRelease([
      change({ id: "a", plannedRelease: "1.0.0", stage: "ready" }),
      change({ id: "b", plannedRelease: "1.0.0", stage: "shipped" }),
      change({ id: "c", plannedRelease: "1.0.0", stage: "ready" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].changeCount).toBe(3);
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

  it("returns no groups for no changes", () => {
    expect(groupChangesByRelease([])).toEqual([]);
  });
});
