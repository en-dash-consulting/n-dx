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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { resolveModel, NEWEST_MODELS, REVIEW_MODELS, TIER_MODELS } from "@n-dx/llm-client";
import { resolveRun, shellWord } from "../../src/cli/commands/run-resolve.js";
import type { RunRefusalCode, RunResolution } from "../../src/cli/commands/run-resolve.js";
import { cmdRun } from "../../src/cli/commands/run.js";
import { readSessionCache, writeSessionCache } from "../../src/agent/lifecycle/session-cache.js";
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

/** Git prints forward slashes on Windows; resolve() gives the native form the code reports. */
function gitToplevel(cwd: string): string {
  return resolvePath(git(cwd, "rev-parse", "--show-toplevel"));
}

/**
 * Write the project config and commit it, so the tree stays clean. Each
 * `llm.<vendor>.cli_path` goes to `.n-dx.local.json`, where `ndx config`
 * writes it: a shared one applies only once the repository is trusted.
 */
async function projectConfig(data: Record<string, unknown>): Promise<void> {
  const llm = { ...((data.llm ?? {}) as Record<string, Record<string, unknown> | unknown>) };
  const localLlm: Record<string, unknown> = {};
  for (const vendor of ["claude", "codex"]) {
    const block = llm[vendor] as Record<string, unknown> | undefined;
    if (block?.cli_path === undefined) continue;
    const { cli_path, ...rest } = block;
    localLlm[vendor] = { cli_path };
    llm[vendor] = rest;
  }
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(data.llm ? { ...data, llm } : data), "utf-8");
  // Always written, so it replaces the template's as `.n-dx.json` does.
  await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: localLlm }), "utf-8");
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

/**
 * The project every test starts from: PRD, config and a baseline commit, built
 * once and copied into a fresh directory per test. A test still gets a tree of
 * its own to dirty, claim or corrupt; what it no longer pays for is the git
 * init, add, commit and rev-parse that built the baseline, per test, for 41
 * tests — about ten times dearer on the Windows CI runner, where this file
 * took 71 s against 5 s on Linux (run 38193308009). A git repository is
 * relocatable, so the copy reports the same toplevel, branch and HEAD a fresh
 * build would.
 */
let templateDir: string;

beforeAll(async () => {
  let templateRexDir: string;
  ({ projectDir: templateDir, rexDir: templateRexDir } = await setupProjectDir("hench-resolve-template-"));
  await (await resolveStore(templateRexDir)).saveDocument(DOC as never);
  await writeFile(join(templateDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: CLAUDE.vendor } }), "utf-8");
  // cli_path is machine-local: a shared one applies only once the repository is trusted.
  await writeFile(join(templateDir, ".n-dx.local.json"), JSON.stringify({ llm: { claude: CLAUDE.claude } }), "utf-8");
  // Ignored, as `ndx init` leaves it: a committed one is repository config.
  await writeFile(join(templateDir, ".gitignore"), ".n-dx.local.json\n", "utf-8");
  commitGitFixtureBaseline(templateDir);
});

