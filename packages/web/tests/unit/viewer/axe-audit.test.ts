// @vitest-environment jsdom
/**
 * Axe-core accessibility audit tests.
 *
 * Renders each major dashboard route component with minimal mock data and
 * asserts zero axe violations at "critical" or "serious" impact.
 *
 * Tests run in both light and dark theme variants to catch theme-specific
 * structural ARIA regressions.
 *
 * NOTE: color-contrast rule is disabled — jsdom does not compute CSS styles.
 * Contrast must be verified via the manual procedure in docs/accessibility.md.
 *
 * Tag: [a11y] — run independently with: pnpm --filter @n-dx/web test:a11y
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { Finding, Zone } from "../../../src/viewer/external.js";
import { FindingsList } from "../../../src/viewer/components/data-display/findings-list.js";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";
import { ZonesView } from "../../../src/viewer/views/zones.js";
import { Graph } from "../../../src/viewer/views/graph.js";
import { Overview } from "../../../src/viewer/views/overview.js";
import { ProblemsView } from "../../../src/viewer/views/problems.js";
import { ArchitectureView } from "../../../src/viewer/views/architecture.js";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import { RoutesView } from "../../../src/viewer/views/routes.js";

// ── Axe-core loader ───────────────────────────────────────────────────────────

// Dynamic import so the file can be loaded without axe-core installed.
// Tests below use describe.skipIf to skip when the package is absent.
type AxeViolation = { impact: string; id: string; description: string; nodes: unknown[] };
type AxeRunResult = { violations: AxeViolation[] };
type AxeRunFn = (el: Element | Document, opts?: object) => Promise<AxeRunResult>;
let axeRun: AxeRunFn | null = null;

// Use createRequire to bypass Vite's static import analysis — Vite's bundler
// errors at transform time on `import("axe-core")` when the package is absent.
// Node's require() resolves at runtime, so the try/catch is effective.
const _require = createRequire(import.meta.url);
try {
  const axe = _require("axe-core") as { run: AxeRunFn };
  axeRun = axe.run.bind(axe);
} catch {
  // axe-core not installed. Tests will be skipped below.
  // Run `pnpm install` in the project root to add the package.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Axe options shared across all tests. */
const AXE_OPTIONS = {
  // color-contrast requires real computed CSS — jsdom always returns "transparent".
  // Contrast must be verified manually; see docs/accessibility.md.
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
  },
  rules: {
    "color-contrast": { enabled: false },
    // Document hierarchy rules are too strict for component fragments in jsdom
    "region": { enabled: false },
    "landmark-one-main": { enabled: false },
    "page-has-heading-one": { enabled: false },
    "bypass": { enabled: false },
  },
};

async function runAxe(element: Element): Promise<AxeViolation[]> {
  if (!axeRun) throw new Error("axe-core not installed");
  const results = await axeRun(element, AXE_OPTIONS);
  return results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

function renderToDiv(vnode: ReturnType<typeof h>): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(vnode, root);
  return root;
}

function formatViolations(violations: AxeViolation[]): string {
  return violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n");
}

/** Set document theme attribute and return a cleanup function. */
function setTheme(theme: "light" | "dark"): () => void {
  document.documentElement.setAttribute("data-theme", theme);
  return () => document.documentElement.removeAttribute("data-theme");
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SAMPLE_PRD: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "epic-1",
      title: "Core Features",
      status: "in_progress",
      level: "epic",
      children: [
        { id: "feat-1", title: "Feature A", status: "completed", level: "feature" },
        { id: "feat-2", title: "Feature B", status: "pending",   level: "feature" },
      ],
    },
    { id: "epic-2", title: "Polish", status: "pending", level: "epic" },
  ],
};

const SAMPLE_FINDINGS: Finding[] = [
  { type: "anti-pattern", scope: "zone-a", text: "High coupling detected", severity: "critical", pass: 0, related: ["src/a.ts"] },
  { type: "suggestion",   scope: "global",  text: "Consider splitting large files",  severity: "warning",  pass: 1 },
];

const SAMPLE_ZONES: Zone[] = [
  { id: "z-a", name: "Core",    description: "Core logic",  files: ["src/a.ts"],         entryPoints: [], cohesion: 0.9, coupling: 0.2 },
  { id: "z-b", name: "Helpers", description: "Utilities",   files: ["src/utils.ts"],     entryPoints: [], cohesion: 0.8, coupling: 0.3 },
];

