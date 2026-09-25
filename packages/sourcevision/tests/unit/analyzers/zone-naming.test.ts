import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Zone, ZoneCrossing } from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    getJudgmentRoute: vi.fn(() => undefined),
    callClaude: vi.fn(),
    ClaudeClientError: actual.ClaudeClientError,
  };
});
vi.mock("../../../src/analyzers/jev-client.js", async () => {
  const actual = await import("../../../src/analyzers/jev-client.js");
  return { ...actual, askJev: vi.fn() };
});

import { getJudgmentRoute, callClaude } from "../../../src/analyzers/claude-client.js";
import { askJev } from "../../../src/analyzers/jev-client.js";
import {
  buildNameCandidates,
  describeZoneFromFacts,
  candidatePairs,
  buildZoneNamingRequest,
  nameZonesBySelection,
  NAMING_MIN_CONFIDENCE,
  MERGE_MIN_PROBABILITY,
  GENERATED_NAME_MIN_PROBABILITY,
} from "../../../src/analyzers/zone-naming.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedAskJev = vi.mocked(askJev);
const mockedCallClaude = vi.mocked(callClaude);

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}

let projectDir: string;
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-naming-"));
  mkdirSync(join(projectDir, "packages/rex"), { recursive: true });
  writeFileSync(join(projectDir, "packages/rex/package.json"), JSON.stringify({ name: "@n-dx/rex" }));
});
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

