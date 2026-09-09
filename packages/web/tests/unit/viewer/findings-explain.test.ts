// @vitest-environment jsdom
/**
 * Explain, from the row to the panel.
 *
 * Covers the two ends the user sees: every finding row offers the action
 * (whatever its type or severity, including findings the analysis never
 * classified), and the two surfaces that host those rows only offer it when the
 * panel it leads to is actually reachable.
 *
 * @see packages/web/src/viewer/components/data-display/findings-list.ts
 * @see packages/web/src/viewer/ask-seed.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FindingsList } from "../../../src/viewer/components/data-display/findings-list.js";
import { ProblemsView } from "../../../src/viewer/views/problems.js";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import type { Finding } from "../../../src/viewer/external.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import { setPendingAskSeed, takePendingAskSeed } from "../../../src/viewer/ask-seed.js";

/** Every shape a findings row comes in, including an unclassified one. */
const ALL_SHAPES: Finding[] = [
  { type: "anti-pattern", scope: "billing", text: "High coupling", severity: "critical", pass: 3, related: ["src/a.ts"] },
  { type: "anti-pattern", scope: "api", text: "Large module", severity: "warning", pass: 3 },
  { type: "suggestion", scope: "global", text: "Extract shared helpers", severity: "info", pass: 4 },
  { type: "suggestion", scope: "core", text: "Unclassified suggestion", pass: 4, related: ["src/b.ts"] },
  { type: "pattern", scope: "ui", text: "Consistent adapter pattern", pass: 2 },
  { type: "relationship", scope: "web", text: "web imports rex", pass: 2, related: ["src/c.ts"] },
] as Finding[];

function mountList(root: HTMLElement, props: Partial<Parameters<typeof FindingsList>[0]> = {}) {
  act(() => {
    render(h(FindingsList, { findings: ALL_SHAPES, searchable: false, ...props }), root);
  });
}

function explainButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(".finding-explain-btn"));
}

describe("FindingsList — Explain action", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    localStorage.clear();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("offers Explain on every finding, whatever its type or severity", () => {
    mountList(root, { onExplain: () => {} });

    // Includes the row with no severity — the one most likely to be dropped by
    // a filter written against the three known levels.
    expect(explainButtons(root)).toHaveLength(ALL_SHAPES.length);
    const shapes = new Set(ALL_SHAPES.map((f) => `${f.type}:${f.severity ?? "none"}`));
    expect(shapes.size).toBeGreaterThan(3);
  });

  it("names the finding in each button's accessible name", () => {
    mountList(root, { onExplain: () => {} });

    // Every button reads "Explain"; without this a screen reader user hears the
    // same label six times with no way to tell which row they are on.
    const labels = explainButtons(root).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Explain finding: High coupling");
    expect(labels).toContain("Explain finding: Unclassified suggestion");
    expect(new Set(labels).size).toBe(ALL_SHAPES.length);
  });

  it("hands the whole finding to the caller", () => {
    const onExplain = vi.fn();
    mountList(root, { onExplain });

    act(() => { explainButtons(root)[0]!.click(); });

    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onExplain.mock.calls[0]![0]).toMatchObject({
      type: "anti-pattern", scope: "billing", severity: "critical", related: ["src/a.ts"],
    });
  });

  it("renders no Explain action when the caller offers none", () => {
    mountList(root);

    // A button that navigated nowhere would be worse than no button.
    expect(explainButtons(root)).toHaveLength(0);
  });

  it("keeps the expandable row's own toggle working alongside it", () => {
    mountList(root, { onExplain: () => {} });

    // Explain sits outside the header, which is itself a button on rows with
    // related files — nesting would have made the toggle unreachable.
    const toggle = root.querySelector<HTMLButtonElement>(".finding-header-btn");
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector(".finding-explain-btn")).toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    act(() => { toggle!.click(); });
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves legacy insight rows without one", () => {
    act(() => {
      render(
        h(FindingsList, {
          findings: [],
          legacyInsights: ["An old free-text insight"],
          searchable: false,
          onExplain: () => {},
        }),
        root,
      );
    });

    // Insights are free text with no type, zone, or files — nothing to explain
    // in the structured sense the endpoint expects.
    expect(root.textContent).toContain("An old free-text insight");
    expect(explainButtons(root)).toHaveLength(0);
  });
});

/**
 * The two surfaces that host findings. Both gate Explain on `sourcevision.ask`,
 * because the panel is behind that toggle and a row must not offer a route to a
 * tab that is not there.
 */
describe("Problems and Suggestions surfaces", () => {
  let root: HTMLDivElement;

  function stubAskToggle(enabled: boolean) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/features") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ toggles: [{ key: "sourcevision.ask", enabled }] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
  }

  function loadedData(findings: Finding[]): LoadedData {
    return {
      manifest: null,
      inventory: null,
      imports: null,
      zones: { zones: [], crossings: [], unzoned: [], enrichmentPass: 5, findings },
      components: null,
      callGraph: null,
    } as unknown as LoadedData;
  }

  async function mountView(
    view: typeof ProblemsView | typeof SuggestionsView,
    findings: Finding[],
    navigateTo?: (v: string) => void,
  ) {
    await act(async () => {
      render(h(view as never, { data: loadedData(findings), navigateTo } as never), root);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  const ANTI_PATTERN = ALL_SHAPES[0]!;
  const SUGGESTION = ALL_SHAPES[2]!;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    localStorage.clear();
    setPendingAskSeed(null);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers Explain on Problems when the Ask tab is enabled", async () => {
    stubAskToggle(true);
    await mountView(ProblemsView, [ANTI_PATTERN], () => {});

    expect(explainButtons(root)).toHaveLength(1);
  });

  it("offers Explain on Suggestions when the Ask tab is enabled", async () => {
    stubAskToggle(true);
    await mountView(SuggestionsView, [SUGGESTION], () => {});

    expect(explainButtons(root)).toHaveLength(1);
  });

  it("hides Explain while the Ask tab is gated off", async () => {
    stubAskToggle(false);
    await mountView(ProblemsView, [ANTI_PATTERN], () => {});

    // The row still renders — this is the action being withheld, not the list.
    expect(root.textContent).toContain("High coupling");
    expect(explainButtons(root)).toHaveLength(0);
  });

  it("hides Explain when there is nowhere to navigate", async () => {
    stubAskToggle(true);
    await mountView(ProblemsView, [ANTI_PATTERN]);

    expect(explainButtons(root)).toHaveLength(0);
  });

  it("seeds the finding and navigates to Ask on click", async () => {
    stubAskToggle(true);
    const navigateTo = vi.fn();
    await mountView(ProblemsView, [ANTI_PATTERN], navigateTo);

    act(() => { explainButtons(root)[0]!.click(); });

    expect(navigateTo).toHaveBeenCalledWith("ask");
    expect(takePendingAskSeed()).toEqual({
      type: "anti-pattern",
      severity: "critical",
      zone: "billing",
      message: "High coupling",
      files: ["src/a.ts"],
    });
  });
});
