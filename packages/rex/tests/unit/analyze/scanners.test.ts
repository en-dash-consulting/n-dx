import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanTests, scanDocs, scanSourceVision } from "../../../src/analyze/scanners.js";

describe("scanTests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-tests-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts describe and it blocks from test files", async () => {
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

    const features = results.filter((r) => r.kind === "feature");
    const tasks = results.filter((r) => r.kind === "task");

    expect(features.length).toBeGreaterThanOrEqual(1);
    expect(features.some((f) => f.name === "Login")).toBe(true);
    expect(features.some((f) => f.name === "Login Flow")).toBe(true);

    expect(tasks.length).toBe(2);
    expect(tasks.some((t) => t.name === "validates email format")).toBe(true);
    expect(tasks.some((t) => t.name === "handles invalid credentials")).toBe(true);
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
  });

  it("lite mode uses filenames only, skips content", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
  it("handles expiry", () => {});
});
`,
    );

    const results = await scanTests(tempDir, { lite: true });

    // Should only have file-level feature, no tasks from content
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("feature");
    expect(results[0].name).toBe("Auth");
    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.length).toBe(0);
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
    expect(results.some((r) => r.name === "adds numbers" && r.kind === "task")).toBe(true);
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
    expect(results.some((r) => r.name === "formats dates")).toBe(true);
  });

  it("returns empty for directory with no test files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "index.ts"), "export const x = 1;");

    const results = await scanTests(tempDir);
    expect(results).toEqual([]);
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

    const results = await scanSourceVision(tempDir);

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
          { type: "suggestion", pass: 1, scope: "core", text: "Add input validation", severity: "info" },
          { type: "observation", pass: 0, scope: "core", text: "High coupling (0.8)", severity: "warning" },
          { type: "pattern", pass: 1, scope: "core", text: "Repeated error handling", severity: "info" },
        ],
      }),
    );

    const results = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    expect(tasks.find((t) => t.name === "Fix: God object detected")).toBeDefined();
    expect(tasks.find((t) => t.name === "Implement: Add input validation")).toBeDefined();
    expect(tasks.find((t) => t.name === "Investigate: High coupling (0.8)")).toBeDefined();
    expect(tasks.find((t) => t.name === "Refactor: Repeated error handling")).toBeDefined();
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

    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);

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

    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);
    const circulars = results.filter((r) => r.name.startsWith("Resolve circular"));
    expect(circulars.length).toBe(1);
    expect(circulars[0].name).toContain("A");
  });

  it("returns empty when no .sourcevision directory", async () => {
    const results = await scanSourceVision(tempDir);
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

    const results = await scanSourceVision(tempDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name === "Core")).toBe(true);
  });

  it("skips info-severity observations but keeps actionable info findings", async () => {
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
          { type: "observation", pass: 0, scope: "core", text: "High cohesion (0.9)", severity: "info" },
          { type: "relationship", pass: 0, scope: "core", text: "Depends on utils zone", severity: "info" },
          { type: "suggestion", pass: 1, scope: "core", text: "Consider adding tests", severity: "info" },
          { type: "anti-pattern", pass: 1, scope: "core", text: "Bad pattern detected", severity: "warning" },
        ],
      }),
    );

    const results = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");
    // Info observations/relationships are skipped — purely informational
    // But info suggestions/patterns/anti-patterns are kept — they're actionable
    expect(tasks.length).toBe(2);
    expect(tasks.some((t) => t.name.includes("Bad pattern detected"))).toBe(true);
    expect(tasks.some((t) => t.name.includes("Consider adding tests"))).toBe(true);
    // Info-severity actionable findings get medium priority
    const suggestion = tasks.find((t) => t.name.includes("Consider adding tests"));
    expect(suggestion?.priority).toBe("medium");
  });
});
