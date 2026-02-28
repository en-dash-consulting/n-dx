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

export interface GuardConfig {
  blockedPaths: string[];
  allowedCommands: string[];
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
