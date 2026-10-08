/**
 * The readiness scorecard.
 *
 * Built on three repositories committed under `tests/fixtures/sdlc/` and
 * scored through the real analyzer, not on hand-written `SdlcProfile`
 * literals: the thing worth testing is the whole path from "these files
 * exist" to "this is the score", and a hand-built profile would only confirm
 * the arithmetic. Hand-built profiles appear only where a fixture cannot
 * express the input — a parse failure, an unnamed deploy environment.
 *
 * **The exact scores are the point.** Every fixture asserts its overall and all
 * nine dimension scores, so changing a weight, a criterion or a detector fails
 * here and has to be done deliberately. No test restates a weight as a literal —
 * they are read from `READINESS_WEIGHTS`, which is the single source of truth.
 *
 * @see src/analyzers/readiness-score.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { buildSdlcProfile } from "../../../src/analyzers/sdlc-profile.js";
import {
  computeReadinessScore,
  collectAgentSafety,
  DIMENSION_LABELS,
  READINESS_DIMENSIONS,
  READINESS_WEIGHTS,
  type ReadinessDimensionName,
  type ReadinessScore,
} from "../../../src/analyzers/readiness-score.js";
import type { SdlcCiPipeline, SdlcDeployment, SdlcProfile } from "../../../src/schema/v1.js";

// ── Fixtures on disk ────────────────────────────────────────────────────────

const FIXTURES = fileURLToPath(new URL("../../fixtures/sdlc/", import.meta.url));

/** A Node service with GitHub Actions deploying via Helm, Prisma migrations and LaunchDarkly. */
const NODE_REPO = join(FIXTURES, "node-helm-prisma-launchdarkly");
/** A Go service with GitLab CI and no tests. */
const GO_REPO = join(FIXTURES, "go-gitlab-no-tests");
/** Nothing at all — a `.gitkeep` so git keeps the directory, which no detector reads. */
const EMPTY_REPO = join(FIXTURES, "empty");

const roots: string[] = [];

