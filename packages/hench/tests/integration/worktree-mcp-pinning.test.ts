/**
 * A run in a linked worktree must not inherit a registration pinning another
 * checkout.
 *
 * The failure this guards: a hench run in `~/ndx-core/n-dx-071-capture`
 * completed a task and the agent's `update_task_status` wrote the task file in
 * `~/ndx-core/n-dx`, the main checkout, on whatever branch it had out. A
 * local-scope Claude registration (`claude mcp add --scope local`, the pre-0.7
 * `ndx init` path) recorded rex with the main checkout's **absolute** path, and
 * Claude Code applies a repository's entry to sessions started in that
 * repository's other worktrees — shadowing the tracked `.mcp.json`, which
 * resolves `.` per worktree and would have been correct.
 *
 * The per-workspace PRD lock is no defence: the write never reaches the right
 * workspace to contend for its lock.
 *
 * This drives the two modules that close it together — the config writer and
 * the Claude arg builder — with a fake `~/.claude.json` holding exactly that
 * registration, and asserts the spawn argv and the generated config.
 *
 * @see packages/hench/src/process/agent-mcp-config.ts
 * @see packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAgentMcpConfig } from "../../src/process/agent-mcp-config.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { DEFAULT_EXECUTION_POLICY, createPromptEnvelope } from "../../src/prd/llm-gateway.js";
import type { PromptSection, PromptSectionName } from "../../src/prd/llm-gateway.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** The launcher a real `ndx work` exports as NDX_CLI_PATH. */
const REAL_CORE_CLI = join(REPO_ROOT, "packages/core/cli.js");

const ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "USERPROFILE"] as const;

let sandbox: string;
/**
 * Stands in for `~/ndx-core/n-dx` — the checkout the stale entry pins.
 *
 * Deliberately not a path prefix of {@link worktree}: with the real directory
 * names it is one, and a "the pinned checkout appears nowhere" assertion would
 * then fail on the worktree's own path rather than on anything meaningful.
 */
let mainCheckout: string;
/** Stands in for `~/ndx-core/n-dx-071-capture` — where the run executes. */
let worktree: string;
let saved: Record<string, string | undefined>;

function envelope() {
  return createPromptEnvelope([
    { name: "system" as PromptSectionName, content: "SP" } as PromptSection,
    { name: "brief" as PromptSectionName, content: "TP" } as PromptSection,
  ]);
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  sandbox = await mkdtemp(join(tmpdir(), "hench-worktree-mcp-"));
  mainCheckout = join(sandbox, "n-dx-main");
  worktree = join(sandbox, "n-dx-071-capture");
  await mkdir(mainCheckout, { recursive: true });
  await mkdir(join(worktree, ".hench"), { recursive: true });

  // The registration that caused the cross-worktree write. Keyed on the main
  // checkout, with rex's project directory baked in absolutely.
  await writeFile(
    join(sandbox, ".claude.json"),
    JSON.stringify(
      {
        projects: {
          [mainCheckout]: {
            mcpServers: {
              rex: {
                command: "node",
                args: [join(mainCheckout, "packages/rex/dist/cli/index.js"), "mcp", mainCheckout],
              },
              sourcevision: {
                command: "node",
                args: [join(mainCheckout, "packages/sourcevision/dist/cli/index.js"), "mcp", mainCheckout],
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  process.env["HOME"] = sandbox;
  process.env["USERPROFILE"] = sandbox;
  process.env["CLAUDE_CONFIG_DIR"] = sandbox;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key]!;
  }
  await rm(sandbox, { recursive: true, force: true });
});

describe("a run in a linked worktree pins its own MCP servers", () => {
  it("generates a config naming the worktree, not the pinned checkout", async () => {
    const prepared = await prepareAgentMcpConfig({
      henchDir: join(worktree, ".hench"),
      runId: "0b919f4f",
      projectDir: worktree,
      env: { NDX_CLI_PATH: REAL_CORE_CLI },
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const doc = JSON.parse(await readFile(prepared.path, "utf-8"));
    expect(doc.mcpServers.rex.args.at(-1)).toBe(resolve(worktree));
    expect(doc.mcpServers.sourcevision.args.at(-1)).toBe(resolve(worktree));

    // The pinned checkout must appear nowhere: not as a project directory and
    // not as an entrypoint.
    expect(JSON.stringify(doc)).not.toContain(mainCheckout);
  });

  it("spawns with an argv that makes that config authoritative", async () => {
    const prepared = await prepareAgentMcpConfig({
      henchDir: join(worktree, ".hench"),
      runId: "0b919f4f",
      projectDir: worktree,
      env: { NDX_CLI_PATH: REAL_CORE_CLI },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const config = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {
      permissionMode: "acceptEdits",
      mcpConfigPath: prepared.path,
    });

    const idx = config.args.indexOf("--mcp-config");
    expect(idx).toBeGreaterThan(-1);
    expect(config.args[idx + 1]).toBe(prepared.path);
    // Without this flag the file is merged with the inherited registrations
    // rather than replacing them, and the stale rex entry is still reachable.
    expect(config.args).toContain("--strict-mcp-config");
    expect(config.args.join(" ")).not.toContain(mainCheckout);
  });

  it("writes the config inside the worktree it pins", async () => {
    const prepared = await prepareAgentMcpConfig({
      henchDir: join(worktree, ".hench"),
      runId: "0b919f4f",
      projectDir: worktree,
      env: { NDX_CLI_PATH: REAL_CORE_CLI },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.path).toBe(join(worktree, ".hench", "mcp", "0b919f4f.json"));
    expect(prepared.path.startsWith(worktree)).toBe(true);
  });

  it("leaves the spawn inheriting, and says so, when the launcher is unusable", async () => {
    // A standalone `hench run` exports no launcher path. Guessing a rex or
    // sourcevision location from here would be worse than inheriting: it could
    // silently pair the agent with a different build than this hench.
    const prepared = await prepareAgentMcpConfig({
      henchDir: join(worktree, ".hench"),
      runId: "standalone",
      projectDir: worktree,
      env: {},
    });

    expect(prepared).toEqual({ ok: false, reason: "unset" });

    const config = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {});
    expect(config.args).not.toContain("--mcp-config");
    expect(config.args).not.toContain("--strict-mcp-config");
  });
});
