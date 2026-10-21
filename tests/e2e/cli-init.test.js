import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { DEFAULT_TIMEOUT, withSandboxedClaudeConfig } from "./e2e-helpers.js";

/**
 * A full `ndx init` spawns rex, hench and sourcevision init in turn and tries
 * the Claude MCP registration: two seconds on a developer machine, seven on
 * the Windows CI runner. This file used to run one per test, several of them
 * byte-for-byte identical (same fake binary, same flags, same environment) and
 * differing only in which line of the output they asserted on: 31 runs for 25
 * tests, 188 s on the Windows leg (run 38193308009), the second-longest file
 * in the monorepo.
 *
 * Where several tests read the same run, that run is now made once in a
 * `beforeAll` and the tests assert on its captured output. Runs that differ in
 * their inputs — a failing fake, a missing key, a pre-existing file — are
 * still made on their own. One `it` per contract is kept so a failure still
 * names the line that broke.
 */

const isWin = process.platform === "win32";
const PATH_SEP = isWin ? ";" : ":";

/**
 * Create a platform-appropriate fake CLI binary on PATH.
 * On Unix: shell script. On Windows: .cmd batch file.
 *
 * When `captureArgs` is set the shim records its argv at `fakeBinaryArgsPath()`,
 * which is ABSOLUTE and baked into the script. It must not be derived from `$0`
 * or `%~f0`: neither searches PATH, so a shim invoked by bare name (which is how
 * `ndx init` calls `claude`/`codex`) resolved them against the CWD and dropped a
 * `claude.args` file in the repository root. `%~f0` is the more surprising of the
 * two — it "fully qualifies" %0 by prefixing the current directory rather than
 * locating the file.
 */
