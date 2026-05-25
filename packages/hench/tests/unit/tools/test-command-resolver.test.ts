import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTestCommand } from "../../../src/tools/test-command-resolver.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

describe("resolveTestCommand", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "test-resolver-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(henchDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true });
  });

  // ---------------------------------------------------------------------------
  // Config precedence tests
  // ---------------------------------------------------------------------------

  describe("config precedence", () => {
    it("uses fullTestCommand from hench config (highest priority)", async () => {
      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: { fullTestCommand: "pnpm test" },
      });

      expect(result.command).toBe("pnpm test");
      expect(result.source).toBe("config");
      expect(result.persisted).toBeUndefined();
    });

    it("falls back to .n-dx.json when hench config is empty", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          hench: { fullTestCommand: "npm run test:all" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("npm run test:all");
      expect(result.source).toBe("project-config");
    });

    it("falls back to auto-detect when no config is found", async () => {
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("npm run test");
      expect(result.source).toBe("auto-detect");
    });

    it("prefers test:all over test in auto-detection", async () => {
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: {
            test: "vitest",
            "test:all": "vitest run",
          },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("npm run test:all");
      expect(result.source).toBe("auto-detect");
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-detection tests
  // ---------------------------------------------------------------------------

  describe("auto-detection from package.json", () => {
    it("detects test script", async () => {
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { test: "jest" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("npm run test");
      expect(result.source).toBe("auto-detect");
    });

    it("detects test:all script with higher priority", async () => {
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { "test:all": "jest --coverage" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("npm run test:all");
    });

    it("returns undefined when no test scripts exist", async () => {
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { build: "tsc" },
        }),
      );

      await expect(
        resolveTestCommand({
          projectDir,
          henchDir,
          config: {},
          // Mock non-TTY to prevent prompt
        }),
      ).rejects.toThrow("No test command configured");
    });

    it("handles missing package.json gracefully", async () => {
      await expect(
        resolveTestCommand({
          projectDir,
          henchDir,
          config: {},
        }),
      ).rejects.toThrow("No test command configured");
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling in autonomous mode
  // ---------------------------------------------------------------------------

  describe("autonomous mode error handling", () => {
    it("throws helpful error in --auto mode when no command found", async () => {
      const err = await resolveTestCommand(
        {
          projectDir,
          henchDir,
          config: {},
        },
        true, // autonomous
      ).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain("No test command configured");
      expect(err.message).toContain(".hench/config.json");
      expect(err.message).toContain("fullTestCommand");
    });

    it("directs user to --skip-test-gate in error message", async () => {
      const err = await resolveTestCommand(
        {
          projectDir,
          henchDir,
          config: {},
        },
        true,
      ).catch((e) => e);

      expect(err.message).toContain("--skip-test-gate");
    });
  });

  // ---------------------------------------------------------------------------
  // Config loading from .n-dx.json
  // ---------------------------------------------------------------------------

  describe(".n-dx.json project config loading", () => {
    it("loads fullTestCommand from hench section", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          hench: {
            fullTestCommand: "pnpm test --reporter=json",
          },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("pnpm test --reporter=json");
      expect(result.source).toBe("project-config");
    });

    it("ignores invalid project config gracefully", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        "invalid json {",
      );

      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      // Should fall back to auto-detection
      expect(result.source).toBe("auto-detect");
    });
  });

  // ---------------------------------------------------------------------------
  // Preference/priority order
  // ---------------------------------------------------------------------------

  describe("preference order (highest to lowest)", () => {
    it("prefers .hench/config.json over all other sources", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          hench: { fullTestCommand: "project-config-command" },
        }),
      );

      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { test: "auto-detect-command" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: { fullTestCommand: "hench-config-command" },
      });

      expect(result.command).toBe("hench-config-command");
      expect(result.source).toBe("config");
    });

    it("prefers .n-dx.json over auto-detection", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          hench: { fullTestCommand: "project-config-command" },
        }),
      );

      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          scripts: { test: "auto-detect-command" },
        }),
      );

      const result = await resolveTestCommand({
        projectDir,
        henchDir,
        config: {},
      });

      expect(result.command).toBe("project-config-command");
      expect(result.source).toBe("project-config");
    });
  });

  // ---------------------------------------------------------------------------
  // Non-TTY behavior
  // ---------------------------------------------------------------------------

  describe("non-TTY behavior (CI/automated mode)", () => {
    it("throws error when stdin is not a TTY and no command found", async () => {
      // Save original TTY state
      const originalIsTTY = process.stdin.isTTY;

      try {
        // Mock non-TTY
        Object.defineProperty(process.stdin, "isTTY", {
          value: false,
          writable: true,
          configurable: true,
        });

        const err = await resolveTestCommand(
          {
            projectDir,
            henchDir,
            config: {},
          },
          false, // not autonomous (but non-TTY)
        ).catch((e) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("stdin is not a TTY");
      } finally {
        // Restore original TTY state
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalIsTTY,
          writable: true,
          configurable: true,
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Language- and project-shape auto-detection
  // ---------------------------------------------------------------------------

  describe("language-aware auto-detect", () => {
    it("prefers a Makefile validate target over the language toolchain", async () => {
      // A Swift project that ALSO has Makefile validate — the Makefile wins.
      await writeFile(join(projectDir, "Package.swift"), "// swift-package");
      await writeFile(
        join(projectDir, "Makefile"),
        "all:\n\techo hi\nvalidate:\n\tswift test\n\tscripts/check.sh\n",
      );
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("make validate");
      expect(result.source).toBe("auto-detect");
    });

    it("uses 'swift test' for a Package.swift project without Makefile validate", async () => {
      await writeFile(join(projectDir, "Package.swift"), "// swift-package");
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("swift test");
      expect(result.source).toBe("auto-detect");
    });

    it("uses 'swift test' for an Xcode project (.xcodeproj directory)", async () => {
      await mkdir(join(projectDir, "MyApp.xcodeproj"));
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("swift test");
      expect(result.source).toBe("auto-detect");
    });

    it("uses 'cargo test' for a Cargo.toml project", async () => {
      await writeFile(join(projectDir, "Cargo.toml"), '[package]\nname = "x"\nversion = "0.1.0"\n');
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("cargo test");
      expect(result.source).toBe("auto-detect");
    });

    it("uses 'go test ./...' for a go.mod project (when no package.json wins first)", async () => {
      await writeFile(join(projectDir, "go.mod"), "module example.com/x\n");
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("go test ./...");
      expect(result.source).toBe("auto-detect");
    });

    it("uses 'pytest' for a pyproject.toml project", async () => {
      await writeFile(join(projectDir, "pyproject.toml"), "[project]\nname = 'x'\n");
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("pytest");
      expect(result.source).toBe("auto-detect");
    });

    it("does NOT mistake an indented 'validate:' line inside a recipe for a target", async () => {
      // Recipe lines start with a tab and are NOT targets. The detector is
      // strict about column 1 to avoid this false positive.
      await writeFile(join(projectDir, "Package.swift"), "// swift-package");
      await writeFile(
        join(projectDir, "Makefile"),
        "all:\n\techo \"  validate: not a target\"\n",
      );
      const result = await resolveTestCommand({ projectDir, henchDir });
      expect(result.command).toBe("swift test");
    });
  });
});
