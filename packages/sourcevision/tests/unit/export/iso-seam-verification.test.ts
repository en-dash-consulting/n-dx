/**
 * Seam verification tests.
 *
 * A declared injection seam is drawn on the map because somebody wrote it down,
 * not because the analysis found it. A refactor can leave the declaration
 * behind, and a map that keeps asserting a dead relationship is worse than one
 * that shows nothing — so where a call graph exists, the declaration is checked
 * against it, and the difference between "corroborated", "unsupported" and
 * "nobody could check" is carried all the way to the panel.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JSDOM } from "jsdom";
import {
  indexCalleesByFile,
  verifySeamCallbacks,
  loadFromSourcevision,
} from "../../../src/export/iso-sources.js";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";
import type { CallEdge, CallGraph } from "../../../src/schema/v1.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function edge(over: Partial<CallEdge> = {}): CallEdge {
  return {
    callerFile: "src/core/scheduler.ts",
    caller: "start",
    calleeFile: null,
    callee: "broadcast",
    type: "direct",
    line: 1,
    column: 1,
    ...over,
  };
}

function callGraph(edges: CallEdge[]): CallGraph {
  return {
    functions: [],
    edges,
    summary: {
      totalFunctions: 0,
      totalCalls: edges.length,
      filesWithCalls: 0,
      mostCalled: [],
      mostCalling: [],
      cycleCount: 0,
    },
  };
}

/**
 * A two-zone `.sourcevision/` analysis with a declared seam.
 *
 * The seam runs api → core, so `core` is the receiving side: the zone whose
 * files would call the injected callbacks. `calls` names the callee expressions
 * to record against `src/core/scheduler.ts`; omitting `calls` writes no
 * callgraph.json at all, which is the scan-mode-shaped "nothing to check
 * against" case.
 */
function makeAnalysis(options: {
  callbacks?: string[];
  calls?: string[];
  omitCallGraph?: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), "iso-seam-"));
  const sv = join(root, ".sourcevision");
  mkdirSync(sv, { recursive: true });

  const files = [
    "src/api/a.ts",
    "src/api/b.ts",
    "src/core/scheduler.ts",
    "src/core/runner.ts",
  ];
  const write = (name: string, data: unknown) =>
    writeFileSync(join(sv, name), JSON.stringify(data), "utf-8");

  write("zones.json", {
    zones: [
      {
        id: "api",
        name: "Api",
        description: "HTTP surface",
        files: ["src/api/a.ts", "src/api/b.ts"],
        entryPoints: ["src/api/a.ts"],
        cohesion: 0.8,
        coupling: 0.2,
      },
      {
        id: "core",
        name: "Core",
        description: "Scheduling",
        files: ["src/core/scheduler.ts", "src/core/runner.ts"],
        entryPoints: ["src/core/scheduler.ts"],
        cohesion: 0.9,
        coupling: 0.1,
      },
    ],
    crossings: [{ fromZone: "api", toZone: "core" }],
    findings: [],
  });
  write("inventory.json", {
    files: files.map((path) => ({ path, lineCount: 40, role: "source" })),
    summary: { totalFiles: files.length, totalLines: 160 },
  });
  write("imports.json", { external: [] });
  if (!options.omitCallGraph) {
    write(
      "callgraph.json",
      callGraph((options.calls ?? []).map((callee) => edge({ callee }))),
    );
  }

  writeFileSync(
    join(root, ".n-dx.json"),
    JSON.stringify({
      sourcevision: {
        isoMap: {
          injectionSeams: [
            {
              from: "src/api/a.ts",
              to: "src/core/scheduler.ts",
              callbacks: options.callbacks,
              note: "core calls back into api",
            },
          ],
        },
      },
    }),
    "utf-8",
  );

  return root;
}

const load = (root: string) =>
  loadFromSourcevision(root, { useGit: false, analyzedAt: "t" })!;

// ── Indexing ────────────────────────────────────────────────────────────────

