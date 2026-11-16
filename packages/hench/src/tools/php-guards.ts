/**
 * PHP guards — the checks hench runs on an agent's changes in a PHP project
 * before the task can be marked done.
 *
 * - `php -l` on each changed `.php` / `.phtml` / `.inc` file, when `php` is
 *   on PATH;
 * - `composer validate --no-check-publish`, when `composer.json` exists and
 *   `composer` is on PATH.
 *
 * PHPUnit is the test gate's job: {@link detectPhpunitCommand} is what the
 * test-command resolver auto-detects for a PHP project.
 *
 * Each check runs only when its prerequisite exists. These are the project's
 * own tools; n-dx installs nothing (LS16), so a missing tool is reported as a
 * skipped check, not a failure.
 */

import { stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { execRepoShellCmd } from "../guard/sandbox.js";
import { isExecutableOnPath, repoCommandEnv, resolveShellKind } from "../prd/llm-gateway.js";
import type { ExecOptions, ExecResult } from "../process/exec.js";

/** Extensions `php -l` is run on. */
export const PHP_LINT_EXTENSIONS: readonly string[] = [".php", ".phtml", ".inc"];

/** PHPUnit config files whose presence enables the PHPUnit test gate. */
export const PHPUNIT_CONFIG_FILES: readonly string[] = ["phpunit.xml", "phpunit.xml.dist"];

/** The project-local PHPUnit binary Composer installs. */
export const PHPUNIT_BINARY = "vendor/bin/phpunit";

export const COMPOSER_VALIDATE_COMMAND = "composer validate --no-check-publish";

async function isRegularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/**
 * `vendor/bin/phpunit` when the project has a PHPUnit config and the binary
 * Composer installed; otherwise undefined, and there is no PHPUnit gate.
 */
export async function detectPhpunitCommand(projectDir: string): Promise<string | undefined> {
  if (!(await isRegularFile(join(projectDir, PHPUNIT_BINARY)))) return undefined;
  for (const config of PHPUNIT_CONFIG_FILES) {
    if (await isRegularFile(join(projectDir, config))) return PHPUNIT_BINARY;
  }
  return undefined;
}

export type PhpShellKind = ReturnType<typeof resolveShellKind>;

/** Characters a path may carry and still be passed to either shell unquoted. */
const SHELL_SAFE_PATH = /^[A-Za-z0-9._/@+=,:-]+$/;

/**
 * A changed path as one shell argument, or undefined when cmd.exe cannot be
 * given it safely: inside its double quotes `%` and `!` still expand and `"`
 * cannot be escaped.
 */
export function quotePathForShell(path: string, shellKind: PhpShellKind): string | undefined {
  const p = path.split(sep).join("/");
  if (SHELL_SAFE_PATH.test(p)) return p;
  if (shellKind === "posix") return `'${p.replace(/'/g, "'\\''")}'`;
  return /["%!^]/.test(p) ? undefined : `"${p}"`;
}

export interface PhpGuardCheck {
  kind: "php-lint" | "composer-validate";
  command: string;
  /** The changed file a `php-lint` check covers. */
  file?: string;
}

export interface PhpGuardPlan {
  checks: PhpGuardCheck[];
  /** Checks that could not run, each with the reason. */
  skipped: string[];
  /** Checks that cannot be expressed safely: these fail the guard. */
  errors: string[];
}

export interface PhpGuardDeps {
  /** Whether an executable is on PATH. */
  onPath?: (name: string) => boolean;
  shellKind?: PhpShellKind;
}

/** Decide which PHP checks apply to this change. Runs nothing. */
export async function planPhpGuards(
  projectDir: string,
  filesChanged: readonly string[],
  deps: PhpGuardDeps = {},
): Promise<PhpGuardPlan> {
  const onPath = deps.onPath ?? isExecutableOnPath;
  const shellKind = deps.shellKind ?? resolveShellKind();
  const checks: PhpGuardCheck[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // A deleted file is in the changed set too; there is nothing to lint.
  const phpFiles: string[] = [];
  for (const file of filesChanged) {
    if (!PHP_LINT_EXTENSIONS.includes(extname(file).toLowerCase())) continue;
    if (await isRegularFile(join(projectDir, file))) phpFiles.push(file);
  }

  if (phpFiles.length > 0) {
    if (!onPath("php")) {
      skipped.push(`php -l: php is not on PATH (${phpFiles.length} changed PHP file(s) not linted)`);
    } else {
      for (const file of phpFiles) {
        const arg = quotePathForShell(file, shellKind);
        if (arg === undefined) errors.push(`php -l: cannot pass ${file} to cmd.exe safely`);
        else checks.push({ kind: "php-lint", command: `php -l ${arg}`, file });
      }
    }
  }

  if (await isRegularFile(join(projectDir, "composer.json"))) {
    if (onPath("composer")) checks.push({ kind: "composer-validate", command: COMPOSER_VALIDATE_COMMAND });
    else skipped.push("composer validate: composer is not on PATH");
  }

  return { checks, skipped, errors };
}

export interface PhpGuardCheckResult extends PhpGuardCheck {
  passed: boolean;
  /** Output of a failed check, trimmed. */
  output?: string;
}

export interface PhpGuardResult {
  passed: boolean;
  results: PhpGuardCheckResult[];
  skipped: string[];
  errors: string[];
}

export interface RunPhpGuardsOptions extends PhpGuardDeps {
  projectDir: string;
  filesChanged: readonly string[];
  /** Per-check timeout in ms: the guard's `commandTimeout`. */
  timeout: number;
  /** Runs one check. Defaults to the sandboxed repository shell. */
  execCommand?: (command: string, opts: ExecOptions) => Promise<ExecResult>;
}

const MAX_OUTPUT_CHARS = 2000;

/** Run every applicable PHP check; the guard passes when all of them do. */
export async function runPhpGuards(options: RunPhpGuardsOptions): Promise<PhpGuardResult> {
  const { projectDir, filesChanged, timeout } = options;
  const execCommand = options.execCommand ?? execRepoShellCmd;
  const plan = await planPhpGuards(projectDir, filesChanged, options);
  const results: PhpGuardCheckResult[] = [];

  for (const check of plan.checks) {
    // Confined like the test gate: the files checked are agent-written.
    const r = await execCommand(check.command, { cwd: projectDir, timeout, env: repoCommandEnv(projectDir) });
    const passed = r.launched !== false && r.exitCode === 0;
    const output = passed
      ? undefined
      : (r.exitCode === null ? `timed out after ${timeout}ms\n` : "") +
        ((r.stdout.trim() + "\n" + r.stderr.trim()).trim() || r.error?.message || "").slice(-MAX_OUTPUT_CHARS);
    results.push({ ...check, passed, ...(output ? { output } : {}) });
  }

  return {
    passed: plan.errors.length === 0 && results.every((r) => r.passed),
    results,
    skipped: plan.skipped,
    errors: plan.errors,
  };
}