function makeLoadedData(overrides: Partial<LoadedData> = {}): LoadedData {
  return {
    manifest: null,
    inventory: null,
    imports: {
      edges: [
        { from: "src/a.ts", to: "src/b.ts", type: "static", symbols: ["x"] },
      ],
      external: [],
      summary: {
        totalEdges: 1,
        totalExternal: 0,
        circularCount: 0,
        circulars: [],
        mostImported: [{ path: "src/b.ts", count: 1 }],
        avgImportsPerFile: 1,
      },
    },
    zones: {
      zones: SAMPLE_ZONES,
      crossings: [],
      unzoned: [],
      enrichmentPass: 3,
    },
    components: null,
    callGraph: null,
    ...overrides,
  };
}

// ── [a11y] PRDTree ────────────────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] PRDTree — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(PRDTree, { document: SAMPLE_PRD }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(PRDTree, { document: SAMPLE_PRD }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] FindingsList (Findings/Problems) ───────────────────────────────────

describe.skipIf(!axeRun)("[a11y] FindingsList — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
  });

  it("has zero critical/serious violations (light theme, with findings)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(FindingsList, { findings: SAMPLE_FINDINGS }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme, with findings)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(FindingsList, { findings: SAMPLE_FINDINGS }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero violations when empty (no data state)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(FindingsList, { findings: [] }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] ProblemsView ───────────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] ProblemsView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(ProblemsView, { data: makeLoadedData() }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(ProblemsView, { data: makeLoadedData() }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero violations in locked/insufficient-data state", async () => {
    cleanup = setTheme("light");
    const data = makeLoadedData({ zones: { zones: [], crossings: [], unzoned: [], enrichmentPass: 0 } });
    root = renderToDiv(h(ProblemsView, { data }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] Import Graph (Graph view) ─────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] Graph (import graph) — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let rafId: ReturnType<typeof setInterval>;

  beforeEach(() => {
    // Graph uses requestAnimationFrame for force layout; stub it
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafId = setInterval(cb, 16) as unknown as number;
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => clearInterval(rafId));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    vi.unstubAllGlobals();
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(Graph, { data: makeLoadedData(), onSelect: () => {} }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    clearInterval(rafId);
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(Graph, { data: makeLoadedData(), onSelect: () => {} }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    clearInterval(rafId);
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] OverviewView ───────────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] OverviewView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Prevent the re-analyze fetch from firing during render
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(Overview, { data: makeLoadedData(), onSelect: () => {} }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(Overview, { data: makeLoadedData(), onSelect: () => {} }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] ZonesView ─────────────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] ZonesView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let rafId: ReturnType<typeof setInterval>;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafId = setInterval(cb, 16) as unknown as number;
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => clearInterval(rafId));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    vi.unstubAllGlobals();
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(
      h(ZonesView, { data: makeLoadedData(), onSelect: () => {}, navigateTo: () => {} }),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    clearInterval(rafId);
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(
      h(ZonesView, { data: makeLoadedData(), onSelect: () => {}, navigateTo: () => {} }),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    clearInterval(rafId);
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] ArchitectureView ──────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] ArchitectureView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
  });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(ArchitectureView, { data: makeLoadedData(), onSelect: () => {} }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(ArchitectureView, { data: makeLoadedData(), onSelect: () => {} }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero violations in locked/insufficient-data state", async () => {
    cleanup = setTheme("light");
    const data = makeLoadedData({ zones: { zones: [], crossings: [], unzoned: [], enrichmentPass: 0 } });
    root = renderToDiv(h(ArchitectureView, { data, onSelect: () => {} }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] SuggestionsView ───────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] SuggestionsView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Prevent the refresh-recommendations fetch from firing during render
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  const unlockedData = () =>
    makeLoadedData({
      zones: {
        zones: SAMPLE_ZONES,
        crossings: [],
        unzoned: [],
        enrichmentPass: 4,
        findings: [
          { type: "suggestion", scope: "global", text: "Consider extracting shared helpers", severity: "info", pass: 4 },
          { type: "suggestion", scope: "z-a", text: "Split large module", severity: "warning", pass: 4 },
        ],
      },
    });

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(SuggestionsView, { data: unlockedData() }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(SuggestionsView, { data: unlockedData() }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero violations in locked/insufficient-data state", async () => {
    cleanup = setTheme("light");
    const data = makeLoadedData({ zones: { zones: [], crossings: [], unzoned: [], enrichmentPass: 0 } });
    root = renderToDiv(h(SuggestionsView, { data }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] RoutesView ────────────────────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] RoutesView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
  });

  const SAMPLE_COMPONENTS: NonNullable<LoadedData["components"]> = {
    components: [
      { file: "src/button.tsx", name: "Button", kind: "function", line: 1, isDefaultExport: true, conventionExports: [] },
    ],
    usageEdges: [
      { from: "src/routes/home.tsx", to: "src/button.tsx", componentName: "Button", usageCount: 2 },
    ],
    routeModules: [
      { file: "src/routes/home.tsx", routePattern: "/", exports: ["default", "loader"], parentLayout: null, isLayout: false, isIndex: true },
    ],
    routeTree: [
      { file: "src/routes/home.tsx", routePattern: "/", children: [] },
    ],
    summary: {
      totalComponents: 1,
      totalRouteModules: 1,
      totalUsageEdges: 1,
      routeConventions: { default: 1, loader: 1 },
      mostUsedComponents: [{ name: "Button", file: "src/button.tsx", usageCount: 2 }],
      layoutDepth: 1,
    },
  };

  it("has zero critical/serious violations (light theme)", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(RoutesView, { data: makeLoadedData({ components: SAMPLE_COMPONENTS }) }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme)", async () => {
    cleanup = setTheme("dark");
    root = renderToDiv(h(RoutesView, { data: makeLoadedData({ components: SAMPLE_COMPONENTS }) }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero violations in no-component-data state", async () => {
    cleanup = setTheme("light");
    root = renderToDiv(h(RoutesView, { data: makeLoadedData({ components: null }) }));
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] HenchRunsView (loading state) ─────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] HenchRunsView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  it("has zero critical/serious violations (light theme, loading state)", async () => {
    cleanup = setTheme("light");
    const { HenchRunsView } = await import("../../../src/viewer/views/hench-runs.js");
    root = renderToDiv(h(HenchRunsView, { navigateTo: () => {} }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme, loading state)", async () => {
    cleanup = setTheme("dark");
    const { HenchRunsView } = await import("../../../src/viewer/views/hench-runs.js");
    root = renderToDiv(h(HenchRunsView, { navigateTo: () => {} }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] HenchConfigView (loading state) ───────────────────────────────────

describe.skipIf(!axeRun)("[a11y] HenchConfigView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  it("has zero critical/serious violations (light theme, loading state)", async () => {
    cleanup = setTheme("light");
    const { HenchConfigView } = await import("../../../src/viewer/views/hench-config.js");
    root = renderToDiv(h(HenchConfigView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme, loading state)", async () => {
    cleanup = setTheme("dark");
    const { HenchConfigView } = await import("../../../src/viewer/views/hench-config.js");
    root = renderToDiv(h(HenchConfigView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] PRMarkdown (loading state) ────────────────────────────────────────

describe.skipIf(!axeRun)("[a11y] PRMarkdownView — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  it("has zero critical/serious violations (light theme, loading state)", async () => {
    cleanup = setTheme("light");
    const { PRMarkdownView } = await import("../../../src/viewer/views/pr-markdown.js");
    root = renderToDiv(h(PRMarkdownView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme, loading state)", async () => {
    cleanup = setTheme("dark");
    const { PRMarkdownView } = await import("../../../src/viewer/views/pr-markdown.js");
    root = renderToDiv(h(PRMarkdownView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});

// ── [a11y] ProjectSettings (loading state) ───────────────────────────────────

describe.skipIf(!axeRun)("[a11y] ProjectSettings — axe audit", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    cleanup?.();
    globalThis.fetch = originalFetch;
  });

  it("has zero critical/serious violations (light theme, loading state)", async () => {
    cleanup = setTheme("light");
    const { ProjectSettingsView } = await import("../../../src/viewer/views/project-settings.js");
    root = renderToDiv(h(ProjectSettingsView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });

  it("has zero critical/serious violations (dark theme, loading state)", async () => {
    cleanup = setTheme("dark");
    const { ProjectSettingsView } = await import("../../../src/viewer/views/project-settings.js");
    root = renderToDiv(h(ProjectSettingsView, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const violations = await runAxe(root);
    expect(violations, `Violations:\n${formatViolations(violations)}`).toHaveLength(0);
  });
});
