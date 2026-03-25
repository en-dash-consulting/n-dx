import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanTests, scanDocs, scanSourceVision, scanPackageJson } from "../../../src/analyze/scanners.js";

describe("scanTests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-tests-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("emits summary features grouped by epic, not individual tasks", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "login.test.ts"),
      `
describe("Login Flow", () => {
  it("validates email format", () => {});
  it("handles invalid credentials", () => {});
});
`,
    );

    const results = await scanTests(tempDir);

    // Should emit one summary feature, NOT individual tasks for each test case
    const features = results.filter((r) => r.kind === "feature");
    const tasks = results.filter((r) => r.kind === "task");

    expect(features.length).toBe(1);
    expect(features[0].name).toBe("General Tests");
    expect(features[0].description).toContain("1 test file");

    // No individual test tasks — tests are part of workflow, not standalone tasks
    expect(tasks.length).toBe(0);
  });

  it("groups by directory to infer epic names", async () => {
    await mkdir(join(tempDir, "tests", "e2e", "auth"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "e2e", "auth", "login.test.ts"),
      `
describe("Login", () => {
  it("works", () => {});
});
`,
    );

    const results = await scanTests(tempDir);
    const feature = results.find((r) => r.kind === "feature");
    expect(feature?.tags).toContain("Auth");
    expect(feature?.name).toBe("Auth Tests");
  });

  it("groups multiple test files under the same epic", async () => {
    await mkdir(join(tempDir, "tests", "auth"), { recursive: true });
    await writeFile(join(tempDir, "tests", "auth", "login.test.ts"), `test("a", () => {});`);
    await writeFile(join(tempDir, "tests", "auth", "logout.test.ts"), `test("b", () => {});`);
    await writeFile(join(tempDir, "tests", "auth", "session.test.ts"), `test("c", () => {});`);

    const results = await scanTests(tempDir);

    // Should have one feature summarizing all auth tests
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Auth Tests");
    expect(results[0].description).toContain("3 test files");
  });

  it("handles spec files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "utils.spec.js"),
      `
test("adds numbers", () => {});
`,
    );

    const results = await scanTests(tempDir);
    // Should emit a feature summarizing coverage, not individual task
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("feature");
    expect(results[0].name).toBe("Src Tests");
  });

  it("handles __tests__ directory", async () => {
    await mkdir(join(tempDir, "src", "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "__tests__", "helper.ts"),
      `
describe("Helper", () => {
  it("formats dates", () => {});
});
`,
    );

    const results = await scanTests(tempDir);
    // Feature summarizing coverage, not individual tasks
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("feature");
    expect(results[0].name).toBe("Src Tests");
  });

  it("returns empty for directory with no test files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "index.ts"), "export const x = 1;");

    const results = await scanTests(tempDir);
    expect(results).toEqual([]);
  });

  it("groups test files from multiple epics", async () => {
    await mkdir(join(tempDir, "tests", "auth"), { recursive: true });
    await mkdir(join(tempDir, "tests", "api"), { recursive: true });
    await writeFile(join(tempDir, "tests", "auth", "login.test.ts"), `test("a", () => {});`);
    await writeFile(join(tempDir, "tests", "api", "routes.test.ts"), `test("b", () => {});`);

    const results = await scanTests(tempDir);

    // Should have two features, one per epic
    expect(results.length).toBe(2);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["Api Tests", "Auth Tests"]);
  });
});

