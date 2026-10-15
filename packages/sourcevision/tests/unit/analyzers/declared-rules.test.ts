/**
 * Declared-rule checks: the rules a project writes about itself, checked
 * against its own import graph.
 *
 * Three things hold here. The extraction is paid once per edit of the
 * documents, not once per run — so a second call on an unchanged repository
 * must reach the cache and make no request. A confirmed violation must quote
 * the line it breaks, because a reader has to be able to argue with the rule.
 * And a repository that declares nothing must cost nothing: no extraction
 * call, no judgment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Zone, ZoneCrossing } from "../../../src/schema/index.js";

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

import { getJudgmentRoute, callClaude } from "../../../src/analyzers/claude-client.js";
import { askJev } from "@n-dx/llm-client";
import {
  checkDeclaredRules,
  configureRuleCache,
  edgeClasses,
  extractDeclaredRules,
  findRuleDocs,
  judgeRuleViolations,
  parseDeclaredRules,
  ruleDocHash,
  RULE_VIOLATION_MIN_PROBABILITY,
} from "../../../src/analyzers/declared-rules.js";
import type { DeclaredRule } from "../../../src/analyzers/declared-rules.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedAskJev = vi.mocked(askJev);
const mockedCallClaude = vi.mocked(callClaude);

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}
function crossing(from: string, to: string, fromZone: string, toZone: string): ZoneCrossing {
  return { from, to, fromZone, toZone };
}
function noulAnswer(noul: number) {
  return { type: "noul" as const, noul };
}

const RULE: DeclaredRule = {
  rule: "Orchestration scripts spawn CLIs; they never import from packages.",
  source: "CLAUDE.md",
  quote: "Orchestration scripts spawn CLIs via execFile — they never import from packages.",
};

const EXTRACTION_RESPONSE = JSON.stringify([RULE]);

let projectDir: string;
let svDir: string;

/** A project with a CLAUDE.md stating one rule. */
function withDocs(): void {
  writeFileSync(
    join(projectDir, "CLAUDE.md"),
    "# n-dx\n\nOrchestration scripts spawn CLIs via execFile — they never import from packages.\n",
  );
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-rules-"));
  svDir = join(projectDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  mockedAskJev.mockReset();
  mockedCallClaude.mockReset();
  mockedRoute.mockReset();
  mockedRoute.mockReturnValue("typesafe");
  configureRuleCache({ svDir });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  configureRuleCache(undefined);
  rmSync(projectDir, { recursive: true, force: true });
});

// ── Documents ────────────────────────────────────────────────────────────────

describe("findRuleDocs", () => {
  it("finds only the documents the project has, and hashes their contents", () => {
    expect(findRuleDocs(projectDir)).toEqual([]);
    withDocs();
    const docs = findRuleDocs(projectDir);
    expect(docs.map((d) => d.path)).toEqual(["CLAUDE.md"]);

    const before = ruleDocHash(docs);
    writeFileSync(join(projectDir, "CLAUDE.md"), "# n-dx\n\nA different rule entirely.\n");
    expect(ruleDocHash(findRuleDocs(projectDir))).not.toBe(before);
  });

  it("reads the hints file from the configured analysis directory, labelled by its real path", () => {
    writeFileSync(join(svDir, "hints.md"), "The viewer never imports the server.\n");
    expect(findRuleDocs(projectDir).map((d) => d.path)).toEqual([".sourcevision/hints.md"]);
    // Unconfigured, the module holds no opinion about where the layout put it.
    configureRuleCache(undefined);
    expect(findRuleDocs(projectDir)).toEqual([]);
  });
});

describe("parseDeclaredRules", () => {
  it("keeps only complete rules whose source is one of the documents read", () => {
    const docs = [{ path: "CLAUDE.md", text: "x" }];
    const parsed = parseDeclaredRules(
      JSON.stringify([
        RULE,
        { rule: "No quote", source: "CLAUDE.md" },
        { rule: "Invented source", source: "INVENTED.md", quote: "q" },
        "not an object",
      ]),
      docs,
    );
    expect(parsed).toEqual([RULE]);
  });

  it("returns nothing for output that is not an array", () => {
    expect(parseDeclaredRules("sorry, I cannot help with that", [{ path: "CLAUDE.md", text: "x" }])).toEqual([]);
  });
});

// ── Extraction and its cache ─────────────────────────────────────────────────

