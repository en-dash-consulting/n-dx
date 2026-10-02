// @vitest-environment jsdom
/**
 * The navigation model is the one place a view is named.
 *
 * Before `view-meta.ts` the same view was named in four tables — the
 * breadcrumb's `VIEW_META`, the guide's `GUIDE_CONTENT`, the stage sections in
 * `stages.ts`, and a `SOURCEVISION_TABS` list nothing under `src/` read — and
 * they had drifted: `graph` was "Map" in one and "Repository map" in another,
 * and `hench-runs` and `activity` were both "History". These tests pin the
 * three properties that keep that from happening again:
 *
 *   1. every view has exactly one entry,
 *   2. every view is placed in exactly one navigation surface,
 *   3. no two views share a label, and every surface renders the model's.
 *
 * The SourceVision-specific assertions from the retired
 * `sourcevision-tabs.test.ts` live here now, against the Analysis stage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  VIEW_META,
  PRODUCT_LABELS,
  viewLabel,
  viewBlurb,
  viewGlyph,
  viewPixelIcon,
  viewProduct,
  STAGES,
  STAGE_ORDER,
  SETTINGS_ENTRIES,
  isLiveView,
  ENRICHMENT_THRESHOLDS,
  type StageId,
} from "../../../src/viewer/views/index.js";
import { Breadcrumb } from "../../../src/viewer/components/breadcrumb.js";
import { Guide, GUIDE_VIEWS } from "../../../src/viewer/components/guide.js";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { HomeView, StagePage } from "../../../src/viewer/views/stage-pages.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache, resolveCliLabel } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ViewId } from "../../../src/viewer/types.js";

/**
 * Every view, enumerated independently of the model.
 *
 * `buildValidViews(null)` is built from the routing scope lists in
 * `shared/view-routing.ts`, so "the model covers every view" is checked
 * against a table that does not read the model — otherwise it would only be
 * checking the model against itself.
 */
const ALL_VIEWS: ViewId[] = [...buildValidViews(null)].sort();

// ── 1. One entry per view ──────────────────────────────────────

describe("navigation model: coverage", () => {
  it("has an entry for every routable view", () => {
    const missing = ALL_VIEWS.filter((v) => !(v in VIEW_META));
    expect(missing).toEqual([]);
  });

  it("has no entry for anything that is not a routable view", () => {
    const extra = Object.keys(VIEW_META).filter((v) => !ALL_VIEWS.includes(v as ViewId));
    expect(extra).toEqual([]);
  });

  it("every entry is complete", () => {
    for (const view of ALL_VIEWS) {
      expect(viewLabel(view), view).toBeTruthy();
      expect(viewGlyph(view), view).toBeTruthy();
      expect(viewBlurb(view), view).toBeTruthy();
      expect(["sourcevision", "rex", "hench", "global"]).toContain(viewProduct(view));
    }
  });

  it("every product has a display name for document.title", () => {
    for (const view of ALL_VIEWS) {
      expect(PRODUCT_LABELS[viewProduct(view)], view).toBeTruthy();
    }
  });
});

// ── 2. One placement per view ──────────────────────────────────

/** Where a view is reachable from, counted across every navigation surface. */
function placementsOf(view: ViewId): string[] {
  const places: string[] = [];
  if (view === "home") places.push("home");
  if (isLiveView(view)) places.push("live");
  if ((STAGE_ORDER as readonly string[]).includes(view)) places.push(`stage:${view}`);
  for (const stage of STAGE_ORDER) {
    for (const section of STAGES[stage].sections) {
      if (section.view === view) places.push(`section:${stage}`);
      if (section.tabs?.some((t) => t.view === view)) places.push(`tab:${stage}`);
    }
  }
  if (SETTINGS_ENTRIES.some((e) => e.view === view)) places.push("settings");
  return places;
}