describe("scanDocs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-docs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts markdown headings and bullets", async () => {
    await writeFile(
      join(tempDir, "features.md"),
      `# Auth System
- Login with email
- Password reset

# Dashboard
- Charts
`,
    );

    const results = await scanDocs(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Auth System")).toBe(true);
    expect(features.some((f) => f.name === "Dashboard")).toBe(true);

    const authFeature = features.find((f) => f.name === "Auth System");
    expect(authFeature?.acceptanceCriteria).toEqual([
      "Login with email",
      "Password reset",
    ]);

    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name === "Login with email")).toBe(true);
    expect(tasks.some((t) => t.name === "Password reset")).toBe(true);
    expect(tasks.some((t) => t.name === "Charts")).toBe(true);
  });

  it("extracts items from JSON with title fields", async () => {
    await writeFile(
      join(tempDir, "features.json"),
      JSON.stringify([
        { title: "User Management", description: "CRUD for users" },
        { title: "Reporting", description: "Generate reports" },
      ]),
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "User Management")).toBe(true);
    expect(results.some((r) => r.name === "Reporting")).toBe(true);
    expect(results.find((r) => r.name === "User Management")?.description).toBe(
      "CRUD for users",
    );
  });

  it("extracts items from JSON with name fields", async () => {
    await writeFile(
      join(tempDir, "items.json"),
      JSON.stringify({ items: [{ name: "Feature A" }, { name: "Feature B" }] }),
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "Feature A")).toBe(true);
    expect(results.some((r) => r.name === "Feature B")).toBe(true);
  });

  it("extracts items from YAML", async () => {
    await writeFile(
      join(tempDir, "plan.yaml"),
      `
title: Authentication
description: Handle user auth

title: API Gateway
description: Route requests
`,
    );

    const results = await scanDocs(tempDir);
    expect(results.some((r) => r.name === "Authentication")).toBe(true);
    expect(results.some((r) => r.name === "API Gateway")).toBe(true);
  });

  it("skips node_modules and .git directories", async () => {
    await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(tempDir, "node_modules", "pkg", "README.md"),
      "# Package\n- stuff",
    );

    const results = await scanDocs(tempDir);
    expect(results).toEqual([]);
  });

  it("lite mode uses filenames only", async () => {
    await writeFile(
      join(tempDir, "auth-flow.md"),
      "# Auth\n- Login\n- Logout",
    );

    const results = await scanDocs(tempDir, { lite: true });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Auth Flow");
    expect(results[0].kind).toBe("feature");
  });

  it("skips README and CHANGELOG in lite mode", async () => {
    await writeFile(join(tempDir, "README.md"), "# Project");
    await writeFile(join(tempDir, "CHANGELOG.md"), "# Changes");

    const results = await scanDocs(tempDir, { lite: true });
    expect(results).toEqual([]);
  });

  it("skips lockfiles", async () => {
    await writeFile(
      join(tempDir, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
    );
    await writeFile(
      join(tempDir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await writeFile(
      join(tempDir, "yarn.lock"),
      "# yarn lockfile v1\n",
    );
    // Real doc should still come through
    await writeFile(
      join(tempDir, "design.md"),
      "# Design\n- Decision A\n",
    );

    const results = await scanDocs(tempDir);
    expect(results.every((r) => !r.sourceFile.includes("lock"))).toBe(true);
    expect(results.some((r) => r.name === "Design")).toBe(true);
  });

  it("skips generated output directories like build/ and out/", async () => {
    await mkdir(join(tempDir, "build"), { recursive: true });
    await mkdir(join(tempDir, "out"), { recursive: true });
    await mkdir(join(tempDir, ".hench"), { recursive: true });
    await writeFile(join(tempDir, "build", "output.md"), "# Generated\n- item");
    await writeFile(join(tempDir, "out", "bundle.json"), '{"name":"x"}');
    await writeFile(join(tempDir, ".hench", "run.json"), '{"name":"run"}');
    // Real doc should still come through
    await writeFile(join(tempDir, "roadmap.md"), "# Roadmap\n- Milestone 1\n");

    const results = await scanDocs(tempDir);
    expect(results.every((r) => !r.sourceFile.startsWith("build/"))).toBe(true);
    expect(results.every((r) => !r.sourceFile.startsWith("out/"))).toBe(true);
    expect(results.every((r) => !r.sourceFile.startsWith(".hench/"))).toBe(true);
    expect(results.some((r) => r.name === "Roadmap")).toBe(true);
  });

  it("accepts custom ignorePatterns to skip additional paths", async () => {
    await mkdir(join(tempDir, "vendor"), { recursive: true });
    await writeFile(join(tempDir, "vendor", "third-party.md"), "# Vendor\n- stuff");
    await writeFile(join(tempDir, "api-spec.md"), "# API\n- endpoint");

    const results = await scanDocs(tempDir, { ignorePatterns: ["vendor/"] });
    expect(results.every((r) => !r.sourceFile.startsWith("vendor/"))).toBe(true);
    expect(results.some((r) => r.name === "API")).toBe(true);
  });

  it("skips auto-generated files by name pattern", async () => {
    await writeFile(
      join(tempDir, "tsconfig.json"),
      '{"compilerOptions":{}}',
    );
    await writeFile(
      join(tempDir, ".eslintrc.json"),
      '{"rules":{}}',
    );
    await writeFile(
      join(tempDir, "features.md"),
      "# Features\n- Feature A\n",
    );

    const results = await scanDocs(tempDir);
    expect(results.every((r) => !r.sourceFile.includes("tsconfig"))).toBe(true);
    expect(results.every((r) => !r.sourceFile.includes("eslintrc"))).toBe(true);
    expect(results.some((r) => r.name === "Features")).toBe(true);
  });

  it("extracts numbered list items as bullets", async () => {
    await writeFile(
      join(tempDir, "roadmap.md"),
      `# Phase 1
1. Build core API
2. Add authentication
3. Deploy to staging

# Phase 2
- Monitoring dashboard
`,
    );

    const results = await scanDocs(tempDir);

    const phase1 = results.find(
      (r) => r.kind === "feature" && r.name === "Phase 1",
    );
    expect(phase1).toBeDefined();
    expect(phase1!.acceptanceCriteria).toEqual([
      "Build core API",
      "Add authentication",
      "Deploy to staging",
    ]);

    // Numbered items should also become tasks
    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name === "Build core API")).toBe(true);
    expect(tasks.some((t) => t.name === "Add authentication")).toBe(true);
    expect(tasks.some((t) => t.name === "Deploy to staging")).toBe(true);
    // Dash bullets still work
    expect(tasks.some((t) => t.name === "Monitoring dashboard")).toBe(true);
  });

  it("cleans markdown formatting from headings", async () => {
    await writeFile(
      join(tempDir, "spec.md"),
      `# **Bold Heading**
- item A

## [Link Heading](https://example.com)
- item B

### \`Code Heading\`
- item C
`,
    );

    const results = await scanDocs(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Bold Heading")).toBe(true);
    expect(features.some((f) => f.name === "Link Heading")).toBe(true);
    expect(features.some((f) => f.name === "Code Heading")).toBe(true);

    // Should NOT contain markdown syntax
    expect(features.every((f) => !f.name.includes("**"))).toBe(true);
    expect(features.every((f) => !f.name.includes("["))).toBe(true);
    expect(features.every((f) => !f.name.includes("`"))).toBe(true);
  });

  it("ignores bullets inside fenced code blocks", async () => {
    await writeFile(
      join(tempDir, "guide.md"),
      `# Installation
- Run the installer

\`\`\`bash
# This is a comment
- not a real bullet
* also not a bullet
\`\`\`

# Usage
- Import the module
`,
    );

    const results = await scanDocs(tempDir);

    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name === "Run the installer")).toBe(true);
    expect(tasks.some((t) => t.name === "Import the module")).toBe(true);
    // Code block content should NOT produce tasks
    expect(tasks.some((t) => t.name === "not a real bullet")).toBe(false);
    expect(tasks.some((t) => t.name === "also not a bullet")).toBe(false);
    expect(tasks.length).toBe(2);
  });
});

