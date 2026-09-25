/**
 * Unit tests for the run-scoped MCP config.
 *
 * The behaviour under test is the fix for a cross-worktree PRD write: a run in
 * a linked worktree inherited a local-scope MCP registration pinning the main
 * checkout, so the agent's `update_task_status` wrote the task file there. The
 * run now writes its own config naming an absolute project directory.
 *
 * @see packages/hench/src/process/agent-mcp-config.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentMcpConfigPath,
  AGENT_REX_MCP_TOOLS,
  buildAgentMcpServers,
  LAUNCHER_REJECTION_DETAIL,
  prepareAgentMcpConfig,
  resolveLauncherCli,
  writeAgentMcpConfig,
} from "../../../src/process/agent-mcp-config.js";

/** This checkout's real `packages/core/cli.js` — the launcher a run inherits. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const REAL_CORE_CLI = join(REPO_ROOT, "packages/core/cli.js");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hench-mcp-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ── buildAgentMcpServers ─────────────────────────────────────────────────

describe("buildAgentMcpServers", () => {
  it("names both servers with an absolute project directory", () => {
    // Resolved rather than literal: on Windows "/work/tree" is drive-relative,
    // and the builder absolutizes it to e.g. "D:\work\tree".
    const tree = resolve("/work/tree");
    const doc = buildAgentMcpServers({
      cliPath: "/install/packages/core/cli.js",
      projectDir: "/work/tree",
      execPath: "/usr/bin/node",
    });

    expect(doc.mcpServers.rex).toEqual({
      type: "stdio",
      command: "/usr/bin/node",
      args: ["/install/packages/core/cli.js", "rex", "mcp", tree],
    });
    expect(doc.mcpServers.sourcevision).toEqual({
      type: "stdio",
      command: "/usr/bin/node",
      args: ["/install/packages/core/cli.js", "sv", "mcp", tree],
    });
  });

  it("absolutizes a relative project directory", () => {
    // A relative `.` is precisely what a shadowing registration can re-resolve
    // against another worktree's cwd, so it must never reach the file.
    const doc = buildAgentMcpServers({ cliPath: "/i/cli.js", projectDir: "." });
    const projectArg = doc.mcpServers.rex.args.at(-1)!;
    expect(projectArg).toBe(resolve("."));
    expect(isAbsolute(projectArg)).toBe(true);
  });

  it("keeps the server names the agent's tool permissions are written against", () => {
    // Tool permissions are spelled `mcp__<server>__<tool>`, so a rename here
    // renames every grant. `AGENT_REX_MCP_TOOLS` is derived from the same
    // constant for that reason — see the next test.
    const doc = buildAgentMcpServers({ cliPath: "/i/cli.js", projectDir: "/p" });
    expect(Object.keys(doc.mcpServers).sort()).toEqual(["rex", "sourcevision"]);
  });
});

// ── AGENT_REX_MCP_TOOLS ──────────────────────────────────────────────────

/**
 * The grant that makes the attached rex server usable.
 *
 * The run passes `--mcp-config … --strict-mcp-config`, so the session can see
 * rex — but seeing is not permission. `ndx init` auto-approves only rex's read
 * tools (`AUTO_APPROVED_TOOLS` in `packages/core/claude-integration.js`), and a
 * `claude -p` spawn has nobody to approve the rest. Both write tools the base
 * workflow directs were therefore denied in consumer-project runs.
 *
 * Safe because of the completion hold: while a run holds the task's claim, rex
 * records the agent's status request on the claim (`TaskClaims.pendingCompletion`)
 * instead of writing it, and hench applies it only after the test gate passes.
 */
describe("AGENT_REX_MCP_TOOLS", () => {
  it("is derived from the server name buildAgentMcpServers registers", () => {
    // Not restated as a literal prefix: the point is that renaming the server
    // key cannot leave the grant behind, spelled for a server that no longer
    // exists — a failure that is silent, and only reproduces headless.
    const doc = buildAgentMcpServers({ cliPath: "/i/cli.js", projectDir: "/p" });
    const rexServerName = Object.entries(doc.mcpServers).find(
      ([, server]) => server.args[1] === "rex",
    )?.[0];

    expect(rexServerName).toBeDefined();
    for (const tool of AGENT_REX_MCP_TOOLS) {
      expect(tool.startsWith(`mcp__${rexServerName}__`)).toBe(true);
    }
  });

  it("grants only the tools a hench prompt directs the agent to call", () => {
    // Pinned exactly. The session reaches the whole rex server through the
    // config this module writes, so this list is the only thing deciding what
    // it may call — every entry needs a prompt behind it:
    //   update_task_status — base workflow step 6
    //   append_log         — base workflow step 7
    //   add_item           — base workflow steps 3 and 9, and the autonomous
    //                        adversarial-review pass's `should-fix` action
    expect([...AGENT_REX_MCP_TOOLS]).toEqual([
      "mcp__rex__update_task_status",
      "mcp__rex__append_log",
      "mcp__rex__add_item",
    ]);
  });

  it("names no tool from the sourcevision server", () => {
    // sourcevision is attached too, but nothing hench prompts asks the agent to
    // write through it, and its MCP surface includes `set_file_archetype`.
    const doc = buildAgentMcpServers({ cliPath: "/i/cli.js", projectDir: "/p" });
    expect(Object.keys(doc.mcpServers)).toContain("sourcevision");
    for (const tool of AGENT_REX_MCP_TOOLS) {
      expect(tool).not.toContain("sourcevision");
    }
  });
});

// ── resolveLauncherCli ───────────────────────────────────────────────────

