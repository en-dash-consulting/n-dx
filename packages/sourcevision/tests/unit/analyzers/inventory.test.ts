import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectLanguage,
  classifyRole,
  deriveCategory,
  isBinary,
  analyzeInventory,
  IgnoreFilter,
  loadIgnoreFilter,
} from "../../../src/analyzers/inventory.js";
import type { InventoryResult } from "../../../src/analyzers/inventory.js";

// ── detectLanguage ────────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("maps .ts to TypeScript", () => {
    expect(detectLanguage("src/app.ts")).toBe("TypeScript");
  });

  it("maps .py to Python", () => {
    expect(detectLanguage("lib/main.py")).toBe("Python");
  });

  it("maps Makefile to Makefile", () => {
    expect(detectLanguage("Makefile")).toBe("Makefile");
  });

  it("maps Dockerfile to Dockerfile", () => {
    expect(detectLanguage("Dockerfile")).toBe("Dockerfile");
  });

  it("returns Other for unknown extensions", () => {
    expect(detectLanguage("data.xyz")).toBe("Other");
  });

  it("maps .mts to TypeScript", () => {
    expect(detectLanguage("src/server.mts")).toBe("TypeScript");
  });

  it("maps .cts to TypeScript", () => {
    expect(detectLanguage("src/require.cts")).toBe("TypeScript");
  });

  it("maps .d.ts to TypeScript (via .ts extension)", () => {
    expect(detectLanguage("src/types.d.ts")).toBe("TypeScript");
  });

  it("maps Dockerfile.dev to Dockerfile", () => {
    expect(detectLanguage("Dockerfile.dev")).toBe("Dockerfile");
  });

  it("maps Dockerfile.prod to Dockerfile", () => {
    expect(detectLanguage("deploy/Dockerfile.prod")).toBe("Dockerfile");
  });

  it("maps GNUmakefile to Makefile", () => {
    expect(detectLanguage("GNUmakefile")).toBe("Makefile");
  });

  it("maps Justfile to Just", () => {
    expect(detectLanguage("Justfile")).toBe("Just");
  });

  it("maps CMakeLists.txt to CMake", () => {
    expect(detectLanguage("CMakeLists.txt")).toBe("CMake");
  });

  it("handles case-insensitive extensions", () => {
    // extname returns lowercase via .toLowerCase()
    expect(detectLanguage("README.MD")).toBe("Markdown");
  });
});

// ── classifyRole ──────────────────────────────────────────────────────────────

