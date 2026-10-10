/**
 * Guard-layer configuration contracts.
 *
 * Kept in the guard module so guardrails can be reused without
 * importing schema modules from higher orchestration layers.
 */

/** Configurable subset of policy limits (all optional, defaults applied at runtime). */
export interface PolicyLimitsConfig {
  /** Maximum commands per minute (0 = unlimited). */
  maxCommandsPerMinute?: number;
  /** Maximum file writes per minute (0 = unlimited). */
  maxWritesPerMinute?: number;
  /** Maximum total bytes written in the session (0 = unlimited). */
  maxTotalBytesWritten?: number;
  /** Maximum total commands in the session (0 = unlimited). */
  maxTotalCommands?: number;
}

/**
 * Which environment variables reach processes the agent starts.
 *
 * Names are matched case-insensitively as globs (`*` matches any run of
 * characters). The defaults strip anything that looks like a credential —
 * see `DEFAULT_ENV_DENY` in `guard/env.ts` — and `allow` punches holes in that
 * list for variables a project's tests genuinely need.
 */
export type { EnvPolicyConfig } from "../prd/llm-gateway.js";
import type { EnvPolicyConfig } from "../prd/llm-gateway.js";

export interface GuardConfig {
  blockedPaths: string[];
  allowedCommands: string[];
  /** Environment filtering for child processes; defaults strip credential-shaped names. */
  env?: EnvPolicyConfig;
  commandTimeout: number;
  maxFileSize: number;
  /** Timeout in ms for spawn-based execution (spawnTool/spawnManaged). 0 = no timeout. */
  spawnTimeout: number;
  /** Maximum concurrent child processes allowed. */
  maxConcurrentProcesses: number;
  /** Allowed git subcommands. Centralizes the git safety allowlist in guard config. */
  allowedGitSubcommands: string[];
  /** Policy limits for session-aware rate limiting and resource tracking. */
  policy?: PolicyLimitsConfig;
}
