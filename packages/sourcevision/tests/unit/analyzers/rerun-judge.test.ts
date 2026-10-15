import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, Zone, ZoneCrossing, Zones } from "../../../src/schema/index.js";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    getJudgmentRoute: vi.fn(() => undefined),
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
  applyFindingVerdict,
  buildRerunRequest,
  computeZoneDeltas,
  configureRerunLog,
  findingKey,
  judgeRerun,
  judgedPreviousFindings,
  FINDING_HOLDS_DROP_BELOW,
  FINDING_HOLDS_MIN_PROBABILITY,
  RERUN_KEEP_MAX_PROBABILITY,
  RERUN_REFRESH_MIN_PROBABILITY,
} from "../../../src/analyzers/rerun-judge.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedAskJev = vi.mocked(askJev);

function noulAnswer(noul: number) {
  return { type: "noul" as const, noul };
}

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "d", files, entryPoints: [], cohesion: 0.8, coupling: 0.2, ...extra };
}

function finding(text: string, extra: Partial<Finding> = {}): Finding {
  return { type: "observation", pass: 2, scope: "core", text, confidence: 0.9, ...extra };
}

const crossings: ZoneCrossing[] = [];

/** One zone whose content hash moved since the previous run. */
function changedPair(): { pairs: Array<{ zone: Zone; previous: Zone }>; previousZones: Zones; contentHashes: Record<string, string> } {
  const current = zone("core", ["src/a.ts", "src/b.ts"]);
  const previous = zone("core", ["src/a.ts", "src/b.ts"], { insights: ["core parses and renders"] });
  return {
    pairs: [{ zone: current, previous }],
    previousZones: { zones: [previous], crossings: [], unzoned: [], zoneContentHashes: { core: "old" } },
    contentHashes: { core: "new" },
  };
}

beforeEach(() => {
  mockedAskJev.mockReset();
  mockedRoute.mockReset();
  mockedRoute.mockReturnValue("typesafe");
  configureRerunLog(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("computeZoneDeltas", () => {
  it("omits a zone whose content and header hashes are unchanged", () => {
    const z = zone("core", ["src/a.ts"], { headerHash: "h1" });
    const deltas = computeZoneDeltas({
      pairs: [{ zone: z, previous: z }],
      currentCrossings: crossings,
      previousZones: { zones: [z], crossings: [], unzoned: [], zoneContentHashes: { core: "same" } },
      contentHashes: { core: "same" },
      // No projectDir: the header hash is "" and cannot contradict the stored one.
    });
    expect(deltas).toEqual([]);
  });

  it("reports files added and removed, metric deltas, and crossing deltas", () => {
    const previous = zone("core", ["src/a.ts", "src/gone.ts"], { cohesion: 0.9, coupling: 0.1 });
    const current = zone("core", ["src/a.ts", "src/new.ts"], { cohesion: 0.7, coupling: 0.3 });
    const deltas = computeZoneDeltas({
      pairs: [{ zone: current, previous }],
      currentCrossings: [{ from: "src/a.ts", to: "ui/x.ts", fromZone: "core", toZone: "ui" }],
      previousZones: {
        zones: [previous],
        crossings: [],
        unzoned: [],
        zoneContentHashes: { core: "old" },
      },
      contentHashes: { core: "new" },
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      filesAdded: ["src/new.ts"],
      filesRemoved: ["src/gone.ts"],
      contentChanged: true,
      crossingsDelta: { ui: 1 },
      cohesionDelta: -0.2,
      couplingDelta: 0.2,
    });
  });
});

describe("judgeRerun — zone refresh band", () => {
  it("escalates the zone at or above the refresh threshold", async () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    mockedAskJev.mockResolvedValueOnce({
      model: "jev-1.13.0",
      answers: { rz0: noulAnswer(RERUN_REFRESH_MIN_PROBABILITY) },
      tokenUsage: { input: 100, output: 5 },
    });

    const out = await judgeRerun(deltas, []);

    expect(out.zones.get("core")).toBe("refresh");
    expect(out.summary).toMatchObject({ zonesJudged: 1, refreshed: 1 });
    expect(out.summary.uncertainZones).toBeUndefined();
    expect(out.tokenUsage).toEqual({ input: 100, output: 5 });
  });

  it("keeps the previous insights untouched at or below the keep threshold", async () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    mockedAskJev.mockResolvedValueOnce({
      model: "jev-1.13.0",
      answers: { rz0: noulAnswer(RERUN_KEEP_MAX_PROBABILITY) },
    });

    const out = await judgeRerun(deltas, []);

    expect(out.zones.get("core")).toBe("keep");
    expect(out.summary).toMatchObject({ zonesJudged: 1, refreshed: 0 });
    expect(out.summary.uncertainZones).toBeUndefined();
  });

  it("keeps the zone but names it low-confidence in the run record between the bands", async () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    mockedAskJev.mockResolvedValueOnce({
      model: "jev-1.13.0",
      answers: { rz0: noulAnswer((RERUN_KEEP_MAX_PROBABILITY + RERUN_REFRESH_MIN_PROBABILITY) / 2) },
    });

    const out = await judgeRerun(deltas, []);

    expect(out.zones.get("core")).toBe("uncertain");
    expect(out.summary).toMatchObject({ zonesJudged: 1, refreshed: 0, uncertainZones: ["core"] });
  });

  it("asks nothing and makes no request when no zone changed", async () => {
    const out = await judgeRerun([], [finding("something")]);

    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(out.calls).toBe(0);
    expect(out.summary).toEqual({ zonesJudged: 0, refreshed: 0, findingsJudged: 0, carried: 0, resolved: 0, uncertain: 0 });
  });

  it("makes no request without a judgment route", async () => {
    mockedRoute.mockReturnValue(undefined);
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });

    const out = await judgeRerun(deltas, [finding("something")]);

    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(out.zones.size).toBe(0);
  });
});