describe("classifyRole", () => {
  it("classifies .test.ts as test", () => {
    expect(classifyRole("src/app.test.ts", "TypeScript")).toBe("test");
  });

  it("classifies package-lock.json as generated", () => {
    expect(classifyRole("package-lock.json", "JSON")).toBe("generated");
  });

  it("classifies tsconfig.json as config", () => {
    expect(classifyRole("tsconfig.json", "JSON")).toBe("config");
  });

  it("classifies README.md as docs", () => {
    expect(classifyRole("README.md", "Markdown")).toBe("docs");
  });

  it("classifies logo.png as asset", () => {
    expect(classifyRole("logo.png", "Other")).toBe("asset");
  });

  it("classifies Dockerfile as build", () => {
    expect(classifyRole("Dockerfile", "Dockerfile")).toBe("build");
  });

  it("classifies app.ts as source", () => {
    expect(classifyRole("src/app.ts", "TypeScript")).toBe("source");
  });

  it("classifies unknown binary as other", () => {
    expect(classifyRole("data.bin", "Other")).toBe("other");
  });

  it("test takes priority over source", () => {
    expect(classifyRole("src/__tests__/app.ts", "TypeScript")).toBe("test");
  });

  // ── Hardening: .env variants ──

  it("classifies .env as config", () => {
    expect(classifyRole(".env", "Other")).toBe("config");
  });

  it("classifies .env.local as config", () => {
    expect(classifyRole(".env.local", "Other")).toBe("config");
  });

  it("classifies .env.development as config", () => {
    expect(classifyRole(".env.development", "Other")).toBe("config");
  });

  it("classifies .env.production as config", () => {
    expect(classifyRole(".env.production", "Other")).toBe("config");
  });

  it("classifies .env.example as config", () => {
    expect(classifyRole(".env.example", "Other")).toBe("config");
  });

  // ── Hardening: ESM/CJS config variants ──

  it("classifies vitest.config.mjs as config", () => {
    expect(classifyRole("vitest.config.mjs", "JavaScript")).toBe("config");
  });

  it("classifies jest.config.mjs as config", () => {
    expect(classifyRole("jest.config.mjs", "JavaScript")).toBe("config");
  });

  it("classifies eslint.config.ts as config", () => {
    expect(classifyRole("eslint.config.ts", "TypeScript")).toBe("config");
  });

  it("classifies next.config.ts as config", () => {
    expect(classifyRole("next.config.ts", "TypeScript")).toBe("config");
  });

  // ── Hardening: rc file CJS/MJS variants ──

  it("classifies .eslintrc.cjs as config", () => {
    expect(classifyRole(".eslintrc.cjs", "JavaScript")).toBe("config");
  });

  it("classifies .prettierrc.mjs as config", () => {
    expect(classifyRole(".prettierrc.mjs", "JavaScript")).toBe("config");
  });

  // ── Hardening: test directory boundaries ──

  it("does not misclassify test-utils as test dir", () => {
    expect(classifyRole("src/test-utils/helpers.ts", "TypeScript")).toBe("source");
  });

  it("classifies files in exact test/ dir as test", () => {
    expect(classifyRole("test/unit/app.ts", "TypeScript")).toBe("test");
  });

  it("classifies files in exact tests/ dir as test", () => {
    expect(classifyRole("tests/integration/api.ts", "TypeScript")).toBe("test");
  });

  it("classifies .spec.js as test", () => {
    expect(classifyRole("src/app.spec.js", "JavaScript")).toBe("test");
  });

  // ── Hardening: build role ──

  it("classifies GitHub Actions workflow as build", () => {
    expect(classifyRole(".github/workflows/ci.yml", "YAML")).toBe("build");
  });

  it("classifies root Makefile as config (build tool config)", () => {
    // Makefile is in CONFIG_FILENAMES — config takes priority over build
    expect(classifyRole("Makefile", "Makefile")).toBe("config");
  });

  it("classifies scripts dir files as build", () => {
    expect(classifyRole("scripts/deploy.sh", "Shell")).toBe("build");
  });

  // ── Convention: *.config.* build/tooling config not in the enumerated set ──

  it("classifies enumerated-miss configs as config via the *.config.* convention", () => {
    // None of these are in typescript.ts configFilenames, so before the
    // convention heuristic they fell through to the "source" role.
    expect(classifyRole("drizzle.config.ts", "TypeScript")).toBe("config");
    expect(classifyRole("playwright.config.ts", "TypeScript")).toBe("config");
    expect(classifyRole("tsup.config.ts", "TypeScript")).toBe("config");
    expect(classifyRole("cypress.config.js", "JavaScript")).toBe("config");
    expect(classifyRole("commitlint.config.cjs", "JavaScript")).toBe("config");
    expect(classifyRole("uno.config.mts", "TypeScript")).toBe("config");
  });

  it("applies the *.config.* convention regardless of directory depth", () => {
    expect(classifyRole("packages/web/vite.config.ts", "TypeScript")).toBe("config");
    expect(classifyRole("apps/site/astro.config.mjs", "JavaScript")).toBe("config");
  });

  it("matches config data extensions in the *.config.* convention", () => {
    expect(classifyRole("release.config.json", "JSON")).toBe("config");
    expect(classifyRole("renovate.config.yaml", "YAML")).toBe("config");
  });

  // ── Guardrails: the convention must not swallow genuine source files ──

  it("does not treat a source file named config.ts as config", () => {
    expect(classifyRole("src/config.ts", "TypeScript")).toBe("source");
  });

  it("does not match substrings like configuration.ts", () => {
    expect(classifyRole("src/configuration.ts", "TypeScript")).toBe("source");
  });

  it("does not match a hyphenated db-config.ts", () => {
    expect(classifyRole("src/db-config.ts", "TypeScript")).toBe("source");
  });
});

