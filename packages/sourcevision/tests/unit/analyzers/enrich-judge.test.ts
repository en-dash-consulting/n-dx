import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding, Zone, ZoneCrossing } from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    getJudgmentRoute: vi.fn(() => undefined),
    ClaudeClientError: actual.ClaudeClientError,
  };
});
vi.mock("../../../src/analyzers/jev-client.js", async () => {
  const actual = await import("../../../src/analyzers/jev-client.js");
  return { ...actual, askJev: vi.fn() };
});

import { getJudgmentRoute } from "../../../src/analyzers/claude-client.js";
import { askJev } from "../../../src/analyzers/jev-client.js";
import {
  judgeFindings,
  judgeZoneFragility,
  buildFindingJudgeRequest,
  buildZoneFragilityRequest,
  FINDING_JUDGE_MIN_CONFIDENCE,
  FINDING_SUPPORT_DROP_BELOW,
  FINDING_SUPPORT_UNCERTAIN_BELOW,
  FINDING_RESTATES_MAX_PROBABILITY,
  FINDING_RESCOPE_MIN_CONFIDENCE,
  ZONE_FRAGILITY_MIN_PROBABILITY,
  judgeHeuristicFindings,
  judgeMoves,
  buildMoveJudgeRequest,
  HEURISTIC_ARTIFACT_MAX_PROBABILITY,
  HEURISTIC_REAL_MIN_PROBABILITY,
  MOVE_MIN_PROBABILITY,
} from "../../../src/analyzers/enrich-judge.js";
import type { FindingEvidence } from "../../../src/analyzers/enrich-judge.js";
import { enforceSeverityRules } from "../../../src/analyzers/enrich-parsing.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedAskJev = vi.mocked(askJev);

function finding(text: string, extra: Partial<Finding> = {}): Finding {
  return { type: "observation", pass: 2, scope: "global", text, ...extra };
}

function scoreAnswer(score: number, confidence: number) {
  return { type: "score" as const, score, probabilities: [0, 0, 0], confidence };
}
function choiceAnswer(choice: string, confidence: number) {
  return { type: "choice" as const, choice, probabilities: { [choice]: confidence }, confidence };
}

