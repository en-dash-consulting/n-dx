/**
 * `sv workspace --discover <dir>`: find the repositories under a folder,
 * analyse the ones without a current analysis, and report the ones that
 * cannot join the workspace.
 *
 * - A repository root is a directory holding `.git` (directory or file, so a
 *   worktree or submodule counts) or `.svn`. The walk never descends into a
 *   found root, so a nested repository is part of its parent's analysis.
 * - A symlink is never followed. One whose target is a repository outside
 *   <dir> is reported; one inside <dir> is reached through its real path.
 * - Each analysis is `sv analyze --fast` in a child process: no model call
 *   and no network call. The child gets the environment with credentials
 *   stripped, since a third-party repository is being read. A per-repo
 *   timeout stops the child, and `jobs` bounds how many run at once.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileEnvPolicy,
  getCurrentHead,
  sanitizeChildEnv,
  spawnTool,
} from "@n-dx/llm-client";
import { DATA_FILES } from "../../schema/data-files.js";
import { resolveSourcevisionPaths } from "../../paths.js";
import { toPosix } from "../../util/paths.js";

export type DiscoverSkipReason =
  | "analysis-failed"
  | "timed-out"
  | "no-supported-files"
  | "outside-dir"
  | "unreadable";

export interface DiscoverSkip {
  /** Posix path relative to <dir>. */
  path: string;
  reason: DiscoverSkipReason;
  /** The exit line, the symlink target, or the read error. */
  detail?: string;
}

export interface DiscoverFound {
  /** Posix path relative to <dir>. */
  path: string;
  /** `current`: an analysis already matched HEAD and was kept. */
  analysis: "analysed" | "current";
}

export interface DiscoverResult {
  found: DiscoverFound[];
  skipped: DiscoverSkip[];
}

export interface AnalyseOutcome {
  status: "ok" | "failed" | "timed-out";
  detail?: string;
}

/** Runs one static analysis of `repoDir`; must never reject. */
export type AnalyseRunner = (repoDir: string, timeoutMs: number) => Promise<AnalyseOutcome>;

/** Two at once: each analysis is a full CLI process, and a batch of fresh clones should not load the machine. */
export const DEFAULT_DISCOVER_JOBS = 2;
export const DEFAULT_DISCOVER_TIMEOUT_MS = 10 * 60_000;

/** Directories never walked: dependency trees, and hidden ones (analysis output, tool state). */
function skipWalking(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

export function isRepositoryRoot(dir: string): boolean {
  if (existsSync(join(dir, ".git"))) return true;
  const svn = join(dir, ".svn");
  return existsSync(svn) && statSync(svn).isDirectory();
}

function contains(realRoot: string, target: string): boolean {
  const rel = relative(realRoot, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Repository roots under `dir` (absolute, sorted), plus the skips the walk
 * itself found: symlinked repositories outside `dir`, unreadable folders.
 */
export function findRepositoryRoots(dir: string): { roots: string[]; skipped: DiscoverSkip[] } {
  const realRoot = realpathSync(dir);
  const roots: string[] = [];
  const skipped: DiscoverSkip[] = [];
  const rel = (p: string) => toPosix(relative(dir, p));

  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: rel(current), reason: "unreadable", detail: (err as Error).message });
      return;
    }
    for (const entry of entries) {
      if (skipWalking(entry.name)) continue;
      const path = join(current, entry.name);

      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(path);
        } catch {
          continue; // A dangling link leads nowhere: there is no repository to find or report.
        }
        if (!contains(realRoot, target) && statSync(target).isDirectory() && isRepositoryRoot(target)) {
          skipped.push({ path: rel(path), reason: "outside-dir", detail: target });
        }
        continue;
      }

      if (!entry.isDirectory()) continue;
      if (isRepositoryRoot(path)) roots.push(path);
      else walk(path);
    }
  };

  walk(dir);
  return { roots: roots.sort(), skipped };
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Whether `repoDir` already has an analysis of what is checked out: a
 * readable manifest and inventory and, in a git repository, the manifest's
 * `gitSha` equal to HEAD. Uncommitted edits are not detected.
 */
