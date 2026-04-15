import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";

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

  it("prompts with codex and claude options only", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-prompt-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

      const output = run(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          // Short-circuit claude MCP registration; this test only asserts on
          // banner/LLM configuration output, not claude behavior. See
          // packages/core/claude-integration.js:306–320.
          CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
        },
      });
      // Banner shows on every init invocation
      expect(output).toContain("En Dash DX");
      expect(output).toContain("n-dx init");
      // Unified summary shows LLM configuration
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
      { provider: "codex", stdout: "ok", extraFlags: ["--no-claude"] },
      { provider: "claude", stdout: '{"result":"ok"}', extraFlags: [] },
    ];

    for (const { provider, stdout, extraFlags } of cases) {
      const projectDir = await mkdtemp(join(tmpdir(), `ndx-init-${provider}-`));
      const binDir = await mkdtemp(join(tmpdir(), `ndx-init-bin-${provider}-`));
      try {
        await writeFakeBinary(join(binDir, provider), { stdout });

        run(["init", `--provider=${provider}`, ...extraFlags, projectDir], {
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

  it("exits non-zero with clear message when selection is cancelled", () => {
    const result = runFail(["init", tmpDir], { input: "\n" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Init cancelled: no provider selected");
  });

  it("shows banner and LLM configuration in non-interactive mode", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-noninteractive-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

      const output = run(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          // Short-circuit claude MCP registration to keep the child-process
          // init under the 20s timeout. This test only checks banner/LLM
          // output, not claude-specific behavior. See
          // packages/core/claude-integration.js:306–320.
          CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
        },
      });

      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
      // Banner always shows on every init invocation
      expect(output).toContain("En Dash DX");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
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
          ["init", "--provider=codex", "--no-claude", tmpDir],
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

  describe("branded init experience", () => {
    it("shows trex mascot banner during init", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-phases-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(["init", "--provider=codex", "--no-claude", tmpDir], {
          env: {
            ...process.env,
            PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          },
        });

        expect(output).toContain("En Dash DX");
        expect(output).toContain("n-dx init");
        expect(output).toContain("n-dx initialized");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows assistant surfaces in init summary", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-recap-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(["init", "--provider=codex", "--no-claude", tmpDir], {
          env: {
            ...process.env,
            PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          },
        });

        expect(output).toContain("Assistant surfaces:");
        expect(output).toContain("Claude Code");
        expect(output).toContain("Codex");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("produces no ANSI escape codes when NO_COLOR is set", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-nocolor-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(["init", "--provider=codex", "--no-claude", tmpDir], {
          env: {
            ...process.env,
            NO_COLOR: "1",
            PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          },
        });

        expect(output).not.toMatch(/\x1b\[/);
        // Content still present
        expect(output).toContain("n-dx initialized");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("shows full summary even in non-TTY environments", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-quiet-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

        const output = run(["init", "--provider=codex", tmpDir], {
          env: {
            ...process.env,
            PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
            // Short-circuit claude MCP registration; this test checks the
            // non-TTY summary, not claude-specific output. See
            // packages/core/claude-integration.js:306–320.
            CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
          },
        });

        expect(output).toContain("n-dx initialized");
        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+codex/);
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });
});

describe("claude CLI discovery diagnostics", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-diag-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Returns true if claude is reachable via system PATH or common absolute install
   * paths — used to skip the "no claude" scenario on developer machines.
   */
  function claudeFoundOnSystem() {
    try {
      execFileSync("claude", ["--version"], { stdio: "ignore", timeout: 3_000 });
      return true;
    } catch { /* not in PATH */ }
    const commonPaths = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      join(homedir(), ".npm-global", "bin", "claude"),
    ];
    return commonPaths.some((p) => existsSync(p));
  }

  it("exits non-zero and lists searched paths when claude CLI is absent from PATH", async () => {
    if (claudeFoundOnSystem()) return; // skip on machines with claude installed system-wide

    const binDir = await mkdtemp(join(tmpdir(), "ndx-diag-bin-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
      const { CLAUDE_CLI_PATH: _omit, ...envWithout } = process.env;
      // Include node's own bin dir so subprocesses can find node, but nothing else
      const nodeBinDir = dirname(process.execPath);

      const result = runFail(["init", "--provider=codex", tmpDir], {
        env: {
          ...envWithout,
          PATH: `${binDir}${PATH_SEP}${nodeBinDir}`,
          HOME: tmpDir, // prevent ~/.npm-global match on homedir()
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("claude CLI not found");
      expect(result.stderr).toContain("Searched:");
      expect(result.stderr).toMatch(/claude \(PATH\)/);
      expect(result.stderr).toMatch(/brew install claude|npm install -g claude/);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  // Skipped: feature branch's setupAssistantIntegrations is designed so that
  // failure in one vendor (Claude) does not block another (Codex). When
  // --provider=codex is used, Claude discovery failure is captured in the
  // result summary but does not fail init.
  it.skip("exits non-zero with structured error when CLAUDE_CLI_PATH points to nonexistent file", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-diag-envpath-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });

      const result = runFail(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
          CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("claude CLI not found");
      expect(result.stderr).toContain("/nonexistent/path/to/claude");
      expect(result.stderr).toContain("CLAUDE_CLI_PATH");
      expect(result.stderr).toMatch(/brew install claude|npm install -g claude/);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });
});