describe("navigation model: placement", () => {
  it("places every view exactly once", () => {
    const wrong = ALL_VIEWS
      .map((v) => [v, placementsOf(v)] as const)
      .filter(([, places]) => places.length !== 1)
      .map(([v, places]) => `${v}: ${places.length ? places.join(", ") : "nowhere"}`);
    expect(wrong).toEqual([]);
  });

  it("gives each stage exactly one lead section, first", () => {
    for (const stage of STAGE_ORDER) {
      const sections = STAGES[stage].sections;
      expect(sections.filter((s) => s.plain), stage).toHaveLength(1);
      expect(sections[0].plain, stage).toBe(true);
    }
  });
});

// ── 3. Labels are unique, and every surface uses them ──────────

describe("navigation model: labels", () => {
  it("no two views share a label", () => {
    const byLabel = new Map<string, ViewId[]>();
    for (const view of ALL_VIEWS) {
      const label = viewLabel(view);
      byLabel.set(label, [...(byLabel.get(label) ?? []), view]);
    }
    const clashes = [...byLabel.entries()]
      .filter(([, views]) => views.length > 1)
      .map(([label, views]) => `${label}: ${views.join(", ")}`);
    expect(clashes).toEqual([]);
  });

  // The pair that motivated the task: both were "History".
  it("names the run list Runs and the PRD log Execution Log", () => {
    expect(viewLabel("hench-runs")).toBe("Runs");
    expect(viewLabel("activity")).toBe("Execution Log");
  });

  // No label carries the placeholder today (the settings pages that did were
  // merged into Project), so this holds vacuously until one does again.
  it("resolves the {cli} placeholder in every label that carries one", () => {
    const templated = ALL_VIEWS.filter((v) => viewLabel(v).includes("{cli}"));
    for (const view of templated) {
      expect(resolveCliLabel(viewLabel(view), "myapp")).not.toContain("{cli}");
    }
  });
});

// ── Rendered surfaces read the model ───────────────────────────

/** A complete `/api/status` body, as a healthy server sends it. */
const FULL_STATUS = {
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 12, modulesComplete: 3, modulesTotal: 4 },
  rex: { exists: true, percentComplete: 40, stats: { total: 10, completed: 4, inProgress: 1, pending: 5, deferred: 0, blocked: 0 }, hasInProgress: true, hasPending: true, nextTaskTitle: "t" },
  hench: { configured: true, totalRuns: 7, activeRuns: 1, staleRuns: 0 },
};

function stubProject(status: unknown = FULL_STATUS) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/project")) {
      return {
        ok: true, status: 200,
        json: async () => ({ name: "demo", description: null, version: null, git: null, nameSource: "directory" }),
      };
    }
    if (u.includes("/api/status")) return { ok: true, status: 200, json: async () => status };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
  await act(async () => {});
}

