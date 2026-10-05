/**
 * The landing page and the three stage pages.
 *
 * A stage page is a stack of collapsible sections, one per product view the
 * stage lists in stages.ts. Each section renders the real view — nothing is
 * re-implemented here — and mounts it only while open, so a page of eleven
 * sections does not start eleven fetches. "Open" goes to the view's own page.
 *
 * The view renderer is passed in by the registry rather than imported, which
 * keeps this module out of a cycle with view-registry.ts.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useState } from "preact/hooks";
import type { ViewId, NavigateTo } from "../types.js";
import {
  STAGES,
  visibleStages,
  stageProduct,
  viewLabel,
  viewBlurb,
  viewGlyph,
  type StageId,
  type StageSection,
  type StageTab,
} from "./stages.js";
import { ProductLogoPng, ReadyToRun, useProjectStatus, type ProjectStatus } from "../components/index.js";
import { useFeatureToggle, useCliName, resolveCliLabel } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";

export type RenderView = (view: ViewId) => ComponentChild;

// ── Section ────────────────────────────────────────────────────

const OPEN_KEY = "ndx.stage-sections";

function readOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpenState(key: string, open: boolean): void {
  try {
    const all = readOpenState();
    all[key] = open;
    localStorage.setItem(OPEN_KEY, JSON.stringify(all));
  } catch { /* storage unavailable — state lasts for this page */ }
}

interface SectionProps {
  stage: StageId;
  section: StageSection;
  validViews: ReadonlySet<ViewId>;
  deployed: boolean;
  navigateTo: NavigateTo;
  renderView: RenderView;
}

/** The stage's lead section: the view itself, in the page, no dropdown. */
function PlainSection({ section, renderView }: Pick<SectionProps, "section" | "renderView">) {
  return h("section", { class: "stage-section stage-section--plain", "data-view": section.view, "aria-label": viewLabel(section.view) },
    renderView(section.view),
  );
}

