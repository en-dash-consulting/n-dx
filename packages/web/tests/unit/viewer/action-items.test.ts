// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  NEW_FILES_NOTE,
  buildHealthActions,
  buildInfraActions,
  concernCounts,
  zoneIssues,
  recommendationPayload,
} from "../../../src/viewer/views/action-items.js";
import { InfraArchPanel } from "../../../src/viewer/views/infra-arch.js";
import type { NextStep } from "../../../src/viewer/views/next-steps.js";
import type { Readiness } from "../../../src/viewer/views/delivery.js";
import { HealthDetail, HealthSummary, MapPanel } from "../../../src/viewer/views/overview.js";
import { AnalyzeActionsProvider } from "../../../src/viewer/views/analyze-actions-context.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const zone = (id: string, cohesion: number, coupling: number, files = [`${id}/a.ts`]) => ({
  id, name: id.toUpperCase(), description: "", files, entryPoints: [], cohesion, coupling,
});

const FINDINGS = [
  { type: "anti-pattern", pass: 3, scope: "core", text: "God page", severity: "critical" },
  { type: "anti-pattern", pass: 3, scope: "global", text: "Bidirectional imports between web and rex", severity: "warning" },
  { type: "suggestion", pass: 4, scope: "global", text: "Extract a base handler", severity: "info" },
  { type: "suggestion", pass: 4, scope: "admin", text: "Rename the admin helpers", severity: "warning" },
  { type: "observation", pass: 1, scope: "global", text: "Low cohesion (0.3) somewhere", severity: "info" },
  { type: "relationship", pass: 2, scope: "global", text: "web-viewer imports admin/a.ts across a boundary", severity: "warning" },
  { type: "pattern", pass: 2, scope: "global", text: "Gateway modules everywhere", severity: "info" },
  { type: "move-file", pass: 1, scope: "admin", text: "Move admin/a.ts into web-viewer", severity: "info" },
];

function data(pass = 4): LoadedData {
  return {
    manifest: null, inventory: null, components: null,
    imports: null,
    zones: {
      // core: loosely held together; admin: healthy; web-viewer: tied to everything.
      zones: [zone("core", 0.3, 0.2), zone("admin", 0.9, 0.1), zone("web-viewer", 0.8, 0.7)],
      crossings: [{ from: "web-viewer/a.ts", to: "admin/a.ts", fromZone: "web-viewer", toZone: "admin" }],
      unzoned: [], enrichmentPass: pass, findings: FINDINGS,
    },
  } as unknown as LoadedData;
}

const STEP: NextStep = {
  priority: "high", title: "Split the god page", description: "God page", category: "fix",
  relatedFindings: [0], scope: "core",
};

const READINESS: Readiness = {
  overall: 40,
  dimensions: {
    testing: { score: 0, weight: 1, evidence: [], gaps: [{ summary: "No test command", wouldRaiseScore: "A `test` script" }] },
    ci: { score: 70, weight: 1, evidence: [], gaps: [{ summary: "CI skips tests", wouldRaiseScore: "A test step" }] },
    rollback: { score: 100, weight: 1, evidence: [], gaps: [] },
  },
  suggestions: [],
};