afterAll(async () => {
  await cleanupProjectDir(templateDir);
});

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "hench-resolve-"));
  henchDir = join(projectDir, ".hench");
  rexDir = join(projectDir, ".rex");
  await cp(templateDir, projectDir, { recursive: true });
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
      root: gitToplevel(projectDir),
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
      reviewMode: { value: "off", source: "built-in" },
      reviewVendor: { value: "codex", source: "built-in" },
      // Reported without --review: the reviewer a review would use.
      reviewModel: { value: REVIEW_MODELS.claude, source: "vendor-default", vendorDefault: REVIEW_MODELS.claude },
      reviewOptional: { value: false, source: "built-in" },
      skipTestGate: { value: false, source: "built-in" },
      maxTurns: { value: 200, source: "hench.maxTurns" },
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
      // `--reviewer` is refused beside `--review` (self review has no reviewer
      // to name); task-review-settings.test.ts covers it as a cli-flag.
      if (key === "reviewVendor") continue;
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
        `--context-file=${shellWord("/tmp/notes with space.md")} ${projectDir}`,
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
    await projectConfig({ llm: { vendor: "local", local: { reviewModel: "qwen-reviewer" } } });
    const r = await resolve({ task: "t-pending", review: "true" });

    expect(r.resolved.reviewModel).toMatchObject({ value: "qwen-reviewer", source: "llm.local.reviewModel" });
    expect((await resolve({ task: "t-pending", review: "true", "review-model": "other" })).resolved.reviewModel)
      .toMatchObject({ value: "other", source: "cli-flag" });
  });

  it("reports the reviewer and its source without --review, review staying off", async () => {
    await projectConfig({ llm: { vendor: "local", local: { reviewModel: "qwen-reviewer" } } });
    const r = await resolve({ task: "t-pending" });

    expect(r.resolved.review.value).toBe(false);
    expect(r.resolved.reviewModel).toMatchObject({ value: "qwen-reviewer", source: "llm.local.reviewModel" });
  });

  it("reports llm.claude.reviewModel and llm.reviewModel as the reviewer's source", async () => {
    await projectConfig({ llm: { vendor: "claude", claude: { reviewModel: "opus" }, reviewModel: "haiku" } });
    expect((await resolve({ task: "t-pending", review: "true" })).resolved.reviewModel)
      .toMatchObject({ value: resolveModel("opus"), source: "llm.claude.reviewModel" });

    await projectConfig({ llm: { vendor: "claude", reviewModel: "haiku" } });
    expect((await resolve({ task: "t-pending", review: "true" })).resolved.reviewModel)
      .toMatchObject({ value: resolveModel("haiku"), source: "llm.reviewModel" });
  });

  it("drops the permission mode for a vendor without one", async () => {
    await projectConfig({ llm: { vendor: "codex", codex: { cli_path: process.execPath } } });
    const r = await resolve({ task: "t-pending" });

    expect(r.resolved.permissionMode).toEqual({ value: null, source: "built-in" });
    expect(r.options.find((o) => o.key === "provider")?.values).toEqual(["cli"]);
  });

  describe("repository trust", () => {
    let trustHome: string;

    /** Widen the guard so the checkout ships execution config of its own. */
    async function widenGuard(): Promise<void> {
      const path = join(henchDir, "config.json");
      const config = JSON.parse(await readFile(path, "utf-8"));
      config.guard = { ...config.guard, allowedCommands: [...config.guard.allowedCommands, "bash"] };
      await writeFile(path, JSON.stringify(config), "utf-8");
      git(projectDir, "add", "-A");
      git(projectDir, "commit", "-q", "-m", "widen guard");
    }

    beforeEach(async () => {
      trustHome = await mkdtemp(join(tmpdir(), "hench-resolve-trust-"));
      vi.stubEnv("NDX_HOME", trustHome);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await rm(trustHome, { recursive: true, force: true });
    });

    it("reports bypassPermissions as written on a trusted repository", async () => {
      const r = await resolve({ task: "t-pending", "permission-mode": "bypassPermissions" });

      expect(r.resolved.permissionMode).toEqual({ value: "bypassPermissions", source: "cli-flag" });
      expect(r.warnings).toEqual([]);
    });

    it("lowers bypassPermissions to acceptEdits with a warning, not a refusal, on an untrusted one", async () => {
      await widenGuard();
      const r = await resolve({ task: "t-pending", "permission-mode": "bypassPermissions" });

      expect(r.resolved.permissionMode).toEqual({ value: "acceptEdits", source: "repository-trust" });
      expect(r.warnings.map((w) => w.code)).toEqual(["untrusted-repository"]);
      expect(r.warnings[0].message).toMatch(/trust/i);
      expect(codes(r)).toEqual([]);
    });

    it("leaves a lower mode alone but still warns on an untrusted repository", async () => {
      await widenGuard();
      const r = await resolve({ task: "t-pending", "permission-mode": "plan" });

      expect(r.resolved.permissionMode).toEqual({ value: "plan", source: "cli-flag" });
      expect(r.warnings.map((w) => w.code)).toEqual(["untrusted-repository"]);
    });
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
      expect(r.task?.claimedBy?.worktree).toBe(gitToplevel(other));
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

  it("prd-unreadable, with no task, when a tree file cannot be read", async () => {
    // The tree's metadata file is read strictly: anything but "missing" throws.
    const metaPath = join(rexDir, TREE_META_FILENAME);
    await rm(metaPath, { force: true });
    await mkdir(metaPath);

    const r = await resolve({ task: "t-pending" });
    expect(r.task).toBeNull();
    expect(codes(r)).toContain("prd-unreadable");
    expect(r.refusals[0].message).toMatch(/could not be read/);
  });

  it("prd-unreadable when the legacy prd.json is corrupt", async () => {
    await rm(join(rexDir, PRD_TREE_DIRNAME), { recursive: true, force: true });
    await writeFile(join(rexDir, "prd.json"), '{"schema": "rex/v1", "items": [}', "utf-8");

    const r = await resolve({ task: "t-pending" });
    expect(r.task).toBeNull();
    // The deleted tree also leaves the working tree dirty; that is a separate refusal.
    expect(codes(r)).toContain("prd-unreadable");
  });

  it("vendor-unset", async () => {
    await projectConfig({ llm: { claude: { cli_path: process.execPath } } });
    const r = await resolve({ task: "t-pending" });
    expect(codes(r)).toEqual(["vendor-unset"]);
    expect(r.resolved.vendor.source).toBe("built-in");
  });

  it("vendor-cli-missing", async () => {
    // The operator's own local file names the binary; the tracked file's
    // cli_path would be ignored until the checkout is trusted.
    await writeFile(
      join(projectDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { claude: { cli_path: "/nonexistent/claude" } } }),
      "utf-8",
    );
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "local config", "--allow-empty");
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

describe("on a v2 tree", () => {
  const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
  /** The fixture's change CH-1. */
  const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
  /** CH-1's one task, which `--task=CH-1` runs while it is open. */
  const WIRE_ID = "c0000000-0000-4000-8000-000000000002";

  beforeEach(async () => {
    await rm(join(rexDir, PRD_TREE_DIRNAME), { recursive: true, force: true });
    await cp(FIXTURE, rexDir, { recursive: true });
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "v2 tree");
  });

  /** A worktree beside the project, holding claims on `ids`. */
  async function otherWorktreeClaiming(...ids: string[]): Promise<{ claims: TaskClaims; root: string }> {
    const other = `${projectDir}-wt`;
    extraDirs.push(other);
    git(projectDir, "worktree", "add", "-q", "-b", "other", other);
    const claims = TaskClaims.forProject(other);
    for (const id of ids) expect(await claims.claim(id)).toBeNull();
    return { claims, root: gitToplevel(other) };
  }

  it("reports the task a change with an open task runs, not the change", async () => {
    const r = await resolve({ task: "CH-1" });
    expect(codes(r)).toEqual([]);
    expect(r.task?.id).toBe(WIRE_ID);
    expect(r.task?.level).toBe("task");
  });

  it("reports the next task, passing over one another worktree holds", async () => {
    const shipId = "c0000000-0000-4000-8000-000000000003";
    await writeFile(
      join(rexDir, "changes/add-apple-pay/ship-it.md"),
      `---\nid: "${shipId}"\ntype: "task"\ntitle: "Ship it"\nslug: "ship-it"\n---\n`,
    );
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "second task");
    const { claims } = await otherWorktreeClaiming(WIRE_ID);
    try {
      const r = await resolve({ task: "CH-1" });
      expect(codes(r)).toEqual([]);
      expect(r.task?.id).toBe(shipId);
    } finally {
      await claims.releaseAll();
    }
  });

  it("refuses a change whose every open task another worktree holds, naming them", async () => {
    const { claims, root } = await otherWorktreeClaiming(WIRE_ID);
    try {
      const r = await resolve({ task: "CH-1" });
      expect(codes(r)).toEqual(["claimed-elsewhere"]);
      expect(r.task).toBeNull();
      expect(r.refusals[0].message).toContain(`"Wire the button" (claimed by another worktree: ${root})`);
    } finally {
      await claims.releaseAll();
    }
  });

  it("refuses a deferred change with an open task, unless --reset-deferred would reopen it", async () => {
    const stateFile = join(rexDir, "changes/add-apple-pay/state.yaml");
    await writeFile(stateFile, (await readFile(stateFile, "utf-8")).replace('status: "in_progress"', 'status: "deferred"'));
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "defer change");
    const r = await resolve({ task: "CH-1" });
    expect(codes(r)).toEqual(["not-actionable"]);
    expect(r.refusals[0].message).toContain("Add Apple Pay");
    expect(codes(await resolve({ task: "CH-1", "reset-deferred": "true" }))).toEqual([]);
  });

  it("reports a task-less change as the unit", async () => {
    await rm(join(rexDir, "changes/add-apple-pay/wire-the-button.md"));
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "task-less");
    const r = await resolve({ task: "CH-1" });
    expect(codes(r)).toEqual([]);
    expect(r.task?.id).toBe(CHANGE_ID);
  });

  it("checks the claim on the real id, not the display id", async () => {
    const { claims, root } = await otherWorktreeClaiming(CHANGE_ID);
    try {
      const r = await resolve({ task: "CH-1" });
      expect(codes(r)).toEqual(["claimed-elsewhere"]);
      expect(r.task?.claimedBy?.worktree).toBe(root);
    } finally {
      await claims.releaseAll();
    }
  });

  describe("a task inside a claimed change", () => {
    /** The fixture's task under CH-1, which `--task=<id>` runs. */
    const TASK_ID = "c0000000-0000-4000-8000-000000000002";

    it("is refused, naming the change and its holder, when another worktree claims the change", async () => {
      const other = `${projectDir}-wt`;
      extraDirs.push(other);
      git(projectDir, "worktree", "add", "-q", "-b", "other", other);
      const claims = TaskClaims.forProject(other);
      expect(await claims.claim(CHANGE_ID)).toBeNull();
      try {
        const r = await resolve({ task: TASK_ID });
        expect(codes(r)).toEqual(["claimed-elsewhere"]);
        expect(r.task?.id).toBe(TASK_ID);
        expect(r.task?.claimedBy?.worktree).toBe(gitToplevel(other));
        const refusal = r.refusals.find((x) => x.code === "claimed-elsewhere");
        expect(refusal?.message).toContain(CHANGE_ID);
        expect(refusal?.message).toContain(gitToplevel(other));
      } finally {
        await claims.releaseAll();
      }
    });

    it("reports no refusal when the change is unclaimed", async () => {
      const r = await resolve({ task: TASK_ID });
      expect(codes(r)).toEqual([]);
      expect(r.task?.claimedBy).toBeNull();
    });

    it("reports no refusal when this worktree holds the change", async () => {
      const claims = TaskClaims.forProject(projectDir);
      expect(await claims.claim(CHANGE_ID)).toBeNull();
      try {
        const r = await resolve({ task: TASK_ID });
        expect(codes(r)).toEqual([]);
        expect(r.task?.claimedBy).toBeNull();
      } finally {
        await claims.releaseAll();
      }
    });
  });

  it("refuses an Inbox change and its task, naming placement", async () => {
    await appendFile(join(rexDir, "changes/add-apple-pay/state.yaml"), "    needsPlacement: true\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "inbox change");
    for (const ref of ["CH-1", "c0000000-0000-4000-8000-000000000002"]) {
      const r = await resolve({ task: ref });
      expect(codes(r)).toEqual(["not-actionable"]);
      expect(r.refusals[0].message).toContain("needs placement");
      expect(r.refusals[0].hint).toContain("place_change");
    }
  });

  it("refuses a subtask with the run's message, not task-not-found", async () => {
    const taskDir = join(rexDir, "changes/add-apple-pay/wire-the-button");
    await mkdir(taskDir);
    await rename(join(rexDir, "changes/add-apple-pay/wire-the-button.md"), join(taskDir, "index.md"));
    const subId = "c0000000-0000-4000-8000-000000000021";
    await writeFile(join(taskDir, "press.md"), `---\nid: "${subId}"\ntype: "subtask"\ntitle: "Press"\nslug: "press"\n---\n`);
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "subtask");
    const r = await resolve({ task: subId });
    expect(codes(r)).toEqual(["not-actionable"]);
    expect(r.refusals[0].message).toContain('"Press"');
    expect(r.refusals[0].message).toContain("is a subtask");
    expect(r.refusals[0].message).toContain("Run the task instead.");
  });

  it("refuses a container change with the run's message, by id or display id", async () => {
    const umbrella = join(rexDir, "changes/umbrella");
    const innerId = "c0000000-0000-4000-8000-000000000031";
    await mkdir(join(umbrella, "inner"), { recursive: true });
    const umbrellaId = "c0000000-0000-4000-8000-000000000030";
    await writeFile(
      join(umbrella, "index.md"),
      `---\nid: "${umbrellaId}"\ntype: "change"\ntitle: "Umbrella"\nslug: "umbrella"\ndisplayId: "CH-2"\n---\n`,
    );
    await writeFile(join(umbrella, "inner/index.md"), `---\nid: "${innerId}"\ntype: "change"\ntitle: "Inner"\nslug: "inner"\n---\n`);
    await writeFile(join(umbrella, "inner/state.yaml"), `schema: "rex/v2"\nitems:\n  "${innerId}":\n    status: "completed"\n`);
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "container change");
    for (const ref of [umbrellaId, "CH-2"]) {
      const r = await resolve({ task: ref });
      expect(codes(r), ref).toEqual(["not-actionable"]);
      expect(r.refusals[0].message).toContain('"Umbrella"');
      expect(r.refusals[0].message).toContain("holds other changes");
    }
  });

  it("still refuses a ref that names nothing", async () => {
    const r = await resolve({ task: "CH-404" });
    expect(r.task).toBeNull();
    expect(codes(r)).toEqual(["task-not-found"]);
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
    // --fresh is a real run's cue to discard the orientation session; resolve
    // must leave a cached one in place, so seed one for it to (not) clear.
    await writeSessionCache(henchDir, { parentId: "parent-1", svFingerprint: "fp", vendor: "claude", model: "m" });
    const seeded = await readSessionCache(henchDir);
    expect(seeded?.parentId).toBe("parent-1");
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
    expect(await readSessionCache(henchDir)).toEqual(seeded);
    expect(await snapshot(henchDir)).toEqual(before.hench);
    expect(git(projectDir, "status", "--porcelain", "--untracked-files=all")).toBe(before.status);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(before.head);
    expect(existsSync(claimsFile)).toBe(before.claims);
  });
});
