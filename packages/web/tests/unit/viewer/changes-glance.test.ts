// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ChangesGlance, limitGroups, MAX_GLANCE_ROWS, progressPercent, shortStatus } from "../../../src/viewer/views/changes-glance.js";
import { resetImpactCacheForTests } from "../../../src/viewer/components/impact-tags.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
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

  it("shortens the status, reading a blocked change not yet worked as Waiting", () => {
    expect(shortStatus(change("a")).label).toBe("Planned");
    expect(shortStatus(change("a", { stage: "ready" })).label).toBe("Ready");
    expect(shortStatus(change("a", { stage: "in-progress", openBlockers: 2, criteriaGap: true })).label).toBe("Working");
    expect(shortStatus(change("a", { stage: "awaiting-apply" }))).toMatchObject({ label: "Done", title: "Waiting for a steward to apply it" });
    expect(shortStatus(change("a", { stage: "ready", openBlockers: 2 }))).toEqual({ label: "Waiting", tone: "waiting", title: "Ready · blocked by 2 unfinished items" });
    expect(shortStatus(change("a", { criteriaGap: true })).title).toBe("Proposed · no acceptance criteria yet");
  });

  it("gives progress as a whole percentage, or none without tasks", () => {
    expect(progressPercent({ taskCount: 3, completedTaskCount: 1 })).toBe(33);
    expect(progressPercent({ taskCount: 0, completedTaskCount: 0 })).toBeNull();
  });

  it("limits rows across groups and counts the rest", () => {
    const groups = groupGlanceByRelease(Array.from({ length: 15 }, (_, i) => change(`c${i}`, { plannedRelease: i < 10 ? "1.0" : undefined })));
    const { groups: kept, more } = limitGroups(groups);
    expect(kept.flatMap((g) => g.changes)).toHaveLength(MAX_GLANCE_ROWS);
    expect(more).toBe(15 - MAX_GLANCE_ROWS);
  });
});

describe("ChangesGlance", () => {
  let root: HTMLElement;
  const navigateTo = vi.fn();
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); navigateTo.mockReset(); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); resetImpactCacheForTests(); });

  async function mount(open: GlanceChange[], impact: Record<string, unknown> = {}) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url === "/api/rex/impact" ? { items: impact } : { layout: "v2", summary: { inbox: 5, stages: {}, open, next: null } }),
    })));
    await act(async () => { render(h(ChangesSummaryProvider, null, h(ChangesGlance, { navigateTo })), root); });
    await act(async () => {});
  }

  it("draws a table of change, size, progress and status, and opens the detail panel", async () => {
    await mount([change("c1", { stage: "in-progress", taskCount: 4, completedTaskCount: 1, criteriaGap: true, openBlockers: 1 })]);
    expect([...root.querySelectorAll(".cg-table th")].map((th) => th.textContent)).toEqual(["Change", "Size", "Progress", "Status", "Actions"]);
    const row = root.querySelector(".cg-row")!;
    expect(row.querySelector(".cg-title")!.textContent).toBe("Change c1");
    expect(row.querySelector(".cg-size")!.textContent).toBe("—");
    const pct = row.querySelector<HTMLElement>(".cg-pct")!;
    expect(pct.textContent).toBe("25%");
    expect(pct.title).toBe("1 of 4 tasks done");
    const status = row.querySelector<HTMLElement>(".cg-status")!;
    expect(status.textContent).toBe("Working");
    expect(status.title).toBe("In progress");
    await act(async () => { (row.querySelector(".cg-open") as HTMLButtonElement).click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "c1" });
  });

  it("shows size as one word, the file count only in its tooltip, with flags after the name", async () => {
    await mount([change("c1")], {
      c1: { basis: "expected", files: ["a.ts", "config/.env"], fileCount: 12, size: "large", kinds: { code: 11, config: 1 }, security: ["config/.env"], essential: [] },
    });
    // The impact read answers after the summary's.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const size = root.querySelector<HTMLElement>(".cg-size")!;
    expect(size.textContent).toBe("Large");
    expect(size.title.split("\n")[0]).toBe("Large · ~12 files");
    expect([...root.querySelectorAll(".cg-name .impact-tag")].map((t) => t.textContent)).toEqual(["Security"]);
  });

  // Inbox exclusion is the summary route's job: routes-rex-product.test.ts asserts `open` omits held changes.
  it("shows the first three, then links to all of them on the full list", async () => {
    await mount(Array.from({ length: 14 }, (_, i) => change(`c${i}`)));
    expect(MAX_GLANCE_ROWS).toBe(3);
    expect(root.querySelectorAll(".cg-row")).toHaveLength(3);
    const more = root.querySelector<HTMLButtonElement>(".cg-more")!;
    expect(more.textContent).toBe("See all 14 open changes →");
    await act(async () => { more.click(); });
    expect(navigateTo).toHaveBeenCalledWith("changes");
  });

  it("still links to the full list when every change fits", async () => {
    await mount([change("c1")]);
    expect(root.querySelector(".cg-more")!.textContent).toBe("Open the full list →");
  });

  it("leads a row with the summary, the technical title as its tooltip", async () => {
    await mount([change("c1", { summary: "Faster checkout for returning shoppers" })]);
    const open = root.querySelector<HTMLButtonElement>(".cg-open")!;
    expect(open.textContent).toBe("Faster checkout for returning shoppers");
    expect(open.title).toBe("Change c1");
  });
});