beforeEach(() => {
  mockedAskJev.mockReset();
  mockedRoute.mockReset();
  mockedRoute.mockReturnValue("typesafe");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("judgeFindings", () => {
  it("applies Jev's severity and category when confidence clears the threshold and records confidence", async () => {
    const input = [
      finding("Lock released before write completes", { severity: "info", category: "documentation" }),
      finding("Zone X cleanly separates parsing", { severity: "warning", category: "code" }),
    ];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev-1.13.0",
      answers: {
        s0: scoreAnswer(1.9, 0.82), c0: choiceAnswer("code", 0.9),
        s1: scoreAnswer(0.1, 0.77), c1: choiceAnswer("structural", 0.71),
      },
      tokenUsage: { input: 500, output: 20 },
    });

    const res = await judgeFindings(input);

    expect(res.calls).toBe(1);
    expect(res.tokenUsage).toEqual({ input: 500, output: 20 });
    expect(res.findings[0]).toMatchObject({ severity: "critical", category: "code", confidence: 0.82 });
    expect(res.findings[1]).toMatchObject({ severity: "info", category: "structural", confidence: 0.77 });
    // Inputs are not mutated.
    expect(input[0].severity).toBe("info");
  });

  it("keeps the model-stated severity and existing category below the threshold, but still records confidence", async () => {
    const low = FINDING_JUDGE_MIN_CONFIDENCE - 0.01;
    const input = [finding("Something", { severity: "warning", category: "documentation" })];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { s0: scoreAnswer(2, low), c0: choiceAnswer("code", low) },
    });

    const res = await judgeFindings(input);

    expect(res.findings[0]).toMatchObject({ severity: "warning", category: "documentation", confidence: low });
  });

  it("fills a severity and category the model never stated, even when Jev is unsure", async () => {
    const input = [
      finding("Two zones re-implement path normalisation"),
      finding("Four-file automation zone is lean"),
    ];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        s0: scoreAnswer(1.1, 0.6), c0: choiceAnswer("nonsense", 0.9),
        s1: scoreAnswer(0.2, 0.31), c1: choiceAnswer("structural", 0.2),
      },
    });

    const res = await judgeFindings(input);

    expect(res.findings[0].severity).toBe("warning");
    // An option outside the enum never lands on the finding.
    expect(res.findings[0].category).toBeUndefined();
    // Nothing was stated, so the best available grade fills in and the low
    // confidence travels with it rather than leaving the field empty.
    expect(res.findings[1]).toMatchObject({ severity: "info", category: "structural", confidence: 0.31 });
  });

  it("does not shift enforceSeverityRules: positive-language findings still end at info", async () => {
    const input = [finding("Exemplary clean separation between the layers", { severity: "info" })];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { s0: scoreAnswer(2, 0.95), c0: choiceAnswer("structural", 0.9) },
    });

    const judged = (await judgeFindings(input)).findings;
    expect(judged[0].severity).toBe("critical");
    expect(enforceSeverityRules(judged)[0].severity).toBe("info");
  });

  it("makes no request and returns the input untouched when no judgment route is resolved", async () => {
    mockedRoute.mockReturnValue(undefined);
    const input = [finding("x", { severity: "warning" })];

    const res = await judgeFindings(input);

    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(res.findings).toBe(input);
    expect(res.calls).toBe(0);
    expect(res.tokenUsage).toBeUndefined();
  });

  it("splits a failing batch in half and keeps only the finding that still fails as stated", async () => {
    const input = [finding("a", { severity: "info" }), finding("b", { severity: "critical" })];
    mockedAskJev
      .mockRejectedValueOnce(new ClaudeClientError("bad batch", "unknown", false))   // both
      .mockResolvedValueOnce({ model: "jev", answers: { s0: scoreAnswer(2, 0.9), c0: choiceAnswer("code", 0.9) } })  // a
      .mockRejectedValueOnce(new ClaudeClientError("still bad", "unknown", false));  // b alone

    const res = await judgeFindings(input);

    expect(mockedAskJev).toHaveBeenCalledTimes(3);
    expect(res.calls).toBe(1);
    expect(res.findings[0]).toMatchObject({ severity: "critical", category: "code", confidence: 0.9 });
    expect(res.findings[1]).toBe(input[1]);
  });

  it("stops on an auth error and keeps every finding as stated", async () => {
    const input = [finding("a", { severity: "info" }), finding("b", { severity: "critical" })];
    mockedAskJev.mockRejectedValueOnce(new ClaudeClientError("bad key", "auth", false));
    const res = await judgeFindings(input);
    expect(mockedAskJev).toHaveBeenCalledTimes(1);
    expect(res.calls).toBe(0);
    expect(res.findings).toEqual(input);
  });

  it("never sends or alters pass 0 findings, and keeps their positions", async () => {
    const input = [
      finding("heuristic: 41 outgoing calls", { pass: 0, severity: "warning" }),
      finding("model: duplicated normaliser", { pass: 2, severity: "info" }),
      finding("heuristic: circular import", { pass: 0, severity: "critical" }),
    ];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { s0: scoreAnswer(1, 0.9), c0: choiceAnswer("code", 0.9) },
    });

    const res = await judgeFindings(input);

    const sent = mockedAskJev.mock.calls[0][0];
    expect(Object.keys(sent.questions)).toEqual(["s0", "c0"]);
    expect((sent.state as { findings: Record<string, { text: string }> }).findings.f0.text).toBe("model: duplicated normaliser");
    expect(res.findings[0]).toBe(input[0]);
    expect(res.findings[2]).toBe(input[2]);
    expect(res.findings[1]).toMatchObject({ severity: "warning", category: "code", confidence: 0.9 });
  });

  it("makes no request when every finding is pass 0", async () => {
    const res = await judgeFindings([finding("h", { pass: 0, severity: "info" })]);
    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(res.calls).toBe(0);
  });

  it("batches forty findings per request", async () => {
    const input = Array.from({ length: 41 }, (_, i) => finding(`f${i}`));
    mockedAskJev.mockImplementation(async (req) => {
      const n = Object.keys(req.questions).length / 2;
      const answers: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        answers[`s${i}`] = scoreAnswer(0, 0.9);
        answers[`c${i}`] = choiceAnswer("code", 0.9);
      }
      return { model: "jev", answers } as never;
    });

    const res = await judgeFindings(input);

    expect(mockedAskJev).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedAskJev.mock.calls[0][0].questions)).toHaveLength(80);
    expect(Object.keys(mockedAskJev.mock.calls[1][0].questions)).toHaveLength(2);
    expect(res.findings.every((f) => f.severity === "info" && f.category === "code")).toBe(true);
  });
});