describe("scanSourceVision", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-sv-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads zone data and maps to features with file counts", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "auth",
            name: "Authentication",
            description: "Auth module",
            files: ["src/auth/login.ts", "src/auth/session.ts"],
            entryPoints: ["src/auth/login.ts"],
            cohesion: 0.85,
            coupling: 0.2,
            insights: ["Uses JWT tokens", "Session management"],
          },
        ],
        findings: [
          {
            type: "anti-pattern",
            pass: 1,
            scope: "auth",
            text: "Hardcoded secret in config",
            severity: "critical",
            related: ["src/auth/config.ts"],
          },
          {
            type: "suggestion",
            pass: 2,
            scope: "auth",
            text: "Missing rate limit on login endpoint",
            severity: "warning",
            related: ["src/auth/login.ts"],
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Authentication")).toBe(true);
    const authFeature = features.find((f) => f.name === "Authentication")!;
    expect(authFeature.acceptanceCriteria).toEqual([
      "Uses JWT tokens",
      "Session management",
    ]);
    // Feature description includes file count
    expect(authFeature.description).toContain("2 files");

    const tasks = results.filter((r) => r.kind === "task");
    // Tasks have actionable prefixes based on finding type
    const criticalTask = tasks.find((t) => t.name.includes("Hardcoded secret in config"));
    expect(criticalTask).toBeDefined();
    expect(criticalTask!.name).toMatch(/^Fix:/);
    expect(criticalTask!.priority).toBe("critical");
    // Tasks include related file paths
    expect(criticalTask!.sourceFile).toBe("src/auth/config.ts");

    const warningTask = tasks.find((t) => t.name.includes("Missing rate limit"));
    expect(warningTask).toBeDefined();
    expect(warningTask!.name).toMatch(/^Implement:/);
    expect(warningTask!.priority).toBe("high");
    expect(warningTask!.sourceFile).toBe("src/auth/login.ts");
    expect(warningTask!.tags).toContain("Authentication");
  });

  it("maps finding types to actionable prefixes", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "core",
            name: "Core",
            description: "Core module",
            files: ["src/core.ts"],
            entryPoints: [],
            cohesion: 0.9,
            coupling: 0.1,
          },
        ],
        findings: [
          { type: "anti-pattern", pass: 1, scope: "core", text: "God object detected", severity: "warning" },
          { type: "suggestion", pass: 1, scope: "core", text: "Add input validation", severity: "warning" },
          { type: "anti-pattern", pass: 1, scope: "core", text: "Security vulnerability", severity: "critical" },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    // anti-pattern → "Fix:", suggestion → "Implement:"
    expect(tasks.find((t) => t.name === "Fix: God object detected")).toBeDefined();
    expect(tasks.find((t) => t.name === "Implement: Add input validation")).toBeDefined();
    expect(tasks.find((t) => t.name === "Fix: Security vulnerability")).toBeDefined();
  });

  it("includes acceptance criteria with file paths on tasks", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "utils",
            name: "Utilities",
            description: "Shared utils",
            files: ["src/utils/format.ts", "src/utils/validate.ts"],
            entryPoints: [],
            cohesion: 0.7,
            coupling: 0.3,
          },
        ],
        findings: [
          {
            type: "anti-pattern",
            pass: 2,
            scope: "utils",
            text: "Duplicated validation logic",
            severity: "warning",
            related: ["src/utils/format.ts", "src/utils/validate.ts"],
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("Duplicated validation"));
    expect(task).toBeDefined();
    // Acceptance criteria includes affected file paths
    expect(task!.acceptanceCriteria).toBeDefined();
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("src/utils/format.ts"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("src/utils/validate.ts"))).toBe(true);
  });

  it("handles legacy zone format (flat array)", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify([
        {
          name: "Authentication",
          description: "Auth module",
          insights: ["Uses JWT tokens"],
          findings: [
            { severity: "critical", message: "Hardcoded secret" },
          ],
        },
      ]),
    );

    const { results } = await scanSourceVision(tempDir);

    const features = results.filter((r) => r.kind === "feature");
    expect(features.some((f) => f.name === "Authentication")).toBe(true);

    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.some((t) => t.name.includes("Hardcoded secret"))).toBe(true);
    expect(tasks[0].priority).toBe("critical");
  });

  it("reads inventory.json with canonical schema for epic groupings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "inventory.json"),
      JSON.stringify({
        files: [
          { path: "src/components/Button.tsx", category: "components", role: "source" },
          { path: "src/components/Input.tsx", category: "components", role: "source" },
          { path: "src/services/api.ts", category: "services", role: "source" },
        ],
        summary: { totalFiles: 3 },
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const epics = results.filter((r) => r.kind === "epic");
    expect(epics.some((e) => e.name === "Components")).toBe(true);
    expect(epics.some((e) => e.name === "Services")).toBe(true);
    // Epics include file count in description
    const compEpic = epics.find((e) => e.name === "Components")!;
    expect(compEpic.description).toContain("2 files");
    const svcEpic = epics.find((e) => e.name === "Services")!;
    expect(svcEpic.description).toContain("1 file");
  });

  it("reads inventory.json with legacy byCategory format", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "inventory.json"),
      JSON.stringify({
        byCategory: {
          components: { count: 10 },
          services: { count: 5 },
        },
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const epics = results.filter((r) => r.kind === "epic");
    expect(epics.some((e) => e.name === "Components")).toBe(true);
    expect(epics.some((e) => e.name === "Services")).toBe(true);
  });

  it("reads imports.json with canonical schema for circular dependencies", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        edges: [],
        external: [],
        summary: {
          totalEdges: 10,
          totalExternal: 3,
          circularCount: 1,
          circulars: [
            { cycle: ["src/moduleA.ts", "src/moduleB.ts", "src/moduleA.ts"] },
          ],
          mostImported: [],
          avgImportsPerFile: 2,
        },
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("src/moduleA.ts");
    expect(circulars[0].name).toContain("src/moduleB.ts");
    expect(circulars[0].priority).toBe("high");
    // Acceptance criteria lists files in the cycle
    expect(circulars[0].acceptanceCriteria).toBeDefined();
    expect(circulars[0].acceptanceCriteria!.some((c: string) => c.includes("src/moduleA.ts"))).toBe(true);
  });

  it("reads imports.json with legacy circularDependencies format", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        circularDependencies: [
          { from: "moduleA", to: "moduleB" },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("moduleA");
    expect(circulars[0].name).toContain("moduleB");
    expect(circulars[0].priority).toBe("high");
  });

  it("reads imports.json with legacy circular array format", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        circular: [["A", "B", "A"]],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("A");
  });

  it("returns empty when no .sourcevision directory", async () => {
    const { results } = await scanSourceVision(tempDir);
    expect(results).toEqual([]);
  });

  it("returns partial results when some files are missing", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    // Only zones.json, no inventory or imports
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "core",
            name: "Core",
            description: "Core module",
            files: ["src/core.ts"],
            entryPoints: [],
            cohesion: 0.9,
            coupling: 0.1,
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name === "Core")).toBe(true);
  });

  it("only includes actionable warning/critical findings as tasks", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "core",
            name: "Core",
            description: "Core module",
            files: ["src/core.ts"],
            entryPoints: [],
            cohesion: 0.9,
            coupling: 0.1,
          },
        ],
        findings: [
          // Informational types — skipped regardless of severity
          { type: "observation", pass: 0, scope: "core", text: "High cohesion (0.9)", severity: "warning" },
          { type: "relationship", pass: 0, scope: "core", text: "Depends on utils zone", severity: "warning" },
          { type: "pattern", pass: 1, scope: "core", text: "Uses factory pattern", severity: "warning" },
          // Info severity — skipped even for actionable types
          { type: "suggestion", pass: 1, scope: "core", text: "Consider adding tests", severity: "info" },
          { type: "anti-pattern", pass: 1, scope: "core", text: "Minor code smell", severity: "info" },
          // Actionable types with warning/critical — these become tasks
          { type: "anti-pattern", pass: 1, scope: "core", text: "Bad pattern detected", severity: "warning" },
          { type: "suggestion", pass: 2, scope: "core", text: "Add input validation", severity: "warning" },
          { type: "anti-pattern", pass: 1, scope: "core", text: "Critical security issue", severity: "critical" },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    // Only anti-patterns and suggestions with warning/critical severity become tasks
    expect(tasks.length).toBe(3);
    expect(tasks.some((t) => t.name.includes("Bad pattern detected"))).toBe(true);
    expect(tasks.some((t) => t.name.includes("Add input validation"))).toBe(true);
    expect(tasks.some((t) => t.name.includes("Critical security issue"))).toBe(true);

    // Verify priorities
    const warning = tasks.find((t) => t.name.includes("Bad pattern detected"));
    expect(warning?.priority).toBe("high");
    const critical = tasks.find((t) => t.name.includes("Critical security issue"));
    expect(critical?.priority).toBe("critical");
  });

  it("includes concrete fix suggestions based on finding patterns", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "core",
            name: "Core",
            description: "Core module",
            files: ["src/core.ts"],
            entryPoints: ["src/core.ts"],
            cohesion: 0.7,
            coupling: 0.3,
          },
        ],
        findings: [
          {
            type: "anti-pattern",
            pass: 1,
            scope: "core",
            text: "Bidirectional coupling between modules",
            severity: "warning",
            related: ["src/moduleA.ts", "src/moduleB.ts"],
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("Bidirectional"));
    expect(task).toBeDefined();
    expect(task!.acceptanceCriteria).toBeDefined();
    // Should include fix suggestions
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("Suggested fixes:"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("interfaces") || c.includes("types"))).toBe(true);
  });

  it("includes zone entry points in acceptance criteria", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "api",
            name: "API",
            description: "API layer",
            files: ["src/api/routes.ts", "src/api/handlers.ts"],
            entryPoints: ["src/api/routes.ts"],
            cohesion: 0.8,
            coupling: 0.2,
          },
        ],
        findings: [
          {
            type: "suggestion",
            pass: 2,
            scope: "api",
            text: "Add input validation middleware",
            severity: "warning",
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("validation middleware"));
    expect(task).toBeDefined();
    // Should include entry points
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("Entry points:"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("src/api/routes.ts"))).toBe(true);
  });

  it("includes zone metrics in acceptance criteria", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "utils",
            name: "Utils",
            description: "Utility functions",
            files: ["src/utils.ts"],
            entryPoints: [],
            cohesion: 0.95,
            coupling: 0.05,
          },
        ],
        findings: [
          {
            type: "suggestion",
            pass: 1,
            scope: "utils",
            text: "Low coupling indicates good isolation",
            severity: "warning",
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("Low coupling"));
    expect(task).toBeDefined();
    // Should include zone metrics
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("cohesion: 0.95"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("coupling: 0.05"))).toBe(true);
  });

  it("provides fix suggestions for duplication findings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "core",
            name: "Core",
            description: "Core module",
            files: ["src/core.ts"],
            entryPoints: [],
            cohesion: 0.9,
            coupling: 0.1,
          },
        ],
        findings: [
          {
            type: "anti-pattern",
            pass: 2,
            scope: "core",
            text: "Duplicated sorting logic in multiple files",
            severity: "warning",
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("Duplicated"));
    expect(task).toBeDefined();
    // Should suggest extracting to utility
    expect(task!.acceptanceCriteria!.some((c: string) => c.toLowerCase().includes("extract"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.toLowerCase().includes("shared") || c.toLowerCase().includes("utility"))).toBe(true);
  });

  it("provides fix suggestions for god object findings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "main",
            name: "Main",
            description: "Main module",
            files: Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`),
            entryPoints: [],
            cohesion: 0.6,
            coupling: 0.4,
          },
        ],
        findings: [
          {
            type: "anti-pattern",
            pass: 3,
            scope: "main",
            text: "God module with too many responsibilities",
            severity: "critical",
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("God module"));
    expect(task).toBeDefined();
    // Should suggest splitting
    expect(task!.acceptanceCriteria!.some((c: string) => c.toLowerCase().includes("split"))).toBe(true);
    // Should mention current file count since zone has >20 files
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("25 files"))).toBe(true);
  });

  it("includes zone files when no related files specified", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "small",
            name: "Small",
            description: "Small zone",
            files: ["src/a.ts", "src/b.ts", "src/c.ts"],
            entryPoints: ["src/a.ts"],
            cohesion: 0.9,
            coupling: 0.1,
          },
        ],
        findings: [
          {
            type: "suggestion",
            pass: 1,
            scope: "small",
            text: "Consider adding documentation",
            severity: "warning",
            // No related field
          },
        ],
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const task = results.find((r) => r.kind === "task" && r.name.includes("documentation"));
    expect(task).toBeDefined();
    // Should include zone files since no explicit related files
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("Zone files:"))).toBe(true);
    expect(task!.acceptanceCriteria!.some((c: string) => c.includes("src/a.ts"))).toBe(true);
  });

  it("provides fix suggestions for circular dependency imports", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tempDir, ".sourcevision", "imports.json"),
      JSON.stringify({
        edges: [],
        external: [],
        summary: {
          totalEdges: 5,
          totalExternal: 2,
          circularCount: 1,
          circulars: [
            { cycle: ["src/moduleA.ts", "src/moduleB.ts", "src/moduleA.ts"] },
          ],
          mostImported: [],
          avgImportsPerFile: 2,
        },
      }),
    );

    const { results } = await scanSourceVision(tempDir);
    const circular = results.find((r) => r.name.startsWith("Resolve circular"));
    expect(circular).toBeDefined();
    // Should include fix suggestions for circular deps
    expect(circular!.acceptanceCriteria!.some((c: string) => c.includes("Suggested fixes:"))).toBe(true);
    expect(circular!.acceptanceCriteria!.some((c: string) => c.toLowerCase().includes("extract") || c.toLowerCase().includes("common"))).toBe(true);
    expect(circular!.acceptanceCriteria!.some((c: string) => c.toLowerCase().includes("dependency injection") || c.toLowerCase().includes("invert"))).toBe(true);
  });

  it("skips stale findings whose related files no longer exist", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });

    // Inventory knows about src/core.ts but NOT src/deleted.ts
    await writeFile(
      join(tempDir, ".sourcevision", "inventory.json"),
      JSON.stringify({
        files: [
          { path: "src/core.ts", category: "source", role: "source" },
        ],
      }),
    );

    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [{ id: "core", name: "Core", description: "Core", files: ["src/core.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 }],
        findings: [
          // This finding references a file that still exists — should be kept
          { type: "anti-pattern", pass: 1, scope: "core", text: "Issue in core", severity: "warning", related: ["src/core.ts"] },
          // This finding references only deleted files — should be stale
          { type: "anti-pattern", pass: 1, scope: "core", text: "Issue in deleted module", severity: "warning", related: ["src/deleted.ts"] },
        ],
      }),
    );

    const { results, staleCount } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toContain("Issue in core");
    expect(staleCount).toBe(1);
  });

  it("skips stale move-file findings when source file is gone", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });

    await writeFile(
      join(tempDir, ".sourcevision", "inventory.json"),
      JSON.stringify({
        files: [
          { path: "src/existing.ts", category: "source", role: "source" },
        ],
      }),
    );

    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [{ id: "core", name: "Core", description: "Core", files: ["src/existing.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 }],
        findings: [
          { type: "move-file", pass: 0, scope: "core", text: "Move deleted.ts to lib/", severity: "info", from: "src/deleted.ts", to: "lib/deleted.ts" },
          { type: "move-file", pass: 0, scope: "core", text: "Move existing.ts to lib/", severity: "info", from: "src/existing.ts", to: "lib/existing.ts" },
        ],
      }),
    );

    const { results, staleCount } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toContain("existing.ts");
    expect(staleCount).toBe(1);
  });

  it("does not mark findings as stale when inventory is missing", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    // No inventory.json — staleness check should be skipped

    await writeFile(
      join(tempDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        zones: [{ id: "core", name: "Core", description: "Core", files: ["src/core.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 }],
        findings: [
          { type: "anti-pattern", pass: 1, scope: "core", text: "Some issue", severity: "warning", related: ["src/nonexistent.ts"] },
        ],
      }),
    );

    const { results, staleCount } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    // Without inventory, no staleness check — finding should pass through
    expect(tasks.length).toBe(1);
    expect(staleCount).toBe(0);
  });
});

describe("scanPackageJson", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-pkg-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts scripts as tasks", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        scripts: {
          build: "tsc",
          test: "vitest",
          lint: "eslint .",
          "dev": "vite",
        },
      }),
    );

    const results = await scanPackageJson(tempDir);

    const tasks = results.filter((r) => r.kind === "task" && r.tags?.includes("scripts"));
    expect(tasks.length).toBe(4);
    expect(tasks.some((t) => t.name === 'Script: build' && t.description === "tsc")).toBe(true);
    expect(tasks.some((t) => t.name === 'Script: test' && t.description === "vitest")).toBe(true);
    expect(tasks.some((t) => t.name === 'Script: lint')).toBe(true);
    expect(tasks.some((t) => t.name === 'Script: dev')).toBe(true);
    // All script tasks should have source "package"
    expect(tasks.every((t) => t.source === "package")).toBe(true);
  });

  it("extracts dependencies as features", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        dependencies: {
          react: "^18.2.0",
          "react-dom": "^18.2.0",
        },
        devDependencies: {
          vitest: "^1.0.0",
          typescript: "^5.3.0",
        },
      }),
    );

    const results = await scanPackageJson(tempDir);

    const depFeature = results.find((r) => r.kind === "feature" && r.name === "Dependencies");
    expect(depFeature).toBeDefined();
    expect(depFeature!.description).toContain("2 production");

    const devDepFeature = results.find((r) => r.kind === "feature" && r.name === "Dev Dependencies");
    expect(devDepFeature).toBeDefined();
    expect(devDepFeature!.description).toContain("2 dev");
  });

  it("notes engine requirements", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        engines: {
          node: ">=18.0.0",
          npm: ">=9.0.0",
        },
      }),
    );

    const results = await scanPackageJson(tempDir);

    const engineTasks = results.filter((r) => r.kind === "task" && r.tags?.includes("engines"));
    expect(engineTasks.length).toBe(2);
    expect(engineTasks.some((t) => t.name === "Engine: node >=18.0.0")).toBe(true);
    expect(engineTasks.some((t) => t.name === "Engine: npm >=9.0.0")).toBe(true);
  });

  it("scans nested package.json in subdirectories", async () => {
    await mkdir(join(tempDir, "packages", "lib"), { recursive: true });
    await writeFile(
      join(tempDir, "packages", "lib", "package.json"),
      JSON.stringify({
        name: "@scope/lib",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );

    const results = await scanPackageJson(tempDir);

    const tasks = results.filter((r) => r.kind === "task" && r.tags?.includes("scripts"));
    expect(tasks.length).toBe(2);
    expect(tasks[0].sourceFile).toBe("packages/lib/package.json");
  });

  it("creates a project epic from root package.json", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-awesome-app",
        description: "An awesome application",
        scripts: { build: "tsc" },
      }),
    );

    const results = await scanPackageJson(tempDir);

    const epic = results.find((r) => r.kind === "epic");
    expect(epic).toBeDefined();
    expect(epic!.name).toBe("my-awesome-app");
    expect(epic!.description).toBe("An awesome application");
  });

  it("returns empty when no package.json exists", async () => {
    const results = await scanPackageJson(tempDir);
    expect(results).toEqual([]);
  });

  it("skips node_modules directories", async () => {
    await mkdir(join(tempDir, "node_modules", "react"), { recursive: true });
    await writeFile(
      join(tempDir, "node_modules", "react", "package.json"),
      JSON.stringify({ name: "react", scripts: { build: "tsc" } }),
    );

    const results = await scanPackageJson(tempDir);
    expect(results).toEqual([]);
  });

  it("handles malformed package.json gracefully", async () => {
    await writeFile(join(tempDir, "package.json"), "{ invalid json }");

    const results = await scanPackageJson(tempDir);
    expect(results).toEqual([]);
  });

  it("lite mode emits only file-level features", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        scripts: { build: "tsc", test: "vitest" },
        dependencies: { react: "^18.0.0" },
        engines: { node: ">=18" },
      }),
    );

    const results = await scanPackageJson(tempDir, { lite: true });

    // Lite mode: just a feature per package.json, no detailed breakdown
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("feature");
    expect(results[0].name).toBe("my-app");
    expect(results[0].source).toBe("package");
  });

  it("handles package.json with no scripts, dependencies, or engines", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "minimal-pkg", version: "1.0.0" }),
    );

    const results = await scanPackageJson(tempDir);

    // Should still emit a project epic for the root
    const epic = results.find((r) => r.kind === "epic");
    expect(epic).toBeDefined();
    expect(epic!.name).toBe("minimal-pkg");
    // No tasks since no scripts/engines
    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.length).toBe(0);
  });
});
