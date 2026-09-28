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
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
  rex: { exists: true, percentComplete: 96.4, stats: { total: 1548, completed: 1493, inProgress: 1, pending: 54, deferred: 0, blocked: 0 }, hasInProgress: true, hasPending: true, nextTaskTitle: "Next" },
  hench: { configured: true, totalRuns: 1146, activeRuns: 1, staleRuns: 0 },
};

function stubApi(enabledToggles: string[] = []) {
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
    if (url === "/api/status") return jsonResponse(STATUS);
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
    expect(STAGE_ORDER.map((id) => STAGES[id].label)).toEqual(["Analysis", "Plan", "Work"]);
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
    // Token Usage is on Analysis and Work; a Rex-only viewer has neither.
    expect(stageForView("token-usage", buildValidViews("rex"))).toBeNull();
    expect(stageForView("token-usage", buildValidViews("hench"))).toBe("work");
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

// ── Bottom bar and settings overlay ────────────────────────────

describe("BottomBar", () => {
  it("opens settings from the cog and toggles the commands sheet", async () => {
    const onOpenSettings = vi.fn();
    const onToggleCommands = vi.fn();
    await mount(h(BottomBar, {
      server: { version: "0.7.2", cliPath: "", projectDir: "/work/demo" },
      onNavigate: vi.fn(), onOpenSettings, settingsOpen: false, onToggleCommands, commandsOpen: true,
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