describe("buildFindingJudgeRequest", () => {
  it("asks a score and a choice per finding and withholds the model-stated grades", () => {
    const req = buildFindingJudgeRequest([
      finding("t", { severity: "critical", category: "code", related: ["a.ts"] }),
    ]);
    expect(Object.keys(req.questions)).toEqual(["s0", "c0"]);
    expect(req.questions.s0.type).toBe("score");
    expect((req.questions.s0 as { criteria: unknown[] }).criteria).toHaveLength(3);
    expect(req.questions.c0.type).toBe("choice");
    expect(Object.keys((req.questions.c0 as { criteria: object }).criteria)).toEqual(["structural", "code", "documentation"]);
    expect(req.questions.s0.instructions).toContain("`findings.f0`");
    expect(req.state).toEqual({ findings: { f0: { text: "t", type: "observation", scope: "global", related: ["a.ts"] } } });
  });
});

const zones: Zone[] = [
  { id: "web-viewer", name: "Web Viewer", description: "UI", files: ["a.ts", "b.ts"], entryPoints: [], cohesion: 0.3, coupling: 0.8 },
  { id: "rex", name: "Rex", description: "PRD", files: ["c.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
];
const crossings: ZoneCrossing[] = [
  { from: "a.ts", to: "c.ts", fromZone: "web-viewer", toZone: "rex" },
  { from: "b.ts", to: "c.ts", fromZone: "web-viewer", toZone: "rex" },
];

describe("judgeZoneFragility", () => {
  it("emits a structural observation per noul at or above the threshold, carrying the probability", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        u0: { type: "noul", noul: 0.91 },
        d0: { type: "noul", noul: ZONE_FRAGILITY_MIN_PROBABILITY },
        u1: { type: "noul", noul: 0.2 },
        d1: { type: "noul", noul: ZONE_FRAGILITY_MIN_PROBABILITY - 0.01 },
      },
      tokenUsage: { input: 200, output: 8 },
    });

    const res = await judgeZoneFragility(zones, crossings, 3);

    expect(res.findings).toHaveLength(2);
    expect(res.findings[0]).toMatchObject({
      type: "observation", pass: 3, scope: "web-viewer", severity: "info", category: "structural", confidence: 0.91,
    });
    expect(res.findings[0].text).toContain('"Web Viewer"');
    expect(res.findings[0].text).toContain("unrelated purposes");
    expect(res.findings[1]).toMatchObject({ scope: "web-viewer", confidence: ZONE_FRAGILITY_MIN_PROBABILITY });
    expect(res.findings[1].text).toContain("depends on more of the rest of the codebase");
  });

  it("produces nothing when every noul is below the threshold", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { u0: { type: "noul", noul: 0.1 }, d0: { type: "noul", noul: 0.2 }, u1: { type: "noul", noul: 0.3 }, d1: { type: "noul", noul: 0.4 } },
    });
    const res = await judgeZoneFragility(zones, crossings, 1);
    expect(res.findings).toEqual([]);
    expect(res.calls).toBe(1);
  });

  it("makes no request without a route", async () => {
    mockedRoute.mockReturnValue(undefined);
    const res = await judgeZoneFragility(zones, crossings, 1);
    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(res).toEqual({ findings: [], calls: 0 });
  });
});

