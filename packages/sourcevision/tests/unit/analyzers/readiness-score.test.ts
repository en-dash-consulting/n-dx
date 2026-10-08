/**
 * The readiness scorecard.
 *
 * Built on three repositories on disk and scored through the real analyzer, not
 * on hand-written `SdlcProfile` literals: the thing worth testing is the whole
 * path from "these files exist" to "this is the score", and a hand-built
 * profile would only confirm the arithmetic.
 *
 * **The exact scores are the point.** Every fixture asserts its overall and all
 * nine dimension scores, so changing a weight or a criterion fails here and has
 * to be done deliberately. No test restates a weight as a literal — they are
 * read from `READINESS_WEIGHTS`, which is the single source of truth.
 *
 * @see src/analyzers/readiness-score.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const roots: string[] = [];

/** A project on disk, named so two tests never share a directory. */
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

// ── Fixture A: a Node service with the full pipeline ────────────────────────

const NODE_PACKAGE_JSON = JSON.stringify(
  {
    name: "shop-api",
    scripts: {
      test: "vitest run",
      lint: "eslint .",
      build: "tsc",
    },
    dependencies: {
      "launchdarkly-node-server-sdk": "^8.0.0",
      pino: "^9.0.0",
      "@sentry/node": "^8.0.0",
    },
    devDependencies: { vitest: "^4.0.0" },
  },
  null,
  2,
);

const NODE_WORKFLOW = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Test
        run: npm test
  release:
    needs: verify
    steps:
      - name: Deploy
        run: helm upgrade shop-api ./chart --install
`;

/**
 * A Node repository with GitHub Actions deploying via Helm, Prisma migrations
 * and LaunchDarkly — the shape the task names as the well-equipped case.
 *
 * It carries a `.hench/config.json` with no `guard`, which is what leaving
 * hench's defaults in force looks like: repo-trust reports nothing wider than
 * the baseline, so agent safety is clean.
 */
function nodeRepo(): string {
  return project("node-full", {
    "package.json": NODE_PACKAGE_JSON,
    ".github/workflows/ci.yml": NODE_WORKFLOW,
    "src/cart.ts": "export const cart = [];\n",
    "src/cart.test.ts": "import { expect, it } from 'vitest';\nit('works', () => expect(1).toBe(1));\n",
    "tests/e2e/checkout.e2e.test.ts": "it('checks out', () => {});\n",
    "prisma/schema.prisma": "generator client {\n  provider = \"prisma-client-js\"\n}\n",
    "prisma/migrations/0001_init/migration.sql": "CREATE TABLE cart (id INT);\n",
    Dockerfile: "FROM node:22-alpine\nWORKDIR /app\n",
    "chart/Chart.yaml": "apiVersion: v2\nname: shop-api\nversion: 0.1.0\n",
    CODEOWNERS: "* @platform-team\n",
    ".pre-commit-config.yaml": "repos: []\n",
    ".hench/config.json": JSON.stringify({ language: "typescript" }),
  });
}

describe("readiness score: Node repo with Actions, Helm, Prisma and LaunchDarkly", () => {
  it("scores every dimension exactly", async () => {
    const result = await score(nodeRepo());

    expect(scoresOf(result)).toEqual({
      // A test command, vitest, unit tests and e2e tests; coverage is not configured.
      testing: 90,
      // A pipeline that tests, lints, and triggers on push and pull_request.
      ci: 100,
      // One automated deployment, to a single environment.
      cd: 80,
      // The analyzer does not populate `rollback` yet.
      rollback: 0,
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

    expect(result.overall).toBe(81);
  });

  it("draws its evidence from the profile's own detections", async () => {
    const root = nodeRepo();
    const profile = await buildSdlcProfile(root);
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
      ...profile.migrations,
      ...profile.featureFlags,
      ...profile.qualityGates,
      ...profile.observability,
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
    const root = nodeRepo();
    const result = computeReadinessScore(await buildSdlcProfile(root));

    // The same sources repo-trust reports, carried through as evidence.
    expect(collectAgentSafety(root).sources).toEqual([".hench/config.json"]);
    expect(result.dimensions.agentSafety.evidence).toEqual([
      { kind: "agent-config", path: ".hench/config.json", confidence: "certain" },
    ]);
    expect(result.dimensions.agentSafety.gaps).toEqual([]);
  });
});

// ── Fixture B: a Go service with GitLab CI and no tests ─────────────────────

const GITLAB_CI = `
stages:
  - build
