/**
 * An autonomous run actually spawns with its own MCP config.
 *
 * The sibling `worktree-mcp-pinning.test.ts` composes the config writer and the
 * arg builder by hand. That proves both pieces work; it does not prove the run
 * connects them. Deleting `mcpConfigPath` from any of `cliLoop`'s
 * `buildSpawnConfig` calls would leave every other test in this change green
 * while the spawned session went back to inheriting a registration that pins
 * another checkout — the exact defect the task exists to close.
 *
 * So this drives `cliLoop` end to end against a mocked spawn, with a fake
 * `~/.claude.json` holding a local-scope entry for a different checkout, and
 * asserts on the argv the run really passed to the Claude CLI.
 *
 * @see packages/hench/src/agent/lifecycle/cli-loop.ts — the wiring under test
 * @see packages/hench/src/process/agent-mcp-config.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { initConfig } from "../../src/store/config.js";
import { serializeDocument } from "@n-dx/rex";
import { cliSpawnsOnly } from "../helpers/index.js";
import { decodeWindowsCommandLine } from "../helpers/scripted-claude-cli.js";

/** The launcher a real `ndx work` exports; must resolve back to this hench. */
const REAL_CORE_CLI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "packages/core/cli.js",
);

const ENV_KEYS = ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "NDX_CLI_PATH", "N_DX_CLI_PATH"] as const;

/** A Claude CLI that reports one completed turn and exits cleanly. */
function mockClaudeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  queueMicrotask(() => {
    proc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "result",
          session_id: "session-1",
          result: "done",
          num_turns: 1,
        }) + "\n",
      ),
    );
    proc.emit("close", 0);
  });

  return proc;
}

let sandbox: string;
let projectDir: string;
let henchDir: string;
let rexDir: string;
let otherCheckout: string;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  sandbox = await realpath(await mkdtemp(join(tmpdir(), "hench-mcp-wiring-")));
  projectDir = join(sandbox, "repo-feature");
  otherCheckout = join(sandbox, "repo-main");
  henchDir = join(projectDir, ".hench");
  rexDir = join(projectDir, ".rex");

  await mkdir(otherCheckout, { recursive: true });
  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude" } }),
    "utf-8",
  );
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
    "utf-8",
  );
  await writeFile(
    join(rexDir, "prd.md"),
    serializeDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "A task the agent will complete",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    } as never),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  // The registration that caused the cross-worktree write, filed under the
  // other checkout and pinning it absolutely.
  await writeFile(
    join(sandbox, ".claude.json"),
    JSON.stringify({
      projects: {
        [otherCheckout]: {
          mcpServers: {
            rex: {
              command: "node",
              args: [join(otherCheckout, "packages/rex/dist/cli/index.js"), "mcp", otherCheckout],
            },
          },
        },
      },
    }),
    "utf-8",
  );

  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env["HOME"] = sandbox;
  process.env["USERPROFILE"] = sandbox;
  process.env["CLAUDE_CONFIG_DIR"] = sandbox;
  process.env["NDX_CLI_PATH"] = REAL_CORE_CLI;
  delete process.env["N_DX_CLI_PATH"];
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key]!;
  }
  await rm(sandbox, { recursive: true, force: true });
});

/**
 * The vendor CLI's own argv for one recorded spawn call.
 *
 * On Windows `spawnCli` launches the CLI as `cmd.exe /d /s /c "<quoted line>"`,
 * so the raw argv is the wrapper's and every flag sits inside one token. Decode
 * it back, so these assertions see the argv the CLI actually parses on both
 * platforms rather than passing or failing on the wrapper's shape.
 */
function cliArgv(call: unknown[]): string[] {
  const [command, args] = call as [string, string[]];
  if (!/(^|[\\/])cmd(\.exe)?$/i.test(command)) return args;
  const wrapped = args[args.length - 1] ?? "";
  const line = wrapped.startsWith('"') && wrapped.endsWith('"') ? wrapped.slice(1, -1) : wrapped;
  // Drop the binary: callers compare against the CLI's own arguments.
  return decodeWindowsCommandLine(line).slice(1);
}

