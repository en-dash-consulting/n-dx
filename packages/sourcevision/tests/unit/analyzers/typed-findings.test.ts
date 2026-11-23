/**
 * Typed findings: derived from edges, anchored on them, judged against them.
 *
 * The contract this file holds is the one the metric-paraphrase heuristics
 * could not: every finding names files, and the question put to Jev carries
 * the same edges the finding was built from — so a `no` means "those edges are
 * fine", not "that number is fine".
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
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
import { askJev, ClaudeClientError } from "@n-dx/llm-client";
import {
  computeTypedFindings,
  judgeTypedFindings,
  noulAgreement,
  probabilitiesByZone,
  TYPED_ARTIFACT_MAX_PROBABILITY,
  TYPED_REAL_MIN_PROBABILITY,
} from "../../../src/analyzers/typed-findings.js";
import type { TypedFinding, TypedFindingInput } from "../../../src/analyzers/typed-findings.js";
import { jsonBytes, setJevRequestByteCeiling } from "../../../src/analyzers/jev-split.js";

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

  describe("a request TypeSafe refuses as too large", () => {
    const tooLarge = () => new ClaudeClientError('TypeSafe returned 400: {"detail":{"error_type":"max_tokens_exceeded"}}', "unknown", false);
    // Five invented findings; `big` is too large to judge even alone.
    const names = ["alpha", "beta", "gamma", "delta", "big"];
    const five: TypedFinding[] = names.map((n) => ({
      kind: "hub-file",
      finding: { type: "observation", pass: 1, scope: "core", text: `finding ${n}`, severity: "warning", anchors: [{ file: `src/${n}.ts` }] },
      edges: [{ from: `src/${n}.ts`, to: "src/shared.ts" }],
    }));
    const texts = (request: { state: unknown }) =>
      Object.values((request.state as { findings: Record<string, { text: string }> }).findings).map((f) => f.text);

    it("asks again in halves until each fits, landing each answer on its own finding", async () => {
      mockedAskJev.mockImplementation((async (request: { state: unknown; questions: Record<string, unknown> }) => {
        const asked = texts(request);
        if (asked.length > 2 || asked.includes("finding big")) throw tooLarge();
        return { answers: Object.fromEntries(asked.map((t, i) => [`t${i}`, noulAnswer(0.81 + 0.01 * names.indexOf(t.slice(8)))])) };
      }) as never);
      const warn = vi.mocked(console.warn);
      const log = vi.mocked(console.log);

      const result = await judgeTypedFindings(five, { zones: [zone("core", ["src/alpha.ts"])] });

      expect(result.calls).toBe(3);
      expect(result.findings.map((f) => f.confidence)).toEqual([0.81, 0.82, 0.83, 0.84, undefined]);
      expect(result.findings[4].severity).toBe("warning");
      expect(result.probabilities.size).toBe(4);
      expect(warn.mock.calls.map(([m]) => m)).toEqual([
        "  [judge] 1 typed finding(s) too large for one request — keeping derived severities",
      ]);
      expect(log.mock.calls[0][0]).toContain("typed findings: 4 of 5 judged in 3 request(s)");
      expect(log.mock.calls[0][0]).toContain("4/4 outside the uncertain band");
    });

    it("retries a lone refused finding on trimmed evidence and records the level it was judged at", async () => {
      const zonesAsked: Array<Record<string, Record<string, unknown>>> = [];
      let bigAsked = 0;
      mockedAskJev.mockImplementation((async (request: { state: unknown }) => {
        const asked = texts(request);
        zonesAsked.push((request.state as { zones: Record<string, Record<string, unknown>> }).zones);
        // `big` is refused untrimmed and at level 1, answered at level 2.
        if (asked.includes("finding big") && (asked.length > 1 || ++bigAsked < 3)) throw tooLarge();
        return { answers: Object.fromEntries(asked.map((_, i) => [`t${i}`, noulAnswer(0.9)])) };
      }) as never);
      const log = vi.mocked(console.log);

      const result = await judgeTypedFindings(five, { zones: [zone("core", ["src/alpha.ts"])] });

      expect(result.findings[4].confidence).toBe(0.9);
      expect(result.trimmedLevels).toEqual(new Map([["finding big", 2]]));
      expect(zonesAsked.at(-1)!.core).not.toHaveProperty("headers");
      expect(zonesAsked[0].core).toHaveProperty("headers");
      expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain("typed findings: 5 judged in");
      expect(log.mock.calls[0][0]).toContain(", 1 on trimmed evidence (");
    });

    it("counts in the warning only a finding refused at every trim level", async () => {
      const bigRequests: string[][] = [];
      mockedAskJev.mockImplementation((async (request: { state: unknown }) => {
        const asked = texts(request);
        if (asked.includes("finding big")) {
          bigRequests.push(asked);
          throw tooLarge();
        }
        return { answers: Object.fromEntries(asked.map((_, i) => [`t${i}`, noulAnswer(0.9)])) };
      }) as never);

      const result = await judgeTypedFindings(five, { zones: [zone("core", ["src/alpha.ts"])] });

      // Alone: untrimmed, then levels 1–4.
      expect(bigRequests.filter((r) => r.length === 1)).toHaveLength(5);
      expect(result.findings[4].confidence).toBeUndefined();
      expect(result.findings[4].severity).toBe("warning");
      expect(result.trimmedLevels.size).toBe(0);
      expect(vi.mocked(console.warn).mock.calls.map(([m]) => m)).toEqual([
        "  [judge] 1 typed finding(s) too large for one request — keeping derived severities",
      ]);
    });

    it("cuts the zone evidence one level at a time: headers, then symbols, then the file sample", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sv-typed-trim-"));
      const files = Array.from({ length: 12 }, (_, i) => `src/part${i}.ts`);
      mkdirSync(join(dir, "src"));
      for (const [i, f] of files.entries()) writeFileSync(join(dir, f), `/**\n * Part ${i} of the invented core.\n * Pure helpers.\n */\nexport function part${i}() {}\n`);
      const imports = emptyImports();
      imports.edges.push({ from: "src/user.ts", to: files[0], type: "static", symbols: ["part0"] });
      const lone: TypedFinding = {
        kind: "hub-file",
        finding: { type: "observation", pass: 1, scope: "core", text: "finding lone", severity: "warning" },
        edges: [{ from: "src/user.ts", to: files[0] }],
      };
      const zonesAsked: Array<Record<string, unknown>> = [];
      mockedAskJev.mockImplementation((async (request: { state: unknown }) => {
        zonesAsked.push((request.state as { zones: Record<string, Record<string, unknown>> }).zones.core);
        if (zonesAsked.length < 4) throw tooLarge();
        return { answers: { t0: noulAnswer(0.9) } };
      }) as never);

      try {
        const result = await judgeTypedFindings([lone], { zones: [zone("core", files)], imports, projectDir: dir });
        expect(result.trimmedLevels.get("finding lone")).toBe(3);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      const [full, one, two, three] = zonesAsked;
      expect(Object.keys(full.headers as object).length).toBeGreaterThan(0);
      expect((full.declarations as string[]).length).toBeGreaterThan(0);
      expect(full.exportedSymbols).toEqual(["part0"]);
      expect(full.files).toHaveLength(12);
      const { headers: _headers, ...withoutHeaders } = full;
      expect(one).toEqual(withoutHeaders);
      const { declarations: _declarations, exportedSymbols: _exported, ...withoutSymbols } = withoutHeaders;
      expect(two).toEqual(withoutSymbols);
      expect(three).toEqual({ ...withoutSymbols, files: files.slice(0, 10) });
    });

    it("cuts a finding's edges to four at the last trim level", async () => {
      const many: TypedFinding = {
        kind: "hub-file",
        finding: { type: "observation", pass: 1, scope: "core", text: "finding many", severity: "warning" },
        edges: Array.from({ length: 12 }, (_, i) => ({ from: `src/m${i}.ts`, to: "src/hub.ts" })),
      };
      const edgesAsked: number[] = [];
      mockedAskJev.mockImplementation((async (request: { state: unknown }) => {
        const f0 = (request.state as { findings: Record<string, { edges: string[] }> }).findings.f0;
        edgesAsked.push(f0.edges.length);
        if (f0.edges.length > 4) throw tooLarge();
        return { answers: { t0: noulAnswer(0.9) } };
      }) as never);

      const result = await judgeTypedFindings([many], { zones: [zone("core", ["src/hub.ts"])] });

      expect(edgesAsked).toEqual([12, 12, 12, 12, 4]);
      expect(result.trimmedLevels.get("finding many")).toBe(4);
    });

    it("still stops on any other failure, keeping every derived severity", async () => {
      mockedAskJev.mockRejectedValue(new ClaudeClientError("TypeSafe returned 400: bad request", "unknown", false));
      const result = await judgeTypedFindings(five, { zones: [zone("core", ["src/alpha.ts"])] });
      expect(mockedAskJev).toHaveBeenCalledTimes(1);
      expect(result.calls).toBe(0);
      expect(result.findings.every((f) => f.confidence === undefined && f.severity === "warning")).toBe(true);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("typed-finding judgment failed (unknown)");
    });
  });

  describe("packing under the request byte ceiling", () => {
    afterEach(() => setJevRequestByteCeiling(undefined));

    // Six invented findings over two zones.
    const six: TypedFinding[] = ["a1", "a2", "a3", "b1", "b2", "b3"].map((n) => ({
      kind: "hub-file",
      finding: { type: "observation", pass: 1, scope: `zone-${n[0]}`, text: `finding ${n}`, severity: "warning", anchors: [{ file: `src/${n}.ts` }] },
      edges: [{ from: `src/${n}.ts`, to: "src/shared.ts" }],
    }));
    const zones = [zone("zone-a", ["src/a1.ts", "src/a2.ts"]), zone("zone-b", ["src/b1.ts"])];
    const answerAll = (async (request: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, noulAnswer(0.9)])),
    })) as never;
    const asked = () => mockedAskJev.mock.calls.map(([r]) => Object.keys((r.state as { findings: object }).findings).length);

    it("sends one request when everything fits, the same request as before packing", async () => {
      mockedAskJev.mockImplementation(answerAll);
      const result = await judgeTypedFindings(six, { zones });
      expect(asked()).toEqual([6]);
      const [request] = mockedAskJev.mock.calls[0];
      expect(Object.keys(request.state as object)).toEqual(["findings", "zones"]);
      expect(Object.keys((request.state as { zones: object }).zones)).toEqual(["zone-a", "zone-b"]);
      expect(vi.mocked(console.log).mock.calls[0][0]).toBe(
        "  [judge] typed findings: 6 judged in 1 request(s) — 0 demoted to info, 6/6 outside the uncertain band (0 in / 0 out)",
      );
      expect(result.trimmedLevels.size).toBe(0);
    });

    it("sends more, smaller requests under a small ceiling, with no refusal", async () => {
      mockedAskJev.mockImplementation(answerAll);
      // Measure one finding and one zone from an unpacked request, then leave
      // room for three findings and one zone.
      await judgeTypedFindings(six, { zones });
      const [full] = mockedAskJev.mock.calls[0] as unknown as [{ state: { findings: Record<string, unknown>; zones: Record<string, unknown> }; questions: Record<string, unknown> }];
      const finding = jsonBytes(full.state.findings.f0) + jsonBytes(full.questions.t0);
      setJevRequestByteCeiling(3 * finding + jsonBytes(full.state.zones["zone-a"]) + 1);
      mockedAskJev.mockClear();

      const result = await judgeTypedFindings(six, { zones });

      expect(asked()).toEqual([3, 3]);
      expect(mockedAskJev.mock.calls.map(([r]) => Object.keys((r.state as { zones: object }).zones))).toEqual([["zone-a"], ["zone-b"]]);
      expect(result.findings.every((f) => f.confidence === 0.9)).toBe(true);
      expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
    });
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
