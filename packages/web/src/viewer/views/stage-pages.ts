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
import { STAGES, visibleStages, type StageId, type StageSection } from "./stages.js";
import { ProductLogoPng, useProjectStatus, type ProjectStatus } from "../components/index.js";
import { useFeatureToggle } from "../hooks/index.js";
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
  showAlt: boolean;
  navigateTo: NavigateTo;
  renderView: RenderView;
}

/** The stage's lead section: the view itself, in the page, no dropdown. */
function PlainSection({ section, renderView }: Pick<SectionProps, "section" | "renderView">) {
  return h("section", { class: "stage-section stage-section--plain", "data-view": section.view, "aria-label": section.title },
    renderView(section.view),
  );
}

function Section({ stage, section, showAlt, navigateTo, renderView }: SectionProps) {
  const key = `${stage}:${section.view}`;
  const [open, setOpen] = useState<boolean>(() => readOpenState()[key] ?? !!section.open);
  const [useAlt, setUseAlt] = useState(false);
  // Scroll sections: bounded by default, full length on Expand. Stored beside
  // the open state under "<stage>:<view>:full".
  const fullKey = `${key}:full`;
  const [full, setFull] = useState<boolean>(() => readOpenState()[fullKey] ?? false);
  const shown: ViewId = useAlt && section.alt ? section.alt.view : section.view;
  const bodyId = `stage-section-${stage}-${section.view}`;

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
        h("span", { class: "stage-section-title" }, section.title),
        h("span", { class: "stage-section-blurb" }, section.blurb),
      ),
      section.alt && showAlt && open
        ? h("div", { class: "stage-section-projection", role: "group", "aria-label": "Projection" },
            h("button", {
              type: "button",
              class: `stage-section-projection-btn${useAlt ? "" : " active"}`,
              "aria-pressed": String(!useAlt),
              onClick: () => setUseAlt(false),
            }, section.alt.primaryLabel),
            h("button", {
              type: "button",
              class: `stage-section-projection-btn${useAlt ? " active" : ""}`,
              "aria-pressed": String(useAlt),
              onClick: () => setUseAlt(true),
            }, section.alt.label),
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
          }, full ? "Collapse ▴" : "Expand ▾")
        : null,
      h("button", {
        type: "button",
        class: "stage-section-open",
        onClick: () => navigateTo(shown),
        title: `Open ${section.title} on its own page`,
      }, "Open ↗"),
    ),
    open
      ? h("div", {
          class: bodyClass,
          id: bodyId,
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

  return h("div", { class: `stage-page stage-page-${def.product}`, "data-stage": stage },
    h("div", { class: "stage-page-head" },
      h(ProductLogoPng, { product: def.product, size: 36, class: "stage-page-logo" }),
      h("div", null,
        h("h1", { class: "stage-page-title" }, def.label),
        h("p", { class: "stage-page-blurb" }, def.blurb),
      ),
    ),
    sections.map((s) => {
      // The second projection is a server-built view too (the isometric map).
      if (s.plain) return h(PlainSection, { key: s.view, section: s, renderView });
      const showAlt = !!s.alt && validViews.has(s.alt.view) && !deployed;
      return h(Section, { key: s.view, stage, section: s, showAlt, navigateTo, renderView });
    }),
  );
}

// ── Landing ────────────────────────────────────────────────────

type Fact = [value: string, label: string];

function stageFacts(stage: StageId, status: ProjectStatus | null): Fact[] {
  if (!status) return [];
  if (stage === "analyze") {
    const sv = status.sv;
    const age = sv.minutesAgo == null ? "—"
      : sv.minutesAgo < 60 ? `${sv.minutesAgo}m`
      : sv.minutesAgo < 1440 ? `${Math.round(sv.minutesAgo / 60)}h`
      : `${Math.round(sv.minutesAgo / 1440)}d`;
    return [[`${sv.modulesComplete}/${sv.modulesTotal}`, "modules"], [sv.freshness, "analysis"], [age, "ago"]];
  }
  if (stage === "plan") {
    const rex = status.rex;
    if (!rex.exists || !rex.stats) return [["—", "no PRD yet"]];
    return [[rex.stats.total.toLocaleString(), "items"], [`${Math.round(rex.percentComplete)}%`, "complete"], [String(rex.stats.pending), "pending"]];
  }
  const hench = status.hench;
  return [[hench.totalRuns.toLocaleString(), "runs"], [String(hench.activeRuns), "live"], [String(hench.staleRuns), "stale"]];
}

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
    h("div", { class: `home-stages home-stages-${stages.length}` },
      stages.map((id) => {
        const def = STAGES[id];
        const facts = stageFacts(id, status);
        return h("button", {
          key: id,
          type: "button",
          class: `stage-card stage-card-${def.product}`,
          "data-stage": id,
          onClick: () => navigateTo(id),
        },
          h("span", { class: "stage-card-mark" }, h(ProductLogoPng, { product: def.product, size: 160 })),
          h("span", { class: "stage-card-glyph", "aria-hidden": "true" }, def.glyph),
          h("span", { class: "stage-card-name" }, def.label),
          h("span", { class: "stage-card-hint" }, def.product),
          h("span", { class: "stage-card-blurb" }, def.blurb),
          facts.length
            ? h("span", { class: "stage-card-facts" },
                facts.map(([v, k]) => h("span", { key: k, class: "stage-card-fact" },
                  h("span", { class: "stage-card-fact-v" }, v),
                  h("span", { class: "stage-card-fact-k" }, k),
                )),
              )
            : null,
          h("span", { class: "stage-card-go", "aria-hidden": "true" }, `Open ${def.label} →`),
        );
      }),
    ),
    stages.length > 1
      ? h("p", { class: "home-loop" }, stages.map((id) => STAGES[id].label.toLowerCase()).concat(STAGES[stages[0]].label.toLowerCase()).join(" → "))
      : null,
  );
}