/** Move the active tab with the arrow keys — the roving-tabindex tablist pattern. */
function tabListKeyDown(e: KeyboardEvent, tabs: readonly StageTab[], activeIndex: number, activate: (view: ViewId) => void): void {
  let next: number | null = null;
  if (e.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  if (next === null || next === activeIndex) return;
  e.preventDefault();
  const view = tabs[next]!.view;
  activate(view);
  const list = (e.currentTarget as HTMLElement).closest(".stage-section-tablist");
  list?.querySelector<HTMLButtonElement>(`[data-tab="${view}"]`)?.focus();
}

function Section({ stage, section, validViews, deployed, navigateTo, renderView }: SectionProps) {
  const key = `${stage}:${section.view}`;
  const [open, setOpen] = useState<boolean>(() =>
    section.collapsedOnLoad ? false : readOpenState()[key] ?? !!section.open);
  // Scroll sections: bounded by default, full length on Expand. Stored beside
  // the open state under "<stage>:<view>:full".
  const fullKey = `${key}:full`;
  const [full, setFull] = useState<boolean>(() => readOpenState()[fullKey] ?? false);

  // `view` is always the section's first tab; `tabs` adds the rest. Folds
  // what used to be separate sections (Zones; Architecture and Routes) into
  // one, and generalises the old 2D/3D toggle the same way (its `iso-map`
  // side is the one tab still dropped in a static export).
  const allTabs: StageTab[] = [{ view: section.view }, ...(section.tabs ?? [])];
  const tabs = allTabs.filter((t) => validViews.has(t.view) && !(deployed && t.hiddenWhenDeployed));
  const hasTabs = tabs.length > 1;
  // Not persisted across reloads, same as the toggle it replaces: a section
  // always opens back on its first tab.
  const [activeTab, setActiveTab] = useState<ViewId>(section.view);
  const shown: ViewId = tabs.some((t) => t.view === activeTab) ? activeTab : section.view;

  const bodyId = `stage-section-${stage}-${section.view}`;
  // A section named by a group (Terrain) takes its heading from the group,
  // since no one view is its identity; otherwise it is named by its view, the
  // same string the breadcrumb shows once the "Open" link has been followed.
  const title = section.group?.heading ?? viewLabel(section.view);
  const blurb = section.group?.blurb ?? viewBlurb(section.view);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpenState(key, next);
  };
  const toggleFull = () => {
    const next = !full;
    setFull(next);
    writeOpenState(fullKey, next);
  };

  const bodyClass = [
    "stage-section-body",
    section.fill ? "stage-section-body--fill" : "",
    section.scroll && !full ? "stage-section-body--scroll" : "",
  ].filter(Boolean).join(" ");

  return h("section", { class: `stage-section${open ? " stage-section--open" : ""}`, "data-view": section.view },
    h("div", { class: "stage-section-head" },
      h("button", {
        type: "button",
        class: "stage-section-toggle",
        onClick: toggle,
        "aria-expanded": String(open),
        "aria-controls": bodyId,
      },
        h("span", { class: "stage-section-caret", "aria-hidden": "true" }, open ? "▾" : "▸"),
        h("span", { class: "stage-section-title" }, title),
        h("span", { class: "stage-section-blurb" }, blurb),
      ),
      hasTabs && open
        ? h("div", { class: "stage-section-tablist", role: "tablist", "aria-label": `${title} views` },
            tabs.map((t, i) => {
              const selected = t.view === shown;
              return h("button", {
                key: t.view,
                type: "button",
                role: "tab",
                id: `${bodyId}-tab-${t.view}`,
                "data-tab": t.view,
                class: `stage-section-tab${selected ? " active" : ""}`,
                "aria-selected": String(selected),
                "aria-controls": bodyId,
                tabIndex: selected ? 0 : -1,
                onClick: () => setActiveTab(t.view),
                onKeyDown: (e: KeyboardEvent) => tabListKeyDown(e, tabs, i, setActiveTab),
              }, viewLabel(t.view));
            }),
          )
        : null,
      section.scroll && open
        ? h("button", {
            type: "button",
            class: "stage-section-expand",
            onClick: toggleFull,
            "aria-expanded": String(full),
            "aria-controls": bodyId,
            title: full ? "Show as a scrollable list" : "Show at full length",
            "aria-label": `${full ? "Collapse" : "Expand"} ${title}`,
          }, full ? "Collapse ▴" : "Expand ▾")
        : null,
      h("button", {
        type: "button",
        class: "stage-section-open",
        onClick: () => navigateTo(shown),
        title: `Open ${viewLabel(shown)} on its own page`,
        // Every section has an "Open ↗"; without this they are one repeated
        // name in a screen reader's list of controls.
        "aria-label": `Open ${viewLabel(shown)} on its own page`,
      }, "Open ↗"),
    ),
    open
      ? h("div", {
          class: bodyClass,
          id: bodyId,
          role: hasTabs ? "tabpanel" : undefined,
          "aria-labelledby": hasTabs ? `${bodyId}-tab-${shown}` : undefined,
          // A bounded scroll region must be reachable by keyboard.
          tabIndex: section.scroll && !full ? 0 : undefined,
        },
          renderView(shown),
        )
      : null,
  );
}

// ── Stage page ─────────────────────────────────────────────────

export interface StagePageProps {
  stage: StageId;
  validViews: ReadonlySet<ViewId>;
  navigateTo: NavigateTo;
  renderView: RenderView;
}

