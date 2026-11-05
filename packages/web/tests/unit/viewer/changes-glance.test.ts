// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ChangesGlance, limitGroups, MAX_GLANCE_ROWS } from "../../../src/viewer/views/changes-glance.js";
import { glanceGap, groupGlanceByRelease, type GlanceChange } from "../../../src/viewer/views/product-model.js";

function change(id: string, over: Partial<GlanceChange> = {}): GlanceChange {
  return { id, title: `Change ${id}`, stage: "proposed", taskCount: 0, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...over };
}

describe("glance model", () => {
  it("groups by release, newest first, Unscheduled last", () => {
    const groups = groupGlanceByRelease([
      change("a"), change("b", { plannedRelease: "0.9.0" }), change("c", { plannedRelease: "0.10.0" }), change("d", { plannedRelease: " " }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["0.10.0", "0.9.0", "Unscheduled"]);
    expect(groups[2]!.changes.map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("shows blocked before no criteria, and nothing when neither", () => {
    expect(glanceGap({ criteriaGap: true, openBlockers: 2 })).toBe("blocked");
    expect(glanceGap({ criteriaGap: true, openBlockers: 0 })).toBe("no-criteria");
    expect(glanceGap({ criteriaGap: false, openBlockers: 0 })).toBeNull();
  });

  it("limits rows across groups and counts the rest", () => {
    const groups = groupGlanceByRelease(Array.from({ length: 15 }, (_, i) => change(`c${i}`, { plannedRelease: i < 10 ? "1.0" : undefined })));
    const { groups: kept, more } = limitGroups(groups);
    expect(kept.flatMap((g) => g.changes)).toHaveLength(MAX_GLANCE_ROWS);
    expect(more).toBe(3);
  });
});

describe("ChangesGlance", () => {
  let root: HTMLElement;
  const navigateTo = vi.fn();
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); navigateTo.mockReset(); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  async function mount(open: GlanceChange[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ layout: "v2", summary: { inbox: 5, stages: {}, open, next: null } }) })));
    await act(async () => { render(h(ChangesGlance, { navigateTo }), root); });
    await act(async () => {});
  }

  it("draws progress, stage chip and one gap chip, and opens the detail panel", async () => {
    await mount([change("c1", { stage: "in-progress", taskCount: 4, completedTaskCount: 1, criteriaGap: true, openBlockers: 1 })]);
    const row = root.querySelector(".cg-row")!;
    expect(row.querySelector("progress")!.getAttribute("value")).toBe("25");
    expect(row.querySelector(".cg-stage")!.textContent).toBe("In progress");
    expect([...row.querySelectorAll(".cg-gap")].map((e) => e.textContent)).toEqual(["Blocked"]);
    await act(async () => { (row.querySelector(".cg-open") as HTMLButtonElement).click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "c1" });
  });

  // Inbox exclusion is the summary route's job: routes-rex-product.test.ts asserts `open` omits held changes.
  it("ends a long list in N more", async () => {
    await mount(Array.from({ length: 14 }, (_, i) => change(`c${i}`)));
    expect(root.querySelectorAll(".cg-row")).toHaveLength(MAX_GLANCE_ROWS);
    expect(root.querySelector(".cg-more")!.textContent).toBe("2 more");
  });
});
