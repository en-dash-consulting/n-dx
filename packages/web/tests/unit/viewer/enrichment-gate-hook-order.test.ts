// @vitest-environment jsdom
/**
 * Hook order across the enrichment gate.
 *
 * `ProblemsView` and `SuggestionsView` return an `EnrichmentGate` early when the
 * analysis has not reached their threshold. `enrichmentPass` is loaded data: it
 * is 0 on the first render, becomes real when the data arrives, and changes
 * again when an analysis finishes with the dashboard open. So the early return
 * is taken on some renders of the same mounted component and not others, and
 * every hook below it is conditional.
 *
 * ## Why this is checked structurally
 *
 * React throws "Rendered more hooks than during the previous render" and a test
 * could simply assert the throw. Preact does not: it matches hooks positionally
 * and silently, so a hook that appears only on some renders produces no error —
 * it produces a slot that means one thing on one render and another thing on the
 * next. Whether that corrupts anything depends on which hooks moved, which is a
 * property of the *next* edit rather than of this one. Both views currently
 * append the conditional hooks after the stable ones, so today the misalignment
 * is latent rather than visible.
 *
 * A behavioural test therefore cannot fail on the defect, and one written as if
 * it could would be a false guarantee. What can be pinned is the invariant that
 * makes the defect impossible: no view calls a hook after it can return. The
 * transition tests below cover the other half — that fixing the order did not
 * change what either view renders in either state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProblemsView } from "../../../src/viewer/views/problems.js";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";
import type { Finding } from "../../../src/viewer/external.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const VIEWS_DIR = join(import.meta.dirname, "../../../src/viewer/views");

const GATED_VIEWS = [
  { name: "problems.ts", component: "ProblemsView" },
  { name: "suggestions.ts", component: "SuggestionsView" },
] as const;

/**
 * The body of a view's exported component function.
 *
 * Crude on purpose — it reads to the end of the file, which holds exactly one
 * exported component in both of these. A parser would be a heavier dependency
 * than the invariant is worth.
 */
function componentBody(source: string, component: string): string {
  const start = source.indexOf(`export function ${component}(`);
  if (start === -1) throw new Error(`${component} not found`);
  return source.slice(start);
}

describe("gated views call every hook before they can return", () => {
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
  ] as Finding[];

  function dataAtPass(enrichmentPass: number): LoadedData {
    return {
      manifest: null,
      inventory: null,
      imports: null,
      zones: { zones: [], crossings: [], unzoned: [], enrichmentPass, findings: FINDINGS },
      components: null,
      callGraph: null,
    } as unknown as LoadedData;
  }

  async function renderAt(view: typeof ProblemsView | typeof SuggestionsView, pass: number) {
    await act(async () => {
      render(h(view as never, { data: dataAtPass(pass) } as never), root);
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
      component: ProblemsView,
      label: "ProblemsView",
      threshold: ENRICHMENT_THRESHOLDS.problems,
      gatedText: "Problems",
      ungatedText: "anti-patterns detected",
      finding: "High coupling",
      otherFinding: "Extract shared helpers",
    },
    {
      component: SuggestionsView,
      label: "SuggestionsView",
      threshold: ENRICHMENT_THRESHOLDS.suggestions,
      gatedText: "Suggestions",
      ungatedText: "suggestions for improvement",
      finding: "Extract shared helpers",
      otherFinding: "High coupling",
    },
  ] as const;

  for (const c of CASES) {
    it(`${c.label} shows the gate below the threshold and the findings above it`, async () => {
      await renderAt(c.component, c.threshold - 1);
      expect(root.textContent).toContain(c.gatedText);
      expect(root.textContent).not.toContain(c.finding);

      // The transition an analysis completing in the background produces.
      await renderAt(c.component, c.threshold);
      expect(root.textContent).toContain(c.ungatedText);
      expect(root.textContent).toContain(c.finding);
      // Each view shows only the finding type it is about.
      expect(root.textContent).not.toContain(c.otherFinding);
    });

    it(`${c.label} returns to the gate if the analysis is reset`, async () => {
      await renderAt(c.component, c.threshold);
      expect(root.textContent).toContain(c.finding);

      await renderAt(c.component, 0);
      expect(root.textContent).not.toContain(c.finding);
      expect(root.textContent).toContain(c.gatedText);
    });

    it(`${c.label} survives repeated crossings of the threshold`, async () => {
      for (let i = 0; i < 3; i++) {
        await renderAt(c.component, c.threshold - 1);
        await renderAt(c.component, c.threshold);
      }

      expect(root.textContent).toContain(c.finding);
      expect(root.textContent).toContain(c.ungatedText);
    });
  }
});