export function StagePage({ stage, validViews, navigateTo, renderView }: StagePageProps) {
  const def = STAGES[stage];
  const product = stageProduct(stage);
  const gates: Record<string, boolean> = {
    "sourcevision.prMarkdown": useFeatureToggle("sourcevision.prMarkdown", false),
    "sourcevision.ask": useFeatureToggle("sourcevision.ask", false),
  };
  const deployed = isDeployedMode();

  const sections = def.sections.filter((s) =>
    validViews.has(s.view)
    && (!s.featureGate || gates[s.featureGate])
    && !(s.requiresServer && deployed),
  );

  return h("div", { class: `stage-page stage-page-${product}`, "data-stage": stage },
    h("div", { class: "stage-page-head" },
      h(ProductLogoPng, { product, size: 36, class: "stage-page-logo" }),
      h("div", null,
        h("h1", { class: "stage-page-title" }, viewLabel(stage)),
        h("p", { class: "stage-page-blurb" }, viewBlurb(stage)),
      ),
    ),
    // Starting a run is the Work stage's job; the list sits above its sections.
    stage === "work" && !deployed
      ? h(ReadyToRun, {
          onPrepare: (taskId: string) => navigateTo("work", { taskId }),
          onOpenLive: (taskId: string) => navigateTo("live-task", { taskId }),
          onOpenPrd: () => navigateTo("prd"),
        })
      : null,
    sections.map((s) => {
      if (s.plain) return h(PlainSection, { key: s.view, section: s, renderView });
      return h(Section, { key: s.view, stage, section: s, validViews, deployed, navigateTo, renderView });
    }),
  );
}

// ── Landing ────────────────────────────────────────────────────

type Fact = [value: string, label: string];

/**
 * The headline numbers on a Home card.
 *
 * `Partial` is the honest type, not defensiveness for its own sake: the status
 * comes from `/api/status` through `const data: ProjectStatus = await
 * res.json()`, an unchecked cast, so a body missing a section arrives here
 * typed as though it were complete. Home is the dashboard's default landing
 * page — a truncated response should cost that card its numbers, the way a
 * null status already does, rather than throw through the render and leave the
 * whole page blank.
 */
function stageFacts(stage: StageId, status: Partial<ProjectStatus> | null): Fact[] {
  if (!status) return [];
  if (stage === "analyze") {
    const sv = status.sv;
    if (!sv) return [];
    const age = sv.minutesAgo == null ? "—"
      : sv.minutesAgo < 60 ? `${sv.minutesAgo}m`
      : sv.minutesAgo < 1440 ? `${Math.round(sv.minutesAgo / 60)}h`
      : `${Math.round(sv.minutesAgo / 1440)}d`;
    return [[`${sv.modulesComplete}/${sv.modulesTotal}`, "modules"], [sv.freshness, "analysis"], [age, "ago"]];
  }
  if (stage === "plan") {
    const rex = status.rex;
    if (!rex?.exists || !rex.stats) return [["—", "no PRD yet"]];
    return [[rex.stats.total.toLocaleString(), "items"], [`${Math.round(rex.percentComplete)}%`, "complete"], [String(rex.stats.pending), "pending"]];
  }
  const hench = status.hench;
  if (!hench) return [];
  return [[hench.totalRuns.toLocaleString(), "runs"], [String(hench.activeRuns), "live"], [String(hench.staleRuns), "stale"]];
}

// ── Next-step panel ────────────────────────────────────────────

/**
 * Which of the four states the Home next-step panel is in.
 *
 * Read in order: `initialized` (see routes-status.ts) separates a project
 * `ndx init` has never touched from one it has; `sv.freshness` separates
 * "touched but not analysed" from "analysed"; `rex.nextTaskTitle` separates
 * "analysed with nothing actionable in the PRD yet" from "a task is next".
 *
 * Every state here is read off a status the viewer actually has. A *missing*
 * status is not a state — see `NextStepPanel`, which renders nothing for it.
 */
type NextStepState = "not-initialized" | "not-analyzed" | "no-prd" | "has-task";

function nextStepState(status: ProjectStatus): NextStepState {
  if (!status.initialized) return "not-initialized";
  if (status.sv.freshness === "unavailable") return "not-analyzed";
  if (!status.rex.nextTaskTitle) return "no-prd";
  return "has-task";
}

/** Headline + `{cli}`-templated command for the three states with a fixed message. */
const NEXT_STEP_COPY: Record<Exclude<NextStepState, "has-task">, { headline: string; command: string }> = {
  "not-initialized": { headline: "Set up n-dx for this project.", command: "{cli} init" },
  "not-analyzed": { headline: "Scan the codebase to see its structure.", command: "{cli} analyze" },
  "no-prd": { headline: "Turn the analysis into a plan.", command: "{cli} plan" },
};