describe("resolveLauncherCli", () => {
  it("reports `unset` when neither launcher variable is exported", () => {
    expect(resolveLauncherCli({})).toEqual({ usable: false, reason: "unset" });
  });

  it("reports `missing` for a stale path inherited from an older invocation", () => {
    const stale = join(dir, "gone", "cli.js");
    expect(resolveLauncherCli({ NDX_CLI_PATH: stale })).toEqual({
      usable: false,
      reason: "missing",
    });
  });

  it("accepts the launcher of the install running this test", () => {
    const result = resolveLauncherCli({ NDX_CLI_PATH: REAL_CORE_CLI });
    expect(result.usable).toBe(true);
  });

  it("falls back to N_DX_CLI_PATH when NDX_CLI_PATH is absent", () => {
    expect(resolveLauncherCli({ N_DX_CLI_PATH: REAL_CORE_CLI }).usable).toBe(true);
  });

  it("rejects a launcher from another install rather than pointing the agent at it", async () => {
    // The inherited-env hazard: an outer `ndx` exported its own path, and this
    // hench belongs to a different checkout. Using it would hand the agent a
    // rex of a different build than the one holding this run's task open.
    const foreign = join(dir, "other-install");
    await mkdir(join(foreign, "packages/core"), { recursive: true });
    await mkdir(join(foreign, "packages/hench/dist/cli"), { recursive: true });
    await writeFile(join(foreign, "packages/core/cli.js"), "// core\n");
    await writeFile(join(foreign, "packages/hench/dist/cli/index.js"), "// hench\n");

    expect(resolveLauncherCli({ NDX_CLI_PATH: join(foreign, "packages/core/cli.js") })).toEqual({
      usable: false,
      reason: "foreign-install",
    });
  });

  it("has a printable explanation for every rejection", () => {
    for (const reason of ["unset", "missing", "foreign-install"] as const) {
      expect(LAUNCHER_REJECTION_DETAIL[reason]).toBeTruthy();
    }
  });
});

// ── writeAgentMcpConfig / prepareAgentMcpConfig ──────────────────────────

describe("writeAgentMcpConfig", () => {
  it("writes under .hench/mcp/, which is gitignored", async () => {
    const henchDir = join(dir, ".hench");
    const path = await writeAgentMcpConfig({
      henchDir,
      runId: "0b919f4f",
      cliPath: REAL_CORE_CLI,
      projectDir: dir,
    });

    expect(path).toBe(agentMcpConfigPath(henchDir, "0b919f4f"));
    expect(path).toBe(join(henchDir, "mcp", "0b919f4f.json"));

    const parsed = JSON.parse(await readFile(path, "utf-8"));
    expect(parsed.mcpServers.rex.args.at(-1)).toBe(resolve(dir));
  });

  it("keeps the config out of .hench/runs/, where listRuns would claim it", async () => {
    // `listRuns` derives a run id from every `*.json` filename in `runs/` and
    // takes the first `limit` ids before validating any of them. A config file
    // there would occupy a slot and then be dropped, silently shortening
    // `hench list`, the token rollups and the dashboard's run feed.
    const henchDir = join(dir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await writeFile(join(henchDir, "runs", "aaaa1111.json"), JSON.stringify({ id: "aaaa1111" }));

    await writeAgentMcpConfig({
      henchDir,
      runId: "aaaa1111",
      cliPath: REAL_CORE_CLI,
      projectDir: dir,
    });

    expect(await readdir(join(henchDir, "runs"))).toEqual(["aaaa1111.json"]);
  });

  it("sweeps configs left by runs that finished long ago", async () => {
    const henchDir = join(dir, ".hench");
    const mcpDir = join(henchDir, "mcp");
    await mkdir(mcpDir, { recursive: true });

    const stale = join(mcpDir, "old-run.json");
    const recent = join(mcpDir, "recent-run.json");
    await writeFile(stale, "{}");
    await writeFile(recent, "{}");
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(stale, longAgo, longAgo);

    await writeAgentMcpConfig({
      henchDir,
      runId: "new-run",
      cliPath: REAL_CORE_CLI,
      projectDir: dir,
    });

    const remaining = (await readdir(mcpDir)).sort();
    expect(remaining).toEqual(["new-run.json", "recent-run.json"]);
  });

  it("writes valid JSON with a trailing newline", async () => {
    const path = await writeAgentMcpConfig({
      henchDir: join(dir, ".hench"),
      runId: "r1",
      cliPath: REAL_CORE_CLI,
      projectDir: dir,
    });
    const raw = await readFile(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("prepareAgentMcpConfig", () => {
  it("returns the written path when the launcher is usable", async () => {
    const result = await prepareAgentMcpConfig({
      henchDir: join(dir, ".hench"),
      runId: "r2",
      projectDir: dir,
      env: { NDX_CLI_PATH: REAL_CORE_CLI },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(await readFile(result.path, "utf-8"));
    expect(parsed.mcpServers.sourcevision.args).toEqual([
      expect.stringContaining("cli.js"),
      "sv",
      "mcp",
      resolve(dir),
    ]);
  });

  it("reports the reason instead of writing when no launcher is usable", async () => {
    const result = await prepareAgentMcpConfig({
      henchDir: join(dir, ".hench"),
      runId: "r3",
      projectDir: dir,
      env: {},
    });

    expect(result).toEqual({ ok: false, reason: "unset" });
    await expect(
      readFile(agentMcpConfigPath(join(dir, ".hench"), "r3"), "utf-8"),
    ).rejects.toThrow();
  });
});
