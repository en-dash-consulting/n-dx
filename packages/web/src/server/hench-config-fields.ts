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
  category: string;
}

/** Known config field metadata — mirrors the CLI config module. */
export const CONFIG_FIELD_META: ConfigFieldInfo[] = [
  { path: "provider", label: "Provider", description: "Claude provider: 'cli' (Claude Code) or 'api' (direct API)", type: "enum", enumValues: ["cli", "api"], category: "execution" },
  { path: "model", label: "Model", description: "Claude model to use (e.g. sonnet, opus, haiku)", type: "string", category: "execution" },
  { path: "maxTurns", label: "Max Turns", description: "Maximum conversation turns per run", type: "number", positive: true, category: "execution" },
  { path: "maxTokens", label: "Max Tokens per Request", description: "Maximum tokens per API request", type: "number", positive: true, category: "execution" },
  { path: "tokenBudget", label: "Token Budget", description: "Total token budget per run (input+output). 0 = unlimited", type: "number", integer: true, category: "execution" },
  { path: "loopPauseMs", label: "Loop Pause (ms)", description: "Pause between loop/iteration runs in milliseconds", type: "number", integer: true, category: "execution" },
  { path: "maxFailedAttempts", label: "Max Failed Attempts", description: "Consecutive failures before a task is considered stuck", type: "number", integer: true, positive: true, category: "task-selection" },
  { path: "rexDir", label: "Rex Directory", description: "Path to the .rex directory for task data", type: "string", category: "task-selection" },
  { path: "retry.maxRetries", label: "Max Retries", description: "Number of retry attempts for transient API errors", type: "number", integer: true, category: "retry" },
  { path: "retry.baseDelayMs", label: "Base Retry Delay (ms)", description: "Initial delay before first retry (doubles each attempt)", type: "number", positive: true, category: "retry" },
  { path: "retry.maxDelayMs", label: "Max Retry Delay (ms)", description: "Maximum delay between retries (caps exponential backoff)", type: "number", positive: true, category: "retry" },
  { path: "guard.blockedPaths", label: "Blocked Paths", description: "Glob patterns for paths the agent cannot modify", type: "array", category: "guard" },
  { path: "guard.allowedCommands", label: "Allowed Commands", description: "Shell commands the agent is permitted to execute", type: "array", category: "guard" },
  { path: "guard.commandTimeout", label: "Command Timeout (ms)", description: "Maximum time for a single command execution", type: "number", positive: true, category: "guard" },
  { path: "guard.maxFileSize", label: "Max File Size (bytes)", description: "Maximum file size the agent can write", type: "number", positive: true, category: "guard" },
  { path: "apiKeyEnv", label: "API Key Env Var", description: "Environment variable name for Anthropic API key", type: "string", category: "general" },
];

/** Path segments that would poison the prototype chain if used as an object key. */
export const FORBIDDEN_CONFIG_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

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
};

/**
 * Why hench's `prune` group is deliberately NOT in the table above.
 *
 * A group belongs here when the dashboard can leave a partial one on disk, and
 * that only happens for members it can write. `prune.*` is absent from
 * {@link CONFIG_FIELD_META}, so no route can produce a partial `prune` group
 * and completing one would mean the dashboard rewriting config a human hand-
 * edited, in keys it cannot show. That is what the "every group member is a
 * writable field" assertion in `tests/unit/server/hench-config-fields.test.ts`
 * exists to stop.
 *
 * Nothing is at risk from the omission: every member of hench's
 * `PruneConfigSchema` carries its own default, so a partial group already
 * loads.
 *
 * Making `prune` editable here needs more than three `CONFIG_FIELD_META` rows.
 * hench refuses a config whose `prune.retainPairs` is at or above its
 * `prune.triggerPairs`, and {@link validateFieldValue} sees one field at a time
 * — it cannot check a sibling. Adding the rows without a config-aware gate
 * would let a 200 response write a file the next `ndx work` refuses, which is
 * exactly the drift `tests/e2e/hench-config-gate-contract.test.js` catches. Do
 * that work first, or leave the group to the CLI (`ndx config hench.prune.*`).
 */

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
