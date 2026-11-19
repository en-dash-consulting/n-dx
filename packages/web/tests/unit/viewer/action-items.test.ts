// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  NEW_FILES_NOTE,
  buildHealthActions,
  buildInfraActions,
  buildRecommendations,
  filterRecommendations,
  zoneIssues,
  recommendationPayload,
} from "../../../src/viewer/views/action-items.js";
import type { NextStep } from "../../../src/viewer/views/next-steps.js";
import type { Readiness } from "../../../src/viewer/views/delivery.js";
import { MapPanel } from "../../../src/viewer/views/overview.js";
import { GlancePanel } from "../../../src/viewer/views/glance.js";
import { RecommendationsPanel } from "../../../src/viewer/views/recommendations-panel.js";
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
    manifest: null,
    inventory: {
      files: [],
      summary: { totalFiles: 3, totalLines: 300, byLanguage: { TypeScript: 3 }, byRole: { source: 3 }, byCategory: {} },
    },
    components: null,
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

describe("buildRecommendations", () => {
  it("lists next steps, then readiness gaps, then the findings, with files to move last", () => {
    const { items, steps } = buildRecommendations(data(), [STEP], READINESS);
    expect(items.map((a) => [a.kind, a.title])).toEqual([
      ["step", "Split the god page"],
      ["gap", "Testing: No test command"],
      ["gap", "CI: CI skips tests"],
      ["problem", "Bidirectional imports between web and rex"],
      ["suggestion", "Rename the admin helpers"],
      ["suggestion", "Extract a base handler"],
      ["relationship", "web-viewer imports admin/a.ts across a boundary"],
      ["pattern", "Gateway modules everywhere"],
      ["move", "Move admin/a.ts into web-viewer"],
    ]);
    expect(steps).toEqual([STEP]);
    // Every item has its own key, so "+ PRD" state never crosses between them.
    expect(new Set(items.map((a) => a.key)).size).toBe(items.length);
  });

  it("lists a finding a next step covers only as that step, whatever its kind", () => {
    const step: NextStep = { ...STEP, relatedFindings: [0, 5, 7] };
    const kinds = buildRecommendations(data(), [step], null).items.map((a) => a.kind);
    expect(kinds).not.toContain("relationship");
    expect(kinds).not.toContain("move");
  });

  it("carries both sets of enrichment gates", () => {
    const { gated } = buildRecommendations(data(ENRICHMENT_THRESHOLDS.architecture - 1), null, null);
    expect(gated.map((g) => g.label)).toEqual(["problems", "suggestions", "architecture findings"]);
  });
});

describe("filterRecommendations", () => {
  const items = buildRecommendations(data(), [STEP], READINESS).items;
  it("keeps the items a concern tags, or a zone touches, and every item without a filter", () => {
    expect(filterRecommendations(items, null)).toHaveLength(items.length);
    expect(filterRecommendations(items, { kind: "concern", concern: "readiness" }).map((a) => a.kind)).toEqual(["gap", "gap"]);
    expect(filterRecommendations(items, { kind: "zone", zone: "admin", label: "ADMIN" }).map((a) => a.title)).toEqual([
      "Rename the admin helpers",
      "web-viewer imports admin/a.ts across a boundary",
      "Move admin/a.ts into web-viewer",
    ]);
  });
});

describe("zoneIssues", () => {
  it("marks zones needing attention, and every zone an item at warning or above touches, critical winning", () => {
    const d = data();
    expect(zoneIssues(d, buildRecommendations(d, [STEP], READINESS).items)).toEqual({ core: "crit", "web-viewer": "warn", admin: "warn" });
  });
});

// ── The top row: visuals on the left, recommended fixes on the right ──

function stubFetch(extra?: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url.startsWith("/api/sv/next-steps")) return { ok: true, json: async () => ({ steps: [STEP] }) };
    if (url === "/data/readiness.json") return { ok: true, json: async () => READINESS };
    return { ok: false, json: async () => ({}) };
  }));
}

/** The dashboard's top row and map, under one provider, as the stage page draws them. */
const topRow = (d: LoadedData) => h(AnalyzeActionsProvider, { data: d },
  h("div", { class: "left" }, h(GlancePanel, { data: d })),
  h("div", { class: "right" }, h(RecommendationsPanel, { data: d })),
  h("div", { class: "map" }, h(MapPanel, { data: d })));