describe("indexCalleesByFile", () => {
  it("keeps calls whose callee cannot be resolved to a file", () => {
    // An injected callback is a parameter, so where it points is precisely what
    // static resolution cannot follow. aggregateCallEdges drops these; dropping
    // them here would discard the only evidence a seam ever has.
    const index = indexCalleesByFile(
      callGraph([edge({ calleeFile: null, callee: "broadcast" })]),
      new Set(["src/core/scheduler.ts"]),
    );
    expect([...(index.get("src/core/scheduler.ts") ?? [])]).toEqual(["broadcast"]);
  });

  it("indexes only the files it was asked about", () => {
    const index = indexCalleesByFile(
      callGraph([
        edge({ callerFile: "src/core/scheduler.ts", callee: "wanted" }),
        edge({ callerFile: "src/elsewhere/z.ts", callee: "ignored" }),
      ]),
      new Set(["src/core/scheduler.ts"]),
    );
    expect(index.size).toBe(1);
    expect(index.has("src/elsewhere/z.ts")).toBe(false);
  });

  it("returns nothing when there are no files of interest", () => {
    const index = indexCalleesByFile(callGraph([edge()]), new Set());
    expect(index.size).toBe(0);
  });
});

// ── Checking callbacks ──────────────────────────────────────────────────────

describe("verifySeamCallbacks", () => {
  const index = new Map([
    ["src/core/scheduler.ts", new Set(["broadcast", "options.loadPRD", "unrelated"])],
  ]);

  it("corroborates a callback called by name", () => {
    const result = verifySeamCallbacks(["broadcast"], ["src/core/scheduler.ts"], index);
    expect(result.status).toBe("verified");
    expect(result.corroborated).toEqual([
      { callback: "broadcast", file: "src/core/scheduler.ts", expression: "broadcast" },
    ]);
    expect(result.missing).toEqual([]);
  });

  it("corroborates a callback called through the options object", () => {
    // `options.loadPRD()` is a call to the injected `loadPRD`.
    const result = verifySeamCallbacks(["loadPRD"], ["src/core/scheduler.ts"], index);
    expect(result.status).toBe("verified");
    expect(result.corroborated[0].expression).toBe("options.loadPRD");
  });

  it("reports a callback nothing calls, and still verifies the seam", () => {
    const result = verifySeamCallbacks(
      ["broadcast", "onGone"],
      ["src/core/scheduler.ts"],
      index,
    );
    expect(result.status).toBe("verified"); // one callback is enough to draw it
    expect(result.missing).toEqual(["onGone"]);
  });

  it("marks a seam unverified when nothing it names is called", () => {
    const result = verifySeamCallbacks(["onGone", "alsoGone"], ["src/core/scheduler.ts"], index);
    expect(result.status).toBe("unverified");
    expect(result.corroborated).toEqual([]);
    expect(result.missing).toEqual(["onGone", "alsoGone"]);
  });

  it("prefers the exact call over a qualified one, so the evidence is stable", () => {
    const both = new Map([["a.ts", new Set(["wrapper.broadcast", "broadcast"])]]);
    expect(verifySeamCallbacks(["broadcast"], ["a.ts"], both).corroborated[0].expression).toBe(
      "broadcast",
    );
  });

  it("picks the same file every time when several call the callback", () => {
    const many = new Map([
      ["src/z.ts", new Set(["broadcast"])],
      ["src/a.ts", new Set(["broadcast"])],
    ]);
    const run = () =>
      verifySeamCallbacks(["broadcast"], ["src/z.ts", "src/a.ts"], many).corroborated[0].file;
    expect(run()).toBe("src/a.ts");
    expect(run()).toBe(run());
  });
});

// ── Through the model ───────────────────────────────────────────────────────