describe("buildZoneFragilityRequest", () => {
  it("states each zone with its sample, metrics and crossing counts, and asks two nouls", () => {
    const req = buildZoneFragilityRequest(zones, crossings);
    expect(Object.keys(req.questions).sort()).toEqual(["d0", "d1", "u0", "u1"]);
    expect(req.questions.u0.type).toBe("noul");
    expect(req.questions.u0.instructions).toContain("`zones.z0`");
    expect(req.ids.get("d1")).toMatchObject({ zone: zones[1], kind: "overdependent" });
    expect((req.state as { zones: Record<string, unknown> }).zones.z0).toEqual({
      id: "web-viewer", fileCount: 2, files: ["a.ts", "b.ts"],
      cohesion: 0.3, coupling: 0.8, importsTo: { rex: 2 }, importedFrom: {},
    });
    expect((req.state as { zones: Record<string, { importedFrom: object }> }).zones.z1.importedFrom).toEqual({ "web-viewer": 2 });
  });
});

// ── Evidence mode: support, restates, anchor, type, scope ────────────────────

const evidence: FindingEvidence = {
  zones: [
    { id: "web-viewer", name: "Web Viewer", description: "UI", files: ["ui/app.ts", "ui/hub.ts", "ui/store.ts"], entryPoints: [], cohesion: 0.3, coupling: 0.8 },
    { id: "rex", name: "Rex", description: "PRD", files: ["rex/store.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
  ],
  crossings: [{ from: "ui/app.ts", to: "rex/store.ts", fromZone: "web-viewer", toZone: "rex" }],
  heuristics: [finding("Cohesion 0.30 and coupling 0.80 place web-viewer in dual-fragility territory", { pass: 0, scope: "web-viewer", severity: "warning" })],
};

function noulAnswer(p: number) {
  return { type: "noul" as const, noul: p };
}

describe("buildFindingJudgeRequest — with evidence", () => {
  it("adds support, restates, anchor, type and scope questions over shared zone and heuristic state", () => {
    const req = buildFindingJudgeRequest(
      [finding("ui/hub.ts re-implements the store", { scope: "web-viewer", related: ["ui/store.ts"] }), finding("Everything is fine", { scope: "global" })],
      evidence,
    );
    expect(Object.keys(req.questions).sort()).toEqual(["a0", "c0", "c1", "r0", "s0", "s1", "t0", "t1", "v0", "v1", "z0", "z1"]);
    const state = req.state as { zones: Record<string, unknown>; heuristics: Record<string, string[]> };
    expect(state.zones["web-viewer"]).toMatchObject({ fileCount: 3, files: ["ui/app.ts", "ui/hub.ts", "ui/store.ts"], importsTo: { rex: 1 } });
    expect(state.zones["web-viewer"]).not.toHaveProperty("name");
    // No projectDir → no headers, but the field is present so instructions can reference it.
    expect((state.zones["web-viewer"] as { headers: object }).headers).toEqual({});
    expect(state.zones.rex).toBeUndefined(); // only scopes the batch references
    expect(state.heuristics["web-viewer"]).toHaveLength(1);
    // Files the finding names come first among the anchor candidates.
    expect(req.anchorFiles.get("a0")).toEqual(["ui/hub.ts", "ui/store.ts", "ui/app.ts"]);
    expect(Object.keys((req.questions.a0 as { criteria: object }).criteria)).toEqual(["a0", "a1", "a2", "none"]);
    expect(Object.keys((req.questions.z0 as { criteria: object }).criteria)).toEqual(["web-viewer", "rex", "global"]);
    // A global finding has no restates question (no heuristics for global) and no anchor question.
    expect(req.questions.r1).toBeUndefined();
    expect(req.questions.a1).toBeUndefined();
  });
});

describe("judgeFindings — support band", () => {
  it("keeps an undecided finding and records the support probability as its confidence", async () => {
    const mid = (FINDING_SUPPORT_DROP_BELOW + FINDING_SUPPORT_UNCERTAIN_BELOW) / 2;
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { s0: scoreAnswer(1, 0.95), c0: choiceAnswer("code", 0.9), v0: noulAnswer(mid) },
    });
    const res = await judgeFindings([finding("Maybe true", { scope: "web-viewer", severity: "warning" })], evidence);
    expect(res.dropped).toBeUndefined();
    expect(res.findings[0]).toMatchObject({ severity: "warning", confidence: Math.round(mid * 100) / 100 });
  });

  it("leaves the grade's confidence alone when support is clear", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { s0: scoreAnswer(1, 0.8), c0: choiceAnswer("code", 0.9), v0: noulAnswer(FINDING_SUPPORT_UNCERTAIN_BELOW) },
    });
    const res = await judgeFindings([finding("Clearly true", { scope: "web-viewer", severity: "warning" })], evidence);
    expect(res.findings[0].confidence).toBe(0.8);
  });
});

