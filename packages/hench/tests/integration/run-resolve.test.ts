/**
 * `hench run --resolve` — what a run would use, and why it would refuse,
 * without running.
 *
 * Pinned here, against a real project fixture (hench config, rex folder tree,
 * `.n-dx.json`, git repository):
 *  - every resolved setting names the config key that supplied it
 *  - the resolved model is the model a real run with the same flags and
 *    config uses — read from `cmdRun` itself, over a fixture matrix
 *  - every refusal a run would throw is reported as an entry, not thrown
 *  - resolving writes nothing: PRD tree, claims file, git status and HEAD are
 *    unchanged, even with `--reset-deferred` over a deferred task
 *
 * @see packages/hench/src/cli/commands/run-resolve.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveModel, NEWEST_MODELS, TIER_MODELS } from "@n-dx/llm-client";
import { resolveRun } from "../../src/cli/commands/run-resolve.js";
import type { RunRefusalCode, RunResolution } from "../../src/cli/commands/run-resolve.js";
import { cmdRun } from "../../src/cli/commands/run.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import { resolveStore, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Resolve",
  items: [
    {
      id: "epic-1",
      title: "Resolve Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        { id: "t-pending", title: "Pending task", level: "task" as const, status: "pending" as const, blockedBy: ["t-done"] },
        { id: "t-progress", title: "Running task", level: "task" as const, status: "in_progress" as const },
        { id: "t-done", title: "Done task", level: "task" as const, status: "completed" as const },
        { id: "t-blocked", title: "Blocked task", level: "task" as const, status: "blocked" as const },
        { id: "t-deferred", title: "Deferred task", level: "task" as const, status: "deferred" as const },
      ],
    },
  ],
};

let projectDir: string;
let henchDir: string;
let rexDir: string;
const extraDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** Write `.n-dx.json` and commit it, so the tree stays clean. */
async function projectConfig(data: Record<string, unknown>): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(data), "utf-8");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "config", "--allow-empty");
}

/** A Claude config whose CLI is found — node itself stands in for the binary. */
const CLAUDE = { vendor: "claude", claude: { cli_path: process.execPath } };

async function resolve(flags: Record<string, string>): Promise<RunResolution> {
  return resolveRun(projectDir, flags);
}

function codes(r: RunResolution): RunRefusalCode[] {
  return r.refusals.map((x) => x.code);
}

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-resolve-"));
  await (await resolveStore(rexDir)).saveDocument(DOC as never);
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: CLAUDE }), "utf-8");
  commitGitFixtureBaseline(projectDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of extraDirs.splice(0)) await cleanupProjectDir(dir);
  await cleanupProjectDir(projectDir);
});

