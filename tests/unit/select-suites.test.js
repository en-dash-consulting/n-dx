import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ROOT_DRIFT_TEST_FILES,
  ROOT_POLICY_TEST_FILES,
  ROOT_SUBSET_TEST_FILES,
  parsePorcelainZ,
  resolveLabels,
  selectAffected,
  validLabels,
} from "../../scripts/lib/select-suites.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const pkg = (dir, deps = [], hasTest = true) => ({
  dir,
  name: `@n-dx/${dir}`,
  hasTest,
  dependencies: Object.fromEntries(deps.map((d) => [`@n-dx/${d}`, "workspace:*"])),
  devDependencies: {},
});

// Mirrors the real workspace graph, but is data here so the module stays pure.
const MANIFESTS = [
  pkg("core", ["hench", "llm-client", "rex", "sourcevision", "web"], false),
  pkg("hench", ["llm-client", "rex"]),
  pkg("llm-client"),
  pkg("rex", ["llm-client"]),
  pkg("sourcevision", ["llm-client"]),
  pkg("web", ["llm-client", "rex", "sourcevision"]),
];

/** Every suite `all` and run-everything selections run: the root subsets are inside root. */
const everySuite = validLabels(MANIFESTS).filter((l) => l !== "root-policy" && l !== "root-drift");

const select = (...files) => selectAffected(files, MANIFESTS);

describe("selectAffected", () => {
  it("selects an llm-client src change plus every dependent and both root subsets, but not root", () => {
    const { suites, reasons } = select("packages/llm-client/src/foo.ts");
    expect(suites).toEqual(["root-policy", "root-drift", "hench", "llm-client", "rex", "sourcevision", "web"]);
    expect(reasons["llm-client"]).toBe("packages/llm-client/src/foo.ts");
    expect(reasons.rex).toBe("dependent of llm-client");
    expect(reasons.hench).toBe("dependent of llm-client");
  });

  it("follows dependents transitively", () => {
    const { suites, reasons } = select("packages/rex/src/x.ts");
    expect(suites).toEqual(["root-policy", "root-drift", "hench", "rex", "web"]);
    expect(reasons.hench).toBe("dependent of rex");
  });

  it("selects nothing for docs-only changes", () => {
    expect(select("docs/guide/x.md", "README.md", "packages/rex/README.md", "packages/web/docs/a.png").suites).toEqual([]);
  });

  it("selects nothing for PRD, run and analysis state", () => {
    expect(
      select(".rex/prd_tree/a/index.md", ".hench/runs/1.json", ".sourcevision/zones.json").suites,
    ).toEqual([]);
  });

  it("selects hench and root for a hench src/cli change", () => {
    const { suites, reasons } = select("packages/hench/src/cli/run.ts");
    expect(suites).toEqual(["root", "hench"]);
    expect(reasons.root).toBe("packages/hench/src/cli/run.ts");
  });

  it.each([
    "pnpm-lock.yaml",
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "vitest.config.js",
    "scripts/run-all-tests.mjs",
    "scripts/run-vitest-bind-aware.mjs",
  ])("runs every suite when %s changes", (file) => {
    const { suites, reasons } = select(file);
    expect(suites).toEqual(everySuite);
    expect(reasons.web).toContain(file);
  });

  it("selects the package and root-policy, but not root-drift, for a test-only change in it", () => {
    expect(select("packages/llm-client/tests/unit/a.test.ts").suites).toEqual(["root-policy", "llm-client"]);
    const hench = select("packages/hench/tests/unit/tools/new.test.ts");
    expect(hench.suites).toEqual(["root-policy", "hench"]);
    expect(hench.reasons["root-policy"]).toBe("packages/hench/tests/unit/tools/new.test.ts");
  });

  it("selects both root subsets for a hench src change outside src/cli", () => {
    expect(select("packages/hench/src/agent/lifecycle/foo.ts").suites).toEqual(["root-policy", "root-drift", "hench"]);
  });

  it("selects both root subsets for a web src change", () => {
    expect(select("packages/web/src/server/routes-hench.ts").suites).toEqual(["root-policy", "root-drift", "web"]);
  });

  // The three selections measured in the #546 review that went green at the
  // gate and red in CI: each edits a package source that a root drift test
  // reads, and none of them is under src/cli/, so full root is not selected.
  it.each([
    ["packages/hench/src/agent/planning/prompt.ts", ["root-policy", "root-drift", "hench"]],
    ["packages/sourcevision/src/export/iso-map.ts", ["root-policy", "root-drift", "sourcevision", "web"]],
    ["packages/hench/src/schema/validate.ts", ["root-policy", "root-drift", "hench"]],
  ])("selects root-drift for %s", (file, expected) => {
    const { suites, reasons } = select(file);
    expect(suites).toEqual(expected);
    expect(reasons["root-drift"]).toBe(file);
  });

  it("never selects a root subset together with root", () => {
    for (const files of [
      ["packages/hench/src/cli/run.ts"],
      ["packages/hench/src/a.ts", "scripts/x.mjs"],
      ["packages/rex/package.json"],
      ["packages/hench/tests/a.test.ts", "AGENTS.md"],
    ]) {
      const { suites } = selectAffected(files, MANIFESTS);
      expect(suites).toContain("root");
      expect(suites).not.toContain("root-policy");
      expect(suites).not.toContain("root-drift");
    }
  });

  it("does not select a root subset for docs, state or core-only changes", () => {
    expect(select("packages/hench/README.md", ".rex/prd_tree/a/index.md", "packages/core/cli.js").suites).toEqual(["root"]);
  });

  it("maps core changes to root, ignoring core docs", () => {
    expect(select("packages/core/cli.js").suites).toEqual(["root"]);
    expect(select("packages/core/README.md").suites).toEqual([]);
  });

  it("selects the package, dependents and root for a package.json change", () => {
    expect(select("packages/rex/package.json").suites).toEqual(["root", "hench", "rex", "web"]);
  });

  it.each([
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/skills/x/SKILL.md",
    ".agents/a.md",
    ".codex/config.toml",
    ".mcp.json",
    "packages/core/assistant-assets/project-guidance.md",
    ".rex/workflow.md",
    ".rex/n-dx_workflow.md",
  ])("selects root for instruction surface %s", (file) => {
    expect(select(file).suites).toEqual(["root"]);
  });

  it.each(["scripts/other.mjs", "tests/e2e/a.test.js", ".github/workflows/ci.yml", "option1.json"])(
    "selects root for %s",
    (file) => {
      expect(select(file).suites).toEqual(["root"]);
    },
  );

  it("selects nothing for an empty change list", () => {
    expect(select().suites).toEqual([]);
  });

  it("unions a mixed change, in run order, keeping the first reason", () => {
    const { suites, reasons } = select(
      "docs/a.md",
      "packages/sourcevision/src/a.ts",
      "packages/hench/tests/unit/b.test.ts",
      "packages/web/src/cli/c.ts",
      ".rex/prd_tree/x/index.md",
    );
    expect(suites).toEqual(["root", "hench", "sourcevision", "web"]);
    expect(reasons).toEqual({
      root: "packages/web/src/cli/c.ts",
      hench: "packages/hench/tests/unit/b.test.ts",
      sourcevision: "packages/sourcevision/src/a.ts",
      web: "dependent of sourcevision",
    });
  });
});

