/**
 * OS confinement for the repository hooks that hench's own git commands run.
 *
 * Hench's lifecycle commits, staging and stashes run in the hench process,
 * outside the tool sandbox, and they run the repository's hooks as a human
 * commit would. Those hook scripts live in the checkout (`.husky/`, a
 * configured `core.hooksPath`), which the agent can edit, so hench confines
 * them rather than skipping them: git itself runs as before (it can sign, and
 * it writes `.git`), while every hook it would start is reached through a
 * generated wrapper that re-executes the real hook inside the OS sandbox.
 *
 * The hook's policy (`git-hook` kind): read-write to the project, the git
 * common directory of a linked worktree and a private scratch directory;
 * read-only to the toolchain and to hench's own state and the operator's local
 * config; no credential directories; the tool network setting (`none` unless
 * the operator set `sandbox.network: "allow"`, which a hook that fetches
 * needs). The PRD stays writable because the commit stages PRD files hench
 * wrote and a formatter hook may rewrite staged files.
 *
 * When the operator turned the sandbox off, or the host has no backend, no
 * wrapper is made and hooks run unconfined; the run's posture line says so.
 *
 * @module
 */

import { accessSync, constants, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { exec, getGitCommonDir, nodeToolchainRoots, wrapInSandbox } from "../prd/llm-gateway.js";
import type { SandboxPolicy } from "../prd/llm-gateway.js";
import { resolveSandboxPosture } from "./sandbox.js";
import type { CreateToolSandboxOptions } from "./sandbox.js";

/** Hooks for one git command, each re-executed inside the sandbox. */
export interface ConfinedHooks {
  /** Directory to pass as `-c core.hooksPath=<dir>` before the subcommand. */
  readonly hooksPath: string;
  /** Names of the hooks that were wrapped. */
  readonly hooks: readonly string[];
  /** Remove the wrapper and scratch directories. Safe to call more than once. */
  dispose(): void;
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isOutside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.startsWith("..") || resolve(parent, rel) !== child;
}

/** Single-quote a word for POSIX `sh`. */
function shQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The hooks directory git would use here, honouring `core.hooksPath`. */
async function resolveHooksDir(projectDir: string): Promise<string | null> {
  const result = await exec("git", ["rev-parse", "--git-path", "hooks"], { cwd: projectDir, timeout: 10_000 });
  const out = result.stdout.trim();
  if (!result.launched || result.exitCode !== 0 || !out) return null;
  return realOr(resolve(projectDir, out));
}

/** Executable hook files in a hooks directory, as git would run them. */
function executableHooks(hooksDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(hooksDir);
  } catch {
    return [];
  }
  return names.filter((name) => {
    if (name.endsWith(".sample")) return false;
    const path = join(hooksDir, name);
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Prepare confined hooks for one git command run in `projectDir`, or return
 * null when there is nothing to confine: the sandbox is off or unavailable,
 * the hooks directory cannot be resolved, or it holds no executable hook.
 *
 * The wrappers live in their own directory, outside the sandbox's writable
 * roots, so a confined hook cannot rewrite the wrapper git starts next.
 * Each wrapper restores the caller's `GIT_CONFIG_PARAMETERS` before it runs
 * the hook, so git commands inside the hook see the repository's own hooks
 * path and run any nested hook directly — still inside the same sandbox.
 */
export async function prepareConfinedHooks(
  projectDir: string,
  options: CreateToolSandboxOptions = {},
): Promise<ConfinedHooks | null> {
  const { posture, setting, backend } = resolveSandboxPosture(projectDir, options);
  if (posture.state !== "confined") return null;

  const hooksDir = await resolveHooksDir(projectDir);
  if (!hooksDir) return null;
  const hooks = executableHooks(hooksDir);
  if (hooks.length === 0) return null;

  const env = options.env ?? process.env;
  const home = realOr(homedir());
  const realProject = realOr(projectDir);
  const readOnlyRoots = [
    ...nodeToolchainRoots(env).map(realOr),
    join(home, ".gitconfig"),
    join(home, ".config", "git"),
  ];
  if (isOutside(realProject, hooksDir)) readOnlyRoots.push(hooksDir);
  const readWriteRoots: string[] = [];
  const common = getGitCommonDir(realProject);
  if (common) {
    const realCommon = realOr(common);
    if (isOutside(realProject, realCommon)) readWriteRoots.push(realCommon);
  }

  const wrapperDir = realOr(mkdtempSync(join(tmpdir(), "hench-hooks-")));
  let tmpDir: string;
  try {
    tmpDir = realOr(mkdtempSync(join(tmpdir(), "hench-hook-sbx-")));
  } catch (err) {
    rmSync(wrapperDir, { recursive: true, force: true });
    throw err;
  }

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    rmSync(wrapperDir, { recursive: true, force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  };

  try {
    const policy: SandboxPolicy = {
      kind: "git-hook",
      projectDir: realProject,
      tmpDir,
      network: setting.toolNetwork,
      homeDir: home,
      readOnlyRoots,
      readWriteRoots,
    };
    const callerConfig = env.GIT_CONFIG_PARAMETERS;
    const restoreConfig = callerConfig === undefined
      ? "unset GIT_CONFIG_PARAMETERS"
      : `GIT_CONFIG_PARAMETERS=${shQuote(callerConfig)}; export GIT_CONFIG_PARAMETERS`;
    for (const name of hooks) {
      const inv = wrapInSandbox(join(hooksDir, name), [], policy, backend);
      // npm's cache and logs default to the home directory, which the hook
      // cannot write; give it the scratch directory instead.
      const hookEnv: Record<string, string> = { ...inv.env, npm_config_cache: join(tmpDir, "npm-cache") };
      const exports = Object.entries(hookEnv).map(([k, v]) => `${k}=${shQuote(v)}; export ${k}`);
      const script = [
        "#!/bin/sh",
        restoreConfig,
        ...exports,
        `exec ${[inv.file, ...inv.args].map(shQuote).join(" ")} "$@"`,
        "",
      ].join("\n");
      writeFileSync(join(wrapperDir, name), script, { mode: 0o700 });
    }
  } catch (err) {
    dispose();
    throw err;
  }

  return { hooksPath: wrapperDir, hooks, dispose };
}
