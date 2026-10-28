import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  EXTENSION_HUB_FILES,
  ROOT_DOCS_TEST_FILES,
  ROOT_EXTENSIONS_TEST_FILES,
  ROOT_DRIFT_TEST_FILES,
  ROOT_POLICY_TEST_FILES,
  ROOT_SUBSET_LABELS,
  ROOT_SUBSET_TEST_FILES,
  VALIDATED_ARTIFACTS,
  VALIDATED_DOC_PAGES,
  parsePorcelainZ,
  resolveLabels,
  selectAffected,
  validLabels,
} from "../../scripts/lib/select-suites.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Every root test file, root-relative: what `root` runs. */
function rootTestFiles() {
  const files = [];
  (function walk(rel) {
    for (const entry of readdirSync(resolve(ROOT, rel), { withFileTypes: true })) {
      if (entry.name === "fixtures" || entry.name === "node_modules") continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.test\.(?:m?js|ts)$/.test(entry.name)) files.push(child);
    }
  })("tests");
  return files.sort();
}

/** A quoted or bare `*.md` path anywhere in a source: what a test mentions. */
const MD_PATH = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.md)(?![\w/-])/g;

/** A docs page or directory, or the root README: what the doc groups map. */
const DOCS_PATH = /^(?:README\.md|docs(?:\/.+)?)$/;

/** A page inside `path` when it is a directory a test walks; the path itself otherwise. */
const pageIn = (path) => (path.endsWith(".md") ? path : `${path}/any-page.md`);

/**
 * The docs pages and directories a test reads from the repository root,
 * root-relative and sorted. A read is `join`/`resolve` of a root anchor (a
 * `const *ROOT*` built from `import.meta` or `process.cwd()`), or of a `const`
 * built that way, with literal segments; or `new URL("<relative>",
 * import.meta.url)`. A directory that is only the base of another read (as
 * `DOCS` in `join(DOCS, "guide")`) is dropped. Comment lines are skipped; a
 * path under any other base (a temp fixture's `README.md`) is not a read.
 */
