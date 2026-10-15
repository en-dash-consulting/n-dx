/**
 * Typed findings: derived from edges, anchored on them, judged against them.
 *
 * The contract this file holds is the one the metric-paraphrase heuristics
 * could not: every finding names files, and the question put to Jev carries
 * the same edges the finding was built from — so a `no` means "those edges are
 * fine", not "that number is fine".
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Imports, Zone, ZoneCrossing } from "../../../src/schema/index.js";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    getJudgmentRoute: vi.fn(() => undefined),
    callClaude: vi.fn(),
    ClaudeClientError: actual.ClaudeClientError,
  };
});
vi.mock("@n-dx/llm-client", async () => {
  const actual = await import("@n-dx/llm-client");
  return { ...actual, askJev: vi.fn() };
});

import { getJudgmentRoute } from "../../../src/analyzers/claude-client.js";
import { askJev } from "@n-dx/llm-client";
import {
  computeTypedFindings,
  judgeTypedFindings,
  noulAgreement,
  probabilitiesByZone,
  TYPED_ARTIFACT_MAX_PROBABILITY,
  TYPED_REAL_MIN_PROBABILITY,
} from "../../../src/analyzers/typed-findings.js";
import type { TypedFinding, TypedFindingInput } from "../../../src/analyzers/typed-findings.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedAskJev = vi.mocked(askJev);

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}
function crossing(from: string, to: string, fromZone: string, toZone: string): ZoneCrossing {
  return { from, to, fromZone, toZone };
}
function emptyImports(): Imports {
  return {
    edges: [],
    external: [],
    summary: { totalEdges: 0, totalExternal: 0, circularCount: 0, circulars: [], mostImported: [], avgImportsPerFile: 0 },
  };
}

beforeEach(() => {
  mockedAskJev.mockReset();
  mockedRoute.mockReset();
  mockedRoute.mockReturnValue("typesafe");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ── Derivations ──────────────────────────────────────────────────────────────

describe("computeTypedFindings", () => {
  it("calls the thinner direction of a bidirectional zone pair a layering violation, anchored on its files", () => {
    const input: TypedFindingInput = {
      zones: [zone("ui", ["ui/a.ts", "ui/b.ts"]), zone("core", ["core/x.ts", "core/y.ts"])],
      crossings: [
        crossing("ui/a.ts", "core/x.ts", "ui", "core"),
        crossing("ui/b.ts", "core/x.ts", "ui", "core"),
        crossing("ui/a.ts", "core/y.ts", "ui", "core"),
        crossing("core/x.ts", "ui/a.ts", "core", "ui"),
      ],
      imports: emptyImports(),
      pass: 1,
    };
    const found = computeTypedFindings(input).filter((t) => t.kind === "layering-violation");
    expect(found).toHaveLength(1);
    expect(found[0].finding.scope).toBe("core");
    expect(found[0].finding.severity).toBe("warning");
    expect(found[0].edges).toEqual([{ from: "core/x.ts", to: "ui/a.ts" }]);
    expect(found[0].finding.anchors).toEqual([{ file: "core/x.ts" }, { file: "ui/a.ts" }]);
  });

  it("leaves an evenly bidirectional pair alone — neither direction is the minority", () => {
    const input: TypedFindingInput = {
      zones: [zone("a", ["a/x.ts"]), zone("b", ["b/y.ts"])],
      crossings: [crossing("a/x.ts", "b/y.ts", "a", "b"), crossing("b/y.ts", "a/x.ts", "b", "a")],
      imports: emptyImports(),
      pass: 1,
    };
    expect(computeTypedFindings(input).filter((t) => t.kind === "layering-violation")).toHaveLength(0);
  });

  it("anchors a cycle on every file in it", () => {
    const imports = emptyImports();
    imports.summary.circulars = [{ cycle: ["src/a.ts", "src/b.ts", "src/c.ts"] }];
    const found = computeTypedFindings({
      zones: [zone("core", ["src/a.ts", "src/b.ts", "src/c.ts"])],
      crossings: [],
      imports,
      pass: 1,
    }).filter((t) => t.kind === "cycle-member");
    expect(found).toHaveLength(1);
    expect(found[0].finding.anchors?.map((a) => a.file)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(found[0].edges).toHaveLength(3);
  });

  it("reports a file imported from three zones as a hub, naming them", () => {
    const found = computeTypedFindings({
      zones: [zone("a", ["a.ts"]), zone("b", ["b.ts"]), zone("c", ["c.ts"]), zone("shared", ["shared/u.ts"])],
      crossings: [
        crossing("a.ts", "shared/u.ts", "a", "shared"),
        crossing("b.ts", "shared/u.ts", "b", "shared"),
        crossing("c.ts", "shared/u.ts", "c", "shared"),
      ],
      imports: emptyImports(),
      pass: 1,
    }).filter((t) => t.kind === "hub-file");
    expect(found).toHaveLength(1);
    expect(found[0].finding.text).toContain("imported from 3 zones");
    expect(found[0].finding.related).toEqual(["a", "b", "c"]);
  });

  it("reports a source file imported only by tests, and not one a source file also imports", () => {
    const imports = emptyImports();
    imports.edges = [
      { from: "tests/a.test.ts", to: "src/orphan.ts", type: "static", symbols: ["x"] },
      { from: "tests/b.test.ts", to: "src/orphan.ts", type: "static", symbols: ["x"] },
      { from: "tests/a.test.ts", to: "src/used.ts", type: "static", symbols: ["y"] },
      { from: "src/app.ts", to: "src/used.ts", type: "static", symbols: ["y"] },
    ];
    const found = computeTypedFindings({
      zones: [zone("core", ["src/orphan.ts", "src/used.ts", "src/app.ts"])],
      crossings: [],
      imports,
      pass: 1,
    }).filter((t) => t.kind === "test-only-module");
    expect(found).toHaveLength(1);
    expect(found[0].finding.anchors?.map((a) => a.file)).toEqual([
      "tests/a.test.ts",
      "src/orphan.ts",
      "tests/b.test.ts",
    ]);
  });

  it("reports exported declarations nothing imports, anchored on the declaration lines", () => {
    const found = computeTypedFindings({
      zones: [zone("core", ["src/dead.ts"])],
      crossings: [],
      imports: emptyImports(),
      projectDir,
      pass: 1,
    }).filter((t) => t.kind === "dead-export");
    expect(found).toHaveLength(1);
    expect(found[0].finding.anchors).toEqual([
      { file: "src/dead.ts", lineRange: [1, 1], symbol: "unusedThing" },
      { file: "src/dead.ts", lineRange: [2, 2], symbol: "AlsoUnused" },
    ]);
  });

  it("reports cross-zone imports that bypass the target's entry points", () => {
    const found = computeTypedFindings({
      zones: [
        zone("app", ["app/a.ts", "app/b.ts", "app/c.ts"]),
        zone("lib", ["lib/index.ts", "lib/inner.ts", "lib/deep.ts"], { entryPoints: ["lib/index.ts"] }),
      ],
      crossings: [
        crossing("app/a.ts", "lib/inner.ts", "app", "lib"),
        crossing("app/b.ts", "lib/deep.ts", "app", "lib"),
        crossing("app/c.ts", "lib/inner.ts", "app", "lib"),
        crossing("app/a.ts", "lib/index.ts", "app", "lib"),
      ],
      imports: emptyImports(),
      pass: 1,
    }).filter((t) => t.kind === "boundary-crossing");
    expect(found).toHaveLength(1);
    // The edge through the entry point is not part of the finding.
    expect(found[0].edges.map((e) => e.to)).toEqual(["lib/inner.ts", "lib/deep.ts", "lib/inner.ts"]);
    expect(found[0].finding.text).toContain("no interface module");
  });

  it("says nothing about a zone that declares no entry points — there is no interface to bypass", () => {
    const found = computeTypedFindings({
      zones: [zone("app", ["app/a.ts"]), zone("lib", ["lib/inner.ts"])],
      crossings: Array.from({ length: 5 }, () => crossing("app/a.ts", "lib/inner.ts", "app", "lib")),
      imports: emptyImports(),
      pass: 1,
    });
    expect(found.filter((t) => t.kind === "boundary-crossing")).toHaveLength(0);
  });

  it("gives every finding at least one anchor", () => {
    const imports = emptyImports();
    imports.summary.circulars = [{ cycle: ["src/a.ts", "src/b.ts"] }];
    const all = computeTypedFindings({
      zones: [zone("core", ["src/a.ts", "src/b.ts"]), zone("ui", ["ui/x.ts"])],
      crossings: [crossing("ui/x.ts", "src/a.ts", "ui", "core")],
      imports,
      pass: 1,
    });
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) expect(t.finding.anchors?.length ?? 0).toBeGreaterThan(0);
  });
});

// ── Judgment ─────────────────────────────────────────────────────────────────

const cycleInput: TypedFindingInput = (() => {
  const imports = emptyImports();
  imports.summary.circulars = [{ cycle: ["src/a.ts", "src/b.ts"] }];
  return { zones: [zone("core", ["src/a.ts", "src/b.ts"])], crossings: [], imports, pass: 1 };
})();

function typedCycle(): TypedFinding[] {
  return computeTypedFindings(cycleInput);
}

function noulAnswer(noul: number) {
  return { type: "noul" as const, noul };
}

describe("judgeTypedFindings", () => {
  it("puts the finding's own edges in the state it is judged against", async () => {
    mockedAskJev.mockResolvedValue({ answers: { t0: noulAnswer(0.9) }, tokenUsage: { input: 1, output: 1 } } as never);
    await judgeTypedFindings(typedCycle(), { zones: cycleInput.zones, imports: cycleInput.imports });
    const [request] = mockedAskJev.mock.calls[0];
    const state = request.state as { findings: Record<string, { edges: string[]; anchors: string[] }> };
    expect(state.findings.f0.edges).toEqual(["src/a.ts → src/b.ts", "src/b.ts → src/a.ts"]);
    expect(state.findings.f0.anchors).toEqual(["src/a.ts", "src/b.ts"]);
    expect(request.questions.t0.instructions).toContain("`findings.f0.edges`");
  });

  it("keeps the severity of a confirmed finding and records its probability", async () => {
    mockedAskJev.mockResolvedValue({ answers: { t0: noulAnswer(TYPED_REAL_MIN_PROBABILITY) } } as never);
    const result = await judgeTypedFindings(typedCycle(), { zones: cycleInput.zones });
    expect(result.findings[0].severity).toBe("warning");
    expect(result.findings[0].confidence).toBe(TYPED_REAL_MIN_PROBABILITY);
    expect(result.demoted).toBe(0);
    expect(result.uncertain).toBe(0);
  });

  it("drops a finding judged a detection artifact to info, keeping its anchors", async () => {
    mockedAskJev.mockResolvedValue({ answers: { t0: noulAnswer(TYPED_ARTIFACT_MAX_PROBABILITY) } } as never);
    const result = await judgeTypedFindings(typedCycle(), { zones: cycleInput.zones });
    expect(result.findings[0].severity).toBe("info");
    expect(result.demoted).toBe(1);
    expect(result.findings[0].anchors?.length).toBe(2);
  });

  it("counts a mid-band answer as uncertain without changing severity", async () => {
    mockedAskJev.mockResolvedValue({ answers: { t0: noulAnswer(0.5) } } as never);
    const result = await judgeTypedFindings(typedCycle(), { zones: cycleInput.zones });
    expect(result.uncertain).toBe(1);
    expect(result.findings[0].severity).toBe("warning");
  });

  it("makes no request without a judgment route and returns the findings as derived", async () => {
    mockedRoute.mockReturnValue(undefined);
    const result = await judgeTypedFindings(typedCycle(), { zones: cycleInput.zones });
    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(result.calls).toBe(0);
    expect(result.findings[0].severity).toBe("warning");
    expect(result.findings[0].confidence).toBeUndefined();
  });
});

describe("noulAgreement", () => {
  it("counts zones the two judgments band the same way, ignoring zones only one answered", () => {
    const heuristic = new Map([["a", 0.9], ["b", 0.2], ["c", 0.5], ["d", 0.8]]);
    const typed = new Map([["a", 0.95], ["b", 0.5], ["c", 0.45]]);
    expect(noulAgreement(heuristic, typed)).toEqual({ compared: 3, agreed: 2 });
  });

  it("takes each zone's highest judged confidence", () => {
    const byZone = probabilitiesByZone([
      { type: "observation", pass: 1, scope: "a", text: "x", confidence: 0.2 },
      { type: "observation", pass: 1, scope: "a", text: "y", confidence: 0.8 },
      { type: "observation", pass: 1, scope: "b", text: "z" },
    ]);
    expect([...byZone.entries()]).toEqual([["a", 0.8]]);
  });
});

let projectDir: string;
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-typed-"));
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src/dead.ts"), "export const unusedThing = 1;\nexport class AlsoUnused {}\n");
});
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));