describe("judgeFindings — with evidence", () => {
  const base = () => [
    finding("Unsupported claim", { scope: "web-viewer", severity: "info" }),
    finding("Cohesion 0.30 and coupling 0.80 mean fragility", { scope: "web-viewer", severity: "warning" }),
    finding("ui/hub.ts re-implements the store", { scope: "web-viewer", severity: "info" }),
  ];
  const grades = (i: number) => ({ [`s${i}`]: scoreAnswer(1, 0.9), [`c${i}`]: choiceAnswer("code", 0.9) });

  it("drops unsupported findings and metric paraphrases, keeps the rest", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        ...grades(0), v0: noulAnswer(FINDING_SUPPORT_DROP_BELOW - 0.01), r0: noulAnswer(0.1),
        ...grades(1), v1: noulAnswer(0.9), r1: noulAnswer(FINDING_RESTATES_MAX_PROBABILITY),
        ...grades(2), v2: noulAnswer(0.95), r2: noulAnswer(0.05), a2: choiceAnswer("a0", 0.8), t2: choiceAnswer("anti-pattern", 0.7), z2: choiceAnswer("web-viewer", 0.9),
      },
    });

    const res = await judgeFindings(base(), evidence);

    expect(res.dropped).toBe(2);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({
      text: "ui/hub.ts re-implements the store",
      severity: "warning", category: "code", type: "anti-pattern", scope: "web-viewer",
      anchors: [{ file: "ui/hub.ts" }],
    });
  });

  it("leaves anchors empty on none, keeps type below threshold, and rescopes only at high confidence", async () => {
    const input = [finding("x", { scope: "web-viewer" }), finding("y", { scope: "web-viewer" })];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        ...grades(0), v0: noulAnswer(0.9), a0: choiceAnswer("none", 0.9), t0: choiceAnswer("suggestion", FINDING_JUDGE_MIN_CONFIDENCE - 0.01), z0: choiceAnswer("rex", FINDING_RESCOPE_MIN_CONFIDENCE - 0.01),
        ...grades(1), v1: noulAnswer(0.9), a1: choiceAnswer("a9", 0.9), t1: choiceAnswer("suggestion", 0.9), z1: choiceAnswer("rex", FINDING_RESCOPE_MIN_CONFIDENCE),
      },
    });

    const res = await judgeFindings(input, evidence);

    expect(res.findings[0].anchors).toBeUndefined();
    expect(res.findings[0].type).toBe("observation");
    expect(res.findings[0].scope).toBe("web-viewer");
    // An anchor option outside the candidate list is ignored; a valid rescope applies.
    expect(res.findings[1].anchors).toBeUndefined();
    expect(res.findings[1].type).toBe("suggestion");
    expect(res.findings[1].scope).toBe("rex");
    expect(res.dropped).toBeUndefined();
  });

  it("never rescopes to a zone that is not in the evidence", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { ...grades(0), v0: noulAnswer(0.9), z0: choiceAnswer("made-up", 0.99) },
    });
    const res = await judgeFindings([finding("x", { scope: "web-viewer" })], evidence);
    expect(res.findings[0].scope).toBe("web-viewer");
  });
});