describe("the resolution report", () => {
  it("describes the task, the workspace and each setting with its source", async () => {
    const r = await resolve({ task: "t-pending" });

    expect(r.refusals).toEqual([]);
    expect(r.task).toEqual({
      id: "t-pending",
      title: "Pending task",
      status: "pending",
      level: "task",
      blockedBy: ["t-done"],
      claimedBy: null,
    });
    expect(r.workspace).toEqual({
      root: git(projectDir, "rev-parse", "--show-toplevel"),
      branch: git(projectDir, "branch", "--show-current"),
      isAnchor: true,
      dirty: false,
    });
    expect(r.resolved).toEqual({
      vendor: { value: "claude", source: "llm.vendor" },
      model: { value: NEWEST_MODELS.claude, source: "vendor-default" },
      provider: { value: "cli", source: "hench.provider" },
      permissionMode: { value: "acceptEdits", source: "autonomous-default" },
      review: { value: false, source: "built-in" },
      reviewModel: { value: null, source: "built-in" },
      reviewOptional: { value: false, source: "built-in" },
      skipTestGate: { value: false, source: "built-in" },
      maxTurns: { value: 50, source: "hench.maxTurns" },
      tokenBudget: { value: 0, source: "hench.tokenBudget" },
      fresh: { value: false, source: "built-in" },
      allowDirty: { value: false, source: "built-in" },
      resetDeferred: { value: false, source: "built-in" },
    });
    expect(r.command).toBe(`ndx work --task=t-pending --auto ${projectDir}`);
  });

  it("lists every per-run option, keyed to a resolved setting, with flag, type, values and scope", async () => {
    const r = await resolve({ task: "t-pending" });

    expect(r.options.map((o) => o.key).sort()).toEqual(
      Object.keys(r.resolved).filter((k) => k !== "vendor").sort(),
    );
    for (const option of r.options) {
      expect(option.flag).toMatch(/^[a-z-]+$/);
      expect(["enum", "boolean", "integer", "string"]).toContain(option.type);
      expect(["task", "launch"]).toContain(option.scope);
      expect(option.description.length).toBeGreaterThan(0);
      if (option.type === "enum") expect(option.values?.length).toBeGreaterThan(0);
    }
    expect(r.options.find((o) => o.key === "provider")?.values).toEqual(["cli", "api"]);
    expect(r.options.find((o) => o.key === "permissionMode")?.values).toContain("acceptEdits");
  });

  it("reports cli-flag for every setting passed on the command line, and builds the command from them", async () => {
    const r = await resolve({
      task: "t-pending",
      model: "opus",
      provider: "api",
      "permission-mode": "plan",
      review: "true",
      "review-model": "sonnet",
      "review-optional": "true",
      "skip-test-gate": "true",
      "max-turns": "7",
      "token-budget": "1000",
      fresh: "true",
      "allow-dirty": "true",
      "reset-deferred": "true",
    });

    for (const key of Object.keys(r.resolved) as Array<keyof RunResolution["resolved"]>) {
      if (key === "vendor") continue;
      expect(r.resolved[key].source, key).toBe("cli-flag");
    }
    expect(r.resolved.model.value).toBe(resolveModel("opus"));
    expect(r.resolved.maxTurns.value).toBe(7);
    expect(r.resolved.reviewModel.value).toBe(resolveModel("sonnet"));
    // --review on the api provider is what a real run refuses.
    expect(codes(r)).toEqual(["provider-unsupported"]);
    expect(r.command).toBe(
      "ndx work --task=t-pending --auto --model=opus --provider=api --permission-mode=plan --review " +
        `--review-model=sonnet --review-optional --skip-test-gate --max-turns=7 --token-budget=1000 --fresh --allow-dirty --reset-deferred ${projectDir}`,
    );
  });

  it("keeps the flags that change behaviour but are not options: --mine, --priority, --context-file", async () => {
    const r = await resolve({
      task: "t-deferred",
      "reset-deferred": "true",
      mine: "true",
      priority: "high",
      "context-file": "/tmp/notes with space.md",
      review: "true",
      "review-optional": "true",
    });

    expect(r.resolved.reviewOptional).toEqual({ value: true, source: "cli-flag" });
    expect(r.command).toBe(
      "ndx work --task=t-deferred --auto --review --review-optional --reset-deferred --mine --priority=high " +
        `--context-file='/tmp/notes with space.md' ${projectDir}`,
    );
  });

  it("writes a vendor-pinned model flag as --model", async () => {
    const r = await resolve({ task: "t-pending", "claude-model": "haiku" });

    expect(r.resolved.model).toEqual({ value: resolveModel("haiku"), source: "cli-flag" });
    expect(r.command).toContain("--model=haiku");
  });

  it("names the model key that won: hench.models, llm.model, llm.<vendor>.model, llm.routes, llm.tiers", async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ llm: CLAUDE, hench: { models: { claude: "opus" } } }, resolveModel("opus"), "hench.models.claude"],
      [{ llm: { ...CLAUDE, model: "haiku", claude: { ...CLAUDE.claude, model: "sonnet" } } }, resolveModel("haiku"), "llm.model"],
      [{ llm: { ...CLAUDE, claude: { ...CLAUDE.claude, model: "sonnet" } } }, resolveModel("sonnet"), "llm.claude.model"],
      [{ llm: { ...CLAUDE, routes: { "agent.execute": "heavy" } } }, resolveModel(TIER_MODELS.claude.heavy), "llm.routes"],
      [{ llm: { ...CLAUDE, tiers: { claude: { standard: "opus" } } } }, resolveModel("opus"), "llm.tiers.claude.standard"],
    ];
    for (const [config, model, source] of cases) {
      await projectConfig(config);
      expect((await resolve({ task: "t-pending" })).resolved.model, source).toEqual({ value: model, source });
    }
  });

  it("names hench.<key> for configured settings", async () => {
    await projectConfig({ llm: CLAUDE, hench: { permissionMode: "default", skipFullTestGate: true, maxTurns: 12 } });
    const r = await resolve({ task: "t-pending" });

    expect(r.resolved.permissionMode).toEqual({ value: "default", source: "hench.permissionMode" });
    expect(r.resolved.skipTestGate).toEqual({ value: true, source: "hench.skipFullTestGate" });
    expect(r.resolved.maxTurns).toEqual({ value: 12, source: "hench.maxTurns" });
  });

  it("reports the review model and its source when --review is on", async () => {
    // llm.local is the one vendor block whose reviewModel the config loader
    // keeps today; resolve reports what the loaded config says, as a run sees it.
    await projectConfig({ llm: { vendor: "local", local: { reviewModel: "qwen-reviewer" } } });
    const r = await resolve({ task: "t-pending", review: "true" });

    expect(r.resolved.reviewModel).toEqual({ value: "qwen-reviewer", source: "llm.local.reviewModel" });
    expect((await resolve({ task: "t-pending", review: "true", "review-model": "other" })).resolved.reviewModel)
      .toEqual({ value: "other", source: "cli-flag" });
  });

  it("drops the permission mode for a vendor without one", async () => {
    await projectConfig({ llm: { vendor: "codex", codex: { cli_path: process.execPath } } });
    const r = await resolve({ task: "t-pending" });

    expect(r.resolved.permissionMode).toEqual({ value: null, source: "built-in" });
    expect(r.options.find((o) => o.key === "provider")?.values).toEqual(["cli"]);
  });

  it("refuses --resolve without --task", async () => {
    await expect(resolveRun(projectDir, {})).rejects.toThrow(/--resolve requires --task/);
  });
});

