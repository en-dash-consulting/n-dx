// @vitest-environment jsdom
/**
 * Hook order across the enrichment gate.
 *
 * `ArchitectureView`, `ProblemsView` and `SuggestionsView` return an
 * `EnrichmentGate` early when the analysis has not reached their threshold.
 * `enrichmentPass` is loaded data: it is 0 on the first render, becomes real
 * when the data arrives, and changes again when an analysis finishes with the
 * dashboard open. So the early return is taken on some renders of the same
 * mounted component and not others, and every hook below it is conditional.
 *
 * ## Why the view list is checked, not just used
 *
 * The first pass of this fix listed two views and covered two, while the
 * describe below claimed to check every gated view. Architecture had the same
 * defect and stayed green. `VIEWS_RENDERING_THE_GATE` now reads the directory
 * and the list is asserted against it, so the claim and the coverage cannot
 * drift apart again.
 *
 * ## Why this is checked structurally
 *
 * React throws "Rendered more hooks than during the previous render" and a test
 * could simply assert the throw. Preact does not: it matches hooks positionally
 * and silently, so a hook that appears only on some renders produces no error —
 * it produces a slot that means one thing on one render and another thing on the
 * next. Whether that corrupts anything depends on which hooks moved, which is a
 * property of the *next* edit rather than of this one. All three appended the
 * conditional hooks after the stable ones, so the misalignment was latent
 * rather than visible in every case.
 *
 * A behavioural test therefore cannot fail on the defect, and one written as if
 * it could would be a false guarantee. What can be pinned is the invariant that
 * makes the defect impossible: no view calls a hook after it can return. The
 * transition tests below cover the other half — that fixing the order did not
 * change what any of them renders in either state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ArchitectureView } from "../../../src/viewer/views/architecture.js";
import { ProblemsView } from "../../../src/viewer/views/problems.js";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";
import type { Finding } from "../../../src/viewer/external.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const VIEWS_DIR = join(import.meta.dirname, "../../../src/viewer/views");

const GATED_VIEWS = [
  { name: "architecture.ts", component: "ArchitectureView" },
  { name: "problems.ts", component: "ProblemsView" },
  { name: "suggestions.ts", component: "SuggestionsView" },
] as const;

// Every view that renders an EnrichmentGate must be listed above. The list is
// hardcoded rather than derived, so this asserts it is complete — the original
// two-entry list silently exempted ArchitectureView, which had the same defect
// and went unfixed while the suite stayed green.
const VIEWS_RENDERING_THE_GATE = readdirSync(VIEWS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => readFileSync(join(VIEWS_DIR, f), "utf-8").includes("h(EnrichmentGate"))
  .sort();

/**
 * The body of a view's exported component function.
 *
 * Crude on purpose — it reads to the end of the file, which holds exactly one
 * exported component in all three of these. A parser would be a heavier
 * dependency than the invariant is worth.
 */
function componentBody(source: string, component: string): string {
  const start = source.indexOf(`export function ${component}(`);
  if (start === -1) throw new Error(`${component} not found`);
  return source.slice(start);
}