// ── Heuristic findings ───────────────────────────────────────────────────────

describe("judgeHeuristicFindings", () => {
  const heuristics = [
    finding("hub: 41 outgoing calls", { pass: 0, scope: "web-viewer", severity: "warning" }),
    finding("cohesion 0.3", { pass: 0, scope: "web-viewer", severity: "critical" }),
    finding("informational", { pass: 0, scope: "web-viewer", severity: "info" }),
    finding("model finding", { pass: 2, scope: "web-viewer", severity: "warning" }),
    { ...finding("move", { pass: 0, scope: "web-viewer", severity: "warning" }), type: "move-file" as const },
    finding("no zone", { pass: 0, scope: "global", severity: "warning" }),
  ];

  it("asks only about zone-scoped warning+ pass 0 findings and bands the answers", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { h0: noulAnswer(HEURISTIC_ARTIFACT_MAX_PROBABILITY), h1: noulAnswer((HEURISTIC_ARTIFACT_MAX_PROBABILITY + HEURISTIC_REAL_MIN_PROBABILITY) / 2) },
      tokenUsage: { input: 40, output: 2 },
    });

    const res = await judgeHeuristicFindings(heuristics, evidence);

    expect(Object.keys(mockedAskJev.mock.calls[0][0].questions)).toEqual(["h0", "h1"]);
    expect((mockedAskJev.mock.calls[0][0].state as { zones: Record<string, unknown> }).zones["web-viewer"]).toBeDefined();
    expect(res.findings[0]).toMatchObject({ severity: "info", confidence: HEURISTIC_ARTIFACT_MAX_PROBABILITY });
    expect(res.findings[1]).toMatchObject({ severity: "critical", confidence: 0.5 });
    expect(res.findings[2]).toBe(heuristics[2]);
    expect(res.findings[3]).toBe(heuristics[3]);
    expect(res.findings[4]).toBe(heuristics[4]);
    expect(res.findings[5]).toBe(heuristics[5]);
    expect(res.calls).toBe(1);
  });

  it("keeps a real problem as stated with its confidence, and is inert without a route", async () => {
    mockedAskJev.mockResolvedValueOnce({ model: "jev", answers: { h0: noulAnswer(0.92), h1: noulAnswer(0.8) } });
    const res = await judgeHeuristicFindings(heuristics, evidence);
    expect(res.findings[0]).toMatchObject({ severity: "warning", confidence: 0.92 });

    mockedRoute.mockReturnValue(undefined);
    const inert = await judgeHeuristicFindings(heuristics, evidence);
    expect(inert.findings).toBe(heuristics);
    expect(inert.calls).toBe(0);
  });
});

// ── Moves ────────────────────────────────────────────────────────────────────