compile:
  stage: build
  script:
    - go build ./...
`;

/**
 * A Go repository with GitLab CI and no tests.
 *
 * The interesting case for the testing dimension: `go.mod` means the toolchain
 * offers `go test ./...`, so a test *command* exists while nothing proves a
 * single test does. The score credits the command and the gaps name the rest.
 */
function goRepo(): string {
  return project("go-no-tests", {
    "go.mod": "module example.com/svc\n\ngo 1.23\n",
    "main.go": "package main\n\nfunc main() {}\n",
    ".gitlab-ci.yml": GITLAB_CI,
  });
}

describe("readiness score: Go repo with GitLab CI and no tests", () => {
  it("scores every dimension exactly", async () => {
    const result = await score(goRepo());

    expect(scoresOf(result)).toEqual({
      // `go test ./...` is offered by the toolchain; no framework, no test files.
      testing: 30,
      // A GitLab pipeline that only builds, with no declared trigger.
      ci: 40,
      cd: 0,
      rollback: 0,
      migrations: 0,
      featureFlags: 0,
      qualityGates: 0,
      observability: 0,
      agentSafety: 0,
    });

    expect(result.overall).toBe(12);
  });

  it("says that the test command is not evidence of a test", async () => {
    const result = await score(goRepo());
    const summaries = result.dimensions.testing.gaps.map((g) => g.summary);

    expect(summaries).toContain("No unit tests were found.");
    expect(summaries).not.toContain("No test command is declared.");
  });

  it("reports a CI pipeline rather than silence when it only builds", async () => {
    const result = await score(goRepo());

    expect(result.dimensions.ci.evidence.map((e) => e.path)).toEqual([".gitlab-ci.yml"]);
    expect(result.dimensions.ci.gaps.map((g) => g.summary)).toEqual([
      "No CI job runs the tests, so nothing stops a broken change merging.",
      "No pipeline declares a trigger, so CI may only run when started by hand.",
      "CI does not lint or type-check.",
    ]);
  });
});

// ── Fixture C: nothing at all ───────────────────────────────────────────────

describe("readiness score: empty repo", () => {
  it("scores zero across the board", async () => {
    const result = await score(project("empty", {}));

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
    const result = await score(project("empty-gaps", {}));

    for (const name of READINESS_DIMENSIONS) {
      const dimension = result.dimensions[name];
      expect(dimension.evidence, `${name} evidence`).toEqual([]);
      expect(dimension.gaps, `${name} gaps`).toHaveLength(1);
    }
  });

  it("aims its suggestions at the heaviest of the equally weak dimensions", async () => {
    const result = await score(project("empty-suggest", {}));

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
    const result = await score(nodeRepo());
    for (const name of READINESS_DIMENSIONS) {
      expect(result.dimensions[name].weight, name).toBe(READINESS_WEIGHTS[name]);
    }
  });

  it("takes overall as the weighted sum of the dimension scores", async () => {
    for (const root of [nodeRepo(), goRepo(), project("empty-sum", {})]) {
      const result = await score(root);
      expect(result.overall).toBe(Math.round(weightedSum(result)));
    }
  });

  it("keeps every score within 0-100", async () => {
    for (const root of [nodeRepo(), goRepo(), project("empty-range", {})]) {
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
    for (const root of [nodeRepo(), goRepo(), project("empty-remedy", {})]) {
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
    for (const root of [nodeRepo(), goRepo(), project("empty-zero", {})]) {
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
    const profile = await buildSdlcProfile(nodeRepo());
    const { projectDir: _stripped, ...onDisk } = profile;

    // The written artifact has no `projectDir`, so there is no project to read
    // agent safety from. It scores zero with a gap rather than throwing.
    const result = computeReadinessScore(onDisk);
    expect(result.dimensions.agentSafety.score).toBe(0);
    expect(result.dimensions.agentSafety.gaps).toHaveLength(1);
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
    const empty = {
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

    const result = computeReadinessScore(empty, {
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
