/**
 * The single source of truth for which `.hench/config.json` fields the
 * dashboard may write, their types, and how a nested config value is read and
 * written.
 *
 * Three routes edit hench config — `routes-hench.ts` (the config editor PUT),
 * `routes-adaptive.ts` (adaptive apply / manual override), and the narrower
 * `routes-workflow.ts` apply. They must agree on what is writable: an
 * unguarded write path lets a same-origin caller set `guard.allowedCommands`
 * to an unexpected shape, invent a key like `permissionMode`, or poison the
 * prototype chain via a `__proto__` segment, all of which the next autonomous
 * hench run would inherit. Sharing `CONFIG_FIELD_META` here means the paths
 * cannot drift, and `validateConfigKeyValue` gives them one gate.
 */

/**
 * Config field metadata for the UI and for write validation.
 *
 * `integer` and `positive` mirror the `.int()` / `.positive()` refinements on
 * the matching field of hench's `HenchConfigSchema`. They exist because this
 * gate and that schema must agree: a value accepted here is written to
 * `.hench/config.json` verbatim, and hench refuses to start on a file its own
 * schema rejects. `tests/e2e/hench-config-gate-contract.test.js` pins the
 * agreement, so a new field with a refinement hench has and this metadata
 * lacks fails there rather than at the next `ndx work`.
 */
export interface ConfigFieldInfo {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  /** Mirrors `.int()` — a fractional value is refused. */
  integer?: true;
  /** Mirrors `.positive()` — zero is refused, not just negatives. */
  positive?: true;
  /** Mirrors `.min(n)` — inclusive lower bound. */
  min?: number;
  /** Mirrors `.max(n)` — inclusive upper bound. */
  max?: number;
  category: string;
  /**
   * The value hench applies when the key is absent, for the dashboard's
   * "differs from default" marker.
   *
   * Some `guard.*` defaults are chosen by project language. The ones recorded
   * here are hench's JS/TS values, so on a Go or Swift project the marker is
   * approximate for `guard.commandTimeout` and `guard.spawnTimeout` — the
   * dashboard has no language input to resolve it against, and the JS/TS answer
   * is right for the common case. `guard.blockedPaths` and
   * `guard.allowedCommands` differ wholesale rather than in one number, so they
   * record nothing rather than record something wrong.
   */
  defaultValue?: unknown;
}

/**
 * Floor on `prune.triggerPairs` and `prune.retainPairs`.
 *
 * Mirrors hench's `MIN_PRUNE_PAIRS` (web cannot import hench — hench is the
 * execution tier, above web's domain dependencies); the agreement is pinned by
 * `tests/e2e/hench-config-gate-contract.test.js`.
 */
export const MIN_PRUNE_PAIRS = 2;

/**
 * Known config field metadata — mirrors hench's `CONFIG_FIELDS`
 * (`packages/hench/src/cli/commands/config.ts`) path-for-path, so the dashboard
 * and `hench config` offer the same settings. `tests/e2e/hench-config-gate-
 * contract.test.js` compares the two lists and pins every `defaultValue` and
 * refinement against hench's own schema, because web cannot import hench.
 */