describe("an autonomous run spawns with its own MCP config", () => {
  it("passes --mcp-config and --strict-mcp-config naming this project", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: cliSpawnsOnly(mockSpawn) };
    });
    mockSpawn.mockImplementation(() => mockClaudeProcess());

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    await cliLoop({ config, store, projectDir, henchDir, taskId: "task-1" });

    expect(mockSpawn).toHaveBeenCalled();

    // EVERY spawn, not just the first. A run makes several — the warm-parent
    // orientation session and then the task itself — from separate call sites,
    // and each one reaches the PRD. Asserting only `calls[0]` passes while the
    // task spawn inherits, which is the failure this whole change is about.
    const argvs = mockSpawn.mock.calls.map(cliArgv);

    for (const args of argvs) {
      const idx = args.indexOf("--mcp-config");
      expect(
        idx,
        `a spawn carried no --mcp-config; argv was:\n  ${args.join(" ")}`,
      ).toBeGreaterThan(-1);
      expect(args).toContain("--strict-mcp-config");

      // The config must be this project's, and must name this project absolutely.
      const configPath = args[idx + 1]!;
      expect(configPath.startsWith(join(henchDir, "mcp"))).toBe(true);

      const doc = JSON.parse(await readFile(configPath, "utf-8"));
      expect(doc.mcpServers.rex.args.at(-1)).toBe(projectDir);
      expect(doc.mcpServers.sourcevision.args.at(-1)).toBe(projectDir);

      // Nothing anywhere in the spawn may reach the pinned checkout.
      expect(args.join(" ")).not.toContain(otherCheckout);
      expect(JSON.stringify(doc)).not.toContain(otherCheckout);
    }
  });

  it("covers the task spawn, not only the orientation spawn that precedes it", async () => {
    // Guards the assertion above against silently narrowing to one call site:
    // the run must make a spawn that carries the task brief, and that spawn is
    // a different `buildSpawnConfig` call than the orientation session's.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: cliSpawnsOnly(mockSpawn) };
    });
    mockSpawn.mockImplementation(() => mockClaudeProcess());

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    await cliLoop({ config, store, projectDir, henchDir, taskId: "task-1" });

    // The orientation spawn runs in plan mode and is read-only; the task spawn
    // is the one that is not. Identify it by that, not by position.
    const taskSpawns = mockSpawn.mock.calls
      .map(cliArgv)
      .filter((args) => args[args.indexOf("--permission-mode") + 1] !== "plan");

    expect(
      taskSpawns.length,
      "no non-plan-mode spawn was made, so this file never exercised the task call site",
    ).toBeGreaterThan(0);

    for (const args of taskSpawns) {
      expect(args).toContain("--mcp-config");
      expect(args).toContain("--strict-mcp-config");
    }
  });

  it("names the config after the run it belongs to", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: cliSpawnsOnly(mockSpawn) };
    });
    mockSpawn.mockImplementation(() => mockClaudeProcess());

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({ config, store, projectDir, henchDir, taskId: "task-1" });

    const args = cliArgv(mockSpawn.mock.calls[0]!);
    const configPath = args[args.indexOf("--mcp-config") + 1]!;
    expect(configPath).toBe(join(henchDir, "mcp", `${result.run.id}.json`));
  });

  it("spawns without the flags, rather than failing, when no launcher is usable", async () => {
    // A standalone `hench run` exports no launcher path. The run must still
    // happen; it just inherits, which is the behaviour that predates the fix.
    delete process.env["NDX_CLI_PATH"];

    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: cliSpawnsOnly(mockSpawn) };
    });
    mockSpawn.mockImplementation(() => mockClaudeProcess());

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    await cliLoop({ config, store, projectDir, henchDir, taskId: "task-1" });

    const args = cliArgv(mockSpawn.mock.calls[0]!);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
  });
});
