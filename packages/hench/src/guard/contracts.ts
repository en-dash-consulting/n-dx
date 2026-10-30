/**
 * Guard-layer configuration contracts.
 *
 * Kept in the guard module so guardrails can be reused without
 * importing schema modules from higher orchestration layers.
 */

import type { EnvPolicyConfig } from "../prd/llm-gateway.js";

/**
 * Default share of an existing file's size below which `write_file` refuses to
 * replace it without `rewrite: true`. Shared with `schema/` so the loaded
 * config and a hand-built GuardConfig agree.
 */
export const DEFAULT_WRITE_SHRINK_RATIO = 0.5;

/** Existing files at or below this many bytes are exempt from the shrink check. */
export const DEFAULT_WRITE_SHRINK_MIN_BYTES = 1024;

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
export type { EnvPolicyConfig };

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
  /**
   * `write_file` refuses to replace an existing file with content smaller than
   * this share of its size (0-1) unless the call passes `rewrite: true`, so a
   * model cannot blank a file it meant to change one line of. 0 disables the
   * check. Default {@link DEFAULT_WRITE_SHRINK_RATIO}.
   */
  writeShrinkRatio?: number;
  /** Existing files at or below this many bytes are exempt from the shrink check. */
  writeShrinkMinBytes?: number;
  /** Policy limits for session-aware rate limiting and resource tracking. */
  policy?: PolicyLimitsConfig;
}