export const CONFIG_FIELD_META: ConfigFieldInfo[] = [
  // ── Execution strategy ──
  { path: "provider", label: "Provider", description: "Claude provider: 'cli' (Claude Code) or 'api' (direct API)", type: "enum", enumValues: ["cli", "api"], category: "execution", defaultValue: "cli" },
  { path: "model", label: "Model", description: "Claude model to use (e.g. sonnet, opus, haiku)", type: "string", category: "execution", defaultValue: "sonnet" },
  { path: "maxTurns", label: "Max Turns", description: "Maximum conversation turns per run", type: "number", positive: true, category: "execution", defaultValue: 50 },
  { path: "maxTokens", label: "Max Tokens per Request", description: "Maximum tokens per API request", type: "number", positive: true, category: "execution", defaultValue: 8192 },
  { path: "tokenBudget", label: "Token Budget", description: "Total token budget per run (input+cached+output). 0 = unlimited", type: "number", integer: true, category: "execution", defaultValue: 0 },
  { path: "loopPauseMs", label: "Loop Pause (ms)", description: "Pause between loop/iteration runs in milliseconds", type: "number", integer: true, category: "execution", defaultValue: 2000 },
  { path: "permissionMode", label: "Permission Mode", description: "Permission mode the vendor CLI session starts in", type: "enum", enumValues: ["default", "acceptEdits", "bypassPermissions", "plan"], category: "execution" },
  { path: "autonomous", label: "Autonomous", description: "Run without interactive prompts (implies acceptEdits when permissionMode is unset)", type: "boolean", category: "execution" },
  { path: "maxSpawnsPerTask", label: "Max Spawns per Task", description: "Ceiling on vendor spawns for one task, counting retries and fallbacks", type: "number", integer: true, positive: true, category: "execution", defaultValue: 8 },
  { path: "livelockThreshold", label: "Livelock Threshold", description: "Identical tool calls with no disk write in between before a run is stopped. 0 disables", type: "number", integer: true, category: "execution", defaultValue: 6 },
  { path: "promptCache", label: "Prompt Cache", description: "Mark cache_control breakpoints on provider=api Claude requests", type: "boolean", category: "execution" },
  { path: "promptCacheTtl", label: "Prompt Cache TTL", description: 'TTL for both cache_control breakpoints: "5m" or "1h"', type: "enum", enumValues: ["5m", "1h"], category: "execution" },
  { path: "useEventPipeline", label: "Event Pipeline", description: "Capture the RuntimeEvent stream (required by 'hench show --events')", type: "boolean", category: "execution" },
  { path: "useRegistryProvider", label: "Registry Provider", description: "Resolve the vendor through the provider registry rather than the built-in path", type: "boolean", category: "execution" },

  // ── Session reuse ──
  { path: "sessionStrategy", label: "Session Strategy", description: "How task spawns relate to vendor sessions: fork, batch or cold", type: "enum", enumValues: ["fork", "batch", "cold"], category: "session" },
  { path: "tasksPerSession", label: "Tasks per Session", description: 'Tasks per session under the "batch" strategy', type: "number", integer: true, positive: true, category: "session", defaultValue: 4 },
  { path: "parentMaxAgeHours", label: "Parent Session Max Age (h)", description: "How long a cached orientation session may be forked before it is rebuilt", type: "number", positive: true, category: "session", defaultValue: 24 },
  { path: "batchMaxAgeHours", label: "Batch Chain Max Age (h)", description: "How long a \"batch\" chain may keep serving tasks, measured from the task that opened it", type: "number", positive: true, category: "session" },
  { path: "batchMaxIdleHours", label: "Batch Chain Max Idle (h)", description: "How long a \"batch\" chain may sit unused before it is retired", type: "number", positive: true, category: "session" },

  // ── Task selection ──
  { path: "maxFailedAttempts", label: "Max Failed Attempts", description: "Consecutive failures before a task is considered stuck", type: "number", integer: true, positive: true, category: "task-selection", defaultValue: 3 },
  { path: "rexDir", label: "Rex Directory", description: "Path to the .rex directory for task data", type: "string", category: "task-selection", defaultValue: ".rex" },

  // ── Retry policy ──
  { path: "retry.maxRetries", label: "Max Retries", description: "Number of retry attempts for transient API errors", type: "number", integer: true, category: "retry", defaultValue: 3 },
  { path: "retry.baseDelayMs", label: "Base Retry Delay (ms)", description: "Initial delay before first retry (doubles each attempt)", type: "number", positive: true, category: "retry", defaultValue: 2000 },
  { path: "retry.maxDelayMs", label: "Max Retry Delay (ms)", description: "Maximum delay between retries (caps exponential backoff)", type: "number", positive: true, category: "retry", defaultValue: 30000 },

  // ── Context prune (provider=api runs only) ──
  { path: "prune.triggerPairs", label: "Prune Trigger (turn-pairs)", description: "Turn-pairs tolerated before a prune fires. Sets peak context", type: "number", integer: true, min: MIN_PRUNE_PAIRS, category: "prune", defaultValue: 20 },
  { path: "prune.retainPairs", label: "Prune Retain (turn-pairs)", description: "Turn-pairs kept verbatim after a prune. Must be at least 2 and below the trigger", type: "number", integer: true, min: MIN_PRUNE_PAIRS, category: "prune", defaultValue: 10 },
  { path: "prune.transcriptMessageChars", label: "Prune Summary Input (chars)", description: "Characters of each dropped message the summarizer is shown", type: "number", integer: true, positive: true, category: "prune", defaultValue: 2000 },

  // ── Test gate ──
  { path: "fullTestCommand", label: "Full Test Command", description: "Command that runs the whole suite before a commit. Auto-detected when unset", type: "string", category: "test-gate" },
  { path: "fullTestTimeoutMs", label: "Full Test Timeout (ms)", description: "How long the test gate may run before it is killed. 0 means no limit", type: "number", integer: true, category: "test-gate", defaultValue: 900000 },

  // ── Git safety ──
  { path: "rollbackOnFailure", label: "Rollback on Failure", description: "Revert uncommitted changes when a run fails", type: "boolean", category: "git" },
  { path: "autoCommit", label: "Auto Commit", description: "Let the agent commit itself at the end of a run", type: "boolean", category: "git", defaultValue: false },
  { path: "commitMsgTimeoutMs", label: "Mid-run Auto-commit Timer (ms)", description: "Commits whatever is staged this long after the agent writes its commit message, before the task is verified complete. 0 (default) disables it", type: "number", integer: true, category: "git", defaultValue: 0 },
  { path: "git.checkpointThreshold", label: "Checkpoint Threshold (lines)", description: "Lines changed at/above which the pre-run gate defaults to committing a checkpoint. 0 disables", type: "number", integer: true, category: "git" },
  { path: "git.requireCleanTree", label: "Require Clean Tree", description: "Refuse to start runs against a dirty working tree", type: "boolean", category: "git" },

  // ── Guard rails ──
  { path: "guard.blockedPaths", label: "Blocked Paths", description: "Glob patterns for paths the agent cannot modify", type: "array", category: "guard" },
  { path: "guard.allowedCommands", label: "Allowed Commands", description: "Shell commands the agent is permitted to execute", type: "array", category: "guard" },
  { path: "guard.commandTimeout", label: "Command Timeout (ms)", description: "Maximum time for a single command execution", type: "number", positive: true, category: "guard", defaultValue: 30000 },
  { path: "guard.maxFileSize", label: "Max File Size (bytes)", description: "Maximum file size the agent can write", type: "number", positive: true, category: "guard", defaultValue: 1048576 },
  { path: "guard.maxConcurrentProcesses", label: "Max Concurrent Processes", description: "Maximum simultaneous hench processes allowed (prevents memory exhaustion)", type: "number", integer: true, positive: true, category: "guard", defaultValue: 3 },
  { path: "guard.allowedGitSubcommands", label: "Git Subcommands", description: "Git subcommands the agent is permitted to execute", type: "array", category: "guard", defaultValue: ["status", "add", "commit", "diff", "log", "branch", "checkout", "stash", "show", "rev-parse"] },
  { path: "guard.memoryThrottle.enabled", label: "Memory Throttle Enabled", description: "Enable memory-based throttling that delays/rejects runs when system memory is low", type: "boolean", category: "guard" },
  { path: "guard.memoryThrottle.rejectThreshold", label: "Memory Reject Threshold (%)", description: "System memory usage % at which new runs are rejected outright (0–100, default: 95)", type: "number", min: 0, max: 100, category: "guard" },
  { path: "guard.memoryThrottle.delayThreshold", label: "Memory Delay Threshold (%)", description: "System memory usage % at which new runs are delayed with backoff (0–100, default: 80)", type: "number", min: 0, max: 100, category: "guard" },
  { path: "guard.memoryThrottle.baseDelayMs", label: "Memory Throttle Base Delay (ms)", description: "Initial backoff before a throttled run is retried (doubles each attempt)", type: "number", positive: true, category: "guard" },
  { path: "guard.memoryThrottle.maxDelayMs", label: "Memory Throttle Max Delay (ms)", description: "Maximum backoff between throttled retries", type: "number", positive: true, category: "guard" },
  { path: "guard.memoryThrottle.maxRetries", label: "Memory Throttle Max Retries", description: "How many times a throttled run waits before it is rejected", type: "number", integer: true, category: "guard" },
  { path: "guard.memoryMonitor.enabled", label: "Memory Monitor Enabled", description: "Check system memory before the agent spawns a process", type: "boolean", category: "guard" },
  { path: "guard.memoryMonitor.spawnThreshold", label: "Memory Spawn Threshold (%)", description: "System memory usage % above which a process spawn is refused (0–100)", type: "number", min: 0, max: 100, category: "guard" },
  { path: "guard.spawnTimeout", label: "Spawn Timeout (ms)", description: "Maximum time a spawned vendor process may run", type: "number", category: "guard", defaultValue: 300000 },
  { path: "guard.policy.maxCommandsPerMinute", label: "Max Commands per Minute", description: "Rate limit on shell commands the agent may execute", type: "number", integer: true, category: "guard" },
  { path: "guard.policy.maxWritesPerMinute", label: "Max Writes per Minute", description: "Rate limit on file writes the agent may perform", type: "number", integer: true, category: "guard" },
  { path: "guard.policy.maxTotalBytesWritten", label: "Max Total Bytes Written", description: "Ceiling on bytes the agent may write across one run", type: "number", integer: true, category: "guard" },
  { path: "guard.policy.maxTotalCommands", label: "Max Total Commands", description: "Ceiling on shell commands the agent may run across one run", type: "number", integer: true, category: "guard" },

  // ── General ──
  { path: "apiKeyEnv", label: "API Key Env Var", description: "Environment variable name for Anthropic API key", type: "string", category: "general", defaultValue: "ANTHROPIC_API_KEY" },
  { path: "claudePath", label: "Claude CLI Path", description: "Path to the Claude Code binary. Falls back to 'claude' on PATH", type: "string", category: "general" },
  { path: "language", label: "Project Language", description: "Project toolchain, which selects the guard defaults", type: "enum", enumValues: ["typescript", "javascript", "go", "swift"], category: "general" },
];