/** A throwaway project for inputs no committed fixture should carry. */
function project(name: string, files: Record<string, string>): string {
  const root = join(tmpdir(), `sv-readiness-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Score a project end to end: walk it, detect, then judge. */
async function score(root: string): Promise<ReadinessScore> {
  return computeReadinessScore(await buildSdlcProfile(root));
}

function scoresOf(result: ReadinessScore): Record<ReadinessDimensionName, number> {
  const out = {} as Record<ReadinessDimensionName, number>;
  for (const name of READINESS_DIMENSIONS) out[name] = result.dimensions[name].score;
  return out;
}

/** The weighted sum, computed from the weights constant rather than restated. */
function weightedSum(result: ReadinessScore): number {
  let total = 0;
  for (const name of READINESS_DIMENSIONS) {
    total += result.dimensions[name].score * READINESS_WEIGHTS[name];
  }
  return total;
}

/** A profile that found nothing — every section present and empty. */
function emptyProfile(): SdlcProfile {
  return {
    schemaVersion: "1.0.0",
    commands: [],
    tests: { frameworks: [], suites: [] },
    ci: [],
    cd: [],
    rollback: [],
    migrations: [],
    featureFlags: [],
    qualityGates: [],
    observability: [],
    containers: [],
    iac: [],
    parseFailures: [],
  };
}

/** Scoring with no filesystem: agent safety is injected as "nothing found". */
const NO_AGENT_SAFETY = { agentSafety: { sources: [], findings: [] } };

// ── Fixture A: a Node service with the full pipeline ────────────────────────

describe("readiness score: Node repo with Actions, Helm, Prisma and LaunchDarkly", () => {
  it("scores every dimension exactly", async () => {
    const result = await score(NODE_REPO);

    expect(scoresOf(result)).toEqual({
      // A test command, vitest, unit tests and e2e tests; coverage is not configured.
      testing: 90,
      // A pipeline that tests, lints, and triggers on push and pull_request.
      ci: 100,
      // One automated deployment; the job does not name a second environment.
      cd: 80,
      // A Helm chart: `helm rollback` restores the previous release without a human.
      rollback: 100,
      // Prisma migrations, not known to be automated or reversible.
      migrations: 75,
      // LaunchDarkly is configured; no flag keys were readable.
      featureFlags: 70,
      // CODEOWNERS plus a blocking pre-commit hook: two kinds, one blocking.
      qualityGates: 100,
      // pino (logging) and Sentry (error reporting): two kinds, one of them reporting.
      observability: 100,
      // A hench config with the default guard left in force.
      agentSafety: 100,
    });

    expect(result.overall).toBe(91);
  });

  it("draws its evidence from the profile's own detections", async () => {
    const profile = await buildSdlcProfile(NODE_REPO);
    const result = computeReadinessScore(profile);

    // Every path cited by a dimension is a path the analyzer recorded, not one
    // the scorer went looking for.
    const detected = new Set<string>();
    for (const detection of [
      ...profile.commands,
      ...profile.tests.frameworks,
      ...profile.tests.suites,
      ...profile.ci,
      ...profile.cd,
      ...profile.rollback,
      ...profile.migrations,
      ...profile.featureFlags,
      ...profile.qualityGates,
      ...profile.observability,
      ...profile.containers,
      ...profile.iac,
    ]) {
      for (const e of detection.evidence) detected.add(e.path);
    }

    for (const name of READINESS_DIMENSIONS) {
      if (name === "agentSafety") continue; // sourced from repo-trust, asserted below
      for (const e of result.dimensions[name].evidence) {
        expect(detected, `${name} cited ${e.path}`).toContain(e.path);
      }
    }

    expect(result.dimensions.ci.evidence.map((e) => e.path)).toEqual([".github/workflows/ci.yml"]);
    expect(result.dimensions.migrations.evidence.map((e) => e.path)).toEqual([
      "prisma/migrations/0001_init/migration.sql",
    ]);
  });

  it("reads the agentSafety dimension from repo-trust", async () => {
    const result = computeReadinessScore(await buildSdlcProfile(NODE_REPO));

    // The same sources repo-trust reports, carried through as evidence.
    expect(collectAgentSafety(NODE_REPO).sources).toEqual([".hench/config.json"]);
    expect(result.dimensions.agentSafety.evidence).toEqual([
      { kind: "agent-config", path: ".hench/config.json", confidence: "certain" },
    ]);
    expect(result.dimensions.agentSafety.gaps).toEqual([]);
  });
});

// ── Fixture B: a Go service with GitLab CI and no tests ─────────────────────

describe("readiness score: Go repo with GitLab CI and no tests", () => {
  it("scores every dimension exactly", async () => {
    const result = await score(GO_REPO);

    expect(scoresOf(result)).toEqual({
      // `go test ./...` is offered by the toolchain; no framework, no test files.
      testing: 30,
      // A GitLab pipeline that only builds. GitLab runs every pipeline on push
      // unless told otherwise, so the trigger is credited; the tests are not.
      ci: 60,
      cd: 0,
      rollback: 0,
      migrations: 0,
      featureFlags: 0,
      qualityGates: 0,
      observability: 0,
      agentSafety: 0,
    });

    expect(result.overall).toBe(15);
  });

  it("says that the test command is not evidence of a test", async () => {
    const result = await score(GO_REPO);
    const summaries = result.dimensions.testing.gaps.map((g) => g.summary);

    expect(summaries).toContain("No unit tests were found.");
    expect(summaries).not.toContain("No test command is declared.");
  });

  it("does not call unit tests the only kind when there are none", async () => {
    const result = await score(GO_REPO);
    const summaries = result.dimensions.testing.gaps.map((g) => g.summary);

    // With no suite at all, "unit tests are the only kind found" would
    // contradict the gap beside it. The absence is stated as an absence.
    expect(summaries).toContain("No integration or end-to-end tests were found.");
    expect(summaries.join("\n")).not.toContain("Unit tests are the only kind found");
  });

  it("reports a CI pipeline rather than silence when it only builds", async () => {
    const result = await score(GO_REPO);

    expect(result.dimensions.ci.evidence.map((e) => e.path)).toEqual([".gitlab-ci.yml"]);
    expect(result.dimensions.ci.gaps.map((g) => g.summary)).toEqual([
      "No CI job runs the tests, so nothing stops a broken change merging.",
      "CI does not lint or type-check.",
    ]);
  });
});

// ── Fixture C: nothing at all ───────────────────────────────────────────────

describe("readiness score: empty repo", () => {
  it("scores zero across the board", async () => {
    const result = await score(EMPTY_REPO);

    expect(scoresOf(result)).toEqual({
      testing: 0,
      ci: 0,
      cd: 0,
      rollback: 0,
      migrations: 0,
      featureFlags: 0,
      qualityGates: 0,
      observability: 0,
      agentSafety: 0,
    });

    expect(result.overall).toBe(0);
  });

  it("gives every dimension exactly one gap explaining the absence", async () => {
    const result = await score(EMPTY_REPO);

    for (const name of READINESS_DIMENSIONS) {
      const dimension = result.dimensions[name];
      expect(dimension.evidence, `${name} evidence`).toEqual([]);
      expect(dimension.gaps, `${name} gaps`).toHaveLength(1);
    }
  });

  it("aims its suggestions at the heaviest of the equally weak dimensions", async () => {
    const result = await score(EMPTY_REPO);

    // Everything scores zero, so the weight tie-break decides: testing (the
    // heaviest), then the two at the next weight down in declaration order.
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toContain(DIMENSION_LABELS.testing);
    expect(result.suggestions[1]).toContain(DIMENSION_LABELS.ci);
    expect(result.suggestions[2]).toContain(DIMENSION_LABELS.cd);
  });
});

// ── Invariants that hold for every repository ───────────────────────────────

describe("readiness score invariants", () => {
  it("weights sum to 1.0", () => {
    const total = Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("covers nine dimensions, with the weights constant naming every one", () => {
    expect(READINESS_DIMENSIONS).toHaveLength(9);
    expect(Object.keys(DIMENSION_LABELS).sort()).toEqual([...READINESS_DIMENSIONS].sort());
  });

  it("reports each dimension's weight from the weights constant", async () => {
    const result = await score(NODE_REPO);
    for (const name of READINESS_DIMENSIONS) {
      expect(result.dimensions[name].weight, name).toBe(READINESS_WEIGHTS[name]);
    }
  });

  it("takes overall as the weighted sum of the dimension scores", async () => {
    for (const root of [NODE_REPO, GO_REPO, EMPTY_REPO]) {
      const result = await score(root);
      expect(result.overall).toBe(Math.round(weightedSum(result)));
    }
  });

  it("keeps every score within 0-100", async () => {
    for (const root of [NODE_REPO, GO_REPO, EMPTY_REPO]) {
      const result = await score(root);
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
      for (const name of READINESS_DIMENSIONS) {
        const { score: value } = result.dimensions[name];
        expect(value, name).toBeGreaterThanOrEqual(0);
        expect(value, name).toBeLessThanOrEqual(100);
      }
    }
  });

  it("gives every gap, on every fixture, the evidence that would raise the score", async () => {
    for (const root of [NODE_REPO, GO_REPO, EMPTY_REPO]) {
      const result = await score(root);
      for (const name of READINESS_DIMENSIONS) {
        for (const gap of result.dimensions[name].gaps) {
          expect(gap.summary.trim(), `${name} gap summary`).not.toBe("");
          expect(gap.wouldRaiseScore.trim(), `${name} gap remedy`).not.toBe("");
        }
      }
    }
  });

  it("scores a dimension zero whenever it has no evidence", async () => {
    for (const root of [NODE_REPO, GO_REPO, EMPTY_REPO]) {
      const result = await score(root);
      for (const name of READINESS_DIMENSIONS) {
        const dimension = result.dimensions[name];
        if (dimension.evidence.length === 0) {
          expect(dimension.score, `${name} scored without evidence`).toBe(0);
          expect(dimension.gaps.length, `${name} has no gap to explain the zero`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("scores a profile with no projectDir without reading the filesystem", async () => {
    const profile = await buildSdlcProfile(NODE_REPO);
    const { projectDir: _stripped, ...onDisk } = profile;

    // The written artifact has no `projectDir`, so there is no project to read
    // agent safety from. It scores zero with a gap rather than throwing.
    const result = computeReadinessScore(onDisk);
    expect(result.dimensions.agentSafety.score).toBe(0);
    expect(result.dimensions.agentSafety.gaps).toHaveLength(1);
  });
});

// ── A CI file that was found but could not be parsed ────────────────────────

/**
 * "No CI is configured" and "CI is configured and could not be read" are
 * opposite facts, and the analyzer records the second in `parseFailures`. The
 * score is the same zero — nothing was proven — but the gap must name the file
 * and tell the user to fix it, never to add the pipeline they already have.
 */
describe("readiness score: unparseable CI file", () => {
  const failure = {
    path: ".github/workflows/ci.yml",
    kind: "github-actions",
    reason: "YAML anchors are not supported",
  };

  it("scores CI zero but blames the file, not its absence", () => {
    const result = computeReadinessScore({ ...emptyProfile(), parseFailures: [failure] }, NO_AGENT_SAFETY);
    const ci = result.dimensions.ci;

    expect(ci.score).toBe(0);
    expect(ci.gaps).toHaveLength(1);
    expect(ci.gaps[0].summary).toContain("could not be parsed");
    expect(ci.gaps[0].summary).toContain(failure.path);
    expect(ci.gaps[0].summary).toContain(failure.reason);
    expect(ci.gaps[0].summary).not.toContain("No CI pipeline was detected");
    expect(ci.gaps[0].wouldRaiseScore).toContain("Fix the file");
  });

  it("says the same for CD, whose deploy jobs live in the unreadable pipeline", () => {
    const result = computeReadinessScore({ ...emptyProfile(), parseFailures: [failure] }, NO_AGENT_SAFETY);
    const cd = result.dimensions.cd;

    expect(cd.score).toBe(0);
    expect(cd.gaps[0].summary).toContain(failure.path);
    expect(cd.gaps[0].summary).not.toContain("No deployment path was detected");
  });

  it("names every unreadable CI file when there are several", () => {
    const second = { path: ".gitlab-ci.yml", kind: "gitlab-ci", reason: "tab indentation" };
    const result = computeReadinessScore(
      { ...emptyProfile(), parseFailures: [failure, second] },
      NO_AGENT_SAFETY,
    );

    expect(result.dimensions.ci.gaps[0].summary).toContain(failure.path);
    expect(result.dimensions.ci.gaps[0].summary).toContain(second.path);
  });

  it("leaves the no-CI gap alone when the failure is not a CI file", () => {
    const result = computeReadinessScore(
      { ...emptyProfile(), parseFailures: [{ path: "package.json", kind: "package.json", reason: "invalid JSON" }] },
      NO_AGENT_SAFETY,
    );

    expect(result.dimensions.ci.gaps[0].summary).toBe("No CI pipeline was detected.");
    expect(result.dimensions.cd.gaps[0].summary).toBe("No deployment path was detected.");
  });

  it("surfaces the parse failure in the suggestions, where the user will read it", () => {
    const result = computeReadinessScore({ ...emptyProfile(), parseFailures: [failure] }, NO_AGENT_SAFETY);
    // CI is the second-heaviest dimension; with everything at zero it is the
    // second suggestion, and its gap is the parse failure.
    expect(result.suggestions.some((s) => s.includes(failure.path))).toBe(true);
  });
});

// ── Deploy environments the analyzer could not name ─────────────────────────

describe("readiness score: deploy environments", () => {
  function deployment(environment: string): SdlcDeployment {
    return {
      evidence: [{ kind: "ci-step", path: ".github/workflows/ci.yml", confidence: "likely" }],
      environment,
      mechanism: "github-actions",
      automated: true,
    };
  }

  function cdScore(environments: string[]): number {
    const profile = { ...emptyProfile(), cd: environments.map(deployment) };
    return computeReadinessScore(profile, NO_AGENT_SAFETY).dimensions.cd.score;
  }

  it("does not count two unnamed deployments as two environments", () => {
    // Two jobs that both deploy somewhere unnamed prove one path, not a
    // rehearsal before production.
    expect(cdScore(["unknown", "unknown"])).toBe(cdScore(["unknown"]));
    expect(cdScore(["unknown", "unknown"])).toBeLessThan(100);
  });

  it("credits a second named environment", () => {
    expect(cdScore(["staging", "production"])).toBe(100);
    expect(cdScore(["production", "unknown"])).toBe(cdScore(["production"]));
  });
});

// ── Agent safety, driven through repo-trust ─────────────────────────────────

describe("agentSafety dimension", () => {
  it("subtracts for each way the checkout widens the baseline", async () => {
    const root = project("wide-guard", {
      "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest run" } }),
      ".hench/config.json": JSON.stringify({
        language: "typescript",
        permissionMode: "bypassPermissions",
        guard: {
          allowedCommands: ["curl"],
          blockedPaths: [],
          allowedGitSubcommands: [],
        },
      }),
    });

    const safety = collectAgentSafety(root);
    const warnings = safety.findings.filter((f) => f.severity === "warning").length;
    const infos = safety.findings.filter((f) => f.severity === "info").length;
    expect(warnings).toBeGreaterThan(0);

    const result = computeReadinessScore(await buildSdlcProfile(root));
    const dimension = result.dimensions.agentSafety;

    // Penalties are 25 per warning and 5 per info, floored at zero.
    expect(dimension.score).toBe(Math.max(0, 100 - warnings * 25 - infos * 5));
    expect(dimension.gaps).toHaveLength(safety.findings.length);
    expect(dimension.gaps.map((g) => g.summary)).toEqual(safety.findings.map((f) => f.message));
  });

  it("takes an injected input so scoring needs no filesystem", () => {
    const result = computeReadinessScore(emptyProfile(), {
      agentSafety: {
        sources: [".mcp.json"],
        findings: [
          {
            code: "mcp-servers",
            severity: "warning",
            message: "Declares an MCP server ndx did not write",
            values: ["evil: node evil.js"],
          },
        ],
      },
    });

    expect(result.dimensions.agentSafety.score).toBe(75);
    expect(result.dimensions.agentSafety.evidence).toEqual([
      { kind: "agent-config", path: ".mcp.json", confidence: "certain" },
    ]);
  });
});

// ── Manual triggers ─────────────────────────────────────────────────────────

describe("manual triggers", () => {
  function pipeline(triggers: string[]): SdlcCiPipeline {
    return {
      evidence: [{ kind: "workflow-file", path: ".github/workflows/deploy.yml", confidence: "certain" }],
      provider: "github-actions",
      name: "Deploy",
      triggers,
      jobs: [{ name: "deploy", steps: [{ kind: "deploy", run: "./deploy.sh production" }] }],
    };
  }

  function ciScore(triggers: string[]): number {
    return computeReadinessScore({ ...emptyProfile(), ci: [pipeline(triggers)] }, NO_AGENT_SAFETY)
      .dimensions.ci.score;
  }

  it("does not award the automatic-trigger points to a dispatch-only pipeline", () => {
    expect(ciScore(["workflow_dispatch"])).toBe(ciScore(["push"]) - 20);
  });

  it("awards them once an automatic trigger sits beside the manual one", () => {
    expect(ciScore(["workflow_dispatch", "push"])).toBe(ciScore(["push"]));
  });

  it("says the trigger is hand-started in the gap", () => {
    const result = computeReadinessScore({ ...emptyProfile(), ci: [pipeline(["workflow_dispatch"])] }, NO_AGENT_SAFETY);

    expect(result.dimensions.ci.gaps.map((g) => g.summary)).toContain(
      "No pipeline runs on its own; the only triggers found are started by hand.",
    );
  });
});