async function writeFakeBinary(filePath, { stdout = "", stderrLine = "", exitCode = 0, captureArgs = false } = {}) {
  const argsPath = fakeBinaryArgsPath(filePath);
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (captureArgs) lines.push(`echo %* > "${argsPath}"`);
    if (stderrLine) lines.push(`echo ${stderrLine} 1>&2`);
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  // Single-quoted so nothing in the path is expanded. mkdtemp paths contain no
  // single quotes, so this needs no escaping.
  if (captureArgs) lines.push(`echo "$@" > '${argsPath}'`);
  if (stderrLine) lines.push(`echo '${stderrLine}' 1>&2`);
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

/**
 * Where a `captureArgs` shim records its argv. Same on every platform — notably
 * NOT `<shim>.cmd.args` on Windows — so callers need no platform branch.
 */
function fakeBinaryArgsPath(filePath) {
  return `${filePath}.args`;
}

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/**
 * Where `ndx init` puts the project config.
 *
 * Every project these tests create is empty before init runs, so init
 * establishes the `.ndx/` layout and the config lands at `.ndx/config.json`
 * rather than `.n-dx.json`. Written as a helper rather than inlined so the
 * reason is stated once.
 */
function projectConfigPath(dir) {
  return join(dir, ".ndx", "config.json");
}

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    stdio: "pipe",
    ...withSandboxedClaudeConfig(opts),
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

/**
 * Run init capturing stdout/stderr/status without throwing on non-zero exit.
 * Needed to inspect stderr on a successful exit (e.g. the soft-preflight warning
 * init emits while still persisting the vendor and exiting 0).
 */
function runCapture(args, opts = {}) {
  const res = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    stdio: "pipe",
    ...withSandboxedClaudeConfig(opts),
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

/** `process.env` with `dirs` prepended to PATH. */
function pathEnvWith(...dirs) {
  return {
    ...process.env,
    PATH: `${dirs.join(PATH_SEP)}${PATH_SEP}${process.env.PATH ?? ""}`,
  };
}

/**
 * A fresh project dir and a bin dir holding one fake `codex` that answers "ok".
 * The pair most runs in this file start from; the caller removes both.
 */
async function codexFixture(prefix, { captureArgs = false } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const binDir = await mkdtemp(join(tmpdir(), `${prefix}-bin-`));
  await writeFakeBinary(join(binDir, "codex"), { stdout: "ok", captureArgs });
  return { projectDir, binDir };
}

async function removeDirs(...dirs) {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

describe("fake-CLI fixture hygiene", () => {
  // The defect this pins: the shims captured argv via `$0.args` / `%~f0.args`.
  // Neither searches PATH — `%~f0` "fully qualifies" %0 by prefixing the CURRENT
  // DIRECTORY rather than locating the file — so a shim invoked by bare name (how
  // `ndx init` calls claude/codex) wrote its capture into the CWD. In practice
  // that was the repository root, and a .gitignore entry hid it for months.
  //
  // Every other test here invokes shims by absolute path, where the old form
  // happened to work. Only a bare-name invocation reproduces it, so without this
  // test nothing does.
  it("captures argv to an absolute path even when the shim is invoked by bare name", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-args-bin-"));
    const cwdDir = await mkdtemp(join(tmpdir(), "ndx-args-cwd-"));
    try {
      const base = join(binDir, "fakecli");
      await writeFakeBinary(base, { stdout: "ok", captureArgs: true });

      // Bare name, resolved through PATH, with the CWD somewhere else entirely —
      // cwdDir stands in for the repository root.
      const res = spawnSync(
        isWin ? "cmd.exe" : "sh",
        isWin ? ["/d", "/s", "/c", "fakecli hello"] : ["-c", "fakecli hello"],
        {
          cwd: cwdDir,
          encoding: "utf-8",
          env: { ...process.env, PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}` },
        },
      );
      expect(res.status).toBe(0);

      // Landed next to the shim...
      expect(existsSync(fakeBinaryArgsPath(base))).toBe(true);
      // ...and nothing was written into the working directory. Both spellings the
      // old code could have produced are checked, since %0 carries no extension.
      expect(existsSync(join(cwdDir, "fakecli.args"))).toBe(false);
      expect(existsSync(join(cwdDir, "fakecli.cmd.args"))).toBe(false);
    } finally {
      await removeDirs(binDir, cwdDir);
    }
  });
});

describe("n-dx init provider selection", () => {
  // ── `init --provider=codex` with Claude registration short-circuited ──────
  //
  // Three tests read this one run: the banner, the LLM configuration summary
  // and the non-TTY summary are all lines of the same output.
  describe("codex, Claude registration short-circuited", () => {
    let projectDir;
    let binDir;
    let output;

    beforeAll(async () => {
      ({ projectDir, binDir } = await codexFixture("ndx-init-codex"));
      output = run(["init", "--provider=codex", projectDir], {
        env: {
          ...pathEnvWith(binDir),
          // Short-circuit claude MCP registration; these tests only assert on
          // banner/LLM configuration output, not claude behavior. See
          // packages/core/claude-integration.js:306–320.
          CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
        },
      });
    });

    afterAll(async () => {
      await removeDirs(binDir, projectDir);
    });

    it("prompts with codex and claude options only", () => {
      // Banner shows on every init invocation
      expect(output).toContain("En Dash DX");
      expect(output).toContain("n-dx init");
      // Unified summary shows LLM configuration
      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
    });

    it("shows banner and LLM configuration in non-interactive mode", () => {
      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
      // Banner always shows on every init invocation
      expect(output).toContain("En Dash DX");
    });

    it("shows full summary even in non-TTY environments", () => {
      expect(output).toContain("n-dx initialized");
      expect(output).toContain("LLM configuration");
      expect(output).toMatch(/Provider\s+codex/);
    });
  });

  it("persists selected provider to project settings", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-persist-"));
    try {
      await writeFakeBinary(join(binDir, "claude"), { stdout: '{"result":"ok"}' });

      run(["init", "--provider=claude", tmpDir], { env: pathEnvWith(binDir) });

      const ndxConfig = JSON.parse(await readFile(projectConfigPath(tmpDir), "utf-8"));
      expect(ndxConfig.llm.vendor).toBe("claude");
    } finally {
      await removeDirs(binDir, tmpDir);
    }
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

        run(["init", `--provider=${provider}`, ...extraFlags, projectDir], { env: pathEnvWith(binDir) });

        const configured = run(["config", "llm.vendor", projectDir]).trim();
        expect(configured).toBe(provider);
      } finally {
        await removeDirs(binDir, projectDir);
      }
    }
  });

  it("exits non-zero with clear message when selection is cancelled", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
    try {
      const result = runFail(["init", tmpDir], { input: "\n" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Init cancelled: no provider selected");
    } finally {
      await removeDirs(tmpDir);
    }
  });

  describe("provider auth preflight during init", () => {
    // ── `init --provider=codex --no-claude`, authenticated ─────────────────
    //
    // The same run the branded-experience tests read: an authenticated codex
    // init with the Claude surface skipped. `captureArgs` is on because the
    // auth test's fixture had it; it changes nothing in the output.
    describe("codex authenticated", () => {
      let projectDir;
      let binDir;
      let output;

      beforeAll(async () => {
        ({ projectDir, binDir } = await codexFixture("ndx-init-codex-ok", { captureArgs: true }));
        output = run(["init", "--provider=codex", "--no-claude", projectDir], { env: pathEnvWith(binDir) });
      });

      afterAll(async () => {
        await removeDirs(binDir, projectDir);
      });

      it("completes codex init when authenticated and does not show login prompt", () => {
        expect(output).toContain("LLM configuration");
        expect(output).toMatch(/Provider\s+codex/);
        expect(output).not.toContain("Next step: run");
      });

      describe("branded init experience", () => {
        it("shows trex mascot banner during init", () => {
          expect(output).toContain("En Dash DX");
          expect(output).toContain("n-dx init");
          expect(output).toContain("n-dx initialized");
        });

        it("shows assistant surfaces in init summary", () => {
          expect(output).toContain("Assistant surfaces:");
          expect(output).toContain("Claude Code");
          expect(output).toContain("Codex");
        });
      });
    });

    it("warns but still persists vendor when codex auth is missing (soft preflight)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-fail-"));
      try {
        await writeFakeBinary(join(binDir, "codex"), { stderrLine: "not logged in", exitCode: 7 });

        const result = runCapture(
          ["init", "--provider=codex", "--no-claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        // init no longer aborts: the chosen vendor is persisted and applies to
        // all later commands; the auth problem is surfaced as a visible warning.
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("Authentication failed for Codex");
        expect(result.stderr).toContain("codex logout && codex login");
        expect(result.stderr).toContain("Proceeding anyway");

        const ndxConfig = JSON.parse(await readFile(projectConfigPath(tmpDir), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("codex");
      } finally {
        await removeDirs(binDir, tmpDir);
      }
    });

    it("completes claude init when authenticated and does not show login prompt", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
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
        await removeDirs(binDir, tmpDir);
      }
    });

    it("warns but still persists vendor when claude auth is missing (soft preflight)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-fail-"));
      try {
        await writeFakeBinary(join(binDir, "claude"), { stderrLine: "please login", exitCode: 9 });

        const result = runCapture(
          ["init", "--provider=claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toContain("Authentication failed for Claude");
        expect(result.stderr).toContain("claude logout && claude login");
        expect(result.stderr).toContain("Proceeding anyway");

        const ndxConfig = JSON.parse(await readFile(projectConfigPath(tmpDir), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("claude");
      } finally {
        await removeDirs(binDir, tmpDir);
      }
    });
  });

  describe("google provider init", () => {
    /**
     * Google preflight uses the Gemini API HTTP call rather than a CLI binary.
     *
     * Happy-path tests set NDX_TEST_GOOGLE_PREFLIGHT=ok (test bypass that skips
     * the live HTTP call) and a format-valid GEMINI_API_KEY.  Missing-key tests
     * omit both so the preflight returns a key-not-found error before any HTTP.
     */
    function googleEnv(overrides = {}) {
      return {
        ...process.env,
        // Suppress accidental real HTTP calls in CI by default (overridden per test)
        GEMINI_API_KEY: undefined,
        NDX_TEST_GOOGLE_PREFLIGHT: undefined,
        ...overrides,
      };
    }

    const HAPPY = {
      GEMINI_API_KEY: "AIzaFakeTestKey12345678901234567890",
      NDX_TEST_GOOGLE_PREFLIGHT: "ok",
    };

    // ── the happy path, then a second init over it ──────────────────────────
    //
    // One project carries three tests: the first init's config and output, and
    // the re-init that must keep the vendor without re-prompting. The second
    // init is made after the first-init assertions' inputs are captured, so
    // the re-init cannot alter what they read.
    describe("happy path", () => {
      let projectDir;
      let firstOutput;
      let firstConfig;
      let secondConfig;

      beforeAll(async () => {
        projectDir = await mkdtemp(join(tmpdir(), "ndx-init-google-ok-"));
        // First init
        firstOutput = run(["init", "--provider=google", "--no-claude", projectDir], { env: googleEnv(HAPPY) });
        firstConfig = JSON.parse(await readFile(projectConfigPath(projectDir), "utf-8"));
        // Second init — no --provider flag; should re-use existing config
        run(["init", "--no-claude", projectDir], { env: googleEnv(HAPPY) });
        secondConfig = JSON.parse(await readFile(projectConfigPath(projectDir), "utf-8"));
      });

      afterAll(async () => {
        await removeDirs(projectDir);
      });

      it("completes google init and persists vendor to config (happy path)", () => {
        expect(firstConfig.llm.vendor).toBe("google");
      });

      it("shows google in LLM configuration summary after init", () => {
        expect(firstOutput).toContain("LLM configuration");
        expect(firstOutput).toMatch(/Provider\s+google/);
      });

      it("skips provider re-prompt when existing config already has google vendor (idempotency)", () => {
        expect(secondConfig.llm.vendor).toBe("google");
      });
    });

    it("warns with an actionable message but still persists google when GEMINI_API_KEY is absent", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
      try {
        const result = runCapture(["init", "--provider=google", "--no-claude", tmpDir], {
          // Explicitly strip the key and bypass flag so preflight runs for real
          env: googleEnv({ GEMINI_API_KEY: undefined, NDX_TEST_GOOGLE_PREFLIGHT: undefined }),
        });
        // init persists the chosen vendor (so `ndx add`/`work` use Gemini and the
        // auth error surfaces clearly at use time) and emits a visible warning
        // instead of silently aborting and reverting to the Claude default.
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("No API key configured for Google");
        expect(result.stderr).toContain("NDX_GOOGLE_PREFLIGHT_NO_KEY");
        expect(result.stderr).toContain("aistudio.google.com/apikey");
        expect(result.stderr).toContain("Proceeding anyway");

        const ndxConfig = JSON.parse(await readFile(projectConfigPath(tmpDir), "utf-8"));
        expect(ndxConfig.llm.vendor).toBe("google");
      } finally {
        await removeDirs(tmpDir);
      }
    });
  });

  describe("branded init experience", () => {
    it("produces no ANSI escape codes when NO_COLOR is set", async () => {
      const { projectDir, binDir } = await codexFixture("ndx-init-nocolor");
      try {
        const output = run(["init", "--provider=codex", "--no-claude", projectDir], {
          env: { ...pathEnvWith(binDir), NO_COLOR: "1" },
        });

        expect(output).not.toMatch(/\x1b\[/);
        // Content still present
        expect(output).toContain("n-dx initialized");
      } finally {
        await removeDirs(binDir, projectDir);
      }
    });
  });
});

describe("init injects .gitattributes EOL pins (issue #283)", () => {
  async function initWithFakeCodex(projectDir, binDir) {
    await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
    run(["init", "--provider=codex", "--no-claude", projectDir], {
      timeout: 50_000,
      env: pathEnvWith(binDir),
    });
  }

  it("creates .gitattributes with LF pins and is idempotent on re-init", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-attrs-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-attrs-bin-"));
    try {
      await initWithFakeCodex(projectDir, binDir);

      const attrPath = join(projectDir, ".gitattributes");
      expect(existsSync(attrPath)).toBe(true);
      const first = await readFile(attrPath, "utf-8");
      for (const pattern of [
        // A fresh project is on the `.ndx/` layout, so the tool-directory pins
        // name the directories inside the container.
        ".ndx/rex/**/*.md", ".ndx/hench/**/*.json", ".ndx/config.json",
        "AGENTS.md", "CLAUDE.md",
        // Assistant + config + text surfaces must be pinned too (parity with
        // n-dx's own .gitattributes — the eol-pattern sync invariant).
        ".claude/skills/**/*.md", ".codex/config.toml", ".ndx/sourcevision/**/*.txt",
      ]) {
        expect(first).toContain(`${pattern}`);
      }
      expect(first).toMatch(/\.ndx\/rex\/\*\*\/\*\.md\s+text eol=lf/);
      expect(first).toMatch(/\.claude\/skills\/\*\*\/\*\.md\s+text eol=lf/);
      expect(first).toMatch(/\.codex\/config\.toml\s+text eol=lf/);
      expect(first).toMatch(/\.ndx\/sourcevision\/\*\*\/\*\.txt\s+text eol=lf/);

      // Re-init must not duplicate rules or the header.
      await initWithFakeCodex(projectDir, binDir);
      const second = await readFile(attrPath, "utf-8");
      expect(second).toBe(first);
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 120_000);

  it("registers the rex-prd and rex-state merge drivers in a git repo, idempotently", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-mergedrv-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-mergedrv-bin-"));
    const gitConfig = (key) =>
      execFileSync("git", ["config", "--get", key], { cwd: projectDir, encoding: "utf-8" }).trim();
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: projectDir, stdio: "pipe" });

      await initWithFakeCodex(projectDir, binDir);

      // The attributes route PRD tree paths and v2 state files to the drivers...
      const attrs = await readFile(join(projectDir, ".gitattributes"), "utf-8");
      expect(attrs).toMatch(/^\.ndx\/rex\/prd_tree\/\*\*\s+merge=rex-prd$/m);
      expect(attrs).toMatch(/^\.ndx\/rex\/product\/\*\*\/state\.yaml\s+merge=rex-state$/m);
      expect(attrs).toMatch(/^\.ndx\/rex\/changes\/\*\*\/state\.yaml\s+merge=rex-state$/m);
      // ...and git config names the driver commands.
      expect(gitConfig("merge.rex-prd.driver")).toBe("rex merge-driver %O %A %B");
      expect(gitConfig("merge.rex-state.driver")).toBe("rex merge-state %O %A %B %P");

      // Re-init changes neither the attributes file nor the config.
      const firstAttrs = attrs;
      await initWithFakeCodex(projectDir, binDir);
      expect(await readFile(join(projectDir, ".gitattributes"), "utf-8")).toBe(firstAttrs);
      expect(gitConfig("merge.rex-prd.driver")).toBe("rex merge-driver %O %A %B");
      expect(gitConfig("merge.rex-state.driver")).toBe("rex merge-state %O %A %B %P");
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 120_000);

  it("leaves a user-customized merge driver command untouched on re-init", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-mergedrv-user-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-mergedrv-user-bin-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: projectDir, stdio: "pipe" });
      execFileSync(
        "git",
        ["config", "merge.rex-prd.driver", "my-custom-driver %O %A %B"],
        { cwd: projectDir, stdio: "pipe" },
      );

      await initWithFakeCodex(projectDir, binDir);

      const driver = execFileSync("git", ["config", "--get", "merge.rex-prd.driver"], {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();
      expect(driver).toBe("my-custom-driver %O %A %B");
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 60_000);

  it("preserves existing .gitattributes content and user overrides for overlapping patterns", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-attrs-merge-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-attrs-merge-bin-"));
    try {
      const userContent = "*.png binary\n.ndx/rex/**/*.md -text\n";
      await writeFile(join(projectDir, ".gitattributes"), userContent);

      await initWithFakeCodex(projectDir, binDir);

      const merged = await readFile(join(projectDir, ".gitattributes"), "utf-8");
      // User content preserved verbatim, at the top.
      expect(merged.startsWith(userContent)).toBe(true);
      // The user's overlapping rex-markdown rule wins — not re-added by init.
      expect(merged.match(/^\.ndx\/rex\/\*\*\/\*\.md\s/gm)).toHaveLength(1);
      // Missing rules are appended.
      expect(merged).toMatch(/\.ndx\/hench\/\*\*\/\*\.json\s+text eol=lf/);
      expect(merged).toMatch(/CLAUDE\.md\s+text eol=lf/);
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 60_000);
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
      // npm -g installs under the active node prefix sit next to the node
      // binary itself — and the stripped test PATH still includes that dir,
      // so claude would be discoverable and the "no claude" scenario invalid.
      join(dirname(process.execPath), "claude"),
    ];
    return commonPaths.some((p) => existsSync(p));
  }

  it("provisions the Claude surface best-effort (exit 0) when claude CLI is absent from PATH", async () => {
    if (claudeFoundOnSystem()) return; // only meaningful where claude is genuinely unreachable (e.g. CI)

    const binDir = await mkdtemp(join(tmpdir(), "ndx-diag-bin-"));
    try {
      await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
      const { CLAUDE_CLI_PATH: _omit, ...envWithout } = process.env;
      // Include node's own bin dir so subprocesses can find node, but nothing else
      const nodeBinDir = dirname(process.execPath);

      // This runs a FULL init (the claude-discovery failure only surfaces in
      // the end-of-run summary), which can exceed the default 20s exec budget
      // under full-suite load — give it extra headroom. init provisions the
      // Claude surface best-effort and exits 0 even with the CLI absent, so
      // capture the result rather than expecting a non-zero exit.
      const result = runCapture(["init", "--provider=codex", tmpDir], {
        timeout: 50_000,
        env: {
          ...envWithout,
          PATH: `${binDir}${PATH_SEP}${nodeBinDir}`,
          HOME: tmpDir, // prevent ~/.npm-global match on homedir()
        },
      });

      expect(result.status).toBe(0);
      // Claude file surface is still written even with the CLI absent.
      expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
      expect(result.stdout).toContain("CLAUDE.md");
      // The removed hard-fail diagnostic must not resurface.
      expect(result.stdout).not.toContain("claude CLI not found");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  }, 60_000);

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
          ...pathEnvWith(binDir),
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

// ── Folder layout: which one a fresh init writes, and which one it keeps ────
//
// `ndx init` is the only command that gets to *choose* a layout — every other
// command detects one. The two cases below are that choice, and they are e2e
// rather than unit tests on purpose: the mechanism is that `.ndx/` exists
// before the sub-CLIs are spawned, and nothing short of actually spawning them
// proves rex, hench and sourcevision all agree about where to write.
describe("init establishes the folder layout", () => {
  /**
   * Init with the Claude surfaces enabled, because `.mcp.json` is written by
   * the Claude integration and its staying at the repository root is half of
   * what these tests are about. `CLAUDE_CLI_PATH` points nowhere so the
   * `claude mcp add` registration short-circuits — the tracked `.mcp.json` is
   * written by n-dx itself, not by the vendor CLI, so it still lands.
   */
  async function initWithFakeCodex(projectDir, binDir) {
    await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
    return run(["init", "--provider=codex", projectDir], {
      timeout: 50_000,
      env: {
        ...pathEnvWith(binDir),
        CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
        // The suites' v1 init default (tests/setup-session-env.js) is off here:
        // these runs are what a user gets.
        NDX_INIT_LAYOUT: undefined,
      },
    });
  }

  /**
   * The summary's directory rows, as `  <label>  <status>` with the padding
   * that lines the status column up collapsed away.
   *
   * Asserting on the rendered line rather than on `toContain(".ndx/rex/")` is
   * the point: the bug was a correct created/reused verdict printed against a
   * hard-coded label, so a test that checks only the label would still pass if
   * the two were swapped.
   */
  function summaryDirRows(output) {
    const rows = new Map();
    for (const line of output.split("\n")) {
      const match = /^ {2}(\S+\/) {2,}(created|already exists \(reused\))\s*$/.exec(line);
      if (match) rows.set(match[1], match[2]);
    }
    return rows;
  }

  it("puts a new project's state under .ndx/ and leaves no loose n-dx paths", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-layout-new-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-layout-new-bin-"));
    try {
      const output = await initWithFakeCodex(projectDir, binDir);

      // The summary names the directories that now exist, not the legacy ones.
      expect(summaryDirRows(output)).toEqual(new Map([
        [".ndx/sourcevision/", "created"],
        [".ndx/rex/", "created"],
        [".ndx/hench/", "created"],
      ]));

      // All three tools wrote inside the container...
      for (const entry of ["rex", "hench", "sourcevision", "config.json"]) {
        expect(
          existsSync(join(projectDir, ".ndx", entry)),
          `.ndx/${entry} should exist after a fresh init`,
        ).toBe(true);
      }

      // ...and nothing landed at the root under the legacy names. This is the
      // half that would silently regress: a package that kept a literal writes
      // its own directory beside the container, and both then exist.
      for (const legacy of [
        ".rex", ".hench", ".sourcevision", ".n-dx.json", ".n-dx.local.json",
      ]) {
        expect(
          existsSync(join(projectDir, legacy)),
          `${legacy} should not be written by a fresh init`,
        ).toBe(false);
      }

      // `.mcp.json` is the documented exception — the vendor CLIs read it at
      // the repository root, so it stays there on both layouts.
      expect(existsSync(join(projectDir, ".mcp.json"))).toBe(true);

      // The PRD starts as an empty v2 tree, so no command prints the v1 notice.
      expect(readFileSync(join(projectDir, ".ndx", "rex", "product", "index.md"), "utf-8")).toContain('schema: "rex/v2"');
      expect(existsSync(join(projectDir, ".ndx", "rex", "prd_tree"))).toBe(false);
      expect(output).not.toContain("v1 layout (prd_tree/)");
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 120_000);

  it("keeps an existing project on the legacy layout and creates no container", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "ndx-init-layout-old-"));
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-layout-old-bin-"));
    try {
      // One legacy directory is enough to make this an initialized project:
      // re-running init must not turn into a migration nobody asked for.
      await mkdir(join(projectDir, ".rex"), { recursive: true });

      const output = await initWithFakeCodex(projectDir, binDir);

      // Legacy names, and the one directory that was already there is the one
      // reported as reused.
      expect(summaryDirRows(output)).toEqual(new Map([
        [".sourcevision/", "created"],
        [".rex/", "already exists (reused)"],
        [".hench/", "created"],
      ]));

      expect(
        existsSync(join(projectDir, ".ndx")),
        "init must not create .ndx/ for a project that already has state",
      ).toBe(false);
      for (const legacy of [".rex", ".hench", ".sourcevision", ".n-dx.json"]) {
        expect(
          existsSync(join(projectDir, legacy)),
          `${legacy} should be written for a project already on the legacy layout`,
        ).toBe(true);
      }
    } finally {
      await removeDirs(binDir, projectDir);
    }
  }, 120_000);
});