describe("rendered surfaces take their labels from the model", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
    stubProject();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("the breadcrumb's current segment is the model's label, for every view", async () => {
    const wrong: string[] = [];
    for (const view of ALL_VIEWS) {
      act(() => { render(h(Breadcrumb, { view, navigateTo: () => {} }), root); });
      await settle();
      const current = root.querySelector(".breadcrumb-current")?.textContent ?? "";
      const expected = resolveCliLabel(viewLabel(view), "n-dx");
      if (current !== expected) wrong.push(`${view}: rendered "${current}", model says "${expected}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("document.title carries the model's label and product, for every view", async () => {
    const wrong: string[] = [];
    for (const view of ALL_VIEWS) {
      act(() => { render(h(Breadcrumb, { view, navigateTo: () => {} }), root); });
      await settle();
      const label = resolveCliLabel(viewLabel(view), "n-dx");
      const expected = viewProduct(view) === "global" ? `${label} | ` : `${label} — ${PRODUCT_LABELS[viewProduct(view)]}`;
      if (!document.title.startsWith(expected)) {
        wrong.push(`${view}: title "${document.title}" does not start with "${expected}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("survives a view id the model has never heard of", async () => {
    // The crash-recovery banner restores a nav state read from localStorage
    // with an unchecked cast and passes it to `navigateTo`, which does not
    // check it against `validViews`. A key written by an older build, naming
    // a view since removed, reaches the breadcrumb — and a blind lookup would
    // throw through the render, blanking the dashboard during a crash
    // recovery. The project segment survives; the view's own is dropped.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    act(() => {
      render(h(Breadcrumb, { view: "a-view-that-was-removed" as ViewId, navigateTo: () => {} }), root);
    });
    await settle();
    window.removeEventListener("error", onError);

    expect(onError).not.toHaveBeenCalled();
    expect(root.querySelector(".breadcrumb")).not.toBeNull();
    expect(root.querySelector(".breadcrumb-current")).toBeNull();
    expect(root.textContent).toContain("demo");
    // No view segment: the title keeps whatever else it has, but emits no
    // "<label> — <product>" pair for a view the model cannot name.
    expect(document.title).not.toContain("—");
    expect(document.title).not.toContain("undefined");
  });

  it("the top nav names each stage with the model's label", async () => {
    act(() => {
      render(h(TopNav, {
        view: "home", validViews: buildValidViews(null), onNavigate: () => {}, onOpenSearch: () => {},
      }), root);
    });
    await settle();
    const labels = [...root.querySelectorAll("[data-stage] .topnav-tab-label")].map((e) => e.textContent);
    expect(labels).toEqual(STAGE_ORDER.map((id) => viewLabel(id)));
  });

  it("the top nav names the Live tab with the model's label, after the stage tabs", async () => {
    act(() => {
      render(h(TopNav, {
        view: "home", validViews: buildValidViews(null), onNavigate: () => {}, onOpenSearch: () => {},
      }), root);
    });
    await settle();
    const tabs = [...root.querySelectorAll(".topnav-tab")];
    expect(tabs.map((t) => t.querySelector(".topnav-tab-label")?.textContent))
      .toEqual([...STAGE_ORDER, "live"].map((id) => viewLabel(id as ViewId)));
  });

  it("the Home cards name, describe and mark each stage from the model", async () => {
    act(() => {
      render(h(HomeView, { validViews: buildValidViews(null), navigateTo: () => {} }), root);
    });
    await settle();

    const cards = [...root.querySelectorAll(".stage-card")];
    expect(cards).toHaveLength(STAGE_ORDER.length);
    cards.forEach((card, i) => {
      const stage = STAGE_ORDER[i];
      expect(card.querySelector(".stage-card-name")?.textContent).toBe(viewLabel(stage));
      expect(card.querySelector(".stage-card-blurb")?.textContent).toBe(viewBlurb(stage));
      expect(card.querySelector(".stage-card-glyph")?.textContent).toBe(viewGlyph(stage));
      expect(card.querySelector(".stage-card-hint")?.textContent).toBe(viewProduct(stage));
    });
  });

  it("each stage page heads itself with the model's label and blurb", async () => {
    for (const stage of STAGE_ORDER) {
      act(() => {
        render(h(StagePage, {
          stage, validViews: buildValidViews(null), navigateTo: () => {}, renderView: () => null,
        }), root);
      });
      await settle();
      expect(root.querySelector(".stage-page-title")?.textContent, stage).toBe(viewLabel(stage));
      expect(root.querySelector(".stage-page-blurb")?.textContent, stage).toBe(viewBlurb(stage));
    }
  });

  it("each stage section is headed by its view's label and blurb, or its group's", async () => {
    const wrong: string[] = [];
    for (const stage of STAGE_ORDER) {
      act(() => {
        render(h(StagePage, {
          stage, validViews: buildValidViews(null), navigateTo: () => {}, renderView: () => null,
        }), root);
      });
      await settle();
      for (const el of root.querySelectorAll(".stage-section[data-view]:not(.stage-section--plain)")) {
        const view = el.getAttribute("data-view") as ViewId;
        const section = STAGES[stage].sections.find((s) => s.view === view)!;
        const expectedTitle = section.group?.heading ?? viewLabel(view);
        const expectedBlurb = section.group?.blurb ?? viewBlurb(view);
        const title = el.querySelector(".stage-section-title")?.textContent;
        const blurb = el.querySelector(".stage-section-blurb")?.textContent;
        if (title !== expectedTitle) wrong.push(`${stage}/${view}: titled "${title}"`);
        if (blurb !== expectedBlurb) wrong.push(`${stage}/${view}: blurb "${blurb}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every tab in a section is named by its own view", async () => {
    const wrong: string[] = [];
    for (const stage of STAGE_ORDER) {
      act(() => {
        render(h(StagePage, {
          stage, validViews: buildValidViews(null), navigateTo: () => {}, renderView: () => null,
        }), root);
      });
      await settle();
      for (const section of STAGES[stage].sections.filter((s) => s.tabs?.length)) {
        // Open it only if it is closed: a section remembers its open state in
        // localStorage, which is not reset between cases, so a blind click
        // closes an already-open section and leaves nothing to assert on.
        const toggle = root.querySelector<HTMLButtonElement>(
          `.stage-section[data-view="${section.view}"] .stage-section-toggle`,
        );
        if (toggle?.getAttribute("aria-expanded") !== "true") {
          act(() => { toggle?.click(); });
          await settle();
        }
        const tabButtons = [...root.querySelectorAll<HTMLButtonElement>(
          `.stage-section[data-view="${section.view}"] .stage-section-tab`,
        )];
        const expectedViews = [section.view, ...section.tabs!.map((t) => t.view)];
        // A closed section renders no tabs, so this comparison also fails
        // loudly rather than passing having checked nothing.
        if (tabButtons.map((b) => b.textContent).join("|") !== expectedViews.map((v) => viewLabel(v)).join("|")) {
          wrong.push(`${stage}/${section.view}: tabs ${tabButtons.map((b) => b.textContent).join(", ")}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the settings overlay names each entry with the model's label", async () => {
    act(() => {
      render(h(SettingsOverlay, {
        view: "robot-wrangler", validViews: buildValidViews(null),
        onNavigate: () => {}, onClose: () => {}, children: null,
      }), root);
    });
    await settle();

    const rendered = [...root.querySelectorAll(".settings-overlay-item")]
      .map((e) => e.textContent?.replace(/\s+/g, " ").trim() ?? "");
    expect(rendered.length).toBeGreaterThan(0);
    for (const text of rendered) {
      expect(text).not.toContain("{cli}");
      const match = SETTINGS_ENTRIES.some((e) =>
        // A pixel icon is an <svg> with no text; a view without one shows its text glyph.
        text === `${viewPixelIcon(e.view) ? "" : viewGlyph(e.view)}${resolveCliLabel(viewLabel(e.view), "n-dx")}`,
      );
      expect(match, `settings item "${text}" matches no model entry`).toBe(true);
    }
  });

  it("the guide is titled with the model's label, for every view", async () => {
    // Split the two cases rather than accepting either. An assertion that took
    // "the view's label OR Overview" for every view would pass with every
    // title hardcoded to "Overview" — it has to be exact on each side.
    const ownGuide = ALL_VIEWS.filter((v) => GUIDE_VIEWS.has(v));
    const fallback = ALL_VIEWS.filter((v) => !GUIDE_VIEWS.has(v));
    expect(ownGuide.filter((v) => v !== "overview").length).toBeGreaterThan(0);
    expect(fallback.length).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const view of ALL_VIEWS) {
      act(() => { render(h(Guide, { view }), root); });
      await settle();
      act(() => { (root.querySelector(".guide-btn") as HTMLButtonElement).click(); });
      await settle();

      const heading = root.querySelector(".guide-header h2")?.textContent ?? "";
      // A view without its own guide falls back to the Overview prose, and is
      // titled to match the text it shows rather than the page it was opened
      // from — a title that named the page would be labelling someone else's
      // explanation.
      const expected = GUIDE_VIEWS.has(view) ? viewLabel(view) : viewLabel("overview");
      if (heading !== expected) {
        wrong.push(`${view}: guide titled "${heading}", expected "${expected}"`);
      }

      render(null, root);
    }
    expect(wrong).toEqual([]);
  });
});

// ── Moved from sourcevision-tabs.test.ts ───────────────────────

describe("the Analysis stage carries what SOURCEVISION_TABS used to", () => {
  const sectionViews = STAGES.analyze.sections.map((s) => s.view);
  const section = (view: ViewId) => STAGES.analyze.sections.find((s) => s.view === view)!;
  // Every view the stage shows, sections and their tabs flattened — the
  // successor to the old flat `sectionViews` list now that Zones, Routes and
  // the isometric map are tabs rather than sections of their own.
  const allViews = STAGES.analyze.sections.flatMap((s) => [s.view, ...(s.tabs ?? []).map((t) => t.view)]);

  it("lists every SourceVision view, sections and tabs", () => {
    expect(sectionViews).toEqual([
      "overview", "graph", "files", "problems",
      "suggestions", "architecture", "pr-markdown", "ask",
    ]);
    expect(allViews).toEqual([
      "overview", "graph", "iso-map", "zones", "files", "problems",
      "suggestions", "architecture", "routes", "pr-markdown", "ask",
    ]);
  });

  it("folds the repository map, isometric map and zones into one Terrain section", () => {
    const terrain = section("graph");
    expect(terrain.tabs?.map((t) => t.view)).toEqual(["iso-map", "zones"]);
    expect(terrain.group?.heading).toBe("Terrain");
    expect(terrain.tabs?.find((t) => t.view === "iso-map")?.hiddenWhenDeployed).toBe(true);
  });

  it("folds architecture and routes into one section named by Architecture", () => {
    const arch = section("architecture");
    expect(arch.tabs?.map((t) => t.view)).toEqual(["routes"]);
    // No group override: the merged section keeps the `architecture` view's
    // own identity, unlike Terrain, which names no view of its own.
    expect(arch.group).toBeUndefined();
  });

  it("names the repository map and isometric map as the navigation model has them", () => {
    expect(viewLabel("graph")).toBe("Repository Map");
    expect(viewLabel("iso-map")).toBe("Isometric Map");
  });

  it("section views are unique", () => {
    expect(new Set(sectionViews).size).toBe(sectionViews.length);
  });

  it("every view in the stage appears exactly once, sections and tabs together", () => {
    expect(new Set(allViews).size).toBe(allViews.length);
  });

  it("keeps thresholds for the enrichment-gated views", () => {
    // The views gate themselves on these constants (architecture.ts,
    // problems.ts, suggestions.ts); the tab table's parallel `minPass` copy
    // was config nothing read.
    for (const view of ["architecture", "problems", "suggestions"] as const) {
      expect(sectionViews, view).toContain(view);
      expect(ENRICHMENT_THRESHOLDS[view], view).toBeGreaterThan(0);
    }
  });

  it("gates PR Markdown behind a default-off feature flag", () => {
    expect(section("pr-markdown").featureGate).toBe("sourcevision.prMarkdown");
    expect(section("pr-markdown").requiresServer).toBeUndefined();
  });

  it("gates Ask behind a default-off flag and marks it server-rendered", () => {
    // The answer is an on-demand LLM call, so a static export cannot serve it.
    expect(section("ask").featureGate).toBe("sourcevision.ask");
    expect(section("ask").requiresServer).toBe(true);
    expect(viewLabel("ask")).toBe("Ask");
  });

  it("marks the server-built views so static exports hide them", () => {
    // The isometric map is hidden in a static export by its section's `alt`
    // being dropped there, and Ask and Workspaces by `requiresServer`.
    const serverBuilt = STAGE_ORDER.flatMap((stage: StageId) =>
      STAGES[stage].sections.filter((s) => s.requiresServer).map((s) => s.view),
    );
    expect(serverBuilt).toEqual(["ask", "workspaces"]);
  });
});
