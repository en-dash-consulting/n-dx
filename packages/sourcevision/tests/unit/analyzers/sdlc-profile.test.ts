/**
 * The SDLC profile analyzer.
 *
 * Built on real directories in a temp folder rather than mocked `fs`: the
 * thing under test is a traversal with bounds, and a mocked filesystem would
 * only confirm the walk calls the functions the walk calls.
 *
 * The load-bearing test in here is the parse-failure one. "No CI is
 * configured" and "CI is configured and could not be parsed" are opposite
 * facts about a repository, and an empty `ci` array asserts the first.
 *
 * @see src/analyzers/sdlc-profile.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";

import {
  buildSdlcProfile,
  classifyCommand,
  stripSdlcProfileForDisk,
  walkProject,
  WALK_BOUNDS,
} from "../../../src/analyzers/sdlc-profile.js";
import { loadIgnoreFilter } from "../../../src/analyzers/inventory.js";
import { SdlcProfileSchema, validate } from "../../../src/schema/validate.js";

const roots: string[] = [];

/** A project on disk, named so two tests never share a directory. */
function project(name: string, files: Record<string, string>): string {
  const root = join(tmpdir(), `sv-sdlc-${name}`);
  rmSync(root, { recursive: true, force: true });
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

const ACTIONS = `
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
        run: pnpm install
      - name: Test
        run: pnpm test
  release:
    needs: verify
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy
        run: ./deploy.sh production
`;

// ── The walk and its bounds ─────────────────────────────────────────────────

describe("walkProject bounds", () => {
  it("skips node_modules and vendored directories", async () => {
    const root = project("skip", {
      "src/a.ts": "export const a = 1;\n",
      "node_modules/pkg/package.json": "{}",
      "vendor/dep/Makefile": "test:\n\techo hi\n",
      "third_party/x/Dockerfile": "FROM node\n",
    });
    const walk = walkProject(root, await loadIgnoreFilter(root));
    const paths = walk.files.map((f) => f.path);

    expect(paths).toContain("src/a.ts");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("vendor/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("third_party/"))).toBe(false);
  });

  it("respects .gitignore and .sourcevisionignore", async () => {
    const root = project("ignore", {
      ".gitignore": "secret/\n",
      ".sourcevisionignore": "generated.ts\n",
      "secret/key.txt": "x",
      "generated.ts": "export const g = 1;\n",
      "kept.ts": "export const k = 1;\n",
    });
    const paths = walkProject(root, await loadIgnoreFilter(root)).files.map((f) => f.path);

    expect(paths).toContain("kept.ts");
    expect(paths).not.toContain("generated.ts");
    expect(paths.some((p) => p.startsWith("secret/"))).toBe(false);
  });

  it("stops at the depth cap and says so", async () => {
    const deep: Record<string, string> = {};
    deep[`${"a/".repeat(WALK_BOUNDS.maxDepth + 3)}deep.ts`] = "export const d = 1;\n";
    const root = project("depth", deep);
    const walk = walkProject(root, await loadIgnoreFilter(root));

    expect(walk.truncated).toBe(true);
  });

  it("stops at the file cap and says so", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < WALK_BOUNDS.maxFiles + 10; i++) many[`f${i}.txt`] = "x";
    const root = project("count", many);
    const walk = walkProject(root, await loadIgnoreFilter(root));

    expect(walk.truncated).toBe(true);
    expect(walk.files.length).toBeLessThanOrEqual(WALK_BOUNDS.maxFiles);
  });

  it("records a file's size so the reader can refuse it unread", async () => {
    const root = project("size", { "big.json": "x".repeat(50) });
    const walk = walkProject(root, await loadIgnoreFilter(root));
    expect(walk.files.find((f) => f.path === "big.json")?.size).toBe(50);
  });

  it("returns files in a stable order", async () => {
    const root = project("order", { "b.ts": "1", "a.ts": "1", "c/d.ts": "1" });
    const first = walkProject(root, await loadIgnoreFilter(root)).files.map((f) => f.path);
    const second = walkProject(root, await loadIgnoreFilter(root)).files.map((f) => f.path);
    expect(second).toEqual(first);
    expect(first).toEqual([...first].sort());
  });
});

describe("the oversize bound is enforced on read, not on walk", () => {
  it("records a parse failure naming the size rather than reading it", async () => {
    const root = project("oversize", {
      "package.json": `{"name":"x","padding":"${"y".repeat(WALK_BOUNDS.maxFileBytes + 10)}"}`,
    });
    const profile = await buildSdlcProfile(root);

    const failure = profile.parseFailures.find((f) => f.path === "package.json");
    expect(failure).toBeDefined();
    expect(failure?.reason).toMatch(/over the .* byte limit/);
    expect(profile.commands).toEqual([]);
  });
});