describe("extractDeclaredRules", () => {
  it("makes no request on a repository that declares nothing", async () => {
    const result = await extractDeclaredRules(projectDir);
    expect(mockedCallClaude).not.toHaveBeenCalled();
    expect(result).toEqual({ rules: [], calls: 0, cached: false });
  });

  it("extracts once and serves the second run from the cache, keyed by doc hash", async () => {
    withDocs();
    mockedCallClaude.mockResolvedValue({ text: EXTRACTION_RESPONSE, tokenUsage: { input: 10, output: 5 } } as never);

    const first = await extractDeclaredRules(projectDir);
    expect(first.rules).toEqual([RULE]);
    expect(first.calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(existsSync(join(svDir, ".cache", "rules.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(svDir, ".cache", "rules.json"), "utf-8")).rules).toEqual([RULE]);

    const second = await extractDeclaredRules(projectDir);
    expect(second).toEqual({ rules: [RULE], calls: 0, cached: true });
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it("re-extracts when the document changes, because the hash moved", async () => {
    withDocs();
    mockedCallClaude.mockResolvedValue({ text: EXTRACTION_RESPONSE } as never);
    await extractDeclaredRules(projectDir);

    writeFileSync(join(projectDir, "CLAUDE.md"), "# n-dx\n\nDomain packages never import each other.\n");
    await extractDeclaredRules(projectDir);
    expect(mockedCallClaude).toHaveBeenCalledTimes(2);
  });

  it("writes no cache file until configured", async () => {
    configureRuleCache(undefined);
    withDocs();
    mockedCallClaude.mockResolvedValue({ text: EXTRACTION_RESPONSE } as never);
    await extractDeclaredRules(projectDir);
    expect(existsSync(join(svDir, ".cache", "rules.json"))).toBe(false);
  });
});

// ── Checking ─────────────────────────────────────────────────────────────────

const zones = [zone("core", ["core/cli.js"]), zone("rex", ["packages/rex/src/a.ts"])];
const crossings = [
  crossing("core/cli.js", "packages/rex/src/a.ts", "core", "rex"),
  crossing("core/cli.js", "packages/rex/src/b.ts", "core", "rex"),
];

describe("edgeClasses", () => {
  it("groups crossings by zone pair, busiest first, and drops intra-zone edges", () => {
    const classes = edgeClasses([
      ...crossings,
      crossing("core/a.js", "core/b.js", "core", "core"),
      crossing("packages/rex/src/a.ts", "core/cli.js", "rex", "core"),
    ]);
    expect(classes.map((c) => [c.fromZone, c.toZone, c.crossings.length])).toEqual([
      ["core", "rex", 2],
      ["rex", "core", 1],
    ]);
  });
});

describe("judgeRuleViolations", () => {
  it("turns a confirmed crossing into an anti-pattern citing the rule's source and quote", async () => {
    mockedAskJev.mockResolvedValue({
      answers: { "v0-0": noulAnswer(RULE_VIOLATION_MIN_PROBABILITY) },
      tokenUsage: { input: 3, output: 2 },
    } as never);

    const result = await judgeRuleViolations([RULE], zones, crossings, 1);
    expect(result.findings).toHaveLength(1);
    const [f] = result.findings;
    expect(f.type).toBe("anti-pattern");
    expect(f.severity).toBe("warning");
    expect(f.scope).toBe("core");
    expect(f.related).toEqual(["rex"]);
    expect(f.text).toContain(RULE.rule);
    expect(f.text).toContain(`CLAUDE.md: "${RULE.quote}"`);
    expect(f.anchors).toEqual([{ file: "core/cli.js" }]);

    // The rule and the edges it is judged against are both in the state.
    const [request] = mockedAskJev.mock.calls[0];
    const state = request.state as { rules: Record<string, DeclaredRule>; edges: Record<string, { examples: string[] }> };
    expect(state.rules.r0).toEqual({ rule: RULE.rule, source: RULE.source, quote: RULE.quote });
    expect(state.edges.e0.examples).toEqual([
      "core/cli.js → packages/rex/src/a.ts",
      "core/cli.js → packages/rex/src/b.ts",
    ]);
  });

  it("reports nothing when the crossing is judged not to violate the rule", async () => {
    mockedAskJev.mockResolvedValue({ answers: { "v0-0": noulAnswer(0.4) } } as never);
    const result = await judgeRuleViolations([RULE], zones, crossings, 1);
    expect(result.findings).toEqual([]);
    expect(result.asked).toBe(1);
  });

  it("makes no request without a judgment route or without rules", async () => {
    mockedRoute.mockReturnValue(undefined);
    expect((await judgeRuleViolations([RULE], zones, crossings, 1)).calls).toBe(0);
    mockedRoute.mockReturnValue("typesafe");
    expect((await judgeRuleViolations([], zones, crossings, 1)).calls).toBe(0);
    expect(mockedAskJev).not.toHaveBeenCalled();
  });
});

describe("checkDeclaredRules", () => {
  it("asks nothing at all on a repository with no rule documents", async () => {
    const result = await checkDeclaredRules(projectDir, zones, crossings, 1);
    expect(mockedCallClaude).not.toHaveBeenCalled();
    expect(mockedAskJev).not.toHaveBeenCalled();
    expect(result).toEqual({ findings: [], calls: 0, tokenUsage: undefined, asked: 0, rules: [] });
  });

  it("extracts then checks, summing the token usage of both", async () => {
    withDocs();
    mockedCallClaude.mockResolvedValue({ text: EXTRACTION_RESPONSE, tokenUsage: { input: 10, output: 5 } } as never);
    mockedAskJev.mockResolvedValue({
      answers: { "v0-0": noulAnswer(0.95) },
      tokenUsage: { input: 3, output: 2 },
    } as never);

    const result = await checkDeclaredRules(projectDir, zones, crossings, 1);
    expect(result.rules).toEqual([RULE]);
    expect(result.findings).toHaveLength(1);
    expect(result.calls).toBe(2);
    expect(result.tokenUsage).toEqual({ input: 13, output: 7 });
  });
});
