/**
 * Assistant parity smoke tests — prevents regression to Claude-only wording
 * in help text, init guidance, startup output, and project documentation.
 *
 * These smoke checks verify that both supported assistant paths (Claude and
 * Codex) are mentioned where appropriate, and that framing is
 * assistant-neutral in shared surfaces.
 *
 * Coverage areas:
 *   1. CLI help text references both assistants
 *   2. Init output includes both vendor labels
 *   3. Startup banner uses vendor-neutral MCP framing
 *   4. Project guidance uses assistant-neutral language for hench
 *   5. Help definitions mention vendor-neutral MCP descriptions
 *   6. Negative checks: no Claude-only regression in shared text
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run, runResult, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

const ROOT = join(import.meta.dirname, "../..");

// ── Help text: both assistants documented ────────────────────────────────────

describe("help text mentions both assistants", () => {
  let initHelp;
  let startHelp;
  let workHelp;
  let mainHelp;

  beforeAll(() => {
    initHelp = run(["help", "init"]);
    startHelp = run(["help", "start"]);
    workHelp = run(["help", "work"]);
    mainHelp = run([]);
  });

  describe("init help", () => {
    it("documents both --no-claude and --no-codex flags", () => {
      expect(initHelp).toContain("--no-claude");
      expect(initHelp).toContain("--no-codex");
    });

    it("documents both --claude-only and --codex-only flags", () => {
      expect(initHelp).toContain("--claude-only");
      expect(initHelp).toContain("--codex-only");
    });

    it("documents --assistants= flag", () => {
      expect(initHelp).toContain("--assistants=");
    });

    it("mentions both Claude and Codex in description", () => {
      expect(initHelp).toContain("Claude");
      expect(initHelp).toContain("Codex");
    });

    it("mentions both vendors in examples", () => {
      expect(initHelp).toContain("--provider=claude");
      expect(initHelp).toContain("--provider=codex");
    });
  });

  describe("start help", () => {
    it("describes MCP server without Claude-only framing", () => {
      expect(startHelp).toContain("MCP");
      expect(startHelp).not.toContain("Claude Code MCP setup");
    });

    it("uses vendor-neutral 'dashboard and MCP server' summary", () => {
      expect(startHelp).toMatch(/dashboard.*MCP|MCP.*dashboard/i);
    });
  });

  describe("work help", () => {
    it("mentions vendor config requirement neutrally", () => {
      // Should reference both providers, not just Claude
      expect(workHelp).toContain("claude");
      expect(workHelp).toContain("codex");
    });
  });

  describe("main help", () => {
    it("includes start command with MCP in summary", () => {
      expect(mainHelp).toContain("start");
      expect(mainHelp).toContain("MCP");
    });
  });
});

// ── Init output: both assistant labels in summary ────────────────────────────

describe("init output includes both assistant labels", () => {
  let tmpDir;
  let binDir;

  const isWin = process.platform === "win32";
  const PATH_SEP = isWin ? ";" : ":";

  async function writeFakeBinary(filePath, { stdout = "" } = {}) {
    const { writeFile, chmod } = await import("node:fs/promises");
    if (isWin) {
      const cmdPath = filePath + ".cmd";
      await writeFile(cmdPath, `@echo off\necho ${stdout}\n`);
      return cmdPath;
    }
    await writeFile(filePath, `#!/bin/sh\necho '${stdout}'\n`);
    await chmod(filePath, 0o755);
    return filePath;
  }

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    tmpDir = await createTmpDir("ndx-parity-init-");
    binDir = await mkdtemp(join(tmpdir(), "ndx-parity-bin-"));
    await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await removeTmpDir(tmpDir);
    await rm(binDir, { recursive: true, force: true });
  });

  it("shows 'Assistant surfaces:' header in init summary", () => {
    const output = run(["init", "--provider=codex", tmpDir], {
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        // Skip real `claude mcp add` calls — keeps init fast and deterministic
        // in tests that only assert on the summary output. See
        // packages/core/claude-integration.js:306–320 for the short-circuit.
        CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
      },
    });
    expect(output).toContain("Assistant surfaces:");
  });

  it("shows both 'Claude Code' and 'Codex' labels", () => {
    const output = run(["init", "--provider=codex", tmpDir], {
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        // Skip real `claude mcp add` calls — keeps init fast and deterministic
        // in tests that only assert on the summary output. See
        // packages/core/claude-integration.js:306–320 for the short-circuit.
        CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
      },
    });
    expect(output).toContain("Claude Code");
    expect(output).toContain("Codex");
  });

  it("mentions both CLAUDE.md and AGENTS.md artifacts", () => {
    const output = run(["init", "--provider=codex", tmpDir], {
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
        // Skip real `claude mcp add` calls — keeps init fast and deterministic
        // in tests that only assert on the summary output. See
        // packages/core/claude-integration.js:306–320 for the short-circuit.
        CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
      },
    });
    expect(output).toContain("CLAUDE.md");
    expect(output).toContain("AGENTS.md");
  });
});

// ── Startup banner: vendor-neutral MCP framing ──────────────────────────────

describe("startup banner uses vendor-neutral MCP framing", () => {
  /**
   * We can't easily start the full server in a smoke test, so we verify the
   * source code that emits the banner.  Both start.ts and web.js emit the
   * same MCP setup block — checking their source is cheaper and more stable
   * than spawning a live server.
   */

  const startTsSrc = readFileSync(
    join(ROOT, "packages/web/src/server/start.ts"),
    "utf-8",
  );
  const webJsSrc = readFileSync(
    join(ROOT, "packages/core/web.js"),
    "utf-8",
  );

  describe("start.ts (web server)", () => {
    it("uses neutral 'MCP setup:' header (not Claude-specific)", () => {
      expect(startTsSrc).toContain('"MCP setup:"');
      expect(startTsSrc).not.toContain("Claude Code MCP setup");
      expect(startTsSrc).not.toContain("Claude MCP setup");
    });

    it("mentions both Claude and Codex in MCP setup instructions", () => {
      expect(startTsSrc).toContain("Claude:");
      expect(startTsSrc).toContain("Codex:");
    });

    it("includes Codex config.toml reference", () => {
      expect(startTsSrc).toContain("config.toml");
    });
  });

  describe("web.js (background mode banner)", () => {
    it("uses neutral 'MCP setup:' header (not Claude-specific)", () => {
      expect(webJsSrc).toContain('"MCP setup:"');
      expect(webJsSrc).not.toContain("Claude Code MCP setup");
      expect(webJsSrc).not.toContain("Claude MCP setup");
    });

    it("mentions both Claude and Codex in MCP setup instructions", () => {
      expect(webJsSrc).toContain("Claude:");
      expect(webJsSrc).toContain("Codex:");
    });

    it("includes Codex config.toml reference", () => {
      expect(webJsSrc).toContain("config.toml");
    });
  });
});