export function isAnalysisCurrent(repoDir: string): boolean {
  const { svDir } = resolveSourcevisionPaths(repoDir);
  const manifest = readJson<{ gitSha?: string }>(join(svDir, DATA_FILES.manifest));
  if (!manifest || !existsSync(join(svDir, DATA_FILES.inventory))) return false;
  if (!existsSync(join(repoDir, ".git"))) return true;
  return getCurrentHead(repoDir) === manifest.gitSha;
}

/** Number of inventoried files in the analysis, or null when it cannot be read. */
export function analysedFileCount(repoDir: string): number | null {
  const { svDir } = resolveSourcevisionPaths(repoDir);
  const inventory = readJson<{ files?: unknown[] }>(join(svDir, DATA_FILES.inventory));
  return Array.isArray(inventory?.files) ? inventory.files.length : null;
}

/** Maps `items` through `fn` with at most `jobs` calls in flight, keeping input order. */
export async function mapBounded<T, R>(items: T[], jobs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, lane));
  return out;
}

/** The last non-empty line of a child's output, for the skip report. */
function lastLine(text: string): string | undefined {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
}

const SV_CLI = fileURLToPath(new URL("../index.js", import.meta.url));

/**
 * `sv analyze --fast <repoDir>` in a child process with credentials stripped.
 * On timeout spawnTool sends SIGTERM, then SIGKILL, and settles with a null
 * exit code.
 */
export const spawnFastAnalyse: AnalyseRunner = async (repoDir, timeoutMs) => {
  let res;
  try {
    res = await spawnTool(process.execPath, [SV_CLI, "analyze", "--fast", repoDir], {
      env: sanitizeChildEnv(process.env, compileEnvPolicy(undefined)),
      stdio: "pipe",
      timeout: timeoutMs,
      windowsHide: true,
    });
  } catch (err) {
    return { status: "failed", detail: (err as Error).message };
  }
  if (res.exitCode === null) return { status: "timed-out", detail: `no result after ${Math.round(timeoutMs / 1000)}s` };
  if (res.exitCode === 0) return { status: "ok" };
  return { status: "failed", detail: lastLine(res.stderr) ?? lastLine(res.stdout) ?? `exit ${res.exitCode}` };
};

export interface DiscoverOptions {
  jobs?: number;
  timeoutMs?: number;
  runner?: AnalyseRunner;
}

/** Find the repositories under `dir`, analyse those without a current analysis, and sort them into found and skipped. */
export async function discoverRepositories(dir: string, opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  const { jobs = DEFAULT_DISCOVER_JOBS, timeoutMs = DEFAULT_DISCOVER_TIMEOUT_MS, runner = spawnFastAnalyse } = opts;
  const { roots, skipped } = findRepositoryRoots(dir);
  const rel = (p: string) => toPosix(relative(dir, p));

  const outcomes = await mapBounded(roots, jobs, async (root) => {
    if (isAnalysisCurrent(root)) return { root, analysis: "current" as const, outcome: { status: "ok" } as AnalyseOutcome };
    return { root, analysis: "analysed" as const, outcome: await runner(root, timeoutMs) };
  });

  const found: DiscoverFound[] = [];
  for (const { root, analysis, outcome } of outcomes) {
    const path = rel(root);
    if (outcome.status === "timed-out") skipped.push({ path, reason: "timed-out", detail: outcome.detail });
    else if (outcome.status === "failed") skipped.push({ path, reason: "analysis-failed", detail: outcome.detail });
    else {
      const files = analysedFileCount(root);
      if (files === null) skipped.push({ path, reason: "analysis-failed", detail: "no readable inventory.json" });
      else if (files === 0) skipped.push({ path, reason: "no-supported-files" });
      else found.push({ path, analysis });
    }
  }

  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { found, skipped };
}