describe("buildHealthActions", () => {
  it("lists next steps first, then the problems and suggestions they do not cover", () => {
    const { items } = buildHealthActions(data(), [STEP]);
    expect(items.map((a) => [a.kind, a.title])).toEqual([
      ["step", "Split the god page"],
      // Finding 0 is the step's: not listed again.
      ["problem", "Bidirectional imports between web and rex"],
      ["suggestion", "Rename the admin helpers"],
      ["suggestion", "Extract a base handler"],
    ]);
  });

  it("tags items with the metric they concern, from their text or their zone", () => {
    const { items } = buildHealthActions(data(), [STEP]);
    const concerns = Object.fromEntries(items.map((a) => [a.title, a.concerns]));
    expect(concerns["Split the god page"]).toEqual(["cohesion"]);
    expect(concerns["Bidirectional imports between web and rex"]).toEqual(["coupling"]);
    expect(concerns["Extract a base handler"]).toEqual([]);
    expect(concernCounts(items, ["cohesion", "coupling"])).toEqual({ cohesion: 1, coupling: 1 });
  });

  it("names the zones an item touches, and notes a remedy that adds files", () => {
    const { items } = buildHealthActions(data(), [STEP]);
    const byTitle = Object.fromEntries(items.map((a) => [a.title, a]));
    expect(byTitle["Split the god page"]!.zones).toEqual(["core"]);
    expect(byTitle["Split the god page"]!.note).toBe(NEW_FILES_NOTE);
    expect(byTitle["Rename the admin helpers"]!.zones).toEqual(["admin"]);
    expect(byTitle["Rename the admin helpers"]!.note).toBeUndefined();
    expect(byTitle["Extract a base handler"]!.zones).toEqual([]);
  });

  it("keeps the Problems and Suggestions views' enrichment gates", () => {
    const { items, gated } = buildHealthActions(data(ENRICHMENT_THRESHOLDS.problems), null);
    expect(items.map((a) => a.kind)).toEqual(["problem", "problem"]);
    expect(gated).toEqual([{ label: "suggestions", pass: ENRICHMENT_THRESHOLDS.suggestions }]);
  });
});

describe("buildInfraActions", () => {
  it("lists readiness gaps weakest practice first, then architecture findings and files to move", () => {
    const { items } = buildInfraActions(data(), READINESS);
    expect(items.map((a) => [a.kind, a.level, a.title])).toEqual([
      ["gap", "high", "Testing: No test command"],
      ["gap", "medium", "CI: CI skips tests"],
      ["relationship", "warning", "web-viewer imports admin/a.ts across a boundary"],
      ["pattern", "info", "Gateway modules everywhere"],
      ["move", "info", "Move admin/a.ts into web-viewer"],
    ]);
  });

  it("puts gaps off the map with their remedy as the note, and findings on the zones they name", () => {
    const { items } = buildInfraActions(data(), READINESS);
    const [testing, , relationship, pattern, move] = items;
    expect(testing!.zones).toEqual([]);
    expect(testing!.note).toContain("A `test` script");
    expect(testing!.concerns).toEqual(["readiness"]);
    expect(relationship!.zones.slice().sort()).toEqual(["admin", "web-viewer"]);
    expect(relationship!.concerns).toEqual(["boundaries"]);
    expect(pattern!.concerns).toEqual([]);
    expect(move!.zones.slice().sort()).toEqual(["admin", "web-viewer"]);
  });

  it("keeps Architecture's enrichment gate and still lists the gaps without one", () => {
    const { items, gated } = buildInfraActions(data(ENRICHMENT_THRESHOLDS.architecture - 1), null);
    expect(items.map((a) => a.kind)).toEqual(["move"]);
    expect(gated).toEqual([{ label: "architecture findings", pass: ENRICHMENT_THRESHOLDS.architecture }]);
  });
});

describe("zoneIssues", () => {
  it("marks zones needing attention, and every zone an item at warning or above touches, critical winning", () => {
    const d = data();
    const items = [...buildHealthActions(d, [STEP]).items, ...buildInfraActions(d, READINESS).items];
    expect(zoneIssues(d, items)).toEqual({ core: "crit", "web-viewer": "warn", admin: "warn" });
  });
});

