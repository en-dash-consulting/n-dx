// @vitest-environment jsdom
/**
 * The dashboard shell: top nav, stage pages, side stage links, bottom bar,
 * settings overlay and the landing page — the layout that replaced the
 * sidebar. What the sidebar tests used to guarantee (scope filtering, the
 * active item staying lit, accordion sections that remember their state,
 * accessible toggles) is asserted here against the pieces that now carry it.
 *
 * @see src/viewer/views/stages.ts — the layout as data
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { StageLinks } from "../../../src/viewer/components/stage-links.js";
import { BottomBar } from "../../../src/viewer/components/bottom-bar.js";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { HomeView, StagePage } from "../../../src/viewer/views/stage-pages.js";
import {
  STAGES,
  STAGE_ORDER,
  SETTINGS_ENTRIES,
  isSettingsView,
  stageForView,
  viewLabel,
  visibleStages,
} from "../../../src/viewer/views/stages.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { buildValidViews, isKnownViewPath } from "../../../src/shared/index.js";
import type { LoadedData, ViewId } from "../../../src/viewer/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STATUS = {
  initialized: true,
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
  rex: { exists: true, percentComplete: 96.4, stats: { total: 1548, completed: 1493, inProgress: 1, pending: 54, deferred: 0, blocked: 0 }, hasInProgress: true, hasPending: true, nextTaskTitle: "Next" },
  hench: { configured: true, totalRuns: 1146, activeRuns: 1, staleRuns: 0 },
};

function stubApi(enabledToggles: string[] = [], status: unknown = STATUS) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/features") {
      return jsonResponse({
        toggles: enabledToggles.map((key) => ({
          key, label: key, description: "", impact: "", package: "web", stability: "experimental", defaultValue: false, enabled: true,
        })),
      });
    }
    if (url === "/api/project") {
      return jsonResponse({ name: "demo-project", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
    }
    if (url === "/api/status") return jsonResponse(status);
    return jsonResponse({}, 404);
  }));
}

let root: HTMLDivElement;

async function mount(vnode: VNode): Promise<HTMLDivElement> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(vnode, root); });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
  return root;
}

beforeEach(() => {
  clearProjectMetadataCache();
  localStorage.clear();
  delete (window as { __NDX_DEPLOYED__?: unknown }).__NDX_DEPLOYED__;
  stubApi();
});

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ALL = buildValidViews(null);

// ── The layout as data ─────────────────────────────────────────

describe("stages.ts", () => {
  it("orders the loop Analysis → Plan → Work", () => {
    expect(STAGE_ORDER.map((id) => viewLabel(id))).toEqual(["Analysis", "Plan", "Work"]);
  });

  it("lists only real views, each with a registry renderer", () => {
    const ctx = { navigateTo: () => {}, data: {} as LoadedData } as unknown as ViewRenderContext;
    for (const id of STAGE_ORDER) {
      for (const s of STAGES[id].sections) {
        for (const view of [s.view, s.alt?.view].filter(Boolean) as ViewId[]) {
          expect(isKnownViewPath(view), `${id} lists unknown view ${view}`).toBe(true);
          expect(renderActiveView(view, ctx), `no renderer for ${view}`).not.toBeNull();
        }
      }
    }
  });

  it("keeps settings out of the stages and every stage and home routable", () => {
    for (const id of STAGE_ORDER) {
      for (const s of STAGES[id].sections) expect(isSettingsView(s.view)).toBe(false);
      expect(isKnownViewPath(id)).toBe(true);
    }
    expect(isKnownViewPath("home")).toBe(true);
    expect(SETTINGS_ENTRIES.map((e) => e.view)).toEqual([
      "llm-provider", "project-settings", "hench-config", "notion-config", "integrations", "commands", "feature-toggles", "cli-timeouts",
    ]);
  });

  it("puts PRD items and the execution log on Work, above Templates", () => {
    const work = STAGES.work.sections.map((s) => s.view);
    expect(work.indexOf("rex-dashboard")).toBeLessThan(work.indexOf("activity"));
    expect(work.indexOf("activity")).toBeLessThan(work.indexOf("hench-templates"));
    expect(STAGES.analyze.sections.map((s) => s.view)).not.toContain("rex-dashboard");
  });

  it("puts CLI help above History on Plan", () => {
    const plan = STAGES.plan.sections.map((s) => s.view);
    expect(plan.indexOf("command-reference")).toBeLessThan(plan.indexOf("hench-runs"));
  });

  it("finds a view's stage, honouring the viewer's scope", () => {
    expect(stageForView("zones")).toBe("analyze");
    expect(stageForView("iso-map")).toBe("analyze"); // the 3D projection of the map section
    expect(stageForView("hench-runs")).toBe("plan");
    expect(stageForView("rex-dashboard")).toBe("work");
    expect(stageForView("work")).toBe("work");
    expect(stageForView("home")).toBeNull();
    expect(stageForView("llm-provider")).toBeNull();
    // Token Usage is on Work only; a Rex-only viewer has no Work stage.
    expect(stageForView("token-usage")).toBe("work");
    expect(stageForView("token-usage", buildValidViews("rex"))).toBeNull();
    expect(stageForView("token-usage", buildValidViews("hench"))).toBe("work");
  });

  it("lists each view in at most one stage", () => {
    // stageForView returns the first stage in loop order, so a view listed
    // twice lights the wrong stage when opened from the later one.
    const owner = new Map<ViewId, string>();
    for (const id of STAGE_ORDER) {
      for (const s of STAGES[id].sections) {
        for (const view of [s.view, s.alt?.view].filter(Boolean) as ViewId[]) {
          expect(owner.get(view), `${view} is on both ${owner.get(view)} and ${id}`).toBeUndefined();
          owner.set(view, id);
        }
      }
    }
  });

  it("gives a scoped viewer only its own stage", () => {
    expect(visibleStages(ALL)).toEqual(["analyze", "plan", "work"]);
    expect(visibleStages(buildValidViews("sourcevision"))).toEqual(["analyze"]);
    expect(visibleStages(buildValidViews("rex"))).toEqual(["plan"]);
    expect(visibleStages(buildValidViews("hench"))).toEqual(["work"]);
  });
});

// ── Top nav ────────────────────────────────────────────────────

describe("TopNav", () => {
  function nav(view: ViewId, extra: Partial<Parameters<typeof TopNav>[0]> = {}) {
    return h(TopNav, { view, validViews: ALL, onNavigate: vi.fn(), onOpenSearch: vi.fn(), ...extra });
  }
  const tabLabels = () => Array.from(root.querySelectorAll(".topnav-tab .topnav-tab-label")).map((el) => el.textContent);
  const activeTab = () => root.querySelector(".topnav-tab.active .topnav-tab-label")?.textContent ?? null;

  it("shows exactly the three stages, under the View navigation landmark", async () => {
    await mount(nav("home"));
    expect(root.querySelector('nav[aria-label="View navigation"]')).not.toBeNull();
    expect(tabLabels()).toEqual(["Analysis", "Plan", "Work"]);
    expect(activeTab()).toBeNull();
    expect(root.querySelector(".topnav-brand")?.getAttribute("aria-current")).toBe("page");
  });

  it("keeps a stage lit on its own page and on every view it lists", async () => {
    await mount(nav("analyze"));
    expect(activeTab()).toBe("Analysis");
    expect(root.querySelector(".topnav-tab.active")?.getAttribute("aria-current")).toBe("page");
    await act(async () => { render(nav("zones"), root); });
    expect(activeTab()).toBe("Analysis");
    await act(async () => { render(nav("hench-templates"), root); });
    expect(activeTab()).toBe("Work");
  });

  it("navigates: the brand goes home, a tab goes to its stage, search opens search", async () => {
    const onNavigate = vi.fn();
    const onOpenSearch = vi.fn();
    await mount(nav("zones", { onNavigate, onOpenSearch }));
    act(() => { root.querySelector<HTMLButtonElement>(".topnav-brand")!.click(); });
    expect(onNavigate).toHaveBeenLastCalledWith("home");
    act(() => { root.querySelector<HTMLButtonElement>('.topnav-tab[data-stage="plan"]')!.click(); });
    expect(onNavigate).toHaveBeenLastCalledWith("plan");
    act(() => { root.querySelector<HTMLButtonElement>(".topnav-search")!.click(); });
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("scoped: one tab, and the brand says standalone viewer", async () => {
    await mount(nav("overview", { validViews: buildValidViews("sourcevision"), scope: "sourcevision" }));
    expect(tabLabels()).toEqual(["Analysis"]);
    expect(root.querySelector(".topnav-subtitle")?.textContent).toBe("standalone viewer");
  });

  it("names the project in the brand", async () => {
    await mount(nav("home"));
    expect(root.querySelector(".topnav-project")?.textContent).toBe("demo-project");
  });
});

// ── Side stage links ───────────────────────────────────────────

describe("StageLinks", () => {
  const links = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".stage-link")).map((b) => b.dataset.stage);

  it("points each stage at its neighbours, wrapping around the loop", async () => {
    await mount(h(StageLinks, { stage: "analyze", validViews: ALL, onNavigate: vi.fn() }));
    expect(links()).toEqual(["work", "plan"]);
    await act(async () => { render(h(StageLinks, { stage: "work", validViews: ALL, onNavigate: vi.fn() }), root); });
    expect(links()).toEqual(["plan", "analyze"]);
  });

  it("navigates on click and labels both directions", async () => {
    const onNavigate = vi.fn();
    await mount(h(StageLinks, { stage: "plan", validViews: ALL, onNavigate }));
    const next = root.querySelector<HTMLButtonElement>(".stage-link-next")!;
    expect(next.getAttribute("aria-label")).toBe("Next stage: Work");
    act(() => { next.click(); });
    expect(onNavigate).toHaveBeenCalledWith("work");
  });

  it("shows nothing off a stage, or with one stage to step through", async () => {
    await mount(h(StageLinks, { stage: null, validViews: ALL, onNavigate: vi.fn() }));
    expect(links()).toEqual([]);
    await act(async () => { render(h(StageLinks, { stage: "analyze", validViews: buildValidViews("sourcevision"), onNavigate: vi.fn() }), root); });
    expect(links()).toEqual([]);
  });
});

// ── Stage pages ────────────────────────────────────────────────

describe("StagePage", () => {
  const rendered: ViewId[] = [];
  const renderView = (view: ViewId) => { rendered.push(view); return h("div", { class: "fake-view", "data-rendered": view }); };
  const page = (stage: "analyze" | "plan" | "work", validViews = ALL, navigateTo = vi.fn()) =>
    h(StagePage, { stage, validViews, navigateTo, renderView });
  const sectionViews = () => Array.from(root.querySelectorAll<HTMLElement>(".stage-section")).map((el) => el.dataset.view);

  beforeEach(() => { rendered.length = 0; });

  it("stacks the stage's sections in order and mounts only the open ones", async () => {
    await mount(page("work"));
    expect(sectionViews()).toEqual(STAGES.work.sections.map((s) => s.view));
    // Only "Up next" opens on arrival, so only it has rendered.
    expect([...new Set(rendered)]).toEqual(["rex-dashboard"]);
  });

  it("shows each stage's lead section in the page itself, with no dropdown", async () => {
    for (const stage of STAGE_ORDER) {
      const lead = STAGES[stage].sections[0];
      expect(lead.plain, `${stage} lead is plain`).toBe(true);
      expect(STAGES[stage].sections.filter((s) => s.plain)).toHaveLength(1);

      rendered.length = 0;
      if (root) { render(null, root); root.remove(); }
      await mount(page(stage));
      const el = root.querySelector(`.stage-section[data-view="${lead.view}"]`)!;
      expect(el.classList.contains("stage-section--plain")).toBe(true);
      expect(el.querySelector(".stage-section-toggle")).toBeNull();
      expect(el.querySelector(`[data-rendered="${lead.view}"]`)).not.toBeNull();
    }
  });

  it("opens and closes a section, remembering the choice", async () => {
    await mount(page("work"));
    const toggle = root.querySelector<HTMLButtonElement>('.stage-section[data-view="activity"] .stage-section-toggle')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(body?.querySelector('[data-rendered="activity"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("ndx.stage-sections")!)).toMatchObject({ "work:activity": true });

    render(null, root);
    root.remove();
    await mount(page("work"));
    expect(root.querySelector('.stage-section[data-view="activity"] .stage-section-toggle')?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps History a bounded scroll region until Expand, remembering the choice", async () => {
    expect(STAGES.work.sections.find((s) => s.view === "activity")?.scroll).toBe(true);
    expect(STAGES.plan.sections.find((s) => s.view === "hench-runs")?.scroll).toBe(true);
    expect(STAGES.analyze.sections.find((s) => s.view === "files")?.scroll).toBe(true);

    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "work:activity": true }));
    await mount(page("work"));
    const history = () => root.querySelector('.stage-section[data-view="activity"]')!;
    const body = () => history().querySelector<HTMLElement>(".stage-section-body")!;
    const expand = () => history().querySelector<HTMLButtonElement>(".stage-section-expand")!;

    expect(body().classList.contains("stage-section-body--scroll")).toBe(true);
    expect(body().getAttribute("tabindex")).toBe("0");
    expect(expand().getAttribute("aria-expanded")).toBe("false");

    act(() => { expand().click(); });
    expect(body().classList.contains("stage-section-body--scroll")).toBe(false);
    expect(expand().getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(localStorage.getItem("ndx.stage-sections")!)).toMatchObject({ "work:activity:full": true });

    // Sections without the option get no Expand control.
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "work:hench-templates": true }));
    render(null, root);
    root.remove();
    await mount(page("work"));
    expect(root.querySelector('.stage-section[data-view="hench-templates"] .stage-section-expand')).toBeNull();
  });

  it("flips the map section between the 2D and 3D projections", async () => {
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "analyze:graph": true }));
    await mount(page("analyze"));
    const map = root.querySelector('.stage-section[data-view="graph"]')!;
    expect(map.querySelector('[data-rendered="graph"]')).not.toBeNull();
    const [flat, iso] = Array.from(map.querySelectorAll<HTMLButtonElement>(".stage-section-projection-btn"));
    expect([flat.textContent, iso.textContent]).toEqual(["2D", "3D"]);
    act(() => { iso.click(); });
    expect(map.querySelector('[data-rendered="iso-map"]')).not.toBeNull();
    expect(map.querySelector('[data-rendered="graph"]')).toBeNull();
    expect(iso.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a section's view on its own page", async () => {
    const navigateTo = vi.fn();
    await mount(page("plan", ALL, navigateTo));
    act(() => { root.querySelector<HTMLButtonElement>('.stage-section[data-view="validation"] .stage-section-open')!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("validation");
  });

  it("embeds the Tasks tree, open on arrival, in a bounded-height body it can fill", async () => {
    await mount(page("plan"));
    expect(rendered).toContain("prd");
    const body = root.querySelector('.stage-section[data-view="prd"] .stage-section-body');
    // The tree's virtual scroller sizes itself from this container; without a
    // bounded height it measures zero and shows no items.
    expect(body?.classList.contains("stage-section-body--fill")).toBe(true);
    expect(body?.querySelector('[data-rendered="prd"]')).not.toBeNull();
  });

  it("keeps Work lit when its Usage section is opened", async () => {
    const navigateTo = vi.fn();
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "work:token-usage": true }));
    await mount(page("work", ALL, navigateTo));
    act(() => { root.querySelector<HTMLButtonElement>('.stage-section[data-view="token-usage"] .stage-section-open')!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("token-usage");

    render(null, root);
    root.remove();
    await mount(h(TopNav, { view: "token-usage", validViews: ALL, onNavigate: vi.fn(), onOpenSearch: vi.fn() }));
    expect(root.querySelector(".topnav-tab.active .topnav-tab-label")?.textContent).toBe("Work");
  });

  it("drops sections outside the viewer's scope", async () => {
    await mount(page("work", buildValidViews("hench")));
    // Up next is Rex's dashboard: not in a Hench-only viewer.
    expect(sectionViews()).not.toContain("rex-dashboard");
    expect(sectionViews()).toContain("hench-templates");
  });
});

// ── Landing ────────────────────────────────────────────────────

describe("HomeView", () => {
  it("shows the three stages as columns in loop order, each going to its stage", async () => {
    const navigateTo = vi.fn();
    await mount(h(HomeView, { validViews: ALL, navigateTo }));
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>(".stage-card"));
    expect(cards.map((c) => c.querySelector(".stage-card-name")?.textContent)).toEqual(["Analysis", "Plan", "Work"]);
    expect(cards.every((c) => c.querySelector(".stage-card-mark img"))).toBe(true);
    act(() => { cards[1].click(); });
    expect(navigateTo).toHaveBeenCalledWith("plan");
  });

  it("carries each stage's headline numbers from the project status", async () => {
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    const cards = Array.from(root.querySelectorAll(".stage-card"));
    expect(cards[0].textContent).toContain("6/6");
    expect(cards[1].textContent).toContain("1,548");
    expect(cards[1].textContent).toContain("96%");
    expect(cards[2].textContent).toContain("1,146");
  });
});

describe("HomeView next-step panel", () => {
  const NOT_INITIALIZED = {
    initialized: false,
    sv: { freshness: "unavailable", analyzedAt: null, minutesAgo: null, modulesComplete: 0, modulesTotal: 6 },
    rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
    hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
  };
  const NOT_ANALYZED = {
    ...NOT_INITIALIZED,
    initialized: true,
    hench: { ...NOT_INITIALIZED.hench, configured: true },
  };
  const NO_PRD = {
    ...STATUS,
    rex: { ...STATUS.rex, exists: true, stats: { ...STATUS.rex.stats, total: 0 }, nextTaskTitle: null },
  };

  it("names `init` on a never-touched project, above the three stage cards", async () => {
    stubApi([], NOT_INITIALIZED);
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    const panel = root.querySelector(".next-step-panel");
    expect(panel?.getAttribute("data-state")).toBe("not-initialized");
    expect(panel?.querySelector(".next-step-command")?.textContent).toBe("n-dx init");
    // The panel replaces no stage content — all three cards are still there.
    expect(root.querySelectorAll(".stage-card")).toHaveLength(3);
    const panelIndex = Array.from(root.querySelector(".home")!.children).indexOf(panel!);
    const stagesIndex = Array.from(root.querySelector(".home")!.children).findIndex((el) => el.classList.contains("home-stages"));
    expect(panelIndex).toBeLessThan(stagesIndex);
  });

  it("names `analyze` once initialised but never analysed", async () => {
    stubApi([], NOT_ANALYZED);
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    const panel = root.querySelector(".next-step-panel");
    expect(panel?.getAttribute("data-state")).toBe("not-analyzed");
    expect(panel?.querySelector(".next-step-command")?.textContent).toBe("n-dx analyze");
  });

  it("names `plan` once analysed with no PRD", async () => {
    stubApi([], NO_PRD);
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    const panel = root.querySelector(".next-step-panel");
    expect(panel?.getAttribute("data-state")).toBe("no-prd");
    expect(panel?.querySelector(".next-step-command")?.textContent).toBe("n-dx plan");
  });

  it("names the next task's title and `work` once a PRD is present", async () => {
    stubApi([], STATUS);
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    const panel = root.querySelector(".next-step-panel");
    expect(panel?.getAttribute("data-state")).toBe("has-task");
    expect(panel?.querySelector(".next-step-headline")?.textContent).toContain("Next");
    expect(panel?.querySelector(".next-step-command")?.textContent).toBe("n-dx work");
  });

  it("resolves the command through the project's configured CLI name", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/project") {
        return jsonResponse({ name: "demo-project", description: null, version: null, git: null, nameSource: "directory", cliName: "custom-cli" });
      }
      if (url === "/api/status") return jsonResponse(NOT_INITIALIZED);
      if (url === "/api/features") return jsonResponse({ toggles: [] });
      return jsonResponse({}, 404);
    }));
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    expect(root.querySelector(".next-step-command")?.textContent).toBe("custom-cli init");
  });

  it("leaves an empty slot below the panel for the preflight card", async () => {
    stubApi([], STATUS);
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    expect(root.querySelector('[data-slot="preflight"]')).not.toBeNull();
  });

  it("names no command at all when the status is unavailable", async () => {
    // A 404 is what a static export serves: `ndx export` writes api/config.json
    // and api/project.json but never api/status.json, so the deployed viewer's
    // fetch adapter resolves /api/status to a missing file. The same null
    // status also holds on every cold load before the first poll resolves, and
    // whenever the server is unreachable.
    //
    // In none of those does the viewer know the project's state, so it must not
    // assert one: telling the reader of a published dashboard to run `init` on
    // a fully analysed project is wrong, and acting on it would re-run
    // sourcevision/rex/hench init over a set-up project.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/project") {
        return jsonResponse({ name: "demo-project", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
      }
      if (url === "/api/features") return jsonResponse({ toggles: [] });
      return jsonResponse({}, 404);
    }));
    await mount(h(HomeView, { validViews: ALL, navigateTo: vi.fn() }));
    expect(root.querySelector(".next-step-panel")).toBeNull();
    // Home itself still renders — the cards just carry no numbers.
    expect(root.querySelectorAll(".stage-card")).toHaveLength(3);
  });
});

// ── Bottom bar and settings overlay ────────────────────────────

describe("BottomBar", () => {
  it("opens settings from the cog and toggles the commands sheet", async () => {
    const onOpenSettings = vi.fn();
    const onToggleCommands = vi.fn();
    await mount(h(BottomBar, {
      server: { version: "0.7.2", cliPath: "", projectDir: "/work/demo" },
      validViews: ALL, onNavigate: vi.fn(), onOpenSettings, settingsOpen: false, onToggleCommands, commandsOpen: true,
    }));
    expect(root.querySelector(".bottombar-server")?.textContent).toContain("n-dx 0.7.2");
    const cog = root.querySelector<HTMLButtonElement>(".bottombar-settings")!;
    expect(cog.getAttribute("aria-label")).toBe("Settings");
    act(() => { cog.click(); });
    expect(onOpenSettings).toHaveBeenCalledOnce();
    const commands = root.querySelector<HTMLButtonElement>(".bottombar-commands")!;
    expect(commands.getAttribute("aria-expanded")).toBe("true");
    act(() => { commands.click(); });
    expect(onToggleCommands).toHaveBeenCalledOnce();
    expect(root.querySelector(".theme-toggle")).not.toBeNull();
  });
});

describe("BottomBar status indicators", () => {
  function bar(validViews: ReadonlySet<ViewId>, onNavigate = vi.fn()) {
    return h(BottomBar, {
      validViews, onNavigate, onOpenSettings: vi.fn(), settingsOpen: false, onToggleCommands: vi.fn(), commandsOpen: false,
    });
  }
  const indicators = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".bottombar-status button"));

  it("shows all three in the full dashboard, each opening its product's view", async () => {
    const onNavigate = vi.fn();
    await mount(bar(ALL, onNavigate));
    expect(indicators()).toHaveLength(3);
    for (const b of indicators()) act(() => { b.click(); });
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(["overview", "rex-dashboard", "hench-runs"]);
  });

  it("scoped: shows only the indicators whose view is in scope", async () => {
    // /api/status reports every product even to a scoped viewer.
    for (const scope of ["sourcevision", "rex", "hench"] as const) {
      const onNavigate = vi.fn();
      const validViews = buildValidViews(scope);
      if (root) { render(null, root); root.remove(); }
      await mount(bar(validViews, onNavigate));
      expect(indicators(), scope).toHaveLength(1);
      act(() => { indicators()[0].click(); });
      expect(validViews.has(onNavigate.mock.calls[0][0]), `${scope} navigated to ${onNavigate.mock.calls[0][0]}`).toBe(true);
    }
  });
});

describe("SettingsOverlay", () => {
  function overlay(view: ViewId, onNavigate = vi.fn(), onClose = vi.fn()) {
    return h(SettingsOverlay, { view, validViews: ALL, onNavigate, onClose, children: h("div", { class: "fake-settings" }) });
  }
  /** Item labels: the element's own text, without the glyph span. */
  const items = () => Array.from(root.querySelectorAll(".settings-overlay-item")).map((el) =>
    Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim());

  it("is a modal dialog listing the settings pages, gated ones hidden while off", async () => {
    await mount(overlay("llm-provider"));
    const dialog = root.querySelector(".settings-overlay")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(items()).toEqual(["General", "n-dx analyze / plan", "n-dx work", "n-dx export / refresh", "Feature Flags", "CLI Timeouts"]);
    expect(root.querySelector(".fake-settings")).not.toBeNull();
    expect(root.querySelector(".settings-overlay-crumbs")?.textContent).toContain("General");
  });

  it("shows the gated pages when their toggles are on", async () => {
    stubApi(["rex.notionSync", "rex.integrations"]);
    await mount(overlay("llm-provider"));
    expect(items()).toContain("n-dx sync");
    expect(items()).toContain("Integrations");
  });

  it("switches pages and closes with the ✕ or Escape", async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    await mount(overlay("hench-config", onNavigate, onClose));
    expect(root.querySelector(".settings-overlay-item.active")?.textContent).toContain("work");
    act(() => { (root.querySelectorAll<HTMLButtonElement>(".settings-overlay-item")[0]).click(); });
    expect(onNavigate).toHaveBeenCalledWith("llm-provider");
    act(() => { root.querySelector<HTMLButtonElement>(".settings-overlay-close")!.click(); });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