// ── Commands ────────────────────────────────────────────────────────────────

describe("commands", () => {
  it("reads package.json scripts and names the runner from the lockfile", async () => {
    const root = project("scripts", {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "package.json": JSON.stringify({
        name: "x",
        scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", build: "vite build", start: "node ." },
      }),
    });
    const profile = await buildSdlcProfile(root);
    const byKind = Object.fromEntries(profile.commands.map((c) => [c.kind, c]));

    expect(Object.keys(byKind).sort()).toEqual(["build", "lint", "test", "typecheck"]);
    expect(byKind["test"].command).toBe("pnpm run test");
    expect(byKind["test"].runner).toBe("pnpm");
    expect(byKind["test"].evidence[0].path).toBe("package.json");
    expect(byKind["test"].evidence[0].confidence).toBe("certain");
    // "start" is not one of the six kinds and is not invented into one.
    expect(profile.commands.some((c) => c.command.includes("start"))).toBe(false);
  });

  it("reads Makefile targets", async () => {
    const root = project("make", { "Makefile": ".PHONY: test\ntest:\n\tgo test ./...\n\nbuild:\n\tgo build\n\nhelp:\n\techo hi\n" });
    const profile = await buildSdlcProfile(root);
    const kinds = profile.commands.map((c) => c.kind).sort();

    expect(kinds).toContain("test");
    expect(profile.commands.find((c) => c.kind === "test")?.command).toBe("make test");
    expect(profile.commands.find((c) => c.kind === "test")?.runner).toBe("make");
  });

  it("reads pyproject script tables", async () => {
    const root = project("py", {
      "pyproject.toml": "[tool.poetry]\nname = \"x\"\n\n[tool.poetry.scripts]\ntest = \"pytest:main\"\nserve = \"app:main\"\n",
    });
    const profile = await buildSdlcProfile(root);
    expect(profile.commands.map((c) => c.kind)).toContain("test");
    expect(profile.commands.some((c) => c.command === "serve")).toBe(false);
  });

  it("infers the toolchain commands from go.mod, marked likely not certain", async () => {
    const root = project("go", { "go.mod": "module example.com/x\n\ngo 1.23\n" });
    const profile = await buildSdlcProfile(root);
    const test = profile.commands.find((c) => c.kind === "test");

    expect(test?.command).toBe("go test ./...");
    // The module file proves it is a Go module, not that anyone runs tests.
    expect(test?.evidence[0].confidence).toBe("likely");
  });
});

describe("classifyCommand", () => {
  const CASES: Array<[string, string]> = [
    ["pnpm test", "test"], ["vitest run", "test"], ["go test ./...", "test"],
    ["eslint .", "lint"], ["tsc --noEmit", "typecheck"], ["vite build", "build"],
    ["./deploy.sh production", "deploy"], ["npm publish", "publish"],
    ["prisma migrate deploy", "migrate"], ["actions/checkout@v4", "checkout"],
    ["pnpm install", "install"], ["actions/setup-node@v4", "setup"],
  ];
  for (const [text, kind] of CASES) {
    it(`classifies ${JSON.stringify(text)} as ${kind}`, () => {
      expect(classifyCommand(text)).toBe(kind);
    });
  }

  it("answers other for a command it does not recognise", () => {
    // Not a dustbin — an unrecognised command is evidence of nothing, and
    // guessing would put it in a category something later counts.
    expect(classifyCommand("./scripts/frobnicate --wibble")).toBe("other");
  });
});

// ── CI ──────────────────────────────────────────────────────────────────────