// ── deriveCategory ────────────────────────────────────────────────────────────

describe("deriveCategory", () => {
  it("returns 'root' for root files", () => {
    expect(deriveCategory("package.json")).toBe("root");
  });

  it("skips src prefix", () => {
    expect(deriveCategory("src/schema/v1.ts")).toBe("schema");
  });

  it("falls back to prefix chain when all segments are generic", () => {
    // lib and app are both generic prefixes, so with only util.ts left it uses the prefix chain
    expect(deriveCategory("lib/app/util.ts")).toBe("lib-app");
  });

  it("uses first non-generic segment for deep paths", () => {
    expect(deriveCategory("src/lib/analyzers/foo.ts")).toBe("analyzers");
  });

  it("handles file directly under generic prefix", () => {
    expect(deriveCategory("src/index.ts")).toBe("src");
  });
});

// ── isBinary ──────────────────────────────────────────────────────────────────

describe("isBinary", () => {
  it("returns false for text content", () => {
    expect(isBinary(Buffer.from("hello world\n"))).toBe(false);
  });

  it("returns true for buffer with null byte", () => {
    expect(isBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]))).toBe(true);
  });
});

// ── analyzeInventory integration ──────────────────────────────────────────────

describe("analyzeInventory", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("analyzes a temp directory with known files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(join(tmpDir, "package.json"), '{ "name": "test" }\n');
    await writeFile(join(tmpDir, "src", "app.ts"), 'console.log("hi");\n');
    await writeFile(join(tmpDir, "README.md"), "# Hello\n");

    // codeOnly:false to exercise language/role classification across non-code types.
    const inv = await analyzeInventory(tmpDir, { codeOnly: false });

    expect(inv.files).toHaveLength(3);
    expect(inv.summary.totalFiles).toBe(3);
    expect(inv.summary.byLanguage["TypeScript"]).toBe(1);
    expect(inv.summary.byLanguage["JSON"]).toBe(1);
    expect(inv.summary.byLanguage["Markdown"]).toBe(1);

    const tsFile = inv.files.find((f) => f.path === "src/app.ts");
    expect(tsFile).toBeDefined();
    expect(tsFile!.role).toBe("source");
    expect(tsFile!.language).toBe("TypeScript");
    expect(tsFile!.lineCount).toBe(1);
    expect(tsFile!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("excludes non-code files by default (codeOnly)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-codeonly-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(join(tmpDir, "package.json"), '{ "name": "test" }\n');
    await writeFile(join(tmpDir, "src", "app.ts"), 'console.log("hi");\n');
    await writeFile(join(tmpDir, "lib.py"), "x = 1\n");
    await writeFile(join(tmpDir, "README.md"), "# Hello\n");
    await writeFile(join(tmpDir, "logo.png"), "\x89PNG\r\n");
    await writeFile(join(tmpDir, "data.json"), "{}\n");

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path).sort();

    // Only program-code files survive the default code-only walk.
    expect(paths).toEqual(["lib.py", "src/app.ts"]);
  });

  it("includes extra extensions when configured (extraExtensions)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-extraext-"));
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "schema.proto"), "message M {}\n");
    await writeFile(join(tmpDir, "data.json"), "{}\n");

    const inv = await analyzeInventory(tmpDir, { extraExtensions: [".proto"] });
    const paths = inv.files.map((f) => f.path).sort();

    expect(paths).toEqual(["app.ts", "schema.proto"]);
  });

  it("inventories every file when codeOnly is false", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-all-"));
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "README.md"), "# Hello\n");
    await writeFile(join(tmpDir, "data.json"), "{}\n");

    const inv = await analyzeInventory(tmpDir, { codeOnly: false });
    const paths = inv.files.map((f) => f.path).sort();

    expect(paths).toEqual(["README.md", "app.ts", "data.json"]);
  });

  it("skips Python virtualenv directories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-venv-"));
    await writeFile(join(tmpDir, "pyproject.toml"), "[project]\nname='x'\n");
    await writeFile(join(tmpDir, "app.py"), "print('hi')\n");
    await mkdir(join(tmpDir, ".venv", "lib", "site-packages"), { recursive: true });
    await writeFile(join(tmpDir, ".venv", "lib", "site-packages", "dep.py"), "x = 1\n");

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("app.py");
    expect(paths.some((p) => p.includes("site-packages"))).toBe(false);
  });

  it("excludes vendor artifact directories from the inventory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-vendor-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "package.json"), '{ "name": "test" }\n');
    await writeFile(join(tmpDir, "src", "app.ts"), 'console.log("hi");\n');

    // Committed vendor artifacts (not gitignored) in a TS-primary repo.
    for (const [dir, file] of [
      ["vendor", "lib.js"],
      ["third_party", "dep.ts"],
      ["bower_components", "jquery.js"],
      ["jspm_packages", "pkg.js"],
    ] as const) {
      await mkdir(join(tmpDir, dir), { recursive: true });
      await writeFile(join(tmpDir, dir, file), "module.exports = {};\n");
    }

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("src/app.ts");
    expect(
      paths.some((p) =>
        /(?:^|\/)(vendor|third_party|bower_components|jspm_packages)\//.test(p),
      ),
    ).toBe(false);
  });

  it("does not over-exclude source that merely resembles vendor paths", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-vendor-guard-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    // Plural directory name — not the exact "vendor" convention.
    await mkdir(join(tmpDir, "vendors"), { recursive: true });
    await writeFile(join(tmpDir, "vendors", "registry.ts"), "export const x = 1;\n");
    // A genuine source file whose name contains "vendor".
    await writeFile(join(tmpDir, "src", "vendor-utils.ts"), "export const y = 2;\n");

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path).sort();

    expect(paths).toContain("src/vendor-utils.ts");
    expect(paths).toContain("vendors/registry.ts");
  });

  it("produces deterministic output across runs", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-det-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");
    await writeFile(join(tmpDir, "src", "b.ts"), "const b = 2;\n");

    const run1 = await analyzeInventory(tmpDir);
    const run2 = await analyzeInventory(tmpDir);

    expect(run1).toEqual(run2);
  });

  it("emits lastModified on file entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inv-mtime-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const inv = await analyzeInventory(tmpDir);
    const entry = inv.files.find((f) => f.path === "a.ts");
    expect(entry).toBeDefined();
    expect(entry!.lastModified).toBeTypeOf("number");
    expect(entry!.lastModified).toBeGreaterThan(0);
  });
});

