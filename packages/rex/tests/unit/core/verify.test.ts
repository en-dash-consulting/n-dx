import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractKeywords,
  scoreMatch,
  mapCriteriaToTests,
  collectVerifiableTasks,
  findTestFiles,
  verify,
} from "../../../src/core/verify.js";

type PRDItem = {
  id: string;
  title: string;
  level: string;
  status: "pending" | "in_progress" | "completed" | "deferred" | "deleted";
  acceptanceCriteria?: string[];
  children?: PRDItem[];
};

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe("extractKeywords", () => {
  it("extracts meaningful words, dropping stop words", () => {
    const kw = extractKeywords("Maps criteria to test files");
    expect(kw).toContain("maps");
    expect(kw).toContain("criteria");
    expect(kw).toContain("files");
    expect(kw).not.toContain("to");
    expect(kw).not.toContain("test");
  });

  it("lowercases and strips punctuation", () => {
    const kw = extractKeywords("Runs relevant tests for a task!");
    expect(kw).toContain("runs");
    expect(kw).toContain("relevant");
    expect(kw).toContain("task");
    expect(kw).not.toContain("!");
  });

  it("drops short words (length <= 2)", () => {
    const kw = extractKeywords("A is on it");
    expect(kw).toHaveLength(0);
  });

  it("handles hyphenated and underscored terms", () => {
    const kw = extractKeywords("Reports test-results clearly");
    expect(kw).toContain("reports");
    expect(kw).toContain("test-results");
    expect(kw).toContain("clearly");
  });

  it("returns empty for empty string", () => {
    expect(extractKeywords("")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scoreMatch
// ---------------------------------------------------------------------------

describe("scoreMatch", () => {
  it("returns 0 when no keywords match", () => {
    expect(scoreMatch("tests/unit/auth.test.ts", ["database", "migration"])).toBe(0);
  });

  it("returns count of matching keywords", () => {
    expect(scoreMatch("tests/unit/verify.test.ts", ["verify", "unit"])).toBe(2);
  });

  it("matches across path separators", () => {
    expect(scoreMatch("packages/rex/tests/verify.test.ts", ["rex", "verify"])).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(scoreMatch("tests/Verify.test.ts", ["verify"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mapCriteriaToTests
// ---------------------------------------------------------------------------

describe("mapCriteriaToTests", () => {
  const testFiles = [
    "tests/unit/verify.test.ts",
    "tests/unit/status.test.ts",
    "tests/unit/coverage.test.ts",
    "tests/integration/runner.test.ts",
  ];

  it("maps criteria to matching test files", () => {
    const results = mapCriteriaToTests(
      ["Verify task status correctly"],
      testFiles,
    );
    expect(results).toHaveLength(1);
    expect(results[0].covered).toBe(true);
    expect(results[0].testFiles).toContain("tests/unit/verify.test.ts");
    expect(results[0].testFiles).toContain("tests/unit/status.test.ts");
  });

  it("marks criterion as uncovered when no matches", () => {
    const results = mapCriteriaToTests(
      ["Handles authentication properly"],
      testFiles,
    );
    expect(results[0].covered).toBe(false);
    expect(results[0].testFiles).toHaveLength(0);
  });

  it("handles multiple criteria", () => {
    const results = mapCriteriaToTests(
      [
        "Show coverage results",
        "Run integration tests",
      ],
      testFiles,
    );
    expect(results).toHaveLength(2);
    expect(results[0].covered).toBe(true);
    expect(results[0].testFiles).toContain("tests/unit/coverage.test.ts");
    expect(results[1].covered).toBe(true);
    expect(results[1].testFiles).toContain("tests/integration/runner.test.ts");
  });

  it("returns uncovered when criterion has only stop words", () => {
    const results = mapCriteriaToTests(["Is the"], testFiles);
    expect(results[0].covered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectVerifiableTasks
// ---------------------------------------------------------------------------

describe("collectVerifiableTasks", () => {
  const items: PRDItem[] = [
    {
      id: "e1",
      title: "Auth Epic",
      level: "epic",
      status: "in_progress",
      children: [
        {
          id: "t1",
          title: "Login task",
          level: "task",
          status: "pending",
          acceptanceCriteria: ["User can log in", "Shows error on failure"],
        },
        {
          id: "t2",
          title: "No criteria task",
          level: "task",
          status: "pending",
        },
      ],
    },
    {
      id: "t3",
      title: "Standalone task",
      level: "task",
      status: "pending",
      acceptanceCriteria: ["Reports results clearly"],
    },
  ];

  it("collects all tasks with acceptance criteria", () => {
    const tasks = collectVerifiableTasks(items);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("t1");
    expect(tasks[1].id).toBe("t3");
  });

  it("filters by task ID", () => {
    const tasks = collectVerifiableTasks(items, "t3");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t3");
  });

  it("returns empty when task ID has no criteria", () => {
    const tasks = collectVerifiableTasks(items, "t2");
    expect(tasks).toHaveLength(0);
  });

  it("returns empty when task ID does not exist", () => {
    const tasks = collectVerifiableTasks(items, "nonexistent");
    expect(tasks).toHaveLength(0);
  });

  it("records totalCriteria count", () => {
    const tasks = collectVerifiableTasks(items, "t1");
    expect(tasks[0].totalCriteria).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// findTestFiles
// ---------------------------------------------------------------------------

describe("findTestFiles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-verify-find-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("finds .test.ts files", async () => {
    mkdirSync(join(tmp, "tests"), { recursive: true });
    writeFileSync(join(tmp, "tests", "auth.test.ts"), "");
    writeFileSync(join(tmp, "tests", "helper.ts"), "");

    const files = await findTestFiles(tmp);
    expect(files).toEqual(["tests/auth.test.ts"]);
  });

  it("finds .spec.js files", async () => {
    writeFileSync(join(tmp, "auth.spec.js"), "");
    const files = await findTestFiles(tmp);
    expect(files).toEqual(["auth.spec.js"]);
  });

  it("finds .test.tsx files", async () => {
    writeFileSync(join(tmp, "Button.test.tsx"), "");
    const files = await findTestFiles(tmp);
    expect(files).toEqual(["Button.test.tsx"]);
  });

  it("finds _test.ts files", async () => {
    writeFileSync(join(tmp, "utils_test.ts"), "");
    const files = await findTestFiles(tmp);
    expect(files).toEqual(["utils_test.ts"]);
  });

  it("finds _spec.tsx files", async () => {
    writeFileSync(join(tmp, "Component_spec.tsx"), "");
    const files = await findTestFiles(tmp);
    expect(files).toEqual(["Component_spec.tsx"]);
  });

  it("rejects regular source files", async () => {
    writeFileSync(join(tmp, "index.ts"), "");
    writeFileSync(join(tmp, "utils.js"), "");
    writeFileSync(join(tmp, "README.md"), "");
    const files = await findTestFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it("rejects files with test in directory name but not filename", async () => {
    mkdirSync(join(tmp, "tests"), { recursive: true });
    writeFileSync(join(tmp, "tests", "helpers.ts"), "");
    const files = await findTestFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it("skips node_modules", async () => {
    mkdirSync(join(tmp, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(tmp, "node_modules", "pkg", "index.test.ts"), "");

    const files = await findTestFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it("skips dist directory", async () => {
    mkdirSync(join(tmp, "dist"), { recursive: true });
    writeFileSync(join(tmp, "dist", "bundle.test.js"), "");

    const files = await findTestFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it("finds nested test files", async () => {
    mkdirSync(join(tmp, "src", "core"), { recursive: true });
    writeFileSync(join(tmp, "src", "core", "verify.test.ts"), "");

    const files = await findTestFiles(tmp);
    expect(files).toEqual(["src/core/verify.test.ts"]);
  });

  it("returns empty for directory with no test files", async () => {
    writeFileSync(join(tmp, "index.ts"), "");
    const files = await findTestFiles(tmp);
    expect(files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// verify (integration — no actual test execution)
// ---------------------------------------------------------------------------

describe("verify", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-verify-int-"));
    mkdirSync(join(tmp, "tests", "unit"), { recursive: true });
    writeFileSync(join(tmp, "tests", "unit", "login.test.ts"), "test('login works', () => {})");
    writeFileSync(join(tmp, "tests", "unit", "coverage.test.ts"), "test('coverage', () => {})");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  const items: PRDItem[] = [
    {
      id: "t1",
      title: "Login feature",
      level: "task",
      status: "pending",
      acceptanceCriteria: [
        "User can login successfully",
        "Shows error on invalid credentials",
      ],
    },
    {
      id: "t2",
      title: "Coverage report",
      level: "task",
      status: "pending",
      acceptanceCriteria: [
        "Show test coverage in status",
      ],
    },
  ];

  it("maps criteria to test files without running tests", async () => {
    const result = await verify({
      projectDir: tmp,
      items,
      runTests: false,
    });

    expect(result.tasks).toHaveLength(2);
    expect(result.summary.totalTasks).toBe(2);
    expect(result.summary.totalCriteria).toBe(3);
  });

  it("filters to a specific task", async () => {
    const result = await verify({
      projectDir: tmp,
      items,
      taskId: "t2",
      runTests: false,
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe("t2");
    expect(result.summary.totalTasks).toBe(1);
  });

  it("reports no test command configured", async () => {
    const result = await verify({
      projectDir: tmp,
      items,
      runTests: true,
    });

    expect(result.testRun?.ran).toBe(false);
    expect(result.testRun?.error).toContain("No test command configured");
  });

  it("returns empty for items with no criteria", async () => {
    const noCriteria: PRDItem[] = [
      { id: "t1", title: "No criteria", level: "task", status: "pending" },
    ];

    const result = await verify({
      projectDir: tmp,
      items: noCriteria,
      runTests: false,
    });

    expect(result.tasks).toHaveLength(0);
    expect(result.summary.totalCriteria).toBe(0);
  });

  it("counts covered and uncovered criteria", async () => {
    const result = await verify({
      projectDir: tmp,
      items,
      runTests: false,
    });

    // login.test.ts should match the login criteria
    const loginTask = result.tasks.find((t) => t.id === "t1");
    expect(loginTask).toBeDefined();
    expect(loginTask!.coveredCriteria).toBeGreaterThanOrEqual(1);
    expect(result.summary.coveredCriteria).toBeGreaterThanOrEqual(1);
  });
});