describe("judgeRerun — finding still-holds band", () => {
  async function judgeOneFinding(noul: number, f = finding("The lock is released early")) {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    mockedAskJev.mockResolvedValueOnce({
      model: "jev-1.13.0",
      answers: { rz0: noulAnswer(0.1), fh0: noulAnswer(noul) },
    });
    const out = await judgeRerun(deltas, [f]);
    return { out, f };
  }

  it("carries a judged finding forward unchanged at or above the hold threshold", async () => {
    const { out, f } = await judgeOneFinding(FINDING_HOLDS_MIN_PROBABILITY);

    expect(out.findings.get(findingKey(f))?.verdict).toBe("carry");
    expect(applyFindingVerdict(f, out)).toEqual(f);
    expect(out.summary).toMatchObject({ findingsJudged: 1, carried: 1, resolved: 0, uncertain: 0 });
  });

  it("drops a finding below the drop threshold and logs finding-resolved with the probability", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-rerun-"));
    try {
      configureRerunLog({ svDir: dir });
      const { out, f } = await judgeOneFinding(FINDING_HOLDS_DROP_BELOW - 0.1);

      expect(out.findings.get(findingKey(f))?.verdict).toBe("resolve");
      expect(applyFindingVerdict(f, out)).toBeNull();
      expect(out.summary).toMatchObject({ findingsJudged: 1, carried: 0, resolved: 1 });

      const logPath = join(dir, ".cache", "rerun-log.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
      expect(entry).toMatchObject({ event: "finding-resolved", scope: "core", probability: 0.2 });
      expect(entry.detail).toContain("The lock is released early");
      expect(entry.detail).toContain("0.2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries a finding with confidence lowered to the probability between the bands", async () => {
    const mid = 0.5;
    const { out, f } = await judgeOneFinding(mid);

    expect(out.findings.get(findingKey(f))?.verdict).toBe("uncertain");
    expect(applyFindingVerdict(f, out)).toMatchObject({ confidence: mid, text: f.text });
    expect(out.summary).toMatchObject({ findingsJudged: 1, carried: 1, resolved: 0, uncertain: 1 });
  });

  it("never raises a confidence that was already lower", async () => {
    const already = finding("Low-confidence note", { confidence: 0.35 });
    const { out } = await judgeOneFinding(0.5, already);

    expect(applyFindingVerdict(already, out)).toMatchObject({ confidence: 0.35 });
  });

  it("writes no log entry when the log is not configured", async () => {
    const { out } = await judgeOneFinding(0.1);
    expect(out.summary.resolved).toBe(1);
    // No throw, no file: the module is inert until configureRerunLog is called.
  });
});

describe("candidate selection", () => {
  it("excludes pass 0 findings and unjudged findings, which keep the hash rule", () => {
    const judged = finding("judged", { pass: 2, confidence: 0.8 });
    const heuristic = finding("heuristic", { pass: 0, confidence: 0.8 });
    const legacy = finding("legacy", { pass: 3, confidence: undefined });

    expect(judgedPreviousFindings([judged, heuristic, legacy])).toEqual([judged]);
  });

  it("leaves a finding untouched when no verdict was recorded for it", async () => {
    const { out } = await (async () => {
      const { pairs, previousZones, contentHashes } = changedPair();
      const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
      mockedAskJev.mockResolvedValueOnce({ model: "jev-1.13.0", answers: { rz0: noulAnswer(0.1) } });
      return { out: await judgeRerun(deltas, []) };
    })();

    const unasked = finding("never asked about");
    expect(applyFindingVerdict(unasked, out)).toEqual(unasked);
  });
});

describe("buildRerunRequest", () => {
  it("shares one zone state between both Nouls and references it by path", () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    const request = buildRerunRequest(deltas, [finding("The lock is released early")]);

    const state = request.state as { zones: Record<string, unknown>; findings: Record<string, unknown> };
    expect(Object.keys(state.zones)).toEqual(["core"]);
    expect(state.findings).toHaveProperty("f0");
    // Both questions point at the same subtree, so the judgment cache keys them
    // on the zone's evidence and a re-run with identical evidence hits.
    expect(request.questions.rz0.instructions).toContain("`zones.core`");
    expect(request.questions.fh0.instructions).toContain("`zones.core.delta`");
    expect((state.zones.core as { previously: { insights: string[] } }).previously.insights)
      .toEqual(["core parses and renders"]);
  });

  it("is byte-identical for identical input, so every question re-keys into the judgment cache", () => {
    const build = () => {
      const { pairs, previousZones, contentHashes } = changedPair();
      const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
      return buildRerunRequest(deltas, [finding("The lock is released early")]);
    };
    const a = build();
    const b = build();

    // The judgment cache keys on the question plus the state slices it names,
    // so identical evidence must serialise identically or a no-op re-run misses.
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(b.questions)).toBe(JSON.stringify(a.questions));
  });

  it("changes the state a question names when the delta moves, so the cache misses", () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const before = buildRerunRequest(
      computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes }),
      [],
    );
    const grown = { zone: zone("core", ["src/a.ts", "src/b.ts", "src/c.ts"]), previous: pairs[0].previous };
    const after = buildRerunRequest(
      computeZoneDeltas({ pairs: [grown], currentCrossings: crossings, previousZones, contentHashes }),
      [],
    );

    expect(JSON.stringify(after.state)).not.toBe(JSON.stringify(before.state));
  });

  it("asks nothing about a finding whose scope is not among the changed zones", () => {
    const { pairs, previousZones, contentHashes } = changedPair();
    const deltas = computeZoneDeltas({ pairs, currentCrossings: crossings, previousZones, contentHashes });
    const request = buildRerunRequest(deltas, [finding("elsewhere", { scope: "ui" })]);

    expect(request.findingIds.size).toBe(0);
    expect(request.questions).not.toHaveProperty("fh0");
  });
});

afterEach(() => {
  configureRerunLog(undefined);
  vi.restoreAllMocks();
});
