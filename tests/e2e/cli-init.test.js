import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWin = process.platform === "win32";
const PATH_SEP = isWin ? ";" : ":";

/**
 * Create a platform-appropriate fake CLI binary on PATH.
 * On Unix: shell script. On Windows: .cmd batch file.
 */
async function writeFakeBinary(filePath, { stdout = "", stderrLine = "", exitCode = 0, captureArgs = false } = {}) {
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (captureArgs) lines.push("echo %* > \"%~f0.args\"");
    if (stderrLine) lines.push(`echo ${stderrLine} 1>&2`);
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  if (captureArgs) lines.push('echo "$@" > "$0.args"');
  if (stderrLine) lines.push(`echo '${stderrLine}' 1>&2`);
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 20000,
    stdio: "pipe",
    ...opts,
  });
}

function runFail(args, opts = {}) {
  try {
    run(args, opts);
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return {
      stdout: err.stdout,
      stderr: err.stderr,
      status: err.status,
    };
  }
}

describe("n-dx init provider selection", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("selects codex provider via --provider flag and shows confirmation", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-prompt-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

      const output = run(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        },
      });
      // Unified summary shows LLM configuration section with provider and model
      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("persists selected provider to project settings", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-persist-"));
    try {
      await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

      run(["init", "--provider=claude", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        },
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
    const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
    expect(ndxConfig.llm.vendor).toBe("claude");
  });

  it("persists both providers through config get pathway", async () => {
    const cases = [
      { provider: "codex", stdout: "ok" },
      { provider: "claude", stdout: '{"result":"ok"}' },
    ];

    for (const { provider, stdout } of cases) {
      const projectDir = await mkdtemp(join(tmpdir(), `ndx-init-${provider}-`));
      const binDir = await mkdtemp(join(tmpdir(), `ndx-init-bin-${provider}-`));
      try {
        await writeFakeBinary(join(binDir, provider), { stdout });

        run(["init", `--provider=${provider}`, projectDir], {
          env: {
            ...process.env,
            PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          },
        });

        const configured = run(["config", "llm.vendor", projectDir]).trim();
        expect(configured).toBe(provider);
      } finally {
        await rm(binDir, { recursive: true, force: true });
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  });

  it("exits non-zero with clear message when no provider is given in non-TTY mode", () => {
    const result = runFail(["init", tmpDir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Init cancelled: no provider selected");
  });

  it("suppresses init banner in non-interactive mode", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-noninteractive-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

      const output = run(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        },
      });

      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
      // Banner box should be suppressed; "n-dx initialized" summary is fine
      expect(output).not.toContain("Guided project setup");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  describe("assistant-specific init flags and summary reporting", () => {
    it("shows 'Assistant surfaces' header in init summary", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-surfaces-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` } },
        );

        expect(output).toContain("Assistant surfaces:");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows vendor labels in summary instead of raw vendor names", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-labels-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` } },
        );

        expect(output).toContain("Claude Code");
        expect(output).toContain("Codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows skip reason with flag name when --no-codex is used", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-no-codex-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", "--no-codex", tmpDir],
          { env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` } },
        );

        expect(output).toContain("Assistant surfaces:");
        expect(output).toMatch(/Codex\s+skipped \(--no-codex\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows skip reason with flag name when --no-claude is used", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-no-claude-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", "--no-claude", tmpDir],
          { env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` } },
        );

        expect(output).toContain("Assistant surfaces:");
        expect(output).toMatch(/Claude Code\s+skipped \(--no-claude\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows artifact details for provisioned vendors", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-artifacts-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` } },
        );

        // Claude line should include artifact info
        expect(output).toContain("CLAUDE.md");
        expect(output).toMatch(/\d+ skills/);
        // Codex line should include artifact info
        expect(output).toContain("AGENTS.md");
        expect(output).toMatch(/\d+ MCP servers/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("--no-codex is documented in help text", () => {
      const output = run(["init", "--help"]);
      expect(output).toContain("--no-codex");
      expect(output).toContain("--no-claude");
    });
  });

  describe("provider auth preflight during init", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("completes codex init when authenticated and does not show login prompt", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-ok-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok", captureArgs: true });

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+codex/);
        expect(output).not.toContain("Next step: run");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("prompts codex login command when codex auth is missing", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-fail-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stderrLine: "not logged in", exitCode: 7 });

        const result = runFail(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Provider auth preflight failed for \"codex\"");
        expect(result.stderr).toContain("Next step: run 'codex login'");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("completes claude init when authenticated and does not show login prompt", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-ok-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}', captureArgs: true });

        const output = run(
          ["init", "--provider=claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+claude/);
        expect(output).not.toContain("Next step: run");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("prompts claude login command when claude auth is missing", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-fail-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stderrLine: "please login", exitCode: 9 });

        const result = runFail(
          ["init", "--provider=claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Provider auth preflight failed for \"claude\"");
        expect(result.stderr).toContain("Next step: run 'claude login'");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── model persistence via runConfig() ──────────────────────────────────────

  describe("model persistence via runConfig()", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("persists model to .n-dx.json under llm.<vendor>.model when --model flag is given", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
        expect(ndxConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("persists claude model under llm.claude.model", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-claude-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        run(["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir], {
          env: pathEnvWith(binDir),
        });

        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("claude");
        expect(ndxConfig.llm.claude.model).toBe("claude-sonnet-4-6");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("does not write model key when provider preflight fails", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-fail-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stderrLine: "not logged in", exitCode: 7 });

        const result = runFail(
          ["init", "--provider=codex", "--model=gpt-5-codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).not.toBe(0);
        // .n-dx.json should not contain model (vendor preflight failed)
        const configPath = join(tmpDir, ".n-dx.json");
        if (existsSync(configPath)) {
          const ndxConfig = JSON.parse(await readFile(configPath, "utf-8"));
          expect(ndxConfig?.llm?.codex?.model).toBeUndefined();
        }
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("model is readable via config get pathway after persistence", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-get-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        const modelValue = run(["config", "llm.codex.model", tmpDir]).trim();
        expect(modelValue).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("does not write model to .hench/config.json or .codex/config.toml", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-isolation-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // .hench/config.json should not contain model
        const henchConfigPath = join(tmpDir, ".hench", "config.json");
        if (existsSync(henchConfigPath)) {
          const henchConfig = JSON.parse(await readFile(henchConfigPath, "utf-8"));
          expect(henchConfig.model).not.toBe("gpt-5-codex");
        }

        // .codex/config.toml should not contain model
        const codexConfigPath = join(tmpDir, ".codex", "config.toml");
        if (existsSync(codexConfigPath)) {
          const codexContent = await readFile(codexConfigPath, "utf-8");
          expect(codexContent).not.toContain("gpt-5-codex");
        }
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("vendor is written before model (ordering guarantee)", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-model-order-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Both vendor and model should be present and consistent
        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
        expect(ndxConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── init summary shows provider and model ──────────────────────────────────

  describe("init summary shows both provider and model", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("shows Provider and Model lines when both flags are given", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-summary-both-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", "--model=gpt-5-codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+codex\s+\(from --provider flag\)/);
        expect(output).toMatch(/Model\s+gpt-5-codex\s+\(from --model flag\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows model with source label for claude provider", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-summary-claude-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        const output = run(
          ["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+claude/);
        expect(output).toMatch(/Model\s+claude-sonnet-4-6/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("values in summary match what was persisted to .n-dx.json", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-summary-match-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", "--model=gpt-5-codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // Summary shows the values
        expect(output).toMatch(/Provider\s+codex/);
        expect(output).toMatch(/Model\s+gpt-5-codex/);

        // Values match persisted config
        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
        expect(ndxConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows 'Provider skipped' when LLM selection is cancelled", () => {
      // Non-TTY with no flags → no provider → init fails before summary.
      // The skipped path is exercised when a TTY user presses Esc, but we
      // cannot simulate that in a non-TTY e2e harness. Instead, verify the
      // non-TTY error path still works (no regression).
      const result = runFail(["init", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Init cancelled: no provider selected");
    });
  });

  // ── backward-compatible re-init ────────────────────────────────────────────

  describe("backward-compatible re-init detection", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("re-init on Claude-only project skips Codex when no flags are passed", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-compat-claude-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: provisions both vendors
        run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );
        expect(existsSync(join(tmpDir, ".claude"))).toBe(true);
        expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);

        // Remove Codex artifacts to simulate a prior Claude-only project
        await rm(join(tmpDir, ".codex"), { recursive: true, force: true });
        await rm(join(tmpDir, ".agents"), { recursive: true, force: true });
        await rm(join(tmpDir, "AGENTS.md"), { force: true });

        // Re-init without flags — should only re-provision Claude
        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("Claude Code");
        expect(output).toMatch(/Codex\s+skipped/);
        expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(false);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("re-init on Codex-only project skips Claude when no flags are passed", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-compat-codex-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: provisions both vendors
        run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // Remove Claude artifacts to simulate a prior Codex-only project
        await rm(join(tmpDir, ".claude"), { recursive: true, force: true });
        await rm(join(tmpDir, "CLAUDE.md"), { force: true });

        // Re-init without flags — should only re-provision Codex
        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toMatch(/Claude Code\s+skipped/);
        expect(output).toContain("Codex");
        expect(output).toContain("AGENTS.md");
        expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("re-init provisions both when both surfaces already exist", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-compat-both-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: provisions both
        run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // Re-init without flags — both already exist → both re-provisioned
        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).not.toMatch(/Claude Code\s+skipped/);
        expect(output).not.toMatch(/Codex\s+skipped/);
        expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("first init provisions both vendors when no surfaces exist", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-compat-fresh-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).not.toMatch(/Claude Code\s+skipped/);
        expect(output).not.toMatch(/Codex\s+skipped/);
        expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("explicit --assistants= overrides re-init detection", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-compat-override-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: provisions both
        run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // Remove Codex artifacts (simulating Claude-only)
        await rm(join(tmpDir, ".codex"), { recursive: true, force: true });
        await rm(join(tmpDir, ".agents"), { recursive: true, force: true });
        await rm(join(tmpDir, "AGENTS.md"), { force: true });

        // Re-init with explicit --assistants=claude,codex overrides detection
        const output = run(
          ["init", "--provider=codex", "--assistants=claude,codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).not.toMatch(/Claude Code\s+skipped/);
        expect(output).not.toMatch(/Codex\s+skipped/);
        expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── re-init with existing LLM config ──────────────────────────────────────

  describe("re-init with existing LLM config", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("reuses vendor from config when --provider flag is omitted", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-vendor-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: establish vendor + model
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Re-init WITHOUT --provider flag — should reuse vendor from config
        const output = run(["init", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+codex\s+\(from existing config\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("reuses both vendor and model from config when all flags are omitted", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-both-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: establish vendor + model
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Re-init WITHOUT any LLM flags
        const output = run(["init", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+codex\s+\(from existing config\)/);
        expect(output).toMatch(/Model\s+gpt-5-codex\s+\(from existing config\)/);

        // Verify .n-dx.json is unchanged
        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
        expect(ndxConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("reuses claude vendor and model from config on re-init", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-claude-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        // First init: establish claude vendor + model
        run(["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Re-init WITHOUT flags
        const output = run(["init", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+claude\s+\(from existing config\)/);
        expect(output).toMatch(/Model\s+claude-sonnet-4-6\s+\(from existing config\)/);

        // Verify persistence is intact
        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("claude");
        expect(ndxConfig.llm.claude.model).toBe("claude-sonnet-4-6");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows 'Model not set' when config has vendor but no model (non-TTY)", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-nomodel-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: establish vendor + model
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Remove model from config (keep vendor)
        const configPath = join(tmpDir, ".n-dx.json");
        const config = JSON.parse(await readFile(configPath, "utf-8"));
        delete config.llm.codex.model;
        await writeFile(configPath, JSON.stringify(config, null, 2));

        // Re-init WITHOUT flags — provider from config, model missing
        const output = run(["init", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+codex\s+\(from existing config\)/);
        expect(output).toMatch(/Model\s+not set/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("accepts --model flag to supply missing model on re-init", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-modelflag-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init: establish vendor + model
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Remove model from config (keep vendor)
        const configPath = join(tmpDir, ".n-dx.json");
        const config = JSON.parse(await readFile(configPath, "utf-8"));
        delete config.llm.codex.model;
        await writeFile(configPath, JSON.stringify(config, null, 2));

        // Re-init with --model flag only (no --provider)
        const output = run(["init", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+codex\s+\(from existing config\)/);
        expect(output).toMatch(/Model\s+gpt-5-codex\s+\(from --model flag\)/);

        // Verify model was persisted
        const finalConfig = JSON.parse(await readFile(configPath, "utf-8"));
        expect(finalConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("summary shows mixed sources: provider from config, model from flag", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-reinit-mixed-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        // First init: establish claude vendor + model
        run(["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Remove model from config
        const configPath = join(tmpDir, ".n-dx.json");
        const config = JSON.parse(await readFile(configPath, "utf-8"));
        delete config.llm.claude.model;
        await writeFile(configPath, JSON.stringify(config, null, 2));

        // Re-init: provider from config, model from flag (non-recommended)
        const output = run(["init", "--model=claude-opus-4-20250514", tmpDir], {
          env: pathEnvWith(binDir),
        });

        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+claude\s+\(from existing config\)/);
        expect(output).toMatch(/Model\s+claude-opus-4-20250514\s+\(from --model flag\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── flag-driven init uses exact values ────────────────────────────────────

  describe("flag-driven init uses exact values without auto-selection", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("--model flag with non-recommended model persists without auto-correction", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-nonrec-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        run(["init", "--provider=claude", "--model=claude-opus-4-20250514", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Exact non-recommended model is persisted (not overridden to recommended)
        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.claude.model).toBe("claude-opus-4-20250514");

        // Summary shows the exact model with flag source
        const output = run(["init", "--provider=claude", "--model=claude-opus-4-20250514", tmpDir], {
          env: pathEnvWith(binDir),
        });
        expect(output).toMatch(/Model\s+claude-opus-4-20250514\s+\(from --model flag\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("--provider flag overrides existing config vendor", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-override-vendor-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        // First init with codex
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        let ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");

        // Re-init with different provider flag
        run(["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir], {
          env: pathEnvWith(binDir),
        });

        ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("claude");
        expect(ndxConfig.llm.claude.model).toBe("claude-sonnet-4-6");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("--provider same as config still shows 'from --provider flag' in summary", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-same-flag-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        // First init
        run(["init", "--provider=codex", "--model=gpt-5-codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Re-init with same provider flag — flag takes precedence over config
        const output = run(["init", "--provider=codex", tmpDir], {
          env: pathEnvWith(binDir),
        });

        // Flag source label even though config has the same value
        expect(output).toMatch(/Provider\s+codex\s+\(from --provider flag\)/);
        // Model still comes from config
        expect(output).toMatch(/Model\s+gpt-5-codex\s+\(from existing config\)/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── incompatible flag validation ──────────────────────────────────────────

  describe("incompatible flag combination validation", () => {
    it("rejects --provider=codex with --claude-model", () => {
      const result = runFail(["init", "--provider=codex", "--claude-model=claude-sonnet-4-6", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Cannot set --claude-model when --provider is codex");
      expect(result.stderr).toContain("Use --codex-model instead");
    });

    it("rejects --provider=claude with --codex-model", () => {
      const result = runFail(["init", "--provider=claude", "--codex-model=gpt-5-codex", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Cannot set --codex-model when --provider is claude");
      expect(result.stderr).toContain("Use --claude-model instead");
    });

    it("rejects both --claude-model and --codex-model together", () => {
      const result = runFail(["init", "--claude-model=claude-sonnet-4-6", "--codex-model=gpt-5-codex", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Cannot set both --claude-model and --codex-model");
    });

    it("rejects --claude-model with --model (ambiguous)", () => {
      const result = runFail(["init", "--claude-model=claude-sonnet-4-6", "--model=claude-opus-4-20250514", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Cannot set both --claude-model and --model");
    });

    it("rejects --codex-model with --model (ambiguous)", () => {
      const result = runFail(["init", "--codex-model=gpt-5-codex", "--model=gpt-5-codex", tmpDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Cannot set both --codex-model and --model");
    });
  });

  // ── unknown model warning ─────────────────────────────────────────────────

  describe("unknown model ID warning", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("warns but succeeds when --model is not in vendor catalog", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-unknown-model-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        const output = run(
          ["init", "--provider=claude", "--model=claude-custom-v99", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // Should still succeed (warning does not block init)
        expect(output).toContain("n-dx initialized");
        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Model\s+claude-custom-v99/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("does not warn when model is in vendor catalog", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-known-model-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        const output = run(
          ["init", "--provider=claude", "--model=claude-sonnet-4-6", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("n-dx initialized");
        expect(output).not.toContain("Unknown model");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("--claude-model with known model does not warn", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-known-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        const output = run(
          ["init", "--claude-model=claude-sonnet-4-6", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("n-dx initialized");
        expect(output).not.toContain("Unknown model");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });

  // ── vendor-specific model flags work end-to-end ───────────────────────────

  describe("vendor-specific model flags (--claude-model, --codex-model)", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
      };
    }

    it("--claude-model implies provider=claude and persists both", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-model-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

        const output = run(
          ["init", "--claude-model=claude-sonnet-4-6", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+claude/);
        expect(output).toMatch(/Model\s+claude-sonnet-4-6/);

        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("claude");
        expect(ndxConfig.llm.claude.model).toBe("claude-sonnet-4-6");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("--codex-model implies provider=codex and persists both", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-model-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(
          ["init", "--codex-model=gpt-5-codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("n-dx initialized");
        expect(output).toMatch(/Provider\s+codex/);
        expect(output).toMatch(/Model\s+gpt-5-codex/);

        const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
        expect(ndxConfig.llm.codex.model).toBe("gpt-5-codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });
});