/** Path segments that would poison the prototype chain if used as an object key. */
export const FORBIDDEN_CONFIG_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Which providers each vendor accepts. Hench's real source of truth is
 * `VENDOR_PROVIDERS` in `packages/hench/src/cli/commands/provider-support.ts`
 * (also re-exported from hench's public API); web cannot import hench at
 * runtime — hench is the execution tier, above the domain packages web
 * depends on — so this is a separately maintained literal.
 * `tests/integration/cross-package-contracts.test.js` pins the two together
 * against the compiled dist artifacts, the same one-directional pattern
 * `tests/e2e/hench-config-gate-contract.test.js` already uses for
 * `HenchConfigSchema`.
 */
export const VENDOR_PROVIDERS: Readonly<Record<"claude" | "codex" | "google" | "local", readonly ("cli" | "api")[]>> = {
  claude: ["cli", "api"],
  codex: ["cli"],
  google: ["api"],
  local: ["api"],
};

/**
 * Validate a `provider` value about to be written to `.hench/config.json`
 * against the vendor active in `.n-dx.json`'s `llm.vendor`. Returns an error
 * naming the vendor and its allowed providers, or null when acceptable.
 *
 * `vendor` may be null (unset) or an unrecognized string — in both cases
 * every declared provider is accepted, since there is no known vendor to be
 * wrong about; `hench`'s own default-vendor fallback resolves the rest.
 */
export function validateProviderForVendor(provider: string, vendor: string | null): string | null {
  if (!vendor) return null;
  const allowed = VENDOR_PROVIDERS[vendor as keyof typeof VENDOR_PROVIDERS];
  if (!allowed) return null;
  if (!allowed.includes(provider as "cli" | "api")) {
    return `Provider "${provider}" is not supported for vendor "${vendor}". Allowed: ${allowed.join(", ")}.`;
  }
  return null;
}

/**
 * Nested config groups the dashboard writes member-by-member but hench reads
 * whole. Writing `retry.maxRetries` into a config with no `retry` used to
 * leave a one-member group on disk, which hench's schema then refused — a 200
 * response that bricked the next `ndx work`. Every write path completes a
 * partially-present group from these defaults before serializing.
 *
 * The values mirror hench's `DEFAULT_HENCH_CONFIG()` (web cannot import hench
 * at runtime — hench sits above web's domain dependencies); the agreement is
 * pinned by `tests/e2e/hench-config-gate-contract.test.js`.
 */
export const CONFIG_GROUP_DEFAULTS: Record<string, Record<string, unknown>> = {
  retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
  prune: { triggerPairs: 20, retainPairs: 10, transcriptMessageChars: 2000 },
};

/**
 * Cross-field constraints hench's schema enforces that {@link validateFieldValue}
 * cannot see, because it is handed one field at a time.
 *
 * Today there is one: hench refuses a config whose `prune.retainPairs` is at or
 * above its `prune.triggerPairs` — equal values would prune every turn and drop
 * nothing, and a retention above the trigger never reaches a droppable span.
 * Without this check a single-key write (`prune.triggerPairs` on a config with
 * no `prune` block, which {@link completeConfigGroups} then fills in from the
 * defaults) could answer 200 and leave a file the next `ndx work` refuses.
 *
 * Call it on the finished config, after group completion and before writing.
 * Returns an error message, or null when the config is acceptable.
 */
export function validateConfigConstraints(config: Record<string, unknown>): string | null {
  const prune = config["prune"];
  if (prune && typeof prune === "object" && !Array.isArray(prune)) {
    const { triggerPairs, retainPairs } = prune as Record<string, unknown>;
    if (
      typeof triggerPairs === "number" &&
      typeof retainPairs === "number" &&
      retainPairs >= triggerPairs
    ) {
      return (
        "Prune Retain (turn-pairs) must be below Prune Trigger (turn-pairs) — the gap " +
        "between them is how many turns of cache-friendly growth follow each prune"
      );
    }
  }
  return null;
}

/**
 * Fill in missing members of any partially-present group in-place. A group
 * that is absent entirely stays absent (hench applies its own defaults);
 * a group that is present but not a plain object is left for the schema to
 * refuse. Returns the dotted paths that were filled.
 */
export function completeConfigGroups(config: Record<string, unknown>): string[] {
  const filled: string[] = [];
  for (const [group, defaults] of Object.entries(CONFIG_GROUP_DEFAULTS)) {
    const value = config[group];
    if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const members = value as Record<string, unknown>;
    for (const [member, fallback] of Object.entries(defaults)) {
      if (members[member] === undefined) {
        members[member] = fallback;
        filled.push(`${group}.${member}`);
      }
    }
  }
  return filled;
}

/**
 * Validate a single field value against its declared type.
 * Returns an error message, or null when the value is acceptable.
 *
 * Every check here is at least as strict as hench's `HenchConfigSchema` for the
 * same field, because whatever this accepts is written to `.hench/config.json`
 * and hench refuses to load a file its schema rejects — a 200 response that
 * bricks the next `ndx work` until the file is hand-edited. The three checks
 * that look redundant are the ones that used to let that happen:
 * `typeof value === "string"` before the enum lookup (`String(["cli"])` is
 * `"cli"`, so an array passed a `z.enum` check), the element test on arrays
 * (`z.array(z.string())` rejects `[1, null]`), and `Number.isFinite` (JSON
 * `1e999` parses to `Infinity`, which `JSON.stringify` then writes as `null`).
 */
export function validateFieldValue(field: ConfigFieldInfo, value: unknown): string | null {
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${field.label} must be a finite number`;
      if (field.positive) {
        if (value <= 0) return `${field.label} must be greater than zero`;
      } else if (value < 0) {
        return `${field.label} must be non-negative`;
      }
      if (field.integer && !Number.isInteger(value))
        return `${field.label} must be a whole number`;
      if (field.min !== undefined && value < field.min)
        return `${field.label} must be at least ${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `${field.label} must be at most ${field.max}`;
      return null;
    case "boolean":
      if (typeof value !== "boolean") return `${field.label} must be a boolean`;
      return null;
    case "enum":
      if (typeof value !== "string" || (field.enumValues && !field.enumValues.includes(value)))
        return `${field.label} must be one of: ${field.enumValues?.join(", ") ?? "the allowed values"}`;
      return null;
    case "array":
      if (!Array.isArray(value)) return `${field.label} must be an array`;
      if (!value.every((entry) => typeof entry === "string"))
        return `${field.label} must be an array of strings`;
      return null;
    case "string":
      if (typeof value !== "string" || value.length === 0) return `${field.label} must be a non-empty string`;
      return null;
    default:
      return null;
  }
}

/**
 * Validate a `key`/`value` pair for a config write: the key must be an
 * allowlisted field with no prototype-poisoning segment, and the value must
 * match that field's type. Returns an error message, or null when acceptable.
 *
 * @param vendor  The active `llm.vendor`, when the caller knows it. Only
 *   consulted for `key === "provider"` — see {@link validateProviderForVendor}.
 */
export function validateConfigKeyValue(key: string, value: unknown, vendor?: string | null): string | null {
  if (key.split(".").some((seg) => FORBIDDEN_CONFIG_SEGMENTS.has(seg))) {
    return `Key "${key}" contains a forbidden path segment.`;
  }
  const field = CONFIG_FIELD_META.find((f) => f.path === key);
  if (!field) {
    return `Unknown config field: ${key}`;
  }
  const typeError = validateFieldValue(field, value);
  if (typeError) return typeError;
  if (key === "provider" && typeof value === "string") {
    return validateProviderForVendor(value, vendor ?? null);
  }
  return null;
}

/**
 * Read a value from a nested object by dotted path. Returns undefined when any
 * segment is missing or not traversable.
 */
export function getConfigValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Write a value into a nested object by dotted path, creating intermediate
 * objects as needed. A path containing `__proto__`/`constructor`/`prototype`
 * is a no-op — defense in depth even though {@link validateConfigKeyValue}
 * rejects such keys upstream.
 */
export function setConfigValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.some((part) => FORBIDDEN_CONFIG_SEGMENTS.has(part))) return;
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object" || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