describe("the Analyze top row", () => {
  let root: HTMLElement | undefined;
  afterEach(() => {
    if (root) { act(() => { render(null, root!); }); root.remove(); }
    vi.unstubAllGlobals();
  });

  async function show(tree: (d: LoadedData) => ReturnType<typeof h>): Promise<HTMLElement> {
    stubFetch();
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(tree(data()), root!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return root;
  }

  const left = (el: HTMLElement) => el.querySelector<HTMLElement>(".left")!;
  const right = (el: HTMLElement) => el.querySelector<HTMLElement>(".right")!;
  const card = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(".overview-stat-open")].find((c) => c.getAttribute("aria-label")!.startsWith(label))!;
  const zoneButton = (el: HTMLElement, name: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(".summary-zone-filter")].find((b) => b.textContent === `!${name}`)!;
  const titles = (el: HTMLElement) => [...el.querySelectorAll(".health-action-title")].map((t) => t.textContent);

  it("puts only visuals and numbers on the left, and every recommended fix on the right", async () => {
    const el = await show(topRow);
    // Left: the stat cards, the language pie, the zone and role bars — no list.
    const statLabels = left(el).querySelectorAll(".overview-stat:not(.overview-stat--signals) .overview-stat-label");
    expect([...statLabels].map((l) => l.firstChild?.textContent)).toEqual([
      "Files", "Zones", "Avg cohesion", "Avg coupling", "SDLC readiness", "Cross-zone imports",
    ]);
    expect(left(el).querySelector(".lang-pie-chart")).not.toBeNull();
    expect(left(el).querySelector('[aria-label="Largest zones"]')).not.toBeNull();
    expect(left(el).querySelector(".health-actions, .health-action")).toBeNull();
    expect(left(el).textContent).not.toContain("What to do");
    // Right: one list holding every kind, each with "+ PRD".
    expect([...right(el).querySelectorAll(".health-action-row .health-kind")].map((k) => k.textContent)).toEqual([
      "Next step", "Readiness", "Readiness", "Problem", "Suggestion", "Suggestion", "Boundary", "Pattern", "Move file",
    ]);
    expect(right(el).querySelectorAll(".health-action-add")).toHaveLength(9);
  });

  it("keeps the '!' on zones with issues, on the left", async () => {
    const el = await show(topRow);
    const zoneLabels = left(el).querySelectorAll('[aria-label="Largest zones"] .tile-sum-bar-label');
    expect([...zoneLabels].map((l) => l.textContent)).toEqual(["!CORE", "!ADMIN", "!WEB-VIEWER"]);
  });

  it("filters the fixes to a '!' zone when it is pressed, and clears the filter", async () => {
    const el = await show(topRow);
    act(() => zoneButton(el, "ADMIN").click());
    expect(zoneButton(el, "ADMIN").getAttribute("aria-pressed")).toBe("true");
    expect(titles(right(el))).toEqual([
      "Rename the admin helpers",
      "web-viewer imports admin/a.ts across a boundary",
      "Move admin/a.ts into web-viewer",
    ]);
    expect(right(el).querySelector(".health-actions-filter")?.textContent).toBe("ADMIN · 3 ×");
    act(() => right(el).querySelector<HTMLButtonElement>(".health-actions-filter")!.click());
    expect(titles(right(el))).toHaveLength(9);
    expect(zoneButton(el, "ADMIN").getAttribute("aria-pressed")).toBe("false");
    // Pressing it twice clears it too.
    act(() => zoneButton(el, "CORE").click());
    expect(titles(right(el))).toEqual(["Split the god page"]);
    act(() => zoneButton(el, "CORE").click());
    expect(titles(right(el))).toHaveLength(9);
  });

  it("filters the fixes to what a stat card concerns, and a second element replaces the first", async () => {
    const el = await show(topRow);
    act(() => card(left(el), "SDLC readiness").click());
    expect(titles(right(el))).toEqual(["Testing: No test command", "CI: CI skips tests"]);
    act(() => card(left(el), "Avg cohesion").click());
    expect(card(left(el), "SDLC readiness").getAttribute("aria-pressed")).toBe("false");
    expect(titles(right(el))).toEqual(["Split the god page"]);
  });

  it("highlights the fixes a hovered element concerns", async () => {
    const el = await show(topRow);
    act(() => { card(left(el), "Avg coupling").focus(); });
    expect(right(el).querySelector(".health-actions")?.className).toContain("health-actions--lit");
    expect([...right(el).querySelectorAll(".health-action--lit .health-action-title")].map((t) => t.textContent))
      .toEqual(["Bidirectional imports between web and rex"]);
    act(() => { card(left(el), "Avg coupling").blur(); });
    expect(right(el).querySelector(".health-actions--lit")).toBeNull();
    act(() => { zoneButton(el, "CORE").dispatchEvent(new MouseEvent("mouseenter")); });
    expect([...right(el).querySelectorAll(".health-action--lit .health-action-title")].map((t) => t.textContent))
      .toEqual(["Split the god page"]);
  });

  it("does not filter from inside the opened visuals tile", async () => {
    const el = await show((d) => h(AnalyzeActionsProvider, { data: d },
      h("div", { class: "left" }, h(GlancePanel, { data: d, opened: true, setDetail: vi.fn() })),
      h("div", { class: "right" }, h(RecommendationsPanel, { data: d }))));
    expect(left(el).querySelector(".summary-zone-filter")).toBeNull();
    const cohesion = card(left(el), "Avg cohesion");
    expect(cohesion.getAttribute("aria-pressed")).toBeNull();
    act(() => cohesion.click());
    expect(titles(right(el))).toHaveLength(9);
    expect(right(el).querySelector(".health-actions-filter")).toBeNull();
  });

  it("names a hovered fix's zones beside the map, or says it adds files the map cannot show", async () => {
    const el = await show(topRow);
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

  async function show(opened = false): Promise<HTMLElement> {
    posted = [];
    stubFetch((url, init) => {
      if (url !== "/api/rex/capture-recommendations") return undefined;
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, unknown>> };
      posted.push(body);
      // The first item of any request is already in the PRD; the rest are added.
      const results = body.items.map((_, i) => (i === 0 && body.items.length > 1 ? "exists" : "created"));
      return {
        ok: true,
        json: async () => ({ ok: true, destination: "Inbox", results, created: results.filter((r) => r === "created").length, skipped: results.filter((r) => r === "exists").length }),
      };
    });
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(h(RecommendationsPanel, { data: data(), opened }), root!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return root;
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const row = (el: HTMLElement, title: string) => [...el.querySelectorAll<HTMLElement>(".health-action")]
    .find((li) => li.querySelector(".health-action-title")?.textContent === title)!;

  it("adds one recommendation from its row, sending what it found, then says it was added", async () => {
    const el = await show();
    const add = row(el, "Rename the admin helpers").querySelector<HTMLButtonElement>(".health-action-add")!;
    expect(add.textContent).toBe("+ PRD");
    act(() => add.click());
    await settle();
    expect(posted).toEqual([{ items: [{ title: "Rename the admin helpers", kind: "suggestion", level: "warning", zones: ["admin"] }] }]);
    expect(add.textContent).toBe("✓ Added");
    expect(add.disabled).toBe(true);
    expect(el.querySelector(".health-actions-captured")?.textContent).toBe("✓ Added 1 to the Inbox");
  });

  it("opened, shows each fix and adds every item shown after a confirm, marking each as the server reports", async () => {
    const el = await show(true);
    expect(row(el, "Testing: No test command").querySelector(".health-action-detail")?.textContent).toBe("A `test` script");
    const addAll = el.querySelector<HTMLButtonElement>(".health-actions-add-all")!;
    expect(addAll.textContent).toBe("+ Add 9 recommendations to PRD");
    act(() => addAll.click());
    expect(posted).toHaveLength(0);
    act(() => el.querySelector<HTMLButtonElement>(".health-actions-add-confirm")!.click());
    await settle();
    expect(posted[0]!.items[0]!.title).toBe("Split the god page");
    expect(posted[0]!.items).toHaveLength(9);
    const states = [...el.querySelectorAll(".health-action-add")].map((b) => b.textContent);
    expect(states[0]).toBe("✓ In PRD");
    expect(states.slice(1).every((s) => s === "✓ Added")).toBe(true);
    expect(el.querySelector(".health-actions-captured")?.textContent).toBe("✓ Added 8 to the Inbox (1 already in the PRD)");
    // Nothing left to add: the bulk control goes away.
    expect(el.querySelector(".health-actions-add-all")).toBeNull();
  });

  it("sends a readiness gap's remedy as its acceptance criterion", () => {
    const gap = buildInfraActions(data(), READINESS).items[0]!;
    expect(recommendationPayload(gap)).toEqual({
      title: "Testing: No test command", detail: "A `test` script", kind: "gap", level: "high", zones: [],
      note: "Not on the map — closing it adds files: A `test` script", acceptanceCriteria: ["A `test` script"],
    });
  });

  it("offers no add in a static export, which has no server to write the PRD", async () => {
    window.__NDX_DEPLOYED__ = { basePath: "/", exportedAt: "" };
    const el = await show();
    expect(el.querySelectorAll(".health-action")).not.toHaveLength(0);
    expect(el.querySelector(".health-action-add")).toBeNull();
  });
});
