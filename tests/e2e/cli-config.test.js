import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, "config", ...args], {
    encoding: "utf-8",
    timeout: 10000,
    ...opts,
  });
}

function runFail(args) {
  try {
    execFileSync("node", [CLI_PATH, "config", ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return err.stderr;
  }
}

async function setupProject(dir) {
  // Create .rex/config.json
  await mkdir(join(dir, ".rex"), { recursive: true });
  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify(
      {
        schema: "rex/v1",
        project: "test-project",
        adapter: "file",
        sourcevision: "auto",
      },
      null,
      2,
    ) + "\n",
  );

  // Create .hench/config.json
  await mkdir(join(dir, ".hench", "runs"), { recursive: true });
  await writeFile(
    join(dir, ".hench", "config.json"),
    JSON.stringify(
      {
        schema: "hench/v1",
        provider: "cli",
        model: "sonnet",
        maxTurns: 50,
        maxTokens: 8192,
        rexDir: ".rex",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        guard: {
          blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**"],
          allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
          commandTimeout: 30000,
          maxFileSize: 1048576,
        },
      },
      null,
      2,
    ) + "\n",
  );

  // Create .sourcevision/manifest.json
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        toolVersion: "0.1.0",
        analyzedAt: "2026-01-01T00:00:00.000Z",
        targetPath: dir,
        modules: {},
      },
      null,
      2,
    ) + "\n",
  );
}