describe("the resolved model is the model a real run uses", () => {
  /**
   * The model `cmdRun` resolves, read from the vendor/model header it prints
   * from the same variable it hands the loop. The vendor CLI path points
   * nowhere, so the run stops at its CLI check, right after the header.
   */
  async function realRunModel(flags: Record<string, string>): Promise<string> {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdRun(projectDir, { ...flags, auto: "true" }).catch(() => undefined);
      const header = log.mock.calls.map((c) => String(c[0])).find((line) => line.includes("Model: "));
      // The header may be coloured.
      const plain = (header ?? "").replace(/\u001b\[[0-9;]*m/g, "");
      return /Model: (\S+)/.exec(plain)?.[1] ?? "<no header>";
    } finally {
      log.mockRestore();
    }
  }

  const NOWHERE = "/nonexistent/vendor-cli";
  const matrix: Array<[string, Record<string, unknown>, Record<string, string>]> = [
    ["vendor default", { llm: { vendor: "claude", claude: { cli_path: NOWHERE } } }, {}],
    ["--model", { llm: { vendor: "claude", claude: { cli_path: NOWHERE, model: "sonnet" } } }, { model: "opus" }],
    ["--claude-model", { llm: { vendor: "claude", claude: { cli_path: NOWHERE } } }, { "claude-model": "haiku" }],
    ["hench.models", { llm: { vendor: "claude", claude: { cli_path: NOWHERE } }, hench: { models: { claude: "opus" } } }, {}],
    ["llm.model", { llm: { vendor: "claude", model: "haiku", claude: { cli_path: NOWHERE, model: "sonnet" } } }, {}],
    ["llm.routes", { llm: { vendor: "claude", routes: { "agent.execute": "heavy" }, claude: { cli_path: NOWHERE } } }, {}],
    ["llm.tiers", { llm: { vendor: "claude", tiers: { claude: { standard: "opus" } }, claude: { cli_path: NOWHERE } } }, {}],
    ["codex default", { llm: { vendor: "codex", codex: { cli_path: NOWHERE } } }, {}],
    ["codex model", { llm: { vendor: "codex", codex: { cli_path: NOWHERE, model: "gpt-5.6-terra" } } }, {}],
  ];

  it.each(matrix)("%s", async (_label, config, flags) => {
    await projectConfig(config);
    const resolved = (await resolve({ task: "t-pending", ...flags })).resolved.model.value;

    expect(resolved).toBe(await realRunModel({ task: "t-pending", ...flags }));
  });
});