beforeEach(() => {
  mockedAskJev.mockReset();
  mockedCallClaude.mockReset();
  mockedRoute.mockReset();
  mockedRoute.mockReturnValue("typesafe");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const rexZone = zone("rex-cli", ["packages/rex/src/cli/index.ts", "packages/rex/src/cli/commands/add.ts", "packages/rex/src/cli/commands/status.ts"]);
const archetypes = new Map<string, string | null>([
  ["packages/rex/src/cli/index.ts", "entrypoint"],
  ["packages/rex/src/cli/commands/add.ts", "cli-command"],
  ["packages/rex/src/cli/commands/status.ts", "cli-command"],
]);

describe("buildNameCandidates", () => {
  it("offers package, directory, two-level directory and archetype candidates, deduplicated", () => {
    const c = buildNameCandidates(rexZone, { projectDir, fileArchetypes: archetypes, crossings: [] });
    expect(c.map((x) => [x.source, x.name])).toEqual([
      ["package", "Rex"],
      ["directories", "Rex Cli"],
      ["archetype", "Rex CLI Commands"],
    ]);
    // "Rex" from the directory is the same label as the package's — kept once.
    expect(c.filter((x) => x.name === "Rex")).toHaveLength(1);
  });

  it("skips the package candidate when most files are outside that package", () => {
    const mixed = zone("x", ["packages/rex/a.ts", "packages/hench/b.ts", "packages/hench/c.ts"]);
    expect(buildNameCandidates(mixed, { projectDir, crossings: [] }).map((x) => x.source)).not.toContain("package");
  });
});

describe("describeZoneFromFacts", () => {
  it("states size, dominant archetypes, entry points and import partners", () => {
    const web = zone("web", ["w/a.ts"], { name: "Web" });
    const z = { ...rexZone, entryPoints: ["packages/rex/src/cli/index.ts"] };
    const crossings: ZoneCrossing[] = [
      { from: "packages/rex/src/cli/index.ts", to: "w/a.ts", fromZone: "rex-cli", toZone: "web" },
    ];
    const byId = new Map([[web.id, web], [z.id, z]]);
    expect(describeZoneFromFacts(z, { fileArchetypes: archetypes, crossings }, byId)).toBe(
      "3 files, mostly cli commands and entry points; entry points index.ts; imports Web.",
    );
  });
});

describe("candidatePairs", () => {
  it("pairs zones with dense crossings or a shared two-level directory", () => {
    const a = zone("a", ["core/web/x.ts", "core/web/y.ts"]);
    const b = zone("b", ["core/web/z.ts", "core/web/w.ts"]);
    const c = zone("c", ["other/q.ts"]);
    const d = zone("d", ["far/r.ts"]);
    const crossings: ZoneCrossing[] = Array.from({ length: 3 }, () => ({ from: "other/q.ts", to: "far/r.ts", fromZone: "c", toZone: "d" }));
    const pairs = candidatePairs([a, b, c, d], crossings).map(([x, y]) => `${x.id}+${y.id}`);
    expect(pairs).toEqual(["a+b", "c+d"]);
  });
});

describe("buildZoneNamingRequest", () => {
  it("asks one Choice per zone with candidates plus none, and one Noul per pair", () => {
    const a = zone("a", ["core/web/x.ts", "core/web/y.ts"]);
    const b = zone("b", ["core/web/z.ts"]);
    const req = buildZoneNamingRequest([a, b], { crossings: [] }, [[a, b]]);
    expect(Object.keys(req.questions)).toEqual(["name-z0", "name-z1", "pair-0"]);
    expect(Object.keys((req.questions["name-z0"] as { criteria: object }).criteria)).toEqual(["n0", "n1", "none"]);
    expect(req.questions["pair-0"].instructions).toContain("`zones.z0`");
    expect(req.naming.get("name-z0")?.candidates.map((c) => c.name)).toEqual(["Core", "Core Web"]);
  });
});

describe("nameZonesBySelection", () => {
  const a = zone("core", ["core/web/x.ts", "core/web/y.ts"]);
  const b = zone("core-2", ["core/web/z.ts"]);
  const c = zone("other", ["other/q.ts"]);

  it("applies a confident selection, merges a confident pair, and reports an undecided pair", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        "name-z0": { type: "choice", choice: "n1", probabilities: { n1: 0.9 }, confidence: 0.9 },
        "name-z1": { type: "choice", choice: "n0", probabilities: { n0: 0.8 }, confidence: 0.8 },
        "name-z2": { type: "choice", choice: "n0", probabilities: { n0: 0.7 }, confidence: 0.7 },
        "pair-0": { type: "noul", noul: MERGE_MIN_PROBABILITY },
      },
      tokenUsage: { input: 100, output: 4 },
    });

    const res = await nameZonesBySelection([a, b, c], { crossings: [] });

    expect(mockedAskJev).toHaveBeenCalledTimes(1);
    expect(res.merged).toBe(1);
    expect(res.zones).toHaveLength(2);
    const merged = res.zones.find((z) => z.files.length === 3)!;
    expect(merged.id).toBe("core");
    expect(merged.name).toBe("Core Web");
    expect(res.zones.find((z) => z.id === "other")!.name).toBe("Other");
    expect(res.findings).toEqual([]);
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it("surfaces an undecided pair as a low-confidence observation without merging", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        "name-z0": { type: "choice", choice: "n0", probabilities: {}, confidence: 0.9 },
        "name-z1": { type: "choice", choice: "n0", probabilities: {}, confidence: 0.9 },
        "pair-0": { type: "noul", noul: 0.5 },
      },
    });
    const res = await nameZonesBySelection([a, b], { crossings: [] });
    expect(res.zones).toHaveLength(2);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({ category: "structural", severity: "info", confidence: 0.5, scope: "core", related: ["core-2"] });
  });

  it("escalates none or low-confidence choices to one generated-names call and one verification request", async () => {
    mockedAskJev
      .mockResolvedValueOnce({
        model: "jev",
        answers: {
          "name-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
          "name-z1": { type: "choice", choice: "n0", probabilities: {}, confidence: NAMING_MIN_CONFIDENCE - 0.01 },
        },
      })
      // one verification request for both zones: core picks g1 (fits), other picks g0 (does not fit)
      .mockResolvedValueOnce({
        model: "jev",
        answers: {
          "pick-z0": { type: "choice", choice: "g1", probabilities: {}, confidence: 0.8 },
          "fits-z0-0": { type: "noul", noul: 0.2 }, "fits-z0-1": { type: "noul", noul: GENERATED_NAME_MIN_PROBABILITY }, "fits-z0-2": { type: "noul", noul: 0.1 },
          "pick-z1": { type: "choice", choice: "g0", probabilities: {}, confidence: 0.8 },
          "fits-z1-0": { type: "noul", noul: GENERATED_NAME_MIN_PROBABILITY - 0.01 }, "fits-z1-1": { type: "noul", noul: 0.1 }, "fits-z1-2": { type: "noul", noul: 0.1 },
        },
      });
    mockedCallClaude.mockResolvedValue({ text: JSON.stringify({ core: ["Alpha Module", "Beta Module", "Gamma Module"], other: ["One", "Two", "Three"] }) });

    const res = await nameZonesBySelection([a, c], { crossings: [] });

    expect(res.escalated).toBe(2);
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    expect(mockedCallClaude.mock.calls[0][0]).toContain('Zone "core"');
    expect(mockedCallClaude.mock.calls[0][0]).toContain('Zone "other"');
    expect(mockedAskJev).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedAskJev.mock.calls[1][0].questions)).toEqual(["pick-z0", "fits-z0-0", "fits-z0-1", "fits-z0-2", "pick-z1", "fits-z1-0", "fits-z1-1", "fits-z1-2"]);
    expect(res.zones.find((z) => z.id === "core")!.name).toBe("Beta Module");
    expect(res.zones.find((z) => z.id === "other")!.name).toBe("other");
    expect(res.calls).toBe(2);
  });

  it("keeps algorithmic names when the generative fallback fails", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { "name-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 } },
    });
    mockedCallClaude.mockRejectedValueOnce(new ClaudeClientError("down", "unknown", true));
    const res = await nameZonesBySelection([a], { crossings: [] });
    expect(res.zones[0].name).toBe("core");
    expect(mockedAskJev).toHaveBeenCalledTimes(1);
  });

  it("is inert without a route", async () => {
    mockedRoute.mockReturnValue(undefined);
    const input = [a, b];
    const res = await nameZonesBySelection(input, { crossings: [] });
    expect(res.zones).toBe(input);
    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(res.calls).toBe(0);
  });
});

