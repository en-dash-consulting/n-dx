import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod, stat } from "node:fs/promises";
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

      // Project overrides must NOT leak into package config
      expect(henchConfig.model).toBe("sonnet");
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

  // ── Claude configuration ─────────────────────────────────────────────────

  describe("claude config", () => {
    it("sets claude.cli_path in .n-dx.json", async () => {
      const output = run(["claude.cli_path", "/usr/local/bin/claude", "--force", tmpDir]);
      expect(output).toContain("claude.cli_path = /usr/local/bin/claude");

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.cli_path).toBe("/usr/local/bin/claude");
    });

    it("sets claude.api_key in .n-dx.json", async () => {
      const output = run(["claude.api_key", "sk-ant-test-key", tmpDir]);
      expect(output).toContain("claude.api_key = sk-ant-test-key");

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.api_key).toBe("sk-ant-test-key");
    });

    it("gets claude.cli_path after setting it", async () => {
      run(["claude.cli_path", "/opt/claude", "--force", tmpDir]);
      const output = run(["claude.cli_path", tmpDir]);
      expect(output.trim()).toBe("/opt/claude");
    });

    it("gets claude.api_key after setting it", async () => {
      run(["claude.api_key", "sk-ant-key123", tmpDir]);
      const output = run(["claude.api_key", tmpDir]);
      expect(output.trim()).toBe("sk-ant-key123");
    });

    it("shows claude section in --json output", async () => {
      run(["claude.cli_path", "/usr/local/bin/claude", "--force", tmpDir]);
      run(["claude.api_key", "sk-ant-key", tmpDir]);

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.claude.cli_path).toBe("/usr/local/bin/claude");
      expect(parsed.claude.api_key).toBe("sk-ant-key");
    });

    it("shows claude section with ndx config claude --json", async () => {
      run(["claude.cli_path", "/usr/bin/claude", "--force", tmpDir]);

      const output = run(["claude", "--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.cli_path).toBe("/usr/bin/claude");
    });

    it("shows claude section in show all output", async () => {
      run(["claude.cli_path", "/usr/local/bin/claude", "--force", tmpDir]);

      const output = run([tmpDir]);
      expect(output).toContain("claude");
      expect(output).toContain("cli_path");
      expect(output).toContain("/usr/local/bin/claude");
    });

    it("creates .n-dx.json if it does not exist", async () => {
      // No .n-dx.json exists yet
      run(["claude.cli_path", "/usr/local/bin/claude", "--force", tmpDir]);

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.cli_path).toBe("/usr/local/bin/claude");
    });

    it("preserves existing .n-dx.json content when setting claude values", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ hench: { model: "opus" } }, null, 2) + "\n",
      );

      run(["claude.api_key", "sk-ant-test", tmpDir]);

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.hench.model).toBe("opus");
      expect(ndxConfig.claude.api_key).toBe("sk-ant-test");
    });

    it("does not write to package config files", async () => {
      run(["claude.cli_path", "/usr/local/bin/claude", "--force", tmpDir]);

      // .hench/config.json should not have claude settings
      const henchConfig = JSON.parse(
        await readFile(join(tmpDir, ".hench", "config.json"), "utf-8"),
      );
      expect(henchConfig.claude).toBeUndefined();
      expect(henchConfig.cli_path).toBeUndefined();
    });

    it("errors when getting unset claude section", () => {
      const stderr = runFail(["claude", tmpDir]);
      expect(stderr).toContain("No claude configuration set");
    });

    it("errors when getting unset claude key", () => {
      const stderr = runFail(["claude.cli_path", tmpDir]);
      expect(stderr).toContain("not found");
    });

    it("updates existing claude value", async () => {
      run(["claude.cli_path", "/old/path", "--force", tmpDir]);
      run(["claude.cli_path", "/new/path", "--force", tmpDir]);

      const output = run(["claude.cli_path", tmpDir]);
      expect(output.trim()).toBe("/new/path");

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.cli_path).toBe("/new/path");
    });
  });

  // ── Help — Claude settings ───────────────────────────────────────────────

  describe("help — claude settings", () => {
    it("documents claude.cli_path", () => {
      const output = run(["--help"]);
      expect(output).toContain("claude.cli_path");
    });

    it("documents claude.api_key", () => {
      const output = run(["--help"]);
      expect(output).toContain("claude.api_key");
    });

    it("notes claude settings are shared across packages", () => {
      const output = run(["--help"]);
      expect(output).toContain("shared across all packages");
    });

    it("warns about .gitignore for api_key", () => {
      const output = run(["--help"]);
      expect(output).toContain(".gitignore");
    });

    it("includes claude config examples", () => {
      const output = run(["--help"]);
      expect(output).toContain("n-dx config claude.cli_path");
      expect(output).toContain("n-dx config claude.api_key");
    });
  });

  // ── Claude config validation ────────────────────────────────────────────

  describe("claude config validation", () => {
    describe("cli_path validation", () => {
      it("rejects cli_path when file does not exist", () => {
        const stderr = runFail(["claude.cli_path", "/nonexistent/path/to/claude", tmpDir]);
        expect(stderr).toContain("File not found");
        expect(stderr).toContain("/nonexistent/path/to/claude");
      });

      it.skipIf(process.platform === "win32")("rejects cli_path when file is not executable", async () => {
        const nonExecPath = join(tmpDir, "not-executable");
        await writeFile(nonExecPath, "#!/bin/sh\necho hi\n");
        await chmod(nonExecPath, 0o644); // readable but not executable

        const stderr = runFail(["claude.cli_path", nonExecPath, tmpDir]);
        expect(stderr).toContain("not executable");
      });

      it("accepts cli_path when file exists and is executable", async () => {
        const execPath = join(tmpDir, "fake-claude");
        await writeFile(execPath, "#!/bin/sh\necho hi\n");
        await chmod(execPath, 0o755);

        const output = run(["claude.cli_path", execPath, tmpDir]);
        expect(output).toContain(`claude.cli_path = ${execPath}`);
      });

      it("skips validation with --force flag", () => {
        const output = run(["claude.cli_path", "/nonexistent/path", "--force", tmpDir]);
        expect(output).toContain("claude.cli_path = /nonexistent/path");
      });

      it("provides hint to use --force on validation failure", () => {
        const stderr = runFail(["claude.cli_path", "/nonexistent/path", tmpDir]);
        expect(stderr).toContain("--force");
      });
    });

    describe("api_key validation", () => {
      it("rejects api_key with invalid format", () => {
        const stderr = runFail(["claude.api_key", "invalid-key-format", tmpDir]);
        expect(stderr).toContain('start with "sk-ant-"');
      });

      it("rejects empty string api_key", () => {
        const stderr = runFail(["claude.api_key", "not-a-key", tmpDir]);
        expect(stderr).toContain("Invalid API key format");
      });

      it("accepts api_key with correct format", () => {
        const output = run(["claude.api_key", "sk-ant-api03-test-key-123", tmpDir]);
        expect(output).toContain("claude.api_key = sk-ant-api03-test-key-123");
      });

      it("skips validation with --force flag", () => {
        const output = run(["claude.api_key", "custom-key", "--force", tmpDir]);
        expect(output).toContain("claude.api_key = custom-key");
      });

      it("provides helpful error with link to console", () => {
        const stderr = runFail(["claude.api_key", "bad-key", tmpDir]);
        expect(stderr).toContain("console.anthropic.com");
      });
    });

    describe("help documents validation", () => {
      it("documents --force flag", () => {
        const output = run(["--help"]);
        expect(output).toContain("--force");
      });

      it("documents --test-connection flag", () => {
        const output = run(["--help"]);
        expect(output).toContain("--test-connection");
      });

      it("notes validation on cli_path", () => {
        const output = run(["--help"]);
        expect(output).toContain("must exist and be");
        expect(output).toContain("executable");
      });

      it("notes validation on api_key", () => {
        const output = run(["--help"]);
        expect(output).toContain('start with "sk-ant-"');
      });
    });
  });

  // ── Test connection ─────────────────────────────────────────────────────

  describe("test connection", () => {
    it("errors when no claude config exists", () => {
      const stderr = runFail(["--test-connection", tmpDir]);
      expect(stderr).toContain("No Claude configuration set");
    });

    it.skipIf(process.platform === "win32")("tests cli_path with configured binary", async () => {
      // Create a fake claude binary that outputs a version
      const fakeClaude = join(tmpDir, "fake-claude");
      await writeFile(fakeClaude, "#!/bin/sh\necho '1.0.0-test'\n");
      await chmod(fakeClaude, 0o755);

      run(["claude.cli_path", fakeClaude, tmpDir]);
      const output = run(["--test-connection", tmpDir]);
      expect(output).toContain("Testing CLI path...");
      expect(output).toContain("✓");
    });

    it("reports cli_path failure for nonexistent binary", async () => {
      // Use --force to set a bad path, then test
      run(["claude.cli_path", "/nonexistent/claude-binary", "--force", tmpDir]);

      const stderr = runFail(["--test-connection", tmpDir]);
      expect(stderr).toContain("Testing CLI path...");
      expect(stderr).toContain("✗");
    });
  });

  // ── API endpoint and model configuration ────────────────────────────────

  describe("claude.api_endpoint", () => {
    it("sets claude.api_endpoint in .n-dx.json", async () => {
      const output = run(["claude.api_endpoint", "https://proxy.example.com", tmpDir]);
      expect(output).toContain("claude.api_endpoint = https://proxy.example.com");

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.api_endpoint).toBe("https://proxy.example.com");
    });

    it("gets claude.api_endpoint after setting it", () => {
      run(["claude.api_endpoint", "https://custom.api.com", tmpDir]);
      const output = run(["claude.api_endpoint", tmpDir]);
      expect(output.trim()).toBe("https://custom.api.com");
    });

    it("rejects invalid URL format", () => {
      const stderr = runFail(["claude.api_endpoint", "not-a-url", tmpDir]);
      expect(stderr).toContain("Invalid URL");
    });

    it("rejects non-HTTP URL", () => {
      const stderr = runFail(["claude.api_endpoint", "ftp://example.com", tmpDir]);
      expect(stderr).toContain("Invalid protocol");
    });

    it("accepts http:// URL", () => {
      const output = run(["claude.api_endpoint", "http://localhost:8080", tmpDir]);
      expect(output).toContain("claude.api_endpoint = http://localhost:8080");
    });

    it("skips validation with --force flag", () => {
      const output = run(["claude.api_endpoint", "custom-endpoint", "--force", tmpDir]);
      expect(output).toContain("claude.api_endpoint = custom-endpoint");
    });

    it("shows api_endpoint in --json output", async () => {
      run(["claude.api_endpoint", "https://proxy.example.com", tmpDir]);
      run(["claude.api_key", "sk-ant-test", tmpDir]);

      const output = run(["--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.claude.api_endpoint).toBe("https://proxy.example.com");
      expect(parsed.claude.api_key).toBe("sk-ant-test");
    });
  });

  describe("claude.model", () => {
    it("sets claude.model in .n-dx.json", async () => {
      const output = run(["claude.model", "claude-opus-4-20250514", tmpDir]);
      expect(output).toContain("claude.model = claude-opus-4-20250514");

      const ndxConfig = JSON.parse(
        await readFile(join(tmpDir, ".n-dx.json"), "utf-8"),
      );
      expect(ndxConfig.claude.model).toBe("claude-opus-4-20250514");
    });

    it("gets claude.model after setting it", () => {
      run(["claude.model", "claude-sonnet-4-20250514", tmpDir]);
      const output = run(["claude.model", tmpDir]);
      expect(output.trim()).toBe("claude-sonnet-4-20250514");
    });

    it("shows model in --json output", async () => {
      run(["claude.model", "claude-opus-4-20250514", tmpDir]);

      const output = run(["claude", "--json", tmpDir]);
      const parsed = JSON.parse(output);
      expect(parsed.model).toBe("claude-opus-4-20250514");
    });
  });

  // ── Help — new claude settings ─────────────────────────────────────────

  describe("help — api_endpoint and model", () => {
    it("documents claude.api_endpoint", () => {
      const output = run(["--help"]);
      expect(output).toContain("claude.api_endpoint");
    });

    it("documents claude.model", () => {
      const output = run(["--help"]);
      expect(output).toContain("claude.model");
    });

    it("shows default endpoint", () => {
      const output = run(["--help"]);
      expect(output).toContain("https://api.anthropic.com");
    });

    it("shows model examples", () => {
      const output = run(["--help"]);
      expect(output).toContain("claude-sonnet-4-20250514");
      expect(output).toContain("claude-opus-4-20250514");
    });

    it("includes api_endpoint example", () => {
      const output = run(["--help"]);
      expect(output).toContain("n-dx config claude.api_endpoint");
    });

    it("includes model example", () => {
      const output = run(["--help"]);
      expect(output).toContain("n-dx config claude.model");
    });
  });

  // ── Secure file permissions ──────────────────────────────────────────────

  describe("secure file permissions", () => {
    it.skipIf(process.platform === "win32")("sets .n-dx.json to 0600 when api_key is present", async () => {
      run(["claude.api_key", "sk-ant-test-key-123", tmpDir]);

      const fileStat = await stat(join(tmpDir, ".n-dx.json"));
      // 0o600 = owner read/write only (decimal 384)
      const mode = fileStat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("does not restrict permissions when no api_key present", async () => {
      run(["claude.cli_path", "/some/path", "--force", tmpDir]);

      const fileStat = await stat(join(tmpDir, ".n-dx.json"));
      const mode = fileStat.mode & 0o777;
      // Should not be 0o600 — default file permissions apply
      expect(mode).not.toBe(0o600);
    });

    it.skipIf(process.platform === "win32")("restricts permissions when api_key is added to existing config", async () => {
      // First set a non-sensitive value
      run(["claude.cli_path", "/some/path", "--force", tmpDir]);
      const beforeStat = await stat(join(tmpDir, ".n-dx.json"));
      const beforeMode = beforeStat.mode & 0o777;
      expect(beforeMode).not.toBe(0o600);

      // Now add an API key
      run(["claude.api_key", "sk-ant-secure-key", tmpDir]);
      const afterStat = await stat(join(tmpDir, ".n-dx.json"));
      const afterMode = afterStat.mode & 0o777;
      expect(afterMode).toBe(0o600);
    });

    it("mentions 0600 permissions in help text", () => {
      const output = run(["--help"]);
      expect(output).toContain("0600");
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