describe("refusals are reported, not thrown", () => {
  it("task-not-found", async () => {
    const r = await resolve({ task: "no-such-task" });
    expect(r.task).toBeNull();
    expect(codes(r)).toEqual(["task-not-found"]);
  });

  it.each(["t-done", "t-blocked", "t-deferred"])("not-actionable: %s", async (task) => {
    const r = await resolve({ task });
    expect(codes(r)).toEqual(["not-actionable"]);
    expect(r.refusals[0].message).toMatch(/cannot be worked on/);
  });

  it("not-actionable is lifted by --reset-deferred for a deferred task", async () => {
    // What the dashboard's prep GET spawns for a deferred task.
    const r = await resolve({ task: "t-deferred", "reset-deferred": "true" });
    expect(codes(r)).toEqual([]);
    expect(r.resolved.resetDeferred).toEqual({ value: true, source: "cli-flag" });
  });

  it("an in-progress task is actionable: the run resumes it", async () => {
    expect(codes(await resolve({ task: "t-progress" }))).toEqual([]);
  });

  it("claimed-elsewhere", async () => {
    const other = `${projectDir}-wt`;
    extraDirs.push(other);
    git(projectDir, "worktree", "add", "-q", "-b", "other", other);
    const claims = TaskClaims.forProject(other);
    expect(await claims.claim("t-pending")).toBeNull();
    try {
      const r = await resolve({ task: "t-pending" });
      expect(codes(r)).toEqual(["claimed-elsewhere"]);
      expect(r.task?.claimedBy?.worktree).toBe(git(other, "rev-parse", "--show-toplevel"));
    } finally {
      await claims.releaseAll();
    }
  });

  it("tree-not-conformant, saying whether a migration fixes it", async () => {
    const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
    const epicDir = (await readdir(treeRoot)).find((e) => e !== TREE_META_FILENAME)!;
    await rename(join(treeRoot, epicDir), join(treeRoot, "resolve-epic-epic1x"));
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "re-suffix");

    const r = await resolve({ task: "t-pending" });
    expect(codes(r)).toEqual(["tree-not-conformant"]);
    expect(typeof r.refusals[0].migratable).toBe("boolean");
  });

  it("vendor-unset", async () => {
    await projectConfig({ llm: { claude: { cli_path: process.execPath } } });
    const r = await resolve({ task: "t-pending" });
    expect(codes(r)).toEqual(["vendor-unset"]);
    expect(r.resolved.vendor.source).toBe("built-in");
  });

  it("vendor-cli-missing", async () => {
    await projectConfig({ llm: { vendor: "claude", claude: { cli_path: "/nonexistent/claude" } } });
    expect(codes(await resolve({ task: "t-pending" }))).toEqual(["vendor-cli-missing"]);
  });

  it("provider-unsupported: codex has no API provider", async () => {
    await projectConfig({ llm: { vendor: "codex", codex: { cli_path: process.execPath } } });
    expect(codes(await resolve({ task: "t-pending", provider: "api" }))).toEqual(["provider-unsupported"]);
  });

  it("provider-unsupported: --review on a vendor with no CLI", async () => {
    await projectConfig({ llm: { vendor: "google" } });
    const r = await resolve({ task: "t-pending", review: "true" });
    expect(codes(r)).toEqual(["provider-unsupported"]);
    // google has no CLI, so the cli provider switches to api — as a run does.
    expect(r.resolved.provider).toEqual({ value: "api", source: "vendor-default" });
  });

  it("model-vendor-mismatch", async () => {
    await projectConfig({ llm: { ...CLAUDE, model: "gpt-5.6-terra" } });
    expect(codes(await resolve({ task: "t-pending" }))).toEqual(["model-vendor-mismatch"]);
  });

  it("dirty-tree, unless --allow-dirty", async () => {
    await writeFile(join(projectDir, "scratch.txt"), "work in progress", "utf-8");

    const r = await resolve({ task: "t-pending" });
    expect(codes(r)).toEqual(["dirty-tree"]);
    expect(r.workspace.dirty).toBe(true);
    expect(codes(await resolve({ task: "t-pending", "allow-dirty": "true" }))).toEqual([]);
  });
});

describe("resolving acts on nothing", () => {
  async function snapshot(dir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    async function walk(current: string, rel: string): Promise<void> {
      for (const entry of await readdir(current)) {
        const abs = join(current, entry);
        const key = rel ? `${rel}/${entry}` : entry;
        if ((await stat(abs)).isDirectory()) await walk(abs, key);
        else out.set(key, await readFile(abs, "utf-8"));
      }
    }
    await walk(dir, "");
    return out;
  }

  it("leaves the PRD, the claims file, hench state, git status and HEAD as they were", async () => {
    const claimsFile = join(projectDir, ".git", "ndx", "claims.json");
    const before = {
      rex: await snapshot(rexDir),
      hench: await snapshot(henchDir),
      status: git(projectDir, "status", "--porcelain", "--untracked-files=all"),
      head: git(projectDir, "rev-parse", "HEAD"),
      claims: existsSync(claimsFile),
    };

    // --reset-deferred over a deferred task is the run's first PRD write and
    // commit; resolve must report it without making either.
    const r = await resolve({ task: "t-deferred", "reset-deferred": "true", fresh: "true" });
    expect(r.task?.status).toBe("deferred");

    expect(await snapshot(rexDir)).toEqual(before.rex);
    expect(await snapshot(henchDir)).toEqual(before.hench);
    expect(git(projectDir, "status", "--porcelain", "--untracked-files=all")).toBe(before.status);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(before.head);
    expect(existsSync(claimsFile)).toBe(before.claims);
  });
});