describe("judgeMoves", () => {
  const web = { id: "web", name: "Web", description: "", files: ["ui/hub.ts", "ui/app.ts"], entryPoints: [], cohesion: 0.5, coupling: 0.5 };
  const rex = { id: "rex", name: "Rex", description: "", files: ["rex/store.ts", "rex/tree.ts", "rex/serializer.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 };
  const edgesFor = (n: number): ZoneCrossing[] => Array.from({ length: n }, (_, i) => ({ from: "ui/hub.ts", to: rex.files[i % 3], fromZone: "web", toZone: "rex" }));

  it("asks only about files with enough cross-zone edges, offering own zone, partner zones and stay", () => {
    const req = buildMoveJudgeRequest([web, rex], [...edgesFor(3), { from: "ui/app.ts", to: "rex/store.ts", fromZone: "web", toZone: "rex" }]);
    expect(Object.keys(req.questions)).toEqual(["m0"]);
    expect(req.ids.get("m0")).toEqual({ path: "ui/hub.ts", zoneId: "web", edges: { rex: 3 } });
    // rex/store.ts is an import target on two of those edges — below the minimum, so not asked.
    expect(Object.keys((req.questions.m0 as { criteria: object }).criteria)).toEqual(["web", "rex", "stay"]);
    expect((req.state as { zones: Record<string, unknown> }).zones.rex).toEqual({ directory: "rex", fileCount: 3, files: rex.files });
  });

  it("emits a move-file finding for a confident other-zone choice, nothing for stay or a weak choice", async () => {
    const crossings = [...edgesFor(4), ...Array.from({ length: 3 }, () => ({ from: "ui/app.ts", to: "rex/tree.ts", fromZone: "web", toZone: "rex" }))];
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        m0: { type: "choice", choice: "rex", probabilities: { rex: MOVE_MIN_PROBABILITY, web: 0.2, stay: 0.1 }, confidence: 0.6 },
        m1: { type: "choice", choice: "stay", probabilities: { stay: 0.9 }, confidence: 0.9 },
      },
      tokenUsage: { input: 80, output: 4 },
    });

    const res = await judgeMoves([web, rex], crossings, 1);

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({
      type: "move-file", pass: 1, scope: "web", from: "ui/hub.ts", to: "rex/", moveReason: "zone-judgment",
      predictedImpact: 4, confidence: MOVE_MIN_PROBABILITY, related: ["rex"], category: "structural",
    });
    expect(res.findings[0].text).toContain("belongs with Rex");

    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { m0: { type: "choice", choice: "rex", probabilities: { rex: MOVE_MIN_PROBABILITY - 0.01 }, confidence: 0.5 }, m1: { type: "choice", choice: "rex", probabilities: { rex: 0.9 }, confidence: 0.9 } },
    });
    // Import targets count too: rex/tree.ts (4 edges) ranks above ui/app.ts (3).
    expect((await judgeMoves([web, rex], crossings, 1)).findings).toEqual([]);
  });

  it("makes no request when no file qualifies or no route resolves", async () => {
    expect(await judgeMoves([web, rex], edgesFor(2), 1)).toEqual({ findings: [], calls: 0 });
    mockedRoute.mockReturnValue(undefined);
    expect(await judgeMoves([web, rex], edgesFor(5), 1)).toEqual({ findings: [], calls: 0 });
    expect(mockedAskJev).not.toHaveBeenCalled();
  });
});

// ── Judged state is independent of zone names ────────────────────────────────

describe("judged state carries no zone names", () => {
  it("fragility, evidence and move requests are identical when only names and descriptions differ", () => {
    const renamed = zones.map((z) => ({ ...z, name: `${z.name} Renamed`, description: `${z.description} (new)` }));
    expect(JSON.stringify(buildZoneFragilityRequest(renamed, crossings).state)).toBe(JSON.stringify(buildZoneFragilityRequest(zones, crossings).state));
    const f = [finding("x", { scope: "web-viewer" })];
    const renamedEvidence = { ...evidence, zones: evidence.zones.map((z) => ({ ...z, name: `${z.name} Renamed`, description: "changed" })) };
    expect(JSON.stringify(buildFindingJudgeRequest(f, renamedEvidence).state)).toBe(JSON.stringify(buildFindingJudgeRequest(f, evidence).state));
    const moveCrossings: ZoneCrossing[] = Array.from({ length: 3 }, () => ({ from: "a.ts", to: "c.ts", fromZone: "web-viewer", toZone: "rex" }));
    expect(JSON.stringify(buildMoveJudgeRequest(renamed, moveCrossings).state)).toBe(JSON.stringify(buildMoveJudgeRequest(zones, moveCrossings).state));
  });
});