describe("CI parsing", () => {
  it("reads GitHub Actions jobs, steps and triggers", async () => {
    const root = project("gha", { ".github/workflows/ci.yml": ACTIONS });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci).toHaveLength(1);
    const pipeline = profile.ci[0];
    expect(pipeline.provider).toBe("github-actions");
    expect(pipeline.name).toBe("CI");
    expect(pipeline.triggers).toEqual(["push", "pull_request"]);
    expect(pipeline.jobs.map((j) => j.name)).toEqual(["verify", "release"]);

    const verify = pipeline.jobs[0];
    expect(verify.steps.map((s) => s.kind)).toEqual(["checkout", "install", "test"]);
    expect(verify.steps[2].run).toBe("pnpm test");

    const release = pipeline.jobs[1];
    expect(release.needs).toEqual(["verify"]);
    expect(release.condition).toBe("github.ref == 'refs/heads/main'");
    expect(release.steps[0].kind).toBe("deploy");
  });

  it("reads GitLab CI jobs and skips its reserved keys", async () => {
    const root = project("gitlab", {
      ".gitlab-ci.yml": "stages:\n  - test\nvariables:\n  X: '1'\n.hidden:\n  script: ignored\nunit:\n  stage: test\n  script:\n    - pytest\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci[0].provider).toBe("gitlab-ci");
    expect(profile.ci[0].jobs.map((j) => j.name)).toEqual(["unit"]);
    expect(profile.ci[0].jobs[0].steps[0].kind).toBe("test");
  });

  it("reads CircleCI jobs", async () => {
    const root = project("circle", {
      ".circleci/config.yml": "version: 2.1\nworkflows:\n  main:\n    jobs: [build]\njobs:\n  build:\n    steps:\n      - checkout\n      - run: npm test\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci[0].provider).toBe("circleci");
    expect(profile.ci[0].jobs[0].name).toBe("build");
    expect(profile.ci[0].jobs[0].steps.map((s) => s.kind)).toEqual(["checkout", "test"]);
  });

  it("reads Bitbucket pipelines, including branch maps", async () => {
    const root = project("bitbucket", {
      "bitbucket-pipelines.yml":
        "pipelines:\n" +
        "  default:\n" +
        "    - step:\n" +
        "        name: Test\n" +
        "        script:\n" +
        "          - npm test\n" +
        "  branches:\n" +
        "    main:\n" +
        "      - step:\n" +
        "          name: Deploy\n" +
        "          script:\n" +
        "            - ./deploy.sh\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci[0].provider).toBe("bitbucket-pipelines");
    expect(profile.ci[0].triggers).toEqual(["default", "branches"]);
    const names = profile.ci[0].jobs.map((j) => j.name);
    expect(names).toContain("default");
    expect(names).toContain("branches:main");
  });

  it("reads a Jenkinsfile heuristically, and says so in the evidence", async () => {
    const root = project("jenkins", {
      "Jenkinsfile": "pipeline {\n  stages {\n    stage('Test') {\n      steps { sh 'make test' }\n    }\n    stage('Deploy') {\n      steps { sh './deploy.sh' }\n    }\n  }\n}\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci[0].provider).toBe("jenkins");
    expect(profile.ci[0].jobs.map((j) => j.name)).toEqual(["Test", "Deploy"]);
    // Groovy is a program, not data — reading it is a guess about runtime.
    expect(profile.ci[0].evidence[0].confidence).toBe("inferred");
  });
});

describe("a CI file present but unparseable", () => {
  it("is a parse failure carrying its path, not an empty ci section", async () => {
    const root = project("badci", {
      ".github/workflows/ci.yml": "name: CI\njobs:\n  build:\n    <<: *defaults\n",
    });
    const profile = await buildSdlcProfile(root);

    const failure = profile.parseFailures.find((f) => f.path === ".github/workflows/ci.yml");
    expect(failure).toBeDefined();
    expect(failure?.kind).toBe("github-actions");
    expect(failure?.reason).toMatch(/merge keys/i);
  });

  it("keeps the pipelines it could read alongside the one it could not", async () => {
    const root = project("mixedci", {
      ".github/workflows/good.yml": ACTIONS,
      ".github/workflows/bad.yml": "jobs:\n  x: !!str y\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.ci.map((p) => p.name)).toEqual(["CI"]);
    expect(profile.parseFailures.map((f) => f.path)).toEqual([".github/workflows/bad.yml"]);
  });

  it("distinguishes a project with no CI from one whose CI failed", async () => {
    const none = await buildSdlcProfile(project("noci", { "package.json": '{"name":"x"}' }));
    expect(none.ci).toEqual([]);
    expect(none.parseFailures).toEqual([]);

    const broken = await buildSdlcProfile(project("brokenci", {
      "package.json": '{"name":"x"}',
      ".github/workflows/ci.yml": "jobs:\n\tbuild: x\n",
    }));
    expect(broken.ci).toEqual([]);
    expect(broken.parseFailures).toHaveLength(1);
  });

  it("reports malformed JSON rather than treating the manifest as absent", async () => {
    const root = project("badjson", { "package.json": "{ not json" });
    const profile = await buildSdlcProfile(root);

    expect(profile.parseFailures[0].kind).toBe("package.json");
    expect(profile.parseFailures[0].reason).toMatch(/invalid JSON/);
  });
});

// ── Other sections ──────────────────────────────────────────────────────────

describe("deployment, containers, IaC and gates", () => {
  it("derives a deployment from a job containing a deploy step", async () => {
    const root = project("cd", { ".github/workflows/ci.yml": ACTIONS });
    const profile = await buildSdlcProfile(root);

    expect(profile.cd).toHaveLength(1);
    expect(profile.cd[0].environment).toBe("release");
    expect(profile.cd[0].mechanism).toBe("github-actions");
    expect(profile.cd[0].evidence[0].confidence).toBe("likely");
  });

  it("reads a Dockerfile, its base images and whether it is multi-stage", async () => {
    const root = project("docker", {
      "Dockerfile": "FROM node:22-alpine AS build\nRUN npm ci\n\nFROM node:22-alpine\nCOPY --from=build /app /app\n",
      "docker-compose.yml": "services:\n  app:\n    build: .\n",
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.containers[0].baseImages).toEqual(["node:22-alpine", "node:22-alpine"]);
    expect(profile.containers[0].multiStage).toBe(true);
    expect(profile.containers[0].orchestration).toBe("compose");
  });

  it("reuses the existing IaC discovery rather than parsing Terraform again", async () => {
    const root = project("iac", {
      "infra/main.tf": 'resource "aws_sqs_queue" "orders" {\n  name = "orders-queue"\n}\n',
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.iac).toHaveLength(1);
    expect(profile.iac[0].tool).toBe("terraform");
    expect(profile.iac[0].root).toBe("infra");
  });

  it("records CODEOWNERS and pre-commit as quality gates", async () => {
    const root = project("gates", {
      "CODEOWNERS": "* @team\n",
      ".pre-commit-config.yaml": "repos: []\n",
    });
    const profile = await buildSdlcProfile(root);
    const kinds = profile.qualityGates.map((g) => g.kind).sort();

    expect(kinds).toEqual(["codeowners", "pre-commit-hook"]);
  });

  it("detects test frameworks, observability and feature flags from dependencies", async () => {
    const root = project("deps", {
      "package.json": JSON.stringify({
        name: "x",
        dependencies: { pino: "^9", "dd-trace": "^5", "unleash-client": "^6" },
        devDependencies: { vitest: "^4" },
      }),
    });
    const profile = await buildSdlcProfile(root);

    expect(profile.tests.frameworks.map((f) => f.name)).toEqual(["vitest"]);
    expect(profile.observability.map((o) => `${o.kind}:${o.provider}`).sort())
      .toEqual(["logging:pino", "tracing:datadog"]);
    expect(profile.featureFlags.map((f) => f.provider)).toEqual(["unleash"]);
  });

  it("counts test suites by kind from their paths", async () => {
    const root = project("suites", {
      "tests/unit/a.test.ts": "1", "tests/unit/b.test.ts": "1",
      "tests/e2e/c.test.ts": "1",
    });
    const profile = await buildSdlcProfile(root);
    const byKind = Object.fromEntries(profile.tests.suites.map((s) => [s.kind, s.fileCount]));

    expect(byKind["unit"]).toBe(2);
    expect(byKind["e2e"]).toBe(1);
  });
});

// ── Determinism and shape ───────────────────────────────────────────────────

describe("determinism", () => {
  const FULL = {
    "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest", build: "vite build" }, devDependencies: { vitest: "^4" } }),
    ".github/workflows/ci.yml": ACTIONS,
    "Dockerfile": "FROM node:22\n",
    "infra/main.tf": 'resource "aws_s3_bucket" "assets" {\n  bucket = "assets-bucket"\n}\n',
    "CODEOWNERS": "* @team\n",
    "tests/unit/a.test.ts": "1",
  };

  it("two runs over an unchanged tree produce byte-identical output", async () => {
    const root = project("determinism", FULL);
    const first = toCanonicalJSON(stripSdlcProfileForDisk(await buildSdlcProfile(root)));
    const second = toCanonicalJSON(stripSdlcProfileForDisk(await buildSdlcProfile(root)));

    expect(second).toBe(first);
  });

  it("produces a profile the validator accepts", async () => {
    const root = project("valid", FULL);
    const profile = stripSdlcProfileForDisk(await buildSdlcProfile(root));
    const result = validate(SdlcProfileSchema, profile);

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors.issues, null, 2)).toBe(true);
  });

  it("strips the absolute root before the profile is written", async () => {
    const root = project("strip", FULL);
    const profile = await buildSdlcProfile(root);

    expect(profile.projectDir).toBe(root);
    expect(stripSdlcProfileForDisk(profile)).not.toHaveProperty("projectDir");
  });

  it("makes no network call and needs no LLM key", async () => {
    // The deterministic path is the whole contract: nothing here reads an
    // API key, and there is no fetch to intercept. Asserted by construction —
    // the module imports only node:fs, node:path and sibling analyzers.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../../src/analyzers/sdlc-profile.ts", import.meta.url), "utf-8"));

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/callClaude|askJev|https?:\/\//);
  });
});

describe("an empty project", () => {
  it("reports every section empty, with no parse failures", async () => {
    const root = project("empty", { "README.md": "# x\n" });
    const profile = stripSdlcProfileForDisk(await buildSdlcProfile(root));

    expect(profile.commands).toEqual([]);
    expect(profile.ci).toEqual([]);
    expect(profile.containers).toEqual([]);
    expect(profile.iac).toEqual([]);
    expect(profile.parseFailures).toEqual([]);
    expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
  });
});
