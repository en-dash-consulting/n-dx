/**
 * Fixture for the manual, real-vendor browser suite.
 *
 * Builds a throwaway git repository holding a tiny Node project (one module,
 * one passing `node:test` file), initialises n-dx in it for a real vendor,
 * and tunes `.hench/config.json` so an unattended `ndx work` can finish a
 * task: auto-commit on, a cheap test gate, cold sessions, memory guard off.
 *
 * Tasks are seeded through `rex add` with descriptions that name a concrete
 * file under `src/` plus a test, so hench's completion gate (which wants at
 * least one changed code file) and the test gate both pass.
 *
 * The dashboard is started with the existing `startDashboard` helper, so the
 * spawned agent inherits the operator's vendor login from the environment.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createUninitializedFixtureProject,
  startDashboard,
  type RunningDashboard,
} from "../../e2e-ui/helpers/fixture-project.js";

// packages/web/tests/e2e-ui-manual/helpers -> repo root is 5 levels up.
const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
export const CORE_CLI = join(REPO_ROOT, "packages/core/cli.js");
export const REX_BIN = join(REPO_ROOT, "packages/core/bin/rex.js");

export type Vendor = "claude" | "codex";

/** Catalog ids (packages/core/llm-model-catalog.js) — the Settings page can pick these by label. */
export const DEFAULT_MODELS: Record<Vendor, string> = {
  claude: process.env["NDX_E2E_CLAUDE_MODEL"] ?? "claude-haiku-4-5",
  codex: process.env["NDX_E2E_CODEX_MODEL"] ?? "gpt-5.5",
};

/** Upper bound for one agent run to finish; a hang guardrail, not a latency claim. */
export const RUN_TIMEOUT_MS = Number(process.env["NDX_E2E_RUN_TIMEOUT_MS"] ?? 15 * 60_000);

export const KEEP_FIXTURE = process.env["NDX_E2E_KEEP_FIXTURE"] === "1";

export interface RealVendorProject {
  dir: string;
  epicId: string;
  vendor: Vendor;
  model: string;
}

export interface TaskSpec {
  title: string;
  /** Names the file to create and the test to add — concrete enough for a cheap model. */
  description: string;
  criterion: string;
  priority?: "critical" | "high" | "medium" | "low";
}

function extractId(output: string): string {
  const m = output.match(/ID:\s*([a-f0-9-]{36})/i);
  if (!m) throw new Error(`Could not parse item ID from rex output:\n${output}`);
  return m[1];
}

export function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Stage everything and commit; a no-op when the tree is clean. */
export function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  const staged = git(dir, ["diff", "--cached", "--name-only"]).trim();
  if (!staged) return;
  git(dir, ["-c", "user.email=e2e@test.local", "-c", "user.name=e2e-manual", "commit", "-q", "-m", message]);
}

export function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

async function seedNodeProject(dir: string): Promise<void> {
  const pkg = {
    name: "e2e-manual-fixture",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  };
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  // The dashboard's credential probe (`ndx auth`) runs the vendor CLI in the
  // project and leaves claude_commands.log behind; hench's commit gate would
  // otherwise refuse completion over that untracked file.
  await writeFile(join(dir, ".gitignore"), "node_modules/\nclaude_commands.log\n");
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "test"), { recursive: true });
  await writeFile(
    join(dir, "src", "index.js"),
    [
      "/** Entry point of the e2e fixture. Add new modules next to this file. */",
      'export const name = "e2e-manual-fixture";',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "test", "index.test.js"),
    [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { name } from "../src/index.js";',
      "",
      'test("index exports the fixture name", () => {',
      '  assert.equal(name, "e2e-manual-fixture");',
      "});",
      "",
    ].join("\n"),
  );
}

/**
 * A tool's state directory. `ndx init` writes the container layout
 * (`.ndx/<tool>/`); an older checkout has the flat `.<tool>/`. Prefer
 * whichever exists, defaulting to the container.
 */
export function toolDir(dir: string, tool: "hench" | "rex" | "sourcevision"): string {
  const container = join(dir, ".ndx", tool);
  const flat = join(dir, `.${tool}`);
  if (existsSync(container)) return container;
  if (existsSync(flat)) return flat;
  return container;
}

async function tuneHenchConfig(dir: string): Promise<void> {
  const path = join(toolDir(dir, "hench"), "config.json");
  const config = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  const guard = (config["guard"] ?? {}) as Record<string, unknown>;
  Object.assign(config, {
    autoCommit: true,
    fullTestCommand: "node --test",
    sessionStrategy: "cold",
    guard: { ...guard, memoryMonitor: { enabled: false } },
  });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function createRealVendorProject(
  vendor: Vendor,
  model: string = DEFAULT_MODELS[vendor],
): Promise<RealVendorProject> {
  const dir = await createUninitializedFixtureProject();
  await seedNodeProject(dir);
  commitAll(dir, "seed node project");

  // --no-claude / --no-codex skip the assistant scaffolding (instruction
  // files, MCP registration); the vendor comes from --provider.
  execFileSync(
    "node",
    [CORE_CLI, "init", "--quiet", `--provider=${vendor}`, `--model=${model}`, "--no-claude", "--no-codex", dir],
    { stdio: "pipe" },
  );
  await tuneHenchConfig(dir);

  const epicOut = execFileSync("node", [REX_BIN, "add", "epic", "--title=E2E Manual Epic", dir], {
    encoding: "utf-8",
  });
  const epicId = extractId(epicOut);
  commitAll(dir, "init n-dx for the manual suite");
  return { dir, epicId, vendor, model };
}

/** Seed tasks under `epicId`; returns their ids in order. */
export function seedTasks(dir: string, epicId: string, specs: TaskSpec[]): string[] {
  const ids = specs.map((spec) => {
    const out = execFileSync(
      "node",
      [
        REX_BIN,
        "add",
        "task",
        `--title=${spec.title}`,
        `--parent=${epicId}`,
        `--description=${spec.description}`,
        `--criterion=${spec.criterion}`,
        `--priority=${spec.priority ?? "high"}`,
        dir,
      ],
      { encoding: "utf-8" },
    );
    return extractId(out);
  });
  commitAll(dir, `seed ${specs.length} task(s)`);
  return ids;
}

/** A task a cheap model finishes in a few minutes: one new module, one new test. */
export function moduleTask(moduleName: string, fn: string, returns: string): TaskSpec {
  return {
    title: `Add src/${moduleName}.js with ${fn}()`,
    description:
      `Create src/${moduleName}.js exporting a function ${fn}(name) that returns the string ${returns} ` +
      `for the given name. Add test/${moduleName}.test.js using node:test and node:assert/strict with one ` +
      "passing test for it. Do not change any other file. The test command is `node --test`.",
    criterion: `src/${moduleName}.js exports ${fn} and test/${moduleName}.test.js passes under node --test`,
  };
}

/**
 * Start the dashboard for a real run. Claude Code exports CLAUDECODE and
 * CLAUDE_CODE_SESSION_ID to child processes; the spawned agent must not see
 * them (TESTING.md § Family 4), so they are held out of the server's
 * environment for the duration of the spawn.
 */
export async function startRealDashboard(dir: string): Promise<RunningDashboard> {
  const held: Record<string, string | undefined> = {};
  for (const key of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT"]) {
    held[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return await startDashboard(dir);
  } finally {
    for (const [key, value] of Object.entries(held)) {
      if (value !== undefined) process.env[key] = value;
    }
  }
}
