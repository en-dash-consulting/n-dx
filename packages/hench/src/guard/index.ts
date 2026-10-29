/**
 * Security guard system — multi-layered protection for safe autonomous operation.
 *
 * The guard provides configurable, defense-in-depth security for the hench agent.
 * When the agent executes autonomously (running commands, reading/writing files),
 * every operation passes through the guard before execution.
 *
 * ## Security layers
 *
 * 1. **Command allowlisting** (`commands.ts`)
 *    Only explicitly permitted executables can run (e.g., npm, git, node).
 *    Unknown commands are rejected before any shell invocation.
 *
 * 2. **Shell operator blocking** (`commands.ts`)
 *    Metacharacters (`;`, `&`, `|`, `` ` ``, `$`) are rejected to prevent
 *    command chaining or subshell injection. Shell-aware: the set of active
 *    characters and the quotes that protect them follow the shell that will
 *    actually run the command — POSIX `sh`, or cmd.exe on a Windows host
 *    without one — resolved once per run from the same function the executor
 *    uses.
 *
 * 3. **Dangerous pattern detection** (`commands.ts`)
 *    Known-hazardous patterns (sudo, eval, rm -rf /, chmod 777) are blocked
 *    even when the base command is allowed.
 *
 * 4. **Path validation** (`paths.ts`)
 *    - Null-byte rejection (defense against poison-null-byte attacks)
 *    - Directory escape prevention (no `..` traversal outside project)
 *    - Real-path containment (symbolic links are resolved; a link inside the
 *      project that points elsewhere is refused, and tools operate on the
 *      real path)
 *    - Glob-based blocked path patterns (e.g., `.git/**`, `node_modules/**`),
 *      matched against the path as given and its real location
 *    - n-dx's own config files (`NDX_CONFIG_BLOCKED_PATHS`), blocked whatever
 *      the configured patterns say: an agent that wrote `.n-dx.local.json`
 *      would hand itself an unreviewed guard for every later command
 *
 * 5. **Git subcommand allowlisting** (centralized in guard config)
 *    Only explicitly permitted git subcommands can run. Dangerous operations
 *    like push, reset, clean are blocked.
 *
 * 6. **Session-aware policy enforcement** (`policy.ts`)
 *    Tracks cumulative resource usage across the session: commands run,
 *    bytes written, operation frequency. Enforces rate limits and resource
 *    budgets to prevent runaway autonomous behavior.
 *
 * 7. **Config backstop** (`config-backstop.ts`)
 *    Layer 4 sees only hench's own file tools. An allowed command, `codex
 *    exec` or another spelling of a name writes past it, so the run snapshots
 *    n-dx's config files and puts back any that changed after every vendor
 *    spawn and tool call, failing the run.
 *
 * ## Configuration
 *
 * All policies are configurable via {@link GuardConfig} in `.hench/config.json`.
 * Defaults are defined in `schema/v1.ts` (`DEFAULT_HENCH_CONFIG`).
 *
 * @see {@link GuardConfig} for the configuration interface
 * @see {@link validateCommand} for command validation details
 * @see {@link validatePath} for path validation details
 * @see {@link PolicyEngine} for session-aware enforcement
 */

import type { GuardConfig } from "./contracts.js";
import { validatePath, simpleGlobMatch, GuardError } from "./paths.js";
import { validateCommand, resolveShellKind } from "./commands.js";
import type { ShellKind } from "./commands.js";
import { PolicyEngine } from "./policy.js";
import type { AuditEntry, SessionCounters } from "./policy.js";
import { compileEnvPolicy, sanitizeChildEnv } from "./env.js";
import type { ToolSandbox } from "./sandbox.js";
import { NDX_CONFIG_BLOCKED_PATHS } from "../prd/llm-gateway.js";

export { GuardError, validatePath, simpleGlobMatch } from "./paths.js";
export { validateCommand, resolveShellKind } from "./commands.js";
export type { ShellKind } from "./commands.js";
export { PolicyEngine } from "./policy.js";
export {
  DEFAULT_ENV_DENY,
  DEFAULT_ENV_ALLOW,
  compileEnvPolicy,
  envNameAllowed,
  sanitizeChildEnv,
  strippedEnvNames,
} from "./env.js";
export type { EnvPolicy } from "./env.js";
export {
  createToolSandbox,
  createVendorCliSandbox,
  resolveSandboxPosture,
  assertSandboxReady,
  formatSandboxPosture,
} from "./sandbox.js";
export type { ToolSandbox, SandboxPosture, CreateToolSandboxOptions, CreateVendorCliSandboxOptions } from "./sandbox.js";
export type { GuardConfig, EnvPolicyConfig, PolicyLimitsConfig } from "./contracts.js";
export type {
  PolicyLimits,
  OperationType,
  AuditVerdict,
  AuditEntry,
  SessionCounters,
} from "./policy.js";