// ── incremental ──────────────────────────────────────────────────────────────

describe("analyzeInventory (incremental)", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("reuses cached entries when no changes", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "a.ts"), "const a = 1;\n");
    await writeFile(join(tmpDir, "src", "b.ts"), "const b = 2;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    // Second run with previous — no changes
    const second = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;

    expect(second.stats).toBeDefined();
    expect(second.stats!.cached).toBe(2);
    expect(second.stats!.changed).toBe(0);
    expect(second.stats!.added).toBe(0);
    expect(second.stats!.deleted).toBe(0);
    expect(second.stats!.touched).toBe(0);
    expect(second.changedFiles?.size).toBe(0);

    // Output should have same file data
    expect(second.files.length).toBe(first.files.length);
    for (const f of second.files) {
      const prev = first.files.find((p) => p.path === f.path);
      expect(prev).toBeDefined();
      expect(f.hash).toBe(prev!.hash);
    }
  });

  it("detects changed files by mtime", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-change-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    // Wait a bit then modify file
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmpDir, "a.ts"), "const a = 2;\n");

    const second = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;

    expect(second.stats!.changed).toBe(1);
    expect(second.stats!.cached).toBe(0);
    expect(second.changedFiles?.has("a.ts")).toBe(true);
  });

  it("detects new files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-add-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    await writeFile(join(tmpDir, "b.ts"), "const b = 2;\n");

    const second = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;

    expect(second.stats!.added).toBe(1);
    expect(second.files.length).toBe(2);
    expect(second.changedFiles?.has("b.ts")).toBe(true);
  });

  it("detects deleted files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-del-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");
    await writeFile(join(tmpDir, "b.ts"), "const b = 2;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    await rm(join(tmpDir, "b.ts"));

    const second = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;

    expect(second.stats!.deleted).toBe(1);
    expect(second.files.length).toBe(1);
  });

  it("detects touched-but-unchanged files (mtime changed, content identical)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-touch-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    // Simulate `touch` — rewrite identical content after a short delay
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const second = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;

    expect(second.stats!.touched).toBe(1);
    expect(second.stats!.changed).toBe(0);
    expect(second.stats!.cached).toBe(0);
    // Touched files should NOT appear in changedFiles (downstream doesn't need to reprocess)
    expect(second.changedFiles?.has("a.ts")).toBe(false);
    // But hash should still be correct
    expect(second.files.find((f) => f.path === "a.ts")!.hash).toBe(
      first.files.find((f) => f.path === "a.ts")!.hash,
    );
  });

  it("invalidates cache when size changes even if mtime stays the same", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-size-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;
    const entry = first.files.find((f) => f.path === "a.ts")!;

    // Construct a fake previous inventory with matching mtime but wrong size
    const fakeEntry = { ...entry, size: entry.size + 100 };
    const fakePrev = { files: [fakeEntry], summary: first.summary };

    const second = await analyzeInventory(tmpDir, { previousInventory: fakePrev }) as InventoryResult;

    // Should NOT be cached since size doesn't match
    expect(second.stats!.cached).toBe(0);
    // File is touched (mtime matches via the real stat, content hash matches)
    // but was re-read due to size mismatch — exact classification depends on hash
    expect(second.files.find((f) => f.path === "a.ts")!.hash).toBe(entry.hash);
  });

  it("produces identical file data as full run for changed files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-inc-eq-"));
    await writeFile(join(tmpDir, "a.ts"), "const a = 1;\n");
    await writeFile(join(tmpDir, "b.ts"), "const b = 2;\n");

    const first = await analyzeInventory(tmpDir) as InventoryResult;

    // Modify one file
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmpDir, "a.ts"), "const a = 999;\n");

    const incremental = await analyzeInventory(tmpDir, { previousInventory: first }) as InventoryResult;
    const full = await analyzeInventory(tmpDir) as InventoryResult;

    // Files and summary should match (ignoring lastModified which both have)
    expect(incremental.files.length).toBe(full.files.length);
    for (const f of incremental.files) {
      const fullEntry = full.files.find((p) => p.path === f.path);
      expect(fullEntry).toBeDefined();
      expect(f.hash).toBe(fullEntry!.hash);
      expect(f.size).toBe(fullEntry!.size);
      expect(f.lineCount).toBe(fullEntry!.lineCount);
    }
    expect(incremental.summary).toEqual(full.summary);
  });
});

