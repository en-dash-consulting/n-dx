import { describe, it, expect } from "vitest";
import {
  parsePorcelainZ,
  resolveLabels,
  selectAffected,
  validLabels,
} from "../../scripts/lib/select-suites.mjs";

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

const select = (...files) => selectAffected(files, MANIFESTS);

describe("selectAffected", () => {
  it("selects an llm-client src change plus every dependent, but not root", () => {
    const { suites, reasons } = select("packages/llm-client/src/foo.ts");
    expect(suites).toEqual(["hench", "llm-client", "rex", "sourcevision", "web"]);
    expect(reasons["llm-client"]).toBe("packages/llm-client/src/foo.ts");
    expect(reasons.rex).toBe("dependent of llm-client");
    expect(reasons.hench).toBe("dependent of llm-client");
  });

  it("follows dependents transitively", () => {
    const { suites, reasons } = select("packages/rex/src/x.ts");
    expect(suites).toEqual(["hench", "rex", "web"]);
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
    expect(suites).toEqual(validLabels(MANIFESTS));
    expect(reasons.web).toContain(file);
  });

  it("selects only the package for a test-only change in it", () => {
    expect(select("packages/llm-client/tests/unit/a.test.ts").suites).toEqual(["llm-client"]);
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
    expect(resolveLabels(["all"], MANIFESTS).labels).toEqual(validLabels(MANIFESTS));
    expect(resolveLabels(["root"], MANIFESTS).labels).toEqual(["root"]);
    expect(resolveLabels(["packages"], MANIFESTS).labels).toEqual(["hench", "llm-client", "rex", "sourcevision", "web"]);
  });

  it("reports unknown labels with the valid set; core has no suite", () => {
    expect(resolveLabels(["rex,nope", "core"], MANIFESTS)).toEqual({
      unknown: ["nope", "core"],
      valid: validLabels(MANIFESTS),
    });
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
