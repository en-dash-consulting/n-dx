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

/** Config field metadata for the UI and for write validation. */
export interface ConfigFieldInfo {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  category: string;
}

/** Known config field metadata — mirrors the CLI config module. */
export const CONFIG_FIELD_META: ConfigFieldInfo[] = [
  { path: "provider", label: "Provider", description: "Claude provider: 'cli' (Claude Code) or 'api' (direct API)", type: "enum", enumValues: ["cli", "api"], category: "execution" },
  { path: "model", label: "Model", description: "Claude model to use (e.g. sonnet, opus, haiku)", type: "string", category: "execution" },
  { path: "maxTurns", label: "Max Turns", description: "Maximum conversation turns per run", type: "number", category: "execution" },
  { path: "maxTokens", label: "Max Tokens per Request", description: "Maximum tokens per API request", type: "number", category: "execution" },
  { path: "tokenBudget", label: "Token Budget", description: "Total token budget per run (input+output). 0 = unlimited", type: "number", category: "execution" },
  { path: "loopPauseMs", label: "Loop Pause (ms)", description: "Pause between loop/iteration runs in milliseconds", type: "number", category: "execution" },
  { path: "maxFailedAttempts", label: "Max Failed Attempts", description: "Consecutive failures before a task is considered stuck", type: "number", category: "task-selection" },
  { path: "rexDir", label: "Rex Directory", description: "Path to the .rex directory for task data", type: "string", category: "task-selection" },
  { path: "retry.maxRetries", label: "Max Retries", description: "Number of retry attempts for transient API errors", type: "number", category: "retry" },
  { path: "retry.baseDelayMs", label: "Base Retry Delay (ms)", description: "Initial delay before first retry (doubles each attempt)", type: "number", category: "retry" },
  { path: "retry.maxDelayMs", label: "Max Retry Delay (ms)", description: "Maximum delay between retries (caps exponential backoff)", type: "number", category: "retry" },
  { path: "guard.blockedPaths", label: "Blocked Paths", description: "Glob patterns for paths the agent cannot modify", type: "array", category: "guard" },
  { path: "guard.allowedCommands", label: "Allowed Commands", description: "Shell commands the agent is permitted to execute", type: "array", category: "guard" },
  { path: "guard.commandTimeout", label: "Command Timeout (ms)", description: "Maximum time for a single command execution", type: "number", category: "guard" },
  { path: "guard.maxFileSize", label: "Max File Size (bytes)", description: "Maximum file size the agent can write", type: "number", category: "guard" },
  { path: "apiKeyEnv", label: "API Key Env Var", description: "Environment variable name for Anthropic API key", type: "string", category: "general" },
];

/** Path segments that would poison the prototype chain if used as an object key. */
export const FORBIDDEN_CONFIG_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validate a single field value against its declared type.
 * Returns an error message, or null when the value is acceptable.
 */
export function validateFieldValue(field: ConfigFieldInfo, value: unknown): string | null {
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || isNaN(value)) return `${field.label} must be a number`;
      if (value < 0) return `${field.label} must be non-negative`;
      return null;
    case "boolean":
      if (typeof value !== "boolean") return `${field.label} must be a boolean`;
      return null;
    case "enum":
      if (field.enumValues && !field.enumValues.includes(String(value)))
        return `${field.label} must be one of: ${field.enumValues.join(", ")}`;
      return null;
    case "array":
      if (!Array.isArray(value)) return `${field.label} must be an array`;
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
 */
export function validateConfigKeyValue(key: string, value: unknown): string | null {
  if (key.split(".").some((seg) => FORBIDDEN_CONFIG_SEGMENTS.has(seg))) {
    return `Key "${key}" contains a forbidden path segment.`;
  }
  const field = CONFIG_FIELD_META.find((f) => f.path === key);
  if (!field) {
    return `Unknown config field: ${key}`;
  }
  return validateFieldValue(field, value);
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
