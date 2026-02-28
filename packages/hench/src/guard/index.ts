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
 *    command chaining or subshell injection.
 *
 * 3. **Dangerous pattern detection** (`commands.ts`)
 *    Known-hazardous patterns (sudo, eval, rm -rf /, chmod 777) are blocked
 *    even when the base command is allowed.
 *
 * 4. **Path validation** (`paths.ts`)
 *    - Null-byte rejection (defense against poison-null-byte attacks)
 *    - Directory escape prevention (no `..` traversal outside project)
 *    - Glob-based blocked path patterns (e.g., `.git/**`, `node_modules/**`)
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
import { validateCommand } from "./commands.js";
import { PolicyEngine } from "./policy.js";
import type { AuditEntry, SessionCounters } from "./policy.js";

export { GuardError, validatePath, simpleGlobMatch } from "./paths.js";
export { validateCommand } from "./commands.js";
export { PolicyEngine } from "./policy.js";
export type { GuardConfig, PolicyLimitsConfig } from "./contracts.js";
export type {
  PolicyLimits,
  OperationType,
  AuditVerdict,
  AuditEntry,
  SessionCounters,
} from "./policy.js";

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
  readonly policy: PolicyEngine;

  constructor(projectDir: string, config: GuardConfig) {
    this.projectDir = projectDir;
    this.config = config;
    this.policy = new PolicyEngine(config.policy);
  }

  checkPath(filepath: string): string {
    return validatePath(filepath, this.projectDir, this.config.blockedPaths);
  }

  checkCommand(command: string): void {
    validateCommand(command, this.config.allowedCommands);
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