describe("resolveLabels", () => {
  it("accepts comma- and space-separated labels and @n-dx names, in run order", () => {
    expect(resolveLabels(["web,root", "@n-dx/rex"], MANIFESTS)).toEqual({ labels: ["root", "rex", "web"] });
  });

  it("keeps all, root and packages meanings", () => {
    expect(resolveLabels(["all"], MANIFESTS).labels).toEqual(everySuite);
    expect(resolveLabels(["root"], MANIFESTS).labels).toEqual(["root"]);
    expect(resolveLabels(["packages"], MANIFESTS).labels).toEqual(["hench", "llm-client", "rex", "sourcevision", "web"]);
  });

  it("accepts the root subsets, and drops them when root is also wanted", () => {
    expect(validLabels(MANIFESTS)).toContain("root-policy");
    expect(validLabels(MANIFESTS)).toContain("root-drift");
    expect(resolveLabels(["root-policy"], MANIFESTS).labels).toEqual(["root-policy"]);
    expect(resolveLabels(["root-drift"], MANIFESTS).labels).toEqual(["root-drift"]);
    expect(resolveLabels(["root-policy,root-drift"], MANIFESTS).labels).toEqual(["root-policy", "root-drift"]);
    expect(resolveLabels(["root-policy,root-drift,root", "rex"], MANIFESTS).labels).toEqual(["root", "rex"]);
  });

  it("reports unknown labels with the valid set; core has no suite", () => {
    expect(resolveLabels(["rex,nope", "core"], MANIFESTS)).toEqual({
      unknown: ["nope", "core"],
      valid: validLabels(MANIFESTS),
    });
  });
});

describe("root subset test files", () => {
  it("lists only files that exist", () => {
    for (const [label, files] of Object.entries(ROOT_SUBSET_TEST_FILES)) {
      for (const file of files) {
        expect(existsSync(resolve(ROOT, file)), `${label}: ${file}`).toBe(true);
      }
    }
  });

  it("covers both subsets and never runs the same file twice", () => {
    expect(Object.values(ROOT_SUBSET_TEST_FILES)).toEqual([ROOT_POLICY_TEST_FILES, ROOT_DRIFT_TEST_FILES]);
    const all = Object.values(ROOT_SUBSET_TEST_FILES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs the drift tests that read a package source and compare it to a checked-in artifact", () => {
    expect(ROOT_DRIFT_TEST_FILES).toEqual([
      "tests/e2e/prompt-census.test.js",
      "tests/e2e/iso-skill-drift.test.js",
      "tests/e2e/hench-config-gate-contract.test.js",
      "tests/e2e/instruction-alignment.test.js",
    ]);
  });
});

describe("parsePorcelainZ", () => {
  it("returns modified and untracked paths", () => {
    expect(parsePorcelainZ(" M a.js\0?? dir/b.js\0")).toEqual(["a.js", "dir/b.js"]);
  });

  it("includes both sides of a rename", () => {
    expect(parsePorcelainZ("R  new.js\0old.js\0 M c.js\0")).toEqual(["new.js", "old.js", "c.js"]);
  });

  it("returns nothing for empty output", () => {
    expect(parsePorcelainZ("")).toEqual([]);
  });
});