interface NextStepPanelProps {
  status: ProjectStatus | null;
}

/** Above the stage cards: names the single next command for the project's current state. */
function NextStepPanel({ status }: NextStepPanelProps) {
  // Called before the early return below: the status arrives asynchronously, so
  // this component renders both with and without one and the hook order must
  // not depend on which.
  const cliName = useCliName();

  // No status means the viewer does not know the project's state — the fetch
  // failed, the body failed its shape check, or this is a static export, which
  // writes api/config.json and api/project.json but never api/status.json, so
  // deployed mode's fetch adapter resolves /api/status to a missing file. Name
  // no command rather than guess one. Guessing "not initialised" would tell
  // every reader of a published dashboard to run `init` on a project that is
  // already analysed — advice that, if taken, re-runs sourcevision/rex/hench
  // init over a set-up project — and would flash that same advice on every cold
  // load, before the first poll resolves. Staying silent matches `stageFacts`,
  // which drops a card's numbers rather than inventing them.
  if (!status) return null;

  const state = nextStepState(status);

  if (state === "has-task") {
    return h("div", { class: "next-step-panel", "data-state": state },
      h("p", { class: "next-step-headline" },
        "Next up: ", h("strong", null, status.rex.nextTaskTitle),
      ),
      h("code", { class: "next-step-command" }, resolveCliLabel("{cli} work", cliName)),
    );
  }

  const { headline, command } = NEXT_STEP_COPY[state];
  return h("div", { class: "next-step-panel", "data-state": state },
    h("p", { class: "next-step-headline" }, headline),
    h("code", { class: "next-step-command" }, resolveCliLabel(command, cliName)),
  );
}

// ── Landing ────────────────────────────────────────────────────

export interface HomeViewProps {
  validViews: ReadonlySet<ViewId>;
  navigateTo: NavigateTo;
}

export function HomeView({ validViews, navigateTo }: HomeViewProps) {
  const status = useProjectStatus();
  const stages = visibleStages(validViews);

  return h("div", { class: "home" },
    h("div", { class: "home-head" },
      h("h1", null, "n-dx"),
      h("p", null, "Three stages in a loop — understand the code, decide what to build, let the agent build it."),
    ),
    h(NextStepPanel, { status }),
    // Reserved for A8's preflight card — intentionally empty until then.
    h("div", { class: "home-preflight-slot", "data-slot": "preflight" }),
    h("div", { class: `home-stages home-stages-${stages.length}` },
      stages.map((id) => {
        const product = stageProduct(id);
        const label = viewLabel(id);
        const facts = stageFacts(id, status);
        return h("button", {
          key: id,
          type: "button",
          class: `stage-card stage-card-${product}`,
          "data-stage": id,
          onClick: () => navigateTo(id),
          "aria-label": `Open ${label}`,
        },
          h("span", { class: "stage-card-mark" }, h(ProductLogoPng, { product, size: 160 })),
          h("span", { class: "stage-card-glyph", "aria-hidden": "true" }, viewGlyph(id)),
          h("span", { class: "stage-card-name" }, label),
          h("span", { class: "stage-card-hint" }, product),
          h("span", { class: "stage-card-blurb" }, viewBlurb(id)),
          facts.length
            ? h("span", { class: "stage-card-facts" },
                facts.map(([v, k]) => h("span", { key: k, class: "stage-card-fact" },
                  h("span", { class: "stage-card-fact-v" }, v),
                  h("span", { class: "stage-card-fact-k" }, k),
                )),
              )
            : null,
          h("span", { class: "stage-card-go", "aria-hidden": "true" }, `Open ${label} →`),
        );
      }),
    ),
    stages.length > 1
      ? h("p", { class: "home-loop" }, stages.map((id) => viewLabel(id).toLowerCase()).concat(viewLabel(stages[0]).toLowerCase()).join(" → "))
      : null,
  );
}