function docsReads(source, testFile) {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
    .join("\n");
  const SEGMENTS = String.raw`((?:\s*,\s*["'\x60][^"'\x60$]+["'\x60])+)\s*\)`;
  const segments = (list) => [...list.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  const bases = new Map();
  for (const [, name, init] of code.matchAll(/\bconst\s+(\w*ROOT\w*)\s*=\s*([^;\n]+)/g)) {
    if (/import\.meta|process\.cwd\(\)/.test(init)) bases.set(name, "");
  }
  for (const [, name, base, list] of code.matchAll(
    new RegExp(String.raw`\bconst\s+(\w+)\s*=\s*(?:join|resolve)\(\s*(\w+)` + SEGMENTS, "g"),
  )) {
    if (bases.has(base)) bases.set(name, posix.join(bases.get(base), ...segments(list)));
  }
  const paths = new Set();
  for (const [, base, list] of code.matchAll(new RegExp(String.raw`\b(?:join|resolve)\(\s*(\w+)` + SEGMENTS, "g"))) {
    if (bases.has(base)) paths.add(posix.join(bases.get(base), ...segments(list)));
  }
  for (const [, rel] of code.matchAll(/new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g)) {
    paths.add(posix.normalize(posix.join(posix.dirname(testFile), rel)));
  }
  const docs = [...paths].filter((p) => DOCS_PATH.test(p));
  return docs.filter((p) => p.endsWith(".md") || !docs.some((other) => other.startsWith(`${p}/`))).sort();
}

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
const everySuite = validLabels(MANIFESTS).filter((l) => !ROOT_SUBSET_LABELS.includes(l));

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
    expect(select("docs/analysis/x.md", "docs/archive/x.md", "packages/rex/README.md", "packages/web/docs/a.png").suites).toEqual([]);
  });

  // #546 review finding F2: the Markdown/docs short-circuit ran before the
  // ROOT_PREFIXES check, so an artifact a root test validates, changed on its
  // own, selected no suite at all.
  it.each([
    ["tests/shell-spawn-inventory.md", "root-policy"],
    ["tests/wall-clock-assertion-inventory.md", "root-policy"],
    ["docs/analysis/prompt-token-baseline.md", "root-drift"],
    ["docs/analysis/prompt-token-baseline.json", "root-drift"],
  ])("selects the subset that validates %s, and only that subset", (file, label) => {
    const { suites, reasons } = select(file);
    expect(suites).toEqual([label]);
    expect(reasons[label]).toBe(file);
  });

  it("still selects nothing for a plain docs or prose edit with no validated artifact", () => {
    expect(select("docs/architecture/overview.md").suites).toEqual([]);
    expect(select("docs/analysis/AUDIT-2026-09.md").suites).toEqual([]);
    // Live beside the policed inventories but no test reads either: the
    // layout-literal one stopped being an input when its ratchet became a wall
    // and the policy test stopped parsing it for ceilings.
    expect(select("tests/unit-test-constant-inventory.md").suites).toEqual([]);
    expect(select("tests/layout-literal-inventory.md").suites).toEqual([]);
  });

  it("keeps a validated artifact under tests/ off the full root suite", () => {
    const { suites } = select("tests/shell-spawn-inventory.md", "docs/analysis/prompt-token-baseline.json");
    expect(suites).toEqual(["root-policy", "root-drift"]);
  });

  it("lets a code change in the same batch still supersede a validated artifact", () => {
    expect(select("tests/shell-spawn-inventory.md", "tests/e2e/a.test.js").suites).toEqual(["root"]);
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

  // The extensions e2e suite is required on every change to the hub proxy;
  // dispatch and discovery are core, which selects root.
  it.each(EXTENSION_HUB_FILES)("selects root-extensions for %s", (file) => {
    expect(existsSync(resolve(ROOT, file)), file).toBe(true);
    expect(select(file).suites).toEqual(["root-policy", "root-drift", "root-extensions", "web"]);
  });

  it("runs the extensions suite for dispatch and discovery changes, through root", () => {
    for (const file of ["packages/core/extension-dispatch.js", "packages/core/extension-discovery.js"]) {
      expect(select(file).suites).toEqual(["root"]);
    }
  });

  it("selects the extension fixture for every hub source", () => {
    expect(select("packages/web/src/hub/registry.ts").suites).toEqual(["root-policy", "root-drift", "root-extensions", "web"]);
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

  // The recurrence of the above: the task that closed #546 finding F1 named
  // four drift tests, and every other root test of the same shape stayed out of
  // both subsets. Each pair is (a package source, the root test that reads it
  // and fails when its twin or its generated artifact disagrees). Derived, not
  // asserted against a literal label: the pair holds as long as *some* selected
  // suite runs that test, and the test is required to mention the source so a
  // rename cannot leave a stale pairing passing.
  it.each([
    ["packages/web/src/shared/run-options.ts", "tests/e2e/run-options-contract.test.js"],
    ["packages/llm-client/src/config.ts", "tests/e2e/catalog-runtime-contract.test.js"],
    ["packages/rex/src/store/folder-tree-serializer.ts", "tests/e2e/prd-slug-conformance.test.js"],
    ["packages/web/src/server/run-liveness.ts", "tests/e2e/run-liveness-parity.test.js"],
    ["packages/hench/src/agent/lifecycle/shared.ts", "tests/e2e/skill-commit-isolation.test.js"],
    ["packages/web/src/server/start.ts", "tests/e2e/assistant-parity-smoke.test.js"],
    ["packages/llm-client/src/layout.ts", "tests/integration/layout-resolver-contract.test.js"],
    ["packages/llm-client/src/config.ts", "tests/integration/task-class-sync.test.js"],
    ["packages/web/src/server/effective-agent-config.ts", "tests/integration/effective-agent-config-contract.test.js"],
    ["packages/web/src/server/prd-delta.ts", "tests/integration/prd-delta-cli-agreement.test.js"],
    ["packages/hench/src/prd/rex-gateway.ts", "tests/integration/cross-package-contracts.test.js"],
    ["packages/web/src/server/rex-gateway.ts", "tests/integration/web-server-viewer-boundary.test.js"],
  ])("a change to %s alone selects a suite that runs %s", (source, test) => {
    expect(existsSync(resolve(ROOT, source)), source).toBe(true);
    // Named either way round: some of these tests write the path from the repo
    // root, others from `packages/` (`web/src/server/run-liveness.ts`).
    const text = readFileSync(resolve(ROOT, test), "utf8");
    const named = text.includes(source) || text.includes(source.replace(/^packages\//, ""));
    expect(named, `${test} should name ${source}`).toBe(true);
    const { suites } = select(source);
    const runs = suites.some((s) => s === "root" || (ROOT_SUBSET_TEST_FILES[s] ?? []).includes(test));
    expect(runs, `${source} selected ${suites.join(", ")}, none of which runs ${test}`).toBe(true);
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
    expect(select("packages/core/CHANGELOG.md").suites).toEqual([]);
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
    expect(Object.values(ROOT_SUBSET_TEST_FILES)).toEqual([
      ROOT_POLICY_TEST_FILES,
      ROOT_DRIFT_TEST_FILES,
      ROOT_DOCS_TEST_FILES,
      ROOT_EXTENSIONS_TEST_FILES,
    ]);
    const all = Object.values(ROOT_SUBSET_TEST_FILES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs the drift tests that compare a package source to its artifact or its twin", () => {
    expect(ROOT_DRIFT_TEST_FILES).toEqual([
      "tests/e2e/prompt-census.test.js",
      "tests/e2e/iso-skill-drift.test.js",
      "tests/e2e/hench-config-gate-contract.test.js",
      "tests/e2e/instruction-alignment.test.js",
      "tests/e2e/prd-slug-conformance.test.js",
      "tests/e2e/assistant-parity-smoke.test.js",
      "tests/e2e/skill-commit-isolation.test.js",
      "tests/e2e/run-options-contract.test.js",
      "tests/e2e/catalog-runtime-contract.test.js",
      "tests/e2e/run-liveness-parity.test.js",
      "tests/integration/layout-resolver-contract.test.js",
      "tests/integration/task-class-sync.test.js",
      "tests/integration/task-class-registry.test.js",
      "tests/integration/primer-fingerprint-contract.test.js",
      "tests/integration/effective-agent-config-contract.test.js",
      "tests/integration/prd-delta-cli-agreement.test.js",
      "tests/integration/command-effects-manifest-contract.test.js",
      "tests/integration/cross-package-contracts.test.js",
      "tests/integration/web-server-viewer-boundary.test.js",
    ]);
  });

  it("runs the policy tests that police package sources and tests", () => {
    expect(ROOT_POLICY_TEST_FILES).toEqual([
      "tests/e2e/architecture-policy.test.js",
      "tests/e2e/domain-isolation.test.js",
      "tests/e2e/shell-spawn-inventory-policy.test.js",
      "tests/e2e/wall-clock-inventory-policy.test.js",
      "tests/e2e/layout-literal-policy.test.js",
      "tests/e2e/obfuscated-code-policy.test.js",
      "tests/e2e/integration-coverage-policy.test.js",
      "tests/e2e/windows-hide-policy.test.js",
    ]);
  });
});

describe("validated artifacts", () => {
  // Derives the map rather than trusting it: each artifact must name a test
  // that exists, mentions its path, and is actually run by the mapped subset.
  it("maps each artifact to a subset that runs a test which reads it", () => {
    for (const [artifact, { label, test }] of Object.entries(VALIDATED_ARTIFACTS)) {
      expect(existsSync(resolve(ROOT, artifact)), artifact).toBe(true);
      expect(existsSync(resolve(ROOT, test)), test).toBe(true);
      expect(readFileSync(resolve(ROOT, test), "utf8"), `${test} should read ${artifact}`).toContain(artifact);
      expect(ROOT_SUBSET_TEST_FILES[label], `${label} should run ${test}`).toContain(test);
    }
  });

  it("lists only paths the Markdown/docs short-circuit would otherwise drop", () => {
    for (const artifact of Object.keys(VALIDATED_ARTIFACTS)) {
      expect(artifact.endsWith(".md") || artifact.startsWith("docs/"), artifact).toBe(true);
    }
  });
});

describe("validated docs pages", () => {
  it.each([
    ["README.md", "tests/e2e/command-docs-parity.test.js"],
    ["packages/core/README.md", "tests/e2e/command-docs-parity.test.js"],
    ["docs/guide/commands.md", "tests/e2e/command-docs-parity.test.js"],
    ["docs/guide/workflow.md", "tests/e2e/docs-skill-refs.test.js"],
    ["docs/cli-ui-gap.md", "tests/e2e/cli-ui-gap-drift.test.js"],
    ["docs/guide/workflow.md", "tests/e2e/docs-command-refs.test.js"],
    ["docs/guide/skills.md", "tests/e2e/docs-command-refs.test.js"],
    ["docs/guide/concepts/glossary.md", "tests/e2e/docs-command-refs.test.js"],
    ["docs/packages/rex.md", "tests/e2e/docs-command-refs.test.js"],
    ["docs/index.md", "tests/e2e/docs-command-refs.test.js"],
    ["docs/guide/troubleshooting.md", "tests/e2e/assistant-parity-smoke.test.js"],
    ["docs/contributing/cli-smoke-parity.md", "tests/unit/cli-smoke-parity.test.js"],
  ])("%s selects a subset that runs %s, and nothing else", (page, test) => {
    const { suites } = select(page);
    expect(suites).toHaveLength(suites.filter((s) => ROOT_SUBSET_LABELS.includes(s)).length);
    expect(suites.length).toBeGreaterThan(0);
    expect(suites.flatMap((s) => ROOT_SUBSET_TEST_FILES[s])).toContain(test);
  });

  it("selects root-docs, not root, for a guide page", () => {
    expect(select("docs/guide/workflow.md").suites).toEqual(["root-docs"]);
  });

  // docs-skill-refs exempts the skills reference, but docs-command-refs still
  // checks every command it names, so it is not prose.
  it("selects root-docs for the skills reference, which docs-command-refs reads", () => {
    expect(select("docs/guide/skills.md").suites).toEqual(["root-docs"]);
  });

  it("drops root-docs when root is selected too", () => {
    expect(select("README.md", "scripts/a.mjs").suites).toEqual(["root"]);
  });

  it("maps each group to a subset that runs tests which exist", () => {
    for (const { label, tests } of VALIDATED_DOC_PAGES) {
      for (const test of tests) {
        expect(ROOT_SUBSET_TEST_FILES[label], `${label} should run ${test}`).toContain(test);
        expect(existsSync(resolve(ROOT, test)), test).toBe(true);
      }
    }
  });

  it("maps each group only to tests whose source mentions a path it matches", () => {
    const unmentioned = [];
    for (const [i, { tests, match }] of VALIDATED_DOC_PAGES.entries()) {
      for (const test of tests) {
        const source = readFileSync(resolve(ROOT, test), "utf8");
        const mentions = [...docsReads(source, test), ...source.matchAll(MD_PATH)].map((m) =>
          typeof m === "string" ? m : m[1],
        );
        if (!mentions.some((m) => match(pageIn(m)))) unmentioned.push(`group ${i}: ${test}`);
      }
    }
    expect(unmentioned).toEqual([]);
  });

  // The groups above are hand-written: a root test that starts reading another
  // docs page, or a new docs test, would select nothing on a docs-only edit
  // while CI fails. Derived from the test sources instead (docsReads below).
  it("maps every docs page a root test reads to a subset that runs that test", () => {
    // This file is skipped: its docsReads fixtures are sources, not reads.
    const self = "tests/unit/select-suites.test.js";
    const reads = rootTestFiles()
      .filter((test) => test !== self)
      .flatMap((test) =>
      docsReads(readFileSync(resolve(ROOT, test), "utf8"), test).map((path) => ({ test, path })),
    );
    // Guards the scan itself: file reads, directory walks and URL reads it must see today.
    expect(reads).toEqual(
      expect.arrayContaining([
        { test: "tests/e2e/command-docs-parity.test.js", path: "README.md" },
        { test: "tests/e2e/command-docs-parity.test.js", path: "docs/guide/commands.md" },
        { test: "tests/e2e/docs-skill-refs.test.js", path: "docs/guide" },
        { test: "tests/e2e/docs-command-refs.test.js", path: "docs/index.md" },
        { test: "tests/e2e/docs-command-refs.test.js", path: "docs/packages" },
        { test: "tests/unit/cli-smoke-parity.test.js", path: "docs/contributing/cli-smoke-parity.md" },
      ]),
    );
    const unmapped = reads.filter(
      ({ test, path }) =>
        VALIDATED_ARTIFACTS[path]?.test !== test &&
        !VALIDATED_DOC_PAGES.some((g) => g.tests.includes(test) && g.match(pageIn(path))),
    );
    expect(unmapped).toEqual([]);
  });

  describe("docsReads", () => {
    it("resolves root-anchored joins, derived bases, URL reads, and drops a walked dir's parent", () => {
      const source = [
        'const ROOT = join(import.meta.dirname, "../..");',
        'const DOCS = join(ROOT, "docs");',
        'readFileSync(join(ROOT, "README.md"));',
        'walk(join(DOCS, "guide"));',
        'readFileSync(new URL("../../docs/a/b.md", import.meta.url));',
        '// readFileSync(join(ROOT, "docs/commented.md"));',
        'writeFileSync(join(tmpDir, "README.md"), "");',
        'readFileSync(join(ROOT, "packages/web/x.md"));',
      ].join("\n");
      expect(docsReads(source, "tests/unit/x.test.js")).toEqual(["README.md", "docs/a/b.md", "docs/guide"]);
    });
  });

  // A `tests/*.md` file that a root-policy test reads must be mapped, or editing
  // it alone selects nothing while CI fails. Derived from the test sources: a
  // quoted `"<name>.md"` (as in `join(ROOT, "tests", "<name>.md")`) or quoted
  // `"tests/<name>.md"` counts as a read.
  it("has a VALIDATED_ARTIFACTS entry for every tests/*.md a policy test reads", () => {
    const inventories = readdirSync(resolve(ROOT, "tests")).filter((f) => f.endsWith(".md"));
    const reads = [];
    for (const file of ROOT_POLICY_TEST_FILES) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      for (const name of inventories) {
        if (new RegExp(`["'\`](?:tests/)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(source)) {
          reads.push({ file, artifact: `tests/${name}` });
        }
      }
    }
    // Guards the scan itself: it must see the two inventories the policy tests read today.
    expect(reads.map((r) => r.artifact)).toEqual(
      expect.arrayContaining(["tests/shell-spawn-inventory.md", "tests/wall-clock-assertion-inventory.md"]),
    );
    const missing = reads.filter(({ file, artifact }) => VALIDATED_ARTIFACTS[artifact]?.test !== file);
    expect(missing).toEqual([]);
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


describe("the real Graview process boundaries", () => {
  const manifests = [...MANIFESTS, pkg("graview"), pkg("graview-face")];
  it.each(["packages/core/cli.js", "packages/core/extension-env.js", "packages/core/extensions-command.js", "packages/graview-face/package.json"])("selects the real CLI handoff for %s", (file) => {
    expect(selectAffected([file], manifests).suites).toContain("graview");
  });
  it.each(["hub.ts", "home.ts", "routes.ts", "request-guard.ts", "exec-gateway.ts"])("selects the fixture for hub/%s", (file) => {
    expect(selectAffected([`packages/web/src/hub/${file}`], manifests).suites).toContain("root-extensions");
  });
});