// ── IgnoreFilter unit tests ──────────────────────────────────────────────────

describe("IgnoreFilter", () => {
  it("ignores files matching a glob pattern", () => {
    const ig = new IgnoreFilter();
    ig.add("*.log");
    expect(ig.ignores("debug.log")).toBe(true);
    expect(ig.ignores("src/app.log")).toBe(true);
    expect(ig.ignores("src/app.ts")).toBe(false);
  });

  it("ignores directories with trailing slash pattern", () => {
    const ig = new IgnoreFilter();
    ig.add("logs/");
    expect(ig.ignores("logs/")).toBe(true);
    expect(ig.ignores("src/logs/")).toBe(true);
    // directory-only pattern should not match files
    expect(ig.ignores("logs")).toBe(false);
  });

  it("supports negation to un-ignore", () => {
    const ig = new IgnoreFilter();
    ig.add("*.log\n!important.log");
    expect(ig.ignores("debug.log")).toBe(true);
    expect(ig.ignores("important.log")).toBe(false);
  });

  it("anchored patterns only match from root", () => {
    const ig = new IgnoreFilter();
    ig.add("/build");
    expect(ig.ignores("build")).toBe(true);
    expect(ig.ignores("src/build")).toBe(false);
  });

  it("patterns with slash are anchored", () => {
    const ig = new IgnoreFilter();
    ig.add("src/generated");
    expect(ig.ignores("src/generated")).toBe(true);
    expect(ig.ignores("lib/src/generated")).toBe(false);
  });

  it("supports ** glob for directories", () => {
    const ig = new IgnoreFilter();
    ig.add("src/**/temp");
    expect(ig.ignores("src/temp")).toBe(true);
    expect(ig.ignores("src/foo/temp")).toBe(true);
    expect(ig.ignores("src/foo/bar/temp")).toBe(true);
  });

  it("supports ? single-char wildcard", () => {
    const ig = new IgnoreFilter();
    ig.add("file?.txt");
    expect(ig.ignores("file1.txt")).toBe(true);
    expect(ig.ignores("fileA.txt")).toBe(true);
    expect(ig.ignores("file12.txt")).toBe(false);
  });

  it("skips comments and blank lines", () => {
    const ig = new IgnoreFilter();
    ig.add("# this is a comment\n\n   \n*.log");
    expect(ig.ignores("debug.log")).toBe(true);
    expect(ig.ignores("app.ts")).toBe(false);
  });

  it("last matching rule wins", () => {
    const ig = new IgnoreFilter();
    ig.add("*.log\n!*.log\n*.log");
    expect(ig.ignores("debug.log")).toBe(true);
  });
});