describe("seam verification in the model", () => {
  it("marks a seam the call graph supports as verified", () => {
    const dir = makeAnalysis({ callbacks: ["broadcast"], calls: ["broadcast"] });
    const model = buildIsoModel(load(dir));
    const seam = model.edges.find((e) => e.seam)!;
    expect(seam.seam!.verification).toMatchObject({ status: "verified", missing: [] });
    expect(seam.seam!.verification!.corroborated[0].file).toBe("src/core/scheduler.ts");
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks a seam nothing on the receiving side calls as unverified", () => {
    const dir = makeAnalysis({ callbacks: ["broadcast"], calls: ["somethingElse"] });
    const model = buildIsoModel(load(dir));
    const seam = model.edges.find((e) => e.seam)!;
    expect(seam.seam!.verification!.status).toBe("unverified");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the callbacks nothing calls rather than only marking the seam", () => {
    const dir = makeAnalysis({ callbacks: ["broadcast", "onGone"], calls: ["broadcast"] });
    const model = buildIsoModel(load(dir));
    const gap = model.meta.gaps.find((g) => g.includes("may be stale"));
    expect(gap).toBeDefined();
    expect(gap).toContain("onGone");
    expect(gap).not.toContain("broadcast");
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds evidence in a neighbour the receiving module delegates to", () => {
    // n-dx's own scheduler seam names register-scheduler.ts, which hands every
    // callback to usage-cleanup-scheduler.ts, where they are actually called.
    // Checking only the named file would call that seam stale.
    const dir = makeAnalysis({ callbacks: ["broadcast"], calls: [] });
    const sv = join(dir, ".sourcevision");
    writeFileSync(
      join(sv, "callgraph.json"),
      JSON.stringify(callGraph([edge({ callerFile: "src/core/runner.ts", callee: "broadcast" })])),
      "utf-8",
    );
    const model = buildIsoModel(load(dir));
    expect(model.edges.find((e) => e.seam)!.seam!.verification).toMatchObject({
      status: "verified",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a seam unchecked, not unverified, when there is no call graph", () => {
    // "Nobody checked" and "checked and unsupported" are different claims.
    const dir = makeAnalysis({ callbacks: ["broadcast"], omitCallGraph: true });
    const model = buildIsoModel(load(dir));
    expect(model.edges.find((e) => e.seam)!.seam!.verification).toBeUndefined();
    expect(model.meta.gaps.some((g) => g.includes("could not be checked against the code"))).toBe(
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a seam that names no callbacks unchecked — there is nothing to look for", () => {
    const dir = makeAnalysis({ calls: ["broadcast"] });
    const model = buildIsoModel(load(dir));
    expect(model.meta.seamCount).toBe(1);
    expect(model.edges.find((e) => e.seam)!.seam!.verification).toBeUndefined();
    expect(model.meta.gaps.some((g) => g.includes("may be stale"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── On the page ─────────────────────────────────────────────────────────────

describe("seam verification on the rendered page", () => {
  const render = (options: Parameters<typeof makeAnalysis>[0]) => {
    const dir = makeAnalysis(options);
    const html = renderIsoMap(buildIsoModel(load(dir)));
    rmSync(dir, { recursive: true, force: true });
    return new JSDOM(html, { runScripts: "dangerously" });
  };

  const seamEdge = (doc: Document) =>
    [...doc.querySelectorAll("#iso .edge")].find((g) =>
      /runtime seam/i.test(g.getAttribute("aria-label") ?? ""),
    )!;

  it("draws an unverified seam differently from a corroborated one", () => {
    const bad = render({ callbacks: ["broadcast"], calls: ["somethingElse"] });
    const good = render({ callbacks: ["broadcast"], calls: ["broadcast"] });
    const wire = (dom: JSDOM) => seamEdge(dom.window.document).querySelector("polyline:not([stroke])")!;

    expect(wire(bad).getAttribute("class")).toContain("unver");
    expect(wire(good).getAttribute("class")).not.toContain("unver");
    // Not colour alone: the dash pattern differs too.
    expect(wire(bad).getAttribute("stroke-dasharray")).not.toBe(
      wire(good).getAttribute("stroke-dasharray"),
    );

    bad.window.close();
    good.window.close();
  });

  it("says so in the connector's accessible name", () => {
    const dom = render({ callbacks: ["broadcast"], calls: ["somethingElse"] });
    expect(seamEdge(dom.window.document).getAttribute("aria-label")).toContain(
      "Unverified runtime seam",
    );
    dom.window.close();
  });

  it("names the uncalled callback in the panel", () => {
    const dom = render({ callbacks: ["broadcast"], calls: ["somethingElse"] });
    const doc = dom.window.document;
    const edgeEl = seamEdge(doc);
    edgeEl.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
    edgeEl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    const panel = doc.querySelector("#dossier")!.innerHTML;
    expect(panel).toContain("unverified");
    expect(panel).toContain("not called anywhere in Core");
    dom.window.close();
  });

  it("shows where a corroborated callback is called", () => {
    const dom = render({ callbacks: ["broadcast"], calls: ["broadcast"] });
    const doc = dom.window.document;
    const edgeEl = seamEdge(doc);
    edgeEl.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
    edgeEl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    const panel = doc.querySelector("#dossier")!.innerHTML;
    expect(panel).toContain("corroborated");
    expect(panel).toContain("src/core/scheduler.ts");
    dom.window.close();
  });
});