describe("nameZonesBySelection — fallback skipping and progress", () => {
  const a = zone("core", ["core/web/x.ts", "core/web/y.ts"]);
  const c = zone("other", ["other/q.ts"]);

  it("skips the generated-name fallback for zones in skipGeneratedNames and says so", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        "name-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
        "name-z1": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
      },
    });
    mockedCallClaude.mockResolvedValue({ text: JSON.stringify({ other: ["Alpha", "Beta", "Gamma"] }) });
    mockedAskJev.mockResolvedValueOnce({ model: "jev", answers: { "pick-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 } } });

    const res = await nameZonesBySelection([a, c], { crossings: [], skipGeneratedNames: new Set(["core"]) });

    expect(res.skippedFallback).toBe(1);
    expect(res.escalated).toBe(1);
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    expect(mockedCallClaude.mock.calls[0][0]).not.toContain('Zone "core"');
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("asking Jev about 2 zone(s)"))).toBe(true);
    expect(lines.some((l) => l.includes("generating names for 1 zone(s) in one call (other)"))).toBe(true);
    expect(lines.some((l) => l.includes("1 zone(s) keep their algorithmic name"))).toBe(true);
  });

  it("proposes names for every escalated zone in one call and applies each verified name", async () => {
    const many = Array.from({ length: 5 }, (_, i) => zone(`z${i}`, [`z${i}/a.ts`]));
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: Object.fromEntries(many.map((_, i) => [`name-z${i}`, { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 }])),
    });
    mockedCallClaude.mockResolvedValue({ text: JSON.stringify(Object.fromEntries(many.map((z) => [z.id, [`Name ${z.id}`, "B", "C"]]))) });
    mockedAskJev.mockImplementation(async (req) => ({
      model: "jev",
      answers: Object.fromEntries(Object.keys(req.questions).map((q) =>
        q.startsWith("pick-")
          ? [q, { type: "choice", choice: "g0", probabilities: {}, confidence: 0.9 }]
          : [q, { type: "noul", noul: q.endsWith("-0") ? 0.9 : 0.1 }])),
    }));

    const res = await nameZonesBySelection(many, { crossings: [] });

    expect(res.escalated).toBe(5);
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    expect(res.calls).toBe(2);
    expect(res.zones.map((z) => z.name)).toEqual(["Name z0", "Name z1", "Name z2", "Name z3", "Name z4"]);
  });

  it("keeps the algorithmic name for a zone the proposal answer omits", async () => {
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        "name-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
        "name-z1": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
      },
    });
    mockedCallClaude.mockResolvedValue({ text: JSON.stringify({ other: ["Only", "Two", "Three"] }) });
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: { "pick-z0": { type: "choice", choice: "g0", probabilities: {}, confidence: 0.9 }, "fits-z0-0": { type: "noul", noul: 0.9 }, "fits-z0-1": { type: "noul", noul: 0.1 }, "fits-z0-2": { type: "noul", noul: 0.1 } },
    });

    const res = await nameZonesBySelection([a, c], { crossings: [] });

    expect(res.zones.find((z) => z.id === "core")!.name).toBe("core");
    expect(res.zones.find((z) => z.id === "other")!.name).toBe("Only");
  });
});

describe("nameZonesBySelection — deferred generated names", () => {
  it("reports fallback zones and makes no text-model call when deferGeneratedNames is set", async () => {
    const a = zone("core", ["core/web/x.ts"]);
    const c = zone("other", ["other/q.ts"]);
    mockedAskJev.mockResolvedValueOnce({
      model: "jev",
      answers: {
        "name-z0": { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
        "name-z1": { type: "choice", choice: "n0", probabilities: {}, confidence: 0.9 },
      },
    });
    const res = await nameZonesBySelection([a, c], { crossings: [], deferGeneratedNames: true });
    expect(res.fallbackZoneIds).toEqual(["core"]);
    expect(res.escalated).toBe(0);
    expect(mockedCallClaude).not.toHaveBeenCalled();
    expect(res.zones.find((z) => z.id === "core")!.name).toBe("core");
    expect(res.zones.find((z) => z.id === "other")!.name).toBe("Other");
  });
});