describe("n-dx config", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-config-e2e-"));
    await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Show all ───────────────────────────────────────────────────────────────

  describe("show all", () => {
    it("displays all package configs", () => {
      const output = run([tmpDir]);
      expect(output).toContain("n-dx configuration:");
      expect(output).toContain("rex");
      expect(output).toContain("hench");
      expect(output).toContain("sourcevision");
    });

    it("shows rex settings", () => {
      const output = run([tmpDir]);
      expect(output).toContain("project");
      expect(output).toContain("test-project");
    });

    it("shows hench settings", () => {
      const output = run([tmpDir]);
      expect(output).toContain("model");
      expect(output).toContain("sonnet");
    });

    it("outputs JSON with --json flag", () => {
      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.rex.project).toBe("test-project");
      expect(parsed.hench.model).toBe("sonnet");
      expect(parsed.sourcevision.schemaVersion).toBe("1.0.0");
    });

    it("skips missing packages gracefully", async () => {
      await rm(join(tmpDir, ".sourcevision"), { recursive: true });
      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.sourcevision).toBeUndefined();
      expect(parsed.rex.project).toBe("test-project");
    });
  });

  // ── Get single value ──────────────────────────────────────────────────────

  describe("get", () => {
    it("gets a string value by dotted key", () => {
      const output = run(["hench.model", tmpDir]);
      expect(output.trim()).toBe("sonnet");
    });

    it("gets a number value", () => {
      const output = run(["hench.maxTurns", tmpDir]);
      expect(output.trim()).toBe("50");
    });

    it("gets a nested value", () => {
      const output = run(["hench.guard.commandTimeout", tmpDir]);
      expect(output.trim()).toBe("30000");
    });

    it("gets an array value", () => {
      const output = run(["hench.guard.allowedCommands", tmpDir]);
      expect(output.trim()).toContain("npm");
      expect(output.trim()).toContain("vitest");
    });

    it("gets rex value", () => {
      const output = run(["rex.project", tmpDir]);
      expect(output.trim()).toBe("test-project");
    });

    it("gets a whole package config by name", () => {
      const output = run(["rex", tmpDir]);
      expect(output).toContain("project");
      expect(output).toContain("test-project");
    });

    it("outputs single value as JSON", () => {
      const output = run(["hench.model", "--json", tmpDir]);
      expect(JSON.parse(output)).toBe("sonnet");
    });

    it("outputs package config as JSON", () => {
      const output = run(["rex", "--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.project).toBe("test-project");
    });

    it("errors on missing key", () => {
      const stderr = runFail(["hench.nonexistent", tmpDir]);
      expect(stderr).toContain("not found");
    });

    it("errors on missing package", () => {
      const stderr = runFail(["fake.key", tmpDir]);
      expect(stderr).toContain("not initialized");
    });
  });

  // ── Set value ──────────────────────────────────────────────────────────────

  describe("set", () => {
    it("sets a string value", async () => {
      const output = run(["hench.model", "opus", tmpDir]);
      expect(output).toContain("hench.model = opus");

      const config = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(config.model).toBe("opus");
    });

    it("sets a number value with type coercion", async () => {
      run(["hench.maxTurns", "100", tmpDir]);

      const config = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(config.maxTurns).toBe(100);
    });

    it("sets a nested value", async () => {
      run(["hench.guard.commandTimeout", "60000", tmpDir]);

      const config = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(config.guard.commandTimeout).toBe(60000);
    });

    it("sets an array value from comma-separated string", async () => {
      run(["hench.guard.allowedCommands", "npm,git,pnpm", tmpDir]);

      const config = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(config.guard.allowedCommands).toEqual(["npm", "git", "pnpm"]);
    });

    it("sets a rex value", async () => {
      run(["rex.project", "new-name", tmpDir]);

      const config = JSON.parse(
        await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
      );
      expect(config.project).toBe("new-name");
    });

    it("adds a new optional field", async () => {
      run(["rex.validate", "pnpm typecheck", tmpDir]);

      const config = JSON.parse(
        await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
      );
      expect(config.validate).toBe("pnpm typecheck");
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects invalid number values", () => {
      const stderr = runFail(["hench.maxTurns", "abc", tmpDir]);
      expect(stderr).toContain("Expected a number");
    });

    it("prevents modifying schema version", () => {
      const stderr = runFail(["hench.schema", "v2", tmpDir]);
      expect(stderr).toContain("Cannot modify schema");
    });

    it("prevents setting sourcevision (read-only)", () => {
      const stderr = runFail([
        "sourcevision.schemaVersion",
        "2.0.0",
        tmpDir,
      ]);
      expect(stderr).toContain("read-only");
    });

    it("prevents setting an object key directly", () => {
      const stderr = runFail(["hench.guard", "foo", tmpDir]);
      expect(stderr).toContain("object");
    });

    it("rejects unknown package name", () => {
      const stderr = runFail(["unknown.key", "val", tmpDir]);
      expect(stderr).toContain("Unknown package");
    });
  });

  // ── Help ───────────────────────────────────────────────────────────────────

  describe("help", () => {
    it("shows help with --help flag", () => {
      const output = run(["--help"]);
      expect(output).toContain("n-dx config");
      expect(output).toContain("dot notation");
    });

    it("shows -h shorthand", () => {
      const output = run(["-h"]);
      expect(output).toContain("n-dx config");
    });

    it("documents all rex config keys", () => {
      const output = run(["--help"]);
      expect(output).toContain("rex.project");
      expect(output).toContain("rex.adapter");
      expect(output).toContain("rex.validate");
      expect(output).toContain("rex.test");
      expect(output).toContain("rex.sourcevision");
      expect(output).toContain("rex.model");
    });

    it("documents all hench config keys", () => {
      const output = run(["--help"]);
      expect(output).toContain("hench.provider");
      expect(output).toContain("hench.model");
      expect(output).toContain("hench.maxTurns");
      expect(output).toContain("hench.maxTokens");
      expect(output).toContain("hench.rexDir");
      expect(output).toContain("hench.apiKeyEnv");
    });

    it("documents all hench guard keys", () => {
      const output = run(["--help"]);
      expect(output).toContain("hench.guard.blockedPaths");
      expect(output).toContain("hench.guard.allowedCommands");
      expect(output).toContain("hench.guard.commandTimeout");
      expect(output).toContain("hench.guard.maxFileSize");
    });

    it("shows default values", () => {
      const output = run(["--help"]);
      expect(output).toContain('default: "file"');
      expect(output).toContain('default: "cli"');
      expect(output).toContain('default: "sonnet"');
      expect(output).toContain("default: 50");
      expect(output).toContain("default: 8192");
      expect(output).toContain("default: 30000");
      expect(output).toContain("default: 1048576");
    });

    it("shows type information", () => {
      const output = run(["--help"]);
      expect(output).toContain("string");
      expect(output).toContain("number");
      expect(output).toContain("string[]");
    });

    it("notes sourcevision is read-only", () => {
      const output = run(["--help"]);
      expect(output).toContain("sourcevision");
      expect(output).toContain("read-only");
    });

    it("documents type coercion rules", () => {
      const output = run(["--help"]);
      expect(output).toContain("Type coercion");
      expect(output).toContain("Numbers");
      expect(output).toContain("Booleans");
      expect(output).toContain("Arrays");
      expect(output).toContain("comma-separated");
    });

    it("includes usage examples", () => {
      const output = run(["--help"]);
      expect(output).toContain("Examples:");
      expect(output).toContain("n-dx config hench.model opus");
      expect(output).toContain("n-dx config hench.maxTurns 100");
      expect(output).toContain("n-dx config --json");
    });

    it("documents .n-dx.json project config", () => {
      const output = run(["--help"]);
      expect(output).toContain(".n-dx.json");
      expect(output).toContain("project root");
      expect(output).toContain("precedence");
    });
  });

  // ── Project-level .n-dx.json ─────────────────────────────────────────────

  describe(".n-dx.json project config", () => {
    it("reads .n-dx.json and merges with package configs", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ rex: { project: "overridden-name" } }, null, 2) + "\n",
      );

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.rex.project).toBe("overridden-name");
    });

    it("project config takes precedence over package config", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          hench: { model: "opus", maxTurns: 200 },
        }, null, 2) + "\n",
      );

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.hench.model).toBe("opus");
      expect(parsed.hench.maxTurns).toBe(200);
      // Non-overridden values remain from package config
      expect(parsed.hench.provider).toBe("cli");
    });

    it("deep merges nested objects", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          hench: { guard: { commandTimeout: 60000 } },
        }, null, 2) + "\n",
      );

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.hench.guard.commandTimeout).toBe(60000);
      // Other guard values preserved from package config
      expect(parsed.hench.guard.maxFileSize).toBe(1048576);
    });

    it("get returns merged value from .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ hench: { model: "haiku" } }, null, 2) + "\n",
      );

      const output = run(["hench.model", tmpDir]);
      expect(output.trim()).toBe("haiku");
    });

    it("works when no package configs exist but .n-dx.json does", async () => {
      const freshDir = await mkdtemp(join(tmpdir(), "ndx-config-ndxonly-"));
      try {
        // Only create .n-dx.json — no .rex, .hench, .sourcevision dirs
        await mkdir(join(freshDir, ".rex"), { recursive: true });
        await writeFile(
          join(freshDir, ".rex", "config.json"),
          JSON.stringify({
            schema: "rex/v1",
            project: "base",
            adapter: "file",
          }, null, 2) + "\n",
        );
        await writeFile(
          join(freshDir, ".n-dx.json"),
          JSON.stringify({ rex: { project: "from-ndx" } }, null, 2) + "\n",
        );

        const output = run(["--json", freshDir]);
        const parsed = JSON.parse(output);
        expect(parsed.rex.project).toBe("from-ndx");
      } finally {
        await rm(freshDir, { recursive: true, force: true });
      }
    });

    it("ignores .n-dx.json gracefully when it has invalid JSON", async () => {
      await writeFile(join(tmpDir, ".n-dx.json"), "not valid json\n");

      // Should still work — just skip the broken project config
      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.rex.project).toBe("test-project");
    });

    it("ignores .n-dx.json when it does not exist", () => {
      // Default behavior — no .n-dx.json
      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.rex.project).toBe("test-project");
    });

    it("set writes to package config, not .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ hench: { model: "opus" } }, null, 2) + "\n",
      );

      // Set a value — should write to .hench/config.json
      run(["hench.maxTurns", "75", tmpDir]);

      // .n-dx.json should be untouched
      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig).toEqual({ hench: { model: "opus" } });

      // Package config should have the new value
      const henchConfig = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(henchConfig.maxTurns).toBe(75);
    });

    it("array override replaces entire array", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          hench: { guard: { allowedCommands: ["pnpm", "git"] } },
        }, null, 2) + "\n",
      );

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.hench.guard.allowedCommands).toEqual(["pnpm", "git"]);
    });
  });

  // ── No config ──────────────────────────────────────────────────────────────

  describe("no config", () => {
    it("errors when no configs exist", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-config-empty-"));
      try {
        const stderr = runFail([emptyDir]);
        expect(stderr).toContain("No n-dx configuration found");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
