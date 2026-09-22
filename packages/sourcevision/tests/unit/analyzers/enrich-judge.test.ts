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
  ZONE_FRAGILITY_MIN_PROBABILITY,
} from "../../../src/analyzers/enrich-judge.js";
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

  it("stops on a client error and keeps the remaining findings as stated", async () => {
    const input = [finding("a", { severity: "info" }), finding("b", { severity: "critical" })];
    mockedAskJev.mockRejectedValueOnce(new ClaudeClientError("rate limited", "rate-limit", true));

    const res = await judgeFindings(input);

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
      id: "web-viewer", name: "Web Viewer", description: "UI", fileCount: 2, files: ["a.ts", "b.ts"],
      cohesion: 0.3, coupling: 0.8, importsTo: { rex: 2 }, importedFrom: {},
    });
    expect((req.state as { zones: Record<string, { importedFrom: object }> }).zones.z1.importedFrom).toEqual({ "web-viewer": 2 });
  });
});
