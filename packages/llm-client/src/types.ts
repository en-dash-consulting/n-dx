/**
 * Shared types for the Claude API client abstraction layer.
 *
 * These types define the unified interface that both CLI and API providers
 * implement, plus common token usage and configuration types shared across
 * all n-dx packages.
 *
 * ## Architectural role
 *
 * These types form the **cross-package contract** for the n-dx monorepo.
 * Domain packages (rex, sourcevision, hench) import these types to
 * interact with Claude without coupling to each other. Keeping the
 * contract here — in the leaf of the dependency DAG — prevents circular
 * dependencies and allows each package to be built and tested in
 * isolation.
 *
 * When adding new shared types, add them here rather than in a domain
 * package to preserve the acyclic dependency graph.
 */

// ── Token usage ──────────────────────────────────────────────────────────────

/** Per-call token usage breakdown. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Claude configuration from the unified .n-dx.json config.
 * These settings apply across all packages (hench, rex, sourcevision).
 */
export interface ClaudeConfig {
  /** Path to Claude Code CLI binary. When set, used instead of looking for "claude" on PATH. */
  cli_path?: string;
  /** Anthropic API key. When set, used instead of reading from env var. */
  api_key?: string;
  /** Custom API endpoint URL. When set, used instead of the default Anthropic API URL. */
  api_endpoint?: string;
  /** Default Claude model name. When set, used instead of the default model. */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks
   * instead of TIER_MODELS.claude.light.
   */
  lightModel?: string;
}

// ── Provider types ───────────────────────────────────────────────────────────

/** Authentication mode the client is operating in. */
export type AuthMode = "api" | "cli";

/** Options for creating a Claude client. */
export interface ClaudeClientOptions {
  /** Claude configuration (from .n-dx.json). */
  claudeConfig: ClaudeConfig;
  /** Environment variable name for API key fallback (default: "ANTHROPIC_API_KEY"). */
  apiKeyEnv?: string;
}

/** Input to a Claude completion request. */
export interface CompletionRequest {
  /** The prompt text to send. */
  prompt: string;
  /** Model to use (e.g., "claude-sonnet-4-6"). */
  model: string;
  /** Output format: "json" for a single JSON envelope, "stream-json" for streaming events. */
  outputFormat?: "json" | "stream-json";
  /** Additional CLI flags to pass (only used in CLI mode). */
  cliFlags?: string[];
  /** Timeout in milliseconds (only used in CLI mode). */
  timeoutMs?: number;
}

/** Result from a Claude completion request. */
export interface CompletionResult {
  /** The text response from Claude. */
  text: string;
  /** Token usage from the call, if available. */
  tokenUsage?: TokenUsage;
}

/** Error classification for structured error handling. */
export type ErrorReason = "auth" | "timeout" | "rate-limit" | "not-found" | "cli" | "unknown";

/** A classified error from a Claude call or CLI operation. */
export class ClaudeClientError extends Error {
  readonly reason: ErrorReason;
  /** Whether this error is transient and the call could be retried. */
  readonly retryable: boolean;
  /**
   * When the server specifies a Retry-After delay (e.g. 429 responses),
   * this holds the parsed value in milliseconds. Consumers can use it
   * to display a countdown or decide whether to auto-retry.
   */
  readonly retryAfterMs?: number;

  constructor(message: string, reason: ErrorReason, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "ClaudeClientError";
    this.reason = reason;
    this.retryable = retryable;
    if (retryAfterMs != null && retryAfterMs > 0) {
      this.retryAfterMs = retryAfterMs;
    }
  }
}

export const CLI_ERROR_CODES = {
  API_KEY_MISSING: "NDX_CLI_API_KEY_MISSING",
  AUTH_FAILED: "NDX_CLI_AUTH_FAILED",
  BUDGET_EXCEEDED: "NDX_CLI_BUDGET_EXCEEDED",
  CONCURRENCY_LIMIT: "NDX_CLI_CONCURRENCY_LIMIT",
  CONFIG_NOT_FOUND: "NDX_CLI_CONFIG_NOT_FOUND",
  DIRECTORY_NOT_FOUND: "NDX_CLI_DIRECTORY_NOT_FOUND",
  EPIC_NOT_FOUND: "NDX_CLI_EPIC_NOT_FOUND",
  GENERIC: "NDX_CLI_GENERIC",
  INVALID_CONFIGURATION: "NDX_CLI_INVALID_CONFIGURATION",
  INVALID_PRD: "NDX_CLI_INVALID_PRD",
  INVALID_RUN_RECORD: "NDX_CLI_INVALID_RUN_RECORD",
  JSON_PARSE_FAILED: "NDX_CLI_JSON_PARSE_FAILED",
  LLM_CLI_NOT_FOUND: "NDX_CLI_LLM_CLI_NOT_FOUND",
  LLM_RATE_LIMITED: "NDX_CLI_LLM_RATE_LIMITED",
  LLM_SERVER_ERROR: "NDX_CLI_LLM_SERVER_ERROR",
  MEMORY_THRESHOLD: "NDX_CLI_MEMORY_THRESHOLD",
  NETWORK_ERROR: "NDX_CLI_NETWORK_ERROR",
  NOT_INITIALIZED: "NDX_CLI_NOT_INITIALIZED",
  PERMISSION_DENIED: "NDX_CLI_PERMISSION_DENIED",
  PRD_NOT_FOUND: "NDX_CLI_PRD_NOT_FOUND",
  RESOURCE_NOT_FOUND: "NDX_CLI_RESOURCE_NOT_FOUND",
  SOURCEVISION_MANIFEST_NOT_FOUND: "NDX_CLI_SOURCEVISION_MANIFEST_NOT_FOUND",
  TIMEOUT: "NDX_CLI_TIMEOUT",
  UNKNOWN_COMMAND: "NDX_CLI_UNKNOWN_COMMAND",
} as const;

export type CLIErrorCode = typeof CLI_ERROR_CODES[keyof typeof CLI_ERROR_CODES];

/**
 * Base CLI error class for domain packages.
 *
 * Extends {@link ClaudeClientError} with an optional user-facing suggestion,
 * providing a consistent error hierarchy across all n-dx packages. Domain
 * packages (rex, hench, sourcevision) extend this class for their CLI errors
 * instead of plain `Error`, enabling unified `instanceof` checks up the chain.
 */
export class CLIError extends ClaudeClientError {
  /** Actionable hint shown to the user (e.g. "Run 'n-dx init' ..."). */
  readonly suggestion?: string;
  /** Stable machine-readable code for cross-platform CLI failures. */
  readonly code: CLIErrorCode;

  constructor(
    message: string,
    suggestion?: string,
    code: CLIErrorCode = CLI_ERROR_CODES.GENERIC,
  ) {
    super(message, "cli", false);
    this.name = "CLIError";
    this.suggestion = suggestion;
    this.code = code;
  }
}

/**
 * The unified Claude client interface.
 *
 * Both CLI and API providers implement this interface. Consumers don't need
 * to know which provider is active — they call `complete()` and get back
 * a consistent result.
 */
export interface ClaudeClient {
  /** Which authentication mode this client is using. */
  readonly mode: AuthMode;

  /**
   * Send a prompt to Claude and get a text response.
   *
   * @throws {ClaudeClientError} on classified failures (auth, timeout, rate-limit, etc.)
   */
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
