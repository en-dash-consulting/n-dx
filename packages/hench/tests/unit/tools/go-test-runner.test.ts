import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isTestFile,
  candidateTestPaths,
  findRelevantTests,
  detectRunner,
  buildScopedCommand,
} from "../../../src/tools/test-runner.js";

// ---------------------------------------------------------------------------
// isTestFile — Go patterns
// ---------------------------------------------------------------------------

describe("isTestFile — Go", () => {
  it("recognises _test.go files", () => {
    expect(isTestFile("handler_test.go")).toBe(true);
  });

  it("recognises _test.go with directory prefix", () => {
    expect(isTestFile("internal/handler/user_test.go")).toBe(true);
  });

  it("rejects regular .go source files", () => {
    expect(isTestFile("main.go")).toBe(false);
    expect(isTestFile("internal/handler.go")).toBe(false);
  });

  it("rejects files with test in directory but not filename", () => {
    expect(isTestFile("testdata/fixture.go")).toBe(false);
  });

  // Regression: JS/TS recognition unchanged
  it("still recognises JS/TS test patterns", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("lib/bar.spec.js")).toBe(true);
    expect(isTestFile("Button.test.tsx")).toBe(true);
    expect(isTestFile("utils_test.ts")).toBe(true);
  });

  it("still rejects non-test JS/TS files", () => {
    expect(isTestFile("src/foo.ts")).toBe(false);
    expect(isTestFile("index.js")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// candidateTestPaths — Go patterns
// ---------------------------------------------------------------------------

describe("candidateTestPaths — Go", () => {
  it("generates _test.go in the same directory for .go files", () => {
    const paths = candidateTestPaths("internal/handler.go");
    expect(paths).toContain(join("internal", "handler_test.go"));
  });

  it("generates _test.go for root-level .go files", () => {
    const paths = candidateTestPaths("main.go");
    expect(paths).toContain("main_test.go");
  });

  it("does not generate .test.ts or .spec.ts variants for .go files", () => {
    const paths = candidateTestPaths("internal/handler.go");
    expect(paths.every((p) => !p.endsWith(".test.ts"))).toBe(true);
    expect(paths.every((p) => !p.endsWith(".spec.ts"))).toBe(true);
  });

  it("does not generate adjacent test directory variants for .go files", () => {
    const paths = candidateTestPaths("internal/handler.go");
    expect(paths.every((p) => !p.includes("__tests__"))).toBe(true);
    expect(paths.every((p) => !p.includes("/tests/"))).toBe(true);
  });

  it("returns only the _test.go candidate for Go source files", () => {
    const paths = candidateTestPaths("pkg/auth/token.go");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe(join("pkg/auth", "token_test.go"));
  });

  it("returns the file itself if it is already a _test.go file", () => {
    const paths = candidateTestPaths("internal/handler_test.go");
    expect(paths).toEqual(["internal/handler_test.go"]);
  });

  // Regression: JS/TS candidate generation unchanged
  it("still generates .test/.spec variants for .ts files", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain("src/agent/loop.test.ts");
    expect(paths).toContain("src/agent/loop.spec.ts");
  });

  it("still generates mirror paths for src/ JS/TS files", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(join("tests/agent/loop.test.ts"));
  });
});

// ---------------------------------------------------------------------------
// findRelevantTests — Go patterns
// ---------------------------------------------------------------------------

describe("findRelevantTests — Go", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-go-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds co-located _test.go file for a .go source file", async () => {
    await mkdir(join(tmpDir, "internal/handler"), { recursive: true });
    await writeFile(join(tmpDir, "internal/handler/user.go"), "");
    await writeFile(join(tmpDir, "internal/handler/user_test.go"), "");

    const tests = await findRelevantTests(tmpDir, ["internal/handler/user.go"]);
    expect(tests).toEqual([join("internal/handler", "user_test.go")]);
  });

  it("finds _test.go in root directory", async () => {
    await writeFile(join(tmpDir, "main.go"), "");
    await writeFile(join(tmpDir, "main_test.go"), "");

    const tests = await findRelevantTests(tmpDir, ["main.go"]);
    expect(tests).toEqual(["main_test.go"]);
  });

  it("returns the _test.go file itself when in changed list", async () => {
    await mkdir(join(tmpDir, "pkg"), { recursive: true });
    await writeFile(join(tmpDir, "pkg/auth_test.go"), "");

    const tests = await findRelevantTests(tmpDir, ["pkg/auth_test.go"]);
    expect(tests).toEqual([join("pkg", "auth_test.go")]);
  });

  it("returns empty when no _test.go exists", async () => {
    await mkdir(join(tmpDir, "internal"), { recursive: true });
    await writeFile(join(tmpDir, "internal/handler.go"), "");

    const tests = await findRelevantTests(tmpDir, ["internal/handler.go"]);
    expect(tests).toEqual([]);
  });

  it("finds tests for multiple Go source files", async () => {
    await mkdir(join(tmpDir, "internal/handler"), { recursive: true });
    await mkdir(join(tmpDir, "internal/repo"), { recursive: true });
    await writeFile(join(tmpDir, "internal/handler/user.go"), "");
    await writeFile(join(tmpDir, "internal/handler/user_test.go"), "");
    await writeFile(join(tmpDir, "internal/repo/db.go"), "");
    await writeFile(join(tmpDir, "internal/repo/db_test.go"), "");

    const tests = await findRelevantTests(tmpDir, [
      "internal/handler/user.go",
      "internal/repo/db.go",
    ]);
    expect(tests).toContain(join("internal/handler", "user_test.go"));
    expect(tests).toContain(join("internal/repo", "db_test.go"));
    expect(tests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectRunner — Go test
// ---------------------------------------------------------------------------

describe("detectRunner — Go", () => {
  it("detects go test pattern", () => {
    expect(detectRunner("go test ./...")).toBe("go");
  });

  it("detects go test with flags", () => {
    expect(detectRunner("go test -v -count=1 ./...")).toBe("go");
  });

  it("does not detect bare go without test subcommand", () => {
    expect(detectRunner("go build ./...")).toBeUndefined();
    expect(detectRunner("go vet ./...")).toBeUndefined();
  });

  it("does not detect go as the first word with a non-test second word", () => {
    expect(detectRunner("go run main.go")).toBeUndefined();
  });

  // Regression: JS/TS runner detection unchanged
  it("still detects vitest", () => {
    expect(detectRunner("vitest run")).toBe("vitest");
    expect(detectRunner("npx vitest")).toBe("vitest");
  });

  it("still detects jest", () => {
    expect(detectRunner("jest --ci")).toBe("jest");
  });

  it("still returns undefined for package manager wrappers", () => {
    expect(detectRunner("pnpm test")).toBeUndefined();
    expect(detectRunner("npm test")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildScopedCommand — Go scoping
// ---------------------------------------------------------------------------

describe("buildScopedCommand — Go", () => {
  it("scopes to package path from test file in subdirectory", () => {
    const cmd = buildScopedCommand(
      "go test ./...",
      "go",
      ["internal/handler/user_test.go"],
    );
    expect(cmd).toBe("go test ./internal/handler/...");
  });

  it("scopes to root package for root-level test files", () => {
    const cmd = buildScopedCommand(
      "go test ./...",
      "go",
      ["main_test.go"],
    );
    expect(cmd).toBe("go test .");
  });

  it("preserves flags and replaces package targets", () => {
    const cmd = buildScopedCommand(
      "go test -v -count=1 ./...",
      "go",
      ["internal/handler/user_test.go"],
    );
    expect(cmd).toBe("go test -v -count=1 ./internal/handler/...");
  });

  it("deduplicates package paths from multiple test files in same directory", () => {
    const cmd = buildScopedCommand(
      "go test ./...",
      "go",
      ["internal/handler/user_test.go", "internal/handler/admin_test.go"],
    );
    expect(cmd).toBe("go test ./internal/handler/...");
  });

  it("scopes to multiple distinct package paths", () => {
    const cmd = buildScopedCommand(
      "go test ./...",
      "go",
      ["internal/handler/user_test.go", "internal/repo/db_test.go"],
    );
    // Order may vary, check both are present
    expect(cmd).toContain("go test");
    expect(cmd).toContain("./internal/handler/...");
    expect(cmd).toContain("./internal/repo/...");
  });

  it("handles go test without existing package target", () => {
    const cmd = buildScopedCommand(
      "go test",
      "go",
      ["pkg/auth/token_test.go"],
    );
    expect(cmd).toBe("go test ./pkg/auth/...");
  });

  // Regression: JS/TS scoping unchanged
  it("still scopes vitest correctly", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("vitest run tests/foo.test.ts");
  });

  it("still scopes jest with -- separator", () => {
    const cmd = buildScopedCommand("jest", "jest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("jest -- tests/foo.test.ts");
  });
});