// ── loadIgnoreFilter + analyzeInventory integration ──────────────────────────

describe("ignore file integration", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it(".gitignore patterns are respected", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, ".gitignore"), "*.log\nlogs/\n");
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "debug.log"), "log data\n");
    await mkdir(join(tmpDir, "logs"), { recursive: true });
    await writeFile(join(tmpDir, "logs", "out.txt"), "log\n");

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("debug.log");
    expect(paths).not.toContain("logs/out.txt");
  });

  it(".sourcevisionignore patterns are respected", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, ".sourcevisionignore"), "*.dat\n");
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "data.dat"), "binary\n");

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("data.dat");
  });

  it(".sourcevisionignore negation overrides .gitignore", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, ".gitignore"), "*.log\n");
    await writeFile(join(tmpDir, ".sourcevisionignore"), "!important.log\n");
    await writeFile(join(tmpDir, "debug.log"), "ignore me\n");
    await writeFile(join(tmpDir, "important.log"), "keep me\n");

    // codeOnly:false so the assertion isolates ignore-filter behavior from the
    // code-only walk (which would otherwise drop the non-code .log files).
    const inv = await analyzeInventory(tmpDir, { codeOnly: false });
    const paths = inv.files.map((f) => f.path);

    expect(paths).not.toContain("debug.log");
    expect(paths).toContain("important.log");
  });

  it("works when no ignore files exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "data.log"), "log\n");

    const inv = await analyzeInventory(tmpDir, { codeOnly: false });
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("app.ts");
    expect(paths).toContain("data.log");
  });

  it("expanded SKIP_DIRS entries are skipped", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    for (const dir of [".next", "coverage", ".react-router", ".turbo"]) {
      await mkdir(join(tmpDir, dir), { recursive: true });
      await writeFile(join(tmpDir, dir, "file.js"), "skip\n");
    }

    const inv = await analyzeInventory(tmpDir);
    const paths = inv.files.map((f) => f.path);

    expect(paths).toContain("app.ts");
    expect(paths).not.toContain(".next/file.js");
    expect(paths).not.toContain("coverage/file.js");
    expect(paths).not.toContain(".react-router/file.js");
    expect(paths).not.toContain(".turbo/file.js");
  });

  it("loadIgnoreFilter handles comments and blank lines", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ig-"));
    await writeFile(join(tmpDir, ".gitignore"), "# comment\n\n*.log\n   \n");
    await writeFile(join(tmpDir, "app.ts"), "code\n");
    await writeFile(join(tmpDir, "debug.log"), "log\n");

    const ig = await loadIgnoreFilter(tmpDir);
    expect(ig.ignores("debug.log")).toBe(true);
    expect(ig.ignores("app.ts")).toBe(false);
  });
});