describe("gated views call every hook before they can return", () => {
  it("checks every view that renders the gate", () => {
    // Without this, the describe's claim is only as broad as the list, and a
    // fourth gated view is exempt the day it is added — which is exactly how
    // ArchitectureView escaped the first pass of this fix.
    expect(VIEWS_RENDERING_THE_GATE.length, "views rendering an EnrichmentGate").toBeGreaterThan(0);
    expect(
      VIEWS_RENDERING_THE_GATE,
      "a view renders an EnrichmentGate but is not in GATED_VIEWS, so nothing " +
        "below checks its hook order. Add it.",
    ).toEqual(GATED_VIEWS.map((v) => v.name).sort());
  });

  for (const { name, component } of GATED_VIEWS) {
    it(`${component} calls no hook after its enrichment gate`, () => {
      const body = componentBody(readFileSync(join(VIEWS_DIR, name), "utf-8"), component);

      const firstReturn = body.indexOf("return h(EnrichmentGate");
      expect(firstReturn, "the enrichment gate's early return").toBeGreaterThan(0);

      // Hook calls, ignoring the ones inside comments explaining this rule.
      const afterGate = body
        .slice(firstReturn)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      const strayHooks = afterGate.match(/\buse[A-Z]\w*\(/g) ?? [];

      expect(
        strayHooks,
        `${component} calls ${strayHooks.join(", ")} after an early return. Preact ` +
          `matches hooks by position and does not warn, so a hook below the gate ` +
          `silently shifts the slots of every hook after it once the gate flips. ` +
          `Move it above the gate.`,
      ).toEqual([]);
    });
  }
});

/**
 * The other half of the criterion: reordering the hooks changed no output.
 *
 * These pass before and after the fix — they are a regression guard on the
 * refactor, not a demonstration of the defect. See the docblock above.
 */
describe("gated views across the enrichment threshold", () => {
  let root: HTMLDivElement;

  const FINDINGS: Finding[] = [
    { type: "anti-pattern", scope: "billing", text: "High coupling", severity: "critical", pass: 3, related: ["src/a.ts"] },
    { type: "anti-pattern", scope: "api", text: "Large module", severity: "warning", pass: 3 },
    { type: "suggestion", scope: "core", text: "Extract shared helpers", severity: "info", pass: 4 },
    { type: "suggestion", scope: "global", text: "Adopt a lint rule", pass: 4 },
    // Architecture's two types. Invisible to the other two views, which filter
    // on "anti-pattern" and "suggestion" respectively, so one fixture serves
    // all three.
    { type: "pattern", scope: "billing", text: "Layered composition root", severity: "info", pass: 2 },
    { type: "relationship", scope: "api", text: "Bidirectional import edge", severity: "warning", pass: 2 },
  ] as Finding[];

  /**
   * Zones for the bar chart. Only Architecture reads these, so the default is
   * empty and the other two views see exactly the data they saw before.
   */
  const ZONES = [
    { id: "billing", name: "Billing", files: ["src/a.ts", "src/b.ts"], cohesion: 0.7 },
    { id: "api", name: "Api", files: ["src/c.ts"], cohesion: 0.3 },
  ];

  function dataAtPass(enrichmentPass: number, zoneList: unknown[] = []): LoadedData {
    return {
      manifest: null,
      inventory: null,
      imports: null,
      zones: { zones: zoneList, crossings: [], unzoned: [], enrichmentPass, findings: FINDINGS },
      components: null,
      callGraph: null,
    } as unknown as LoadedData;
  }

  async function renderAt(
    view: typeof ProblemsView | typeof SuggestionsView | typeof ArchitectureView,
    pass: number,
    opts: { props?: Record<string, unknown>; zoneList?: unknown[] } = {},
  ) {
    await act(async () => {
      render(
        h(view as never, { data: dataAtPass(pass, opts.zoneList), ...opts.props } as never),
        root,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  const CASES = [
    {
      component: ArchitectureView,
      label: "ArchitectureView",
      threshold: ENRICHMENT_THRESHOLDS.architecture,
      gatedText: "Architecture",
      ungatedText: "findings from",
      finding: "Layered composition root",
      otherFinding: "High coupling",
      // ArchitectureView takes onSelect; the other two do not.
      props: { onSelect: () => {} },
    },
    {
      component: ProblemsView,
      label: "ProblemsView",
      threshold: ENRICHMENT_THRESHOLDS.problems,
      gatedText: "Problems",
      ungatedText: "anti-patterns detected",
      finding: "High coupling",
      otherFinding: "Extract shared helpers",
      props: {},
    },
    {
      component: SuggestionsView,
      label: "SuggestionsView",
      threshold: ENRICHMENT_THRESHOLDS.suggestions,
      gatedText: "Suggestions",
      ungatedText: "suggestions for improvement",
      finding: "Extract shared helpers",
      otherFinding: "High coupling",
      props: {},
    },
  ] as const;

  for (const c of CASES) {
    it(`${c.label} shows the gate below the threshold and the findings above it`, async () => {
      await renderAt(c.component, c.threshold - 1, { props: c.props });
      expect(root.textContent).toContain(c.gatedText);
      expect(root.textContent).not.toContain(c.finding);

      // The transition an analysis completing in the background produces.
      await renderAt(c.component, c.threshold, { props: c.props });
      expect(root.textContent).toContain(c.ungatedText);
      expect(root.textContent).toContain(c.finding);
      // Each view shows only the finding type it is about.
      expect(root.textContent).not.toContain(c.otherFinding);
    });

    it(`${c.label} returns to the gate if the analysis is reset`, async () => {
      await renderAt(c.component, c.threshold, { props: c.props });
      expect(root.textContent).toContain(c.finding);

      await renderAt(c.component, 0, { props: c.props });
      expect(root.textContent).not.toContain(c.finding);
      expect(root.textContent).toContain(c.gatedText);
    });

    it(`${c.label} survives repeated crossings of the threshold`, async () => {
      for (let i = 0; i < 3; i++) {
        await renderAt(c.component, c.threshold - 1, { props: c.props });
        await renderAt(c.component, c.threshold, { props: c.props });
      }

      expect(root.textContent).toContain(c.finding);
      expect(root.textContent).toContain(c.ungatedText);
    });
  }

  // The memo that moved. Its output is what a hook-order slip would corrupt,
  // so assert the chart it feeds actually renders — with zones present, since
  // the shared fixture has none and an empty list renders nothing either way.
  it("ArchitectureView renders the zone-health chart it memoizes, across the gate", async () => {
    const arch = ENRICHMENT_THRESHOLDS.architecture;

    await renderAt(ArchitectureView, arch - 1, { props: { onSelect: () => {} }, zoneList: ZONES });
    expect(root.textContent).toContain("Architecture");
    expect(root.textContent).not.toContain("Zone Sizes");

    await renderAt(ArchitectureView, arch, { props: { onSelect: () => {} }, zoneList: ZONES });
    expect(root.textContent).toContain("Zone Sizes");
    expect(root.textContent).toContain("Billing");
    expect(root.textContent).toContain("Api");
  });
});