/** Construction-time overrides for {@link GuardRails}. */
export interface GuardRailsOptions {
  /**
   * Which shell `run_command` strings will be interpreted under. Defaults to
   * the shell `execShellCmd` will actually pick on this host. Inject to make
   * the cmd.exe branch testable on every platform.
   */
  shellKind?: ShellKind;
  /** The environment to filter for child processes. Defaults to `process.env`; inject for tests. */
  env?: NodeJS.ProcessEnv;
  /**
   * OS-level confinement for `run_command` and `git` children, from
   * {@link createToolSandbox}. Absent or null means the children run with
   * the operator's full permissions; the agent loops always pass one.
   */
  sandbox?: ToolSandbox | null;
}

/**
 * Facade that applies all guard policies against a project directory.
 *
 * Instantiated once per agent run with the project's guard configuration.
 * Exposes `checkPath()` and `checkCommand()` as the primary validation API,
 * plus resource limits (`commandTimeout`, `maxFileSize`) for enforcement
 * by the agent's tool execution layer.
 *
 * The integrated {@link PolicyEngine} tracks session state and enforces
 * rate limits. Tools call `recordFileRead()` / `recordFileWrite()` after
 * successful guard checks to update cumulative counters; the policy engine
 * throws if limits are exceeded.
 */
export class GuardRails {
  private projectDir: string;
  private config: GuardConfig;
  /** The configured blocked paths plus n-dx's own config files. */
  private blockedPaths: string[];
  /** Resolved once: the probe behind it costs a subprocess on win32. */
  readonly shellKind: ShellKind;
  readonly policy: PolicyEngine;
  /**
   * The environment child processes receive: `process.env` minus
   * credential-shaped names (see `guard/env.ts`), resolved once per run so a
   * variable exported mid-run neither appears nor disappears between tools.
   */
  readonly childEnv: NodeJS.ProcessEnv;
  /** OS confinement for tool children, or null when the run is unconfined. */
  readonly sandbox: ToolSandbox | null;

  constructor(projectDir: string, config: GuardConfig, options: GuardRailsOptions = {}) {
    this.projectDir = projectDir;
    this.config = config;
    this.blockedPaths = [...new Set([...config.blockedPaths, ...NDX_CONFIG_BLOCKED_PATHS])];
    this.shellKind = options.shellKind ?? resolveShellKind();
    this.policy = new PolicyEngine(config.policy);
    this.childEnv = sanitizeChildEnv(options.env ?? process.env, compileEnvPolicy(config.env));
    this.sandbox = options.sandbox ?? null;
  }

  checkPath(filepath: string): string {
    return validatePath(filepath, this.projectDir, this.blockedPaths);
  }

  /**
   * Whether `filepath` would pass {@link checkPath}. For directory walks,
   * which visit many entries and leave a refused one out rather than stop.
   * Only guard verdicts are swallowed; any other failure propagates.
   */
  isPathAllowed(filepath: string): boolean {
    try {
      this.checkPath(filepath);
      return true;
    } catch (err) {
      if (err instanceof GuardError) return false;
      throw err;
    }
  }

  checkCommand(command: string): void {
    validateCommand(command, this.config.allowedCommands, this.shellKind);
    this.policy.checkPolicy("command", command);
  }

  /**
   * Validate a git subcommand against the centralized allowlist.
   *
   * This replaces the hardcoded allowlist previously in tools/git.ts,
   * making git safety controls configurable and auditable alongside
   * all other guard policies.
   *
   * @throws {GuardError} if the subcommand is not allowed
   */
  checkGitSubcommand(subcommand: string): void {
    const allowed = this.config.allowedGitSubcommands;
    if (!allowed.includes(subcommand)) {
      throw new GuardError(
        `Git subcommand "${subcommand}" not allowed. Allowed: ${allowed.join(", ")}`,
      );
    }
    this.policy.checkPolicy("git", `git ${subcommand}`);
  }

  /**
   * Record a file read through the policy engine.
   * Call after successful path validation.
   */
  recordFileRead(filepath: string): void {
    this.policy.checkPolicy("file_read", filepath);
  }

  /**
   * Record a file write through the policy engine.
   * Call after successful path validation, before writing.
   */
  recordFileWrite(filepath: string, bytesWritten: number): void {
    this.policy.checkPolicy("file_write", filepath, { bytesWritten });
  }

  /**
   * Get current session counters for logging/monitoring.
   */
  get sessionCounters(): SessionCounters {
    return this.policy.counters;
  }

  /**
   * Get the audit trail for post-run analysis.
   */
  get auditLog(): ReadonlyArray<AuditEntry> {
    return this.policy.auditLog;
  }

  get commandTimeout(): number {
    return this.config.commandTimeout;
  }

  get maxFileSize(): number {
    return this.config.maxFileSize;
  }

  get spawnTimeout(): number {
    return this.config.spawnTimeout;
  }

  get maxConcurrentProcesses(): number {
    return this.config.maxConcurrentProcesses;
  }

  get allowedGitSubcommands(): readonly string[] {
    return this.config.allowedGitSubcommands;
  }
}