describe("HealthSummary", () => {
  let root: HTMLElement | undefined;
  afterEach(() => {
    if (root) { act(() => { render(null, root!); }); root.remove(); }
    vi.unstubAllGlobals();
  });

  async function show(tree: (d: LoadedData) => ReturnType<typeof h>): Promise<HTMLElement> {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.startsWith("/api/sv/next-steps")
        ? { ok: true, json: async () => ({ steps: [STEP] }) }
        : { ok: false, json: async () => ({}) }));
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(tree(data()), root!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return root;
  }

  const card = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(".overview-stat-open")].find((c) => c.getAttribute("aria-label")!.startsWith(label))!;
  const titles = (el: HTMLElement) => [...el.querySelectorAll(".health-action-title")].map((t) => t.textContent);

  it("puts the combined list, each item tagged by kind, under the stats", async () => {
    const el = await show((d) => h(HealthSummary, { data: d }));
    expect(el.querySelector(".health-summary > .overview-stats + .health-actions")).not.toBeNull();
    expect([...el.querySelectorAll(".health-action-row .health-kind")].map((k) => k.textContent))
      .toEqual(["Next step", "Problem", "Suggestion", "Suggestion"]);
  });

  it("highlights the items a metric concerns while its card is hovered or focused", async () => {
    const el = await show((d) => h(HealthSummary, { data: d }));
    act(() => { card(el, "Avg coupling").focus(); });
    expect(el.querySelector(".health-actions")?.className).toContain("health-actions--lit");
    expect([...el.querySelectorAll(".health-action--lit .health-action-title")].map((t) => t.textContent))
      .toEqual(["Bidirectional imports between web and rex"]);
    act(() => { card(el, "Avg coupling").blur(); });
    expect(el.querySelector(".health-actions--lit")).toBeNull();
  });

  it("filters the list to a metric's items when its card is clicked, and clears it", async () => {
    const el = await show((d) => h(HealthSummary, { data: d }));
    act(() => card(el, "Avg cohesion").click());
    expect(card(el, "Avg cohesion").getAttribute("aria-pressed")).toBe("true");
    expect(titles(el)).toEqual(["Split the god page"]);
    act(() => el.querySelector<HTMLButtonElement>(".health-actions-filter")!.click());
    expect(titles(el)).toHaveLength(4);
    act(() => card(el, "Avg cohesion").click());
    act(() => card(el, "Avg cohesion").click());
    expect(titles(el)).toHaveLength(4);
  });

  it("names a hovered item's zones beside the map, or says it adds files the map cannot show", async () => {
    const el = await show((d) => h(AnalyzeActionsProvider, { data: d },
      h(HealthSummary, { data: d }),
      h("div", { class: "map" }, h(MapPanel, { data: d }))));
    const item = (title: string) => [...el.querySelectorAll<HTMLElement>(".health-action")]
      .find((li) => li.querySelector(".health-action-title")?.textContent === title)!;
    const note = () => el.querySelector(".map .map-note")?.textContent ?? null;

    expect(note()).toBeNull();
    act(() => { item("Rename the admin helpers").dispatchEvent(new MouseEvent("mouseenter")); });
    expect(note()).toBe("Lit on the map: ADMIN");
    act(() => { item("Split the god page").dispatchEvent(new MouseEvent("mouseenter")); });
    expect(note()).toContain("Lit on the map: CORE");
    expect(note()).toContain(NEW_FILES_NOTE);
    act(() => { item("Extract a base handler").dispatchEvent(new MouseEvent("mouseenter")); });
    expect(note()).toContain("Not on the map");
    act(() => { el.querySelector(".health-actions")!.dispatchEvent(new MouseEvent("mouseleave")); });
    expect(note()).toBeNull();
  });
});