// ── Project guidance: assistant-neutral hench description ────────────────────

describe("project guidance uses assistant-neutral language", () => {
  const guidanceSrc = readFileSync(
    join(ROOT, "assistant-assets/project-guidance.md"),
    "utf-8",
  );

  it("describes hench as 'drives an LLM' (not Claude-specific)", () => {
    expect(guidanceSrc).toContain("drives an LLM");
    expect(guidanceSrc).not.toMatch(/hench.*calls Claude API/);
  });

  it("mentions MCP servers as assistant-neutral", () => {
    // The MCP section should reference both assistants or be generic
    expect(guidanceSrc).not.toContain("MCP servers for Claude Code tool use");
    // Should either be neutral or mention both
    expect(guidanceSrc).toContain("MCP");
  });

  it("documents the Assistant Instruction Files section", () => {
    expect(guidanceSrc).toContain("Assistant Instruction Files");
    expect(guidanceSrc).toContain("AGENTS.md");
    expect(guidanceSrc).toContain("CLAUDE.md");
    expect(guidanceSrc).toContain(".codex/config.toml");
  });
});

// ── Help definitions: no Claude-only MCP framing ─────────────────────────────

describe("help definitions use vendor-neutral language", () => {
  const helpSrc = readFileSync(
    join(ROOT, "packages/core/help.js"),
    "utf-8",
  );

  it("start command summary does not mention Claude", () => {
    // Extract the start help definition summary line
    const startMatch = helpSrc.match(/start:\s*\{[^}]*summary:\s*"([^"]*)"/s);
    expect(startMatch).toBeTruthy();
    expect(startMatch[1]).not.toContain("Claude");
  });

  it("start command description does not mention Claude", () => {
    const startMatch = helpSrc.match(
      /start:\s*\{[^}]*description:\s*"([^"]*)"/s,
    );
    expect(startMatch).toBeTruthy();
    expect(startMatch[1]).not.toContain("Claude");
  });

  it("init help description mentions both Claude and Codex", () => {
    // Verify via rendered help output (avoids fragile regex on nested JS objects)
    const initHelp = run(["help", "init"]);
    expect(initHelp).toContain("both Claude and Codex");
  });

  it("work help description mentions vendor config neutrally", () => {
    // Verify via rendered help output
    const workHelp = run(["help", "work"]);
    // Should reference vendor config generically or mention both vendors
    expect(workHelp).toContain("vendor config");
  });

  it("MCP-related keywords in subcommands are not Claude-exclusive", () => {
    // rex mcp and sourcevision mcp summaries should say "AI tool integration"
    // not "Claude tool integration"
    const rexMcpMatch = helpSrc.match(
      /name:\s*"mcp",\s*parent:\s*"rex"[^}]*summary:\s*"([^"]*)"/,
    );
    expect(rexMcpMatch).toBeTruthy();
    expect(rexMcpMatch[1]).not.toMatch(/^Claude/);
    expect(rexMcpMatch[1]).toContain("AI tool integration");
  });
});

// ── Negative regression: Claude-only wording must not reappear ───────────────

describe("Claude-only wording regression guard", () => {
  it("project-guidance.md does not use 'calls Claude API or CLI' for hench", () => {
    const src = readFileSync(
      join(ROOT, "assistant-assets/project-guidance.md"),
      "utf-8",
    );
    expect(src).not.toContain("calls Claude API or CLI");
  });

  it("start.ts does not use 'Claude Code MCP setup' banner", () => {
    const src = readFileSync(
      join(ROOT, "packages/web/src/server/start.ts"),
      "utf-8",
    );
    expect(src).not.toContain("Claude Code MCP setup");
  });

  it("web.js does not use 'Claude Code MCP setup' banner", () => {
    const src = readFileSync(
      join(ROOT, "packages/core/web.js"),
      "utf-8",
    );
    expect(src).not.toContain("Claude Code MCP setup");
  });

  it("help init output mentions provisioning for both assistants", () => {
    // Verify via rendered help output (avoids fragile regex on nested JS objects)
    const initHelp = run(["help", "init"]);
    expect(initHelp).toContain("both Claude and Codex");
  });
});