describe("adding recommendations to the PRD", () => {
  let root: HTMLElement | undefined;
  let posted: Array<{ items: Array<Record<string, unknown>> }>;
  afterEach(() => {
    if (root) { act(() => { render(null, root!); }); root.remove(); }
    vi.unstubAllGlobals();
    delete (window as { __NDX_DEPLOYED__?: unknown }).__NDX_DEPLOYED__;
  });

  async function show(tree: (d: LoadedData) => ReturnType<typeof h>): Promise<HTMLElement> {
    posted = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sv/next-steps")) return { ok: true, json: async () => ({ steps: [STEP] }) };
      if (url === "/api/rex/capture-recommendations") {
        const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, unknown>> };
        posted.push(body);
        // The first item of any request is already in the PRD; the rest are added.
        const results = body.items.map((_, i) => (i === 0 && body.items.length > 1 ? "exists" : "created"));
        return {
          ok: true,
          json: async () => ({ ok: true, destination: "Inbox", results, created: results.filter((r) => r === "created").length, skipped: results.filter((r) => r === "exists").length }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }));
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(tree(data()), root!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return root;
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const row = (el: HTMLElement, title: string) => [...el.querySelectorAll<HTMLElement>(".health-action")]
    .find((li) => li.querySelector(".health-action-title")?.textContent === title)!;

  it("adds one recommendation from its row, sending what it found, then says it was added", async () => {
    const el = await show((d) => h(HealthSummary, { data: d }));
    const add = row(el, "Rename the admin helpers").querySelector<HTMLButtonElement>(".health-action-add")!;
    expect(add.textContent).toBe("+ PRD");
    act(() => add.click());
    await settle();
    expect(posted).toEqual([{ items: [{ title: "Rename the admin helpers", kind: "suggestion", level: "warning", zones: ["admin"] }] }]);
    expect(add.textContent).toBe("✓ Added");
    expect(add.disabled).toBe(true);
    expect(el.querySelector(".health-actions-captured")?.textContent).toBe("✓ Added 1 to the Inbox");
  });

  it("opened, adds every item shown after a confirm, and marks each as the server reports", async () => {
    const el = await show((d) => h(HealthDetail, { data: d, openTile: vi.fn(), setDetail: vi.fn() }));
    const addAll = el.querySelector<HTMLButtonElement>(".health-actions-add-all")!;
    expect(addAll.textContent).toBe("+ Add 4 recommendations to PRD");
    act(() => addAll.click());
    expect(posted).toHaveLength(0);
    act(() => el.querySelector<HTMLButtonElement>(".health-actions-add-confirm")!.click());
    await settle();
    expect(posted[0]!.items.map((i) => i.title)).toEqual([
      "Split the god page", "Bidirectional imports between web and rex", "Rename the admin helpers", "Extract a base handler",
    ]);
    expect([...el.querySelectorAll(".health-action-add")].map((b) => b.textContent)).toEqual(["✓ In PRD", "✓ Added", "✓ Added", "✓ Added"]);
    expect(el.querySelector(".health-actions-captured")?.textContent).toBe("✓ Added 3 to the Inbox (1 already in the PRD)");
    // Nothing left to add: the bulk control goes away.
    expect(el.querySelector(".health-actions-add-all")).toBeNull();
  });

  it("sends a readiness gap's remedy as its acceptance criterion", async () => {
    const el = await show((d) => h(AnalyzeActionsProvider, { data: d }, h(InfraArchPanel, { data: d })));
    // The delivery read failed in this stub, so the list holds the findings; a gap is checked directly.
    const gap = buildInfraActions(data(), READINESS).items[0]!;
    expect(recommendationPayload(gap)).toEqual({
      title: "Testing: No test command", detail: "A `test` script", kind: "gap", level: "high", zones: [],
      note: "Not on the map — closing it adds files: A `test` script", acceptanceCriteria: ["A `test` script"],
    });
    expect(el.querySelectorAll(".health-action-add").length).toBeGreaterThan(0);
  });

  it("offers no add in a static export, which has no server to write the PRD", async () => {
    window.__NDX_DEPLOYED__ = { basePath: "/", exportedAt: "" };
    const el = await show((d) => h(HealthSummary, { data: d }));
    expect(el.querySelectorAll(".health-action")).not.toHaveLength(0);
    expect(el.querySelector(".health-action-add")).toBeNull();
  });
});
