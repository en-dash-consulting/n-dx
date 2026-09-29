/**
 * hench config — interactive workflow configuration command.
 *
 * Supports three modes:
 *   hench config [dir]              — display current config
 *   hench config <key> [dir]        — get a single value
 *   hench config <key> <value> [dir] — set a single value
 *   hench config --interactive [dir] — interactive menu
 *
 * All changes are validated before writing and persist to .hench/config.json.
 */

import { join } from "node:path";
import { loadConfig, saveConfig } from "../../store/config.js";
import { validateConfig, formatValidationErrors } from "../../schema/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../schema/v1.js";
import type {HenchConfig, Provider} from "../../schema/v1.js";import { CLIError } from "../errors.js";import { info, result } from "../output.js";

// ── Config field metadata ─────────────────────────────────────────────

export interface ConfigFieldMeta {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  category: ConfigFieldCategory;
  /** Human-readable impact description shown when value changes. */
  impact: (value: unknown) => string;
}

/** Groupings the display and the interactive menu present fields under. */
export type ConfigFieldCategory =
  | "execution"
  | "session"
  | "task-selection"
  | "retry"
  | "prune"
  | "test-gate"
  | "git"
  | "guard"
  | "general";

export const CONFIG_FIELDS: ConfigFieldMeta[] = [
  // ── Execution strategy ──
  {
    path: "provider",
    label: "Provider",
    description: "Claude provider: 'cli' (Claude Code) or 'api' (direct API)",
    type: "enum",
    enumValues: ["cli", "api"],
    category: "execution",
    impact: (v) =>
      v === "cli"
        ? "Agent will use Claude Code CLI (tool-use mode, filesystem access)"
        : "Agent will call Anthropic API directly (requires API key)",
  },
  {
    path: "model",
    label: "Model",
    description: "Claude model to use (e.g. sonnet, opus, haiku)",
    type: "string",
    category: "execution",
    impact: (v) => `Agent will use model "${v}" for task execution`,
  },
  {
    path: "maxTurns",
    label: "Max Turns",
    description: "Maximum conversation turns per run",
    type: "number",
    category: "execution",
    impact: (v) =>
      `Agent will stop after ${v} turns (${Number(v) <= 10 ? "short" : Number(v) <= 30 ? "medium" : "long"} runs)`,
  },
  {
    path: "maxTokens",
    label: "Max Tokens per Request",
    description: "Maximum tokens per API request",
    type: "number",
    category: "execution",
    impact: (v) => `Each API response limited to ${Number(v).toLocaleString()} tokens`,
  },
  {
    path: "tokenBudget",
    label: "Token Budget",
    description: "Total token budget per run (input+cached+output). 0 = unlimited",
    type: "number",
    category: "execution",
    impact: (v) =>
      Number(v) === 0
        ? "No token limit per run (unlimited)"
        : `Run will stop after ${Number(v).toLocaleString()} total tokens`,
  },
  {
    path: "loopPauseMs",
    label: "Loop Pause (ms)",
    description: "Pause between loop/iteration runs in milliseconds",
    type: "number",
    category: "execution",
    impact: (v) => `${Number(v) / 1000}s pause between consecutive task runs`,
  },
  {
    path: "permissionMode",
    label: "Permission Mode",
    description: "Permission mode the vendor CLI session starts in",
    type: "enum",
    enumValues: ["default", "acceptEdits", "bypassPermissions", "plan"],
    category: "execution",
    impact: (v) =>
      v === "plan"
        ? "Sessions start in plan mode — autonomous runs will stall waiting for approval"
        : `Vendor CLI sessions start with permission mode "${v}"`,
  },
  {
    path: "autonomous",
    label: "Autonomous",
    description: "Run without interactive prompts (implies acceptEdits when permissionMode is unset)",
    type: "boolean",
    category: "execution",
    impact: (v) =>
      v ? "Runs proceed without prompting" : "Runs may stop to ask for confirmation",
  },
  {
    path: "maxSpawnsPerTask",
    label: "Max Spawns per Task",
    description: "Ceiling on vendor spawns for one task, counting retries and fallbacks",
    type: "number",
    category: "execution",
    impact: (v) => `Task fails with a breakdown after ${v} vendor spawns`,
  },
  {
    path: "livelockThreshold",
    label: "Livelock Threshold",
    description: "Identical tool calls with no disk write in between before a run is stopped. 0 disables",
    type: "number",
    category: "execution",
    impact: (v) =>
      Number(v) === 0
        ? "Livelock detection disabled"
        : `Run stops after ${v} identical tool calls with nothing written`,
  },
  {
    path: "promptCache",
    label: "Prompt Cache",
    description: "Mark cache_control breakpoints on provider=api Claude requests",
    type: "boolean",
    category: "execution",
    impact: (v) =>
      v
        ? "API requests carry cache_control breakpoints"
        : "API requests sent without cache_control — set this when a gateway rejects the field",
  },
  {
    path: "promptCacheTtl",
    label: "Prompt Cache TTL",
    description: 'TTL for both cache_control breakpoints: "5m" or "1h"',
    type: "enum",
    enumValues: ["5m", "1h"],
    category: "execution",
    impact: (v) =>
      v === "1h"
        ? "Cache writes cost 2x input and survive an hour — only pays off past a 5-minute turn gap"
        : "Cache writes cost 1.25x input and survive five minutes",
  },
  {
    path: "useEventPipeline",
    label: "Event Pipeline",
    description: "Capture the RuntimeEvent stream (required by 'hench show --events')",
    type: "boolean",
    category: "execution",
    impact: (v) => (v ? "Runs record their event stream" : "No event stream is recorded"),
  },
  {
    path: "useRegistryProvider",
    label: "Registry Provider",
    description: "Resolve the vendor through the provider registry rather than the built-in path",
    type: "boolean",
    category: "execution",
    impact: (v) =>
      v ? "Vendor resolved through the provider registry" : "Vendor resolved through the built-in path",
  },

  // ── Session reuse ──
  {
    path: "sessionStrategy",
    label: "Session Strategy",
    description: "How task spawns relate to vendor sessions: fork, batch or cold",
    type: "enum",
    enumValues: ["fork", "batch", "cold"],
    category: "session",
    impact: (v) =>
      v === "fork"
        ? "Orient once, then fork that session per task — no task re-pays cold-start context"
        : v === "batch"
          ? "Several tasks share one session"
          : "A fresh spawn per task",
  },
  {
    path: "tasksPerSession",
    label: "Tasks per Session",
    description: 'Tasks per session under the "batch" strategy',
    type: "number",
    category: "session",
    impact: (v) => `Up to ${v} tasks share one batched session`,
  },
  {
    path: "parentMaxAgeHours",
    label: "Parent Session Max Age (h)",
    description: "How long a cached orientation session may be forked before it is rebuilt",
    type: "number",
    category: "session",
    impact: (v) => `Orientation session rebuilt after ${v}h`,
  },

  // ── Task selection ──
  {
    path: "maxFailedAttempts",
    label: "Max Failed Attempts",
    description: "Consecutive failures before a task is considered stuck",
    type: "number",
    category: "task-selection",
    impact: (v) =>
      `Tasks will be skipped as stuck after ${v} consecutive failures`,
  },
  {
    path: "rexDir",
    label: "Rex Directory",
    description: "Path to the .rex directory for task data",
    type: "string",
    category: "task-selection",
    impact: (v) => `Task data will be read from "${v}"`,
  },

  // ── Retry policy ──
  {
    path: "retry.maxRetries",
    label: "Max Retries",
    description: "Number of retry attempts for transient API errors",
    type: "number",
    category: "retry",
    impact: (v) => `Transient errors will be retried up to ${v} times`,
  },
  {
    path: "retry.baseDelayMs",
    label: "Base Retry Delay (ms)",
    description: "Initial delay before first retry (doubles each attempt)",
    type: "number",
    category: "retry",
    impact: (v) =>
      `First retry after ${Number(v) / 1000}s, then ${(Number(v) * 2) / 1000}s, ${(Number(v) * 4) / 1000}s...`,
  },
  {
    path: "retry.maxDelayMs",
    label: "Max Retry Delay (ms)",
    description: "Maximum delay between retries (caps exponential backoff)",
    type: "number",
    category: "retry",
    impact: (v) => `Retry delay capped at ${Number(v) / 1000}s`,
  },

  // ── Context prune (provider=api runs only) ──
  {
    path: "prune.triggerPairs",
    label: "Prune Trigger (turn-pairs)",
    description: "Turn-pairs tolerated before a prune fires. Sets peak context",
    type: "number",
    category: "prune",
    impact: (v) => `Prompt grows by append until ${v} turn-pairs, then a prune fires`,
  },
  {
    path: "prune.retainPairs",
    label: "Prune Retain (turn-pairs)",
    description: "Turn-pairs kept verbatim after a prune. Must be at least 2 and below the trigger",
    type: "number",
    category: "prune",
    impact: (v) => `${v} turn-pairs stay verbatim; everything older becomes a summary`,
  },
  {
    path: "prune.transcriptMessageChars",
    label: "Prune Summary Input (chars)",
    description: "Characters of each dropped message the summarizer is shown",
    type: "number",
    category: "prune",
    impact: (v) => `Summarizer sees the first ${Number(v).toLocaleString()} characters of each dropped message`,
  },

  // ── Test gate ──
  {
    path: "fullTestCommand",
    label: "Full Test Command",
    description: "Command that runs the whole suite before a commit. Auto-detected when unset",
    type: "string",
    category: "test-gate",
    impact: (v) => `Test gate will run "${v}"`,
  },
  {
    path: "fullTestTimeoutMs",
    label: "Full Test Timeout (ms)",
    description: "How long the test gate may run before it is killed. 0 means no limit",
    type: "number",
    category: "test-gate",
    impact: (v) =>
      Number(v) === 0
        ? "Test gate runs without a time limit"
        : `Test gate killed after ${Number(v) / 60000} minutes`,
  },

  // ── Git safety ──
  {
    path: "rollbackOnFailure",
    label: "Rollback on Failure",
    description: "Revert uncommitted changes when a run fails",
    type: "boolean",
    category: "git",
    impact: (v) =>
      v ? "Failed runs revert their uncommitted changes" : "Failed runs leave their changes in place",
  },
  {
    path: "autoCommit",
    label: "Auto Commit",
    description: "Let the agent commit itself at the end of a run",
    type: "boolean",
    category: "git",
    impact: (v) =>
      v
        ? "Agent runs 'git commit' directly — no approval prompt interrupts a loop"
        : "Agent stages changes and waits for approval before committing",
  },
  {
    path: "commitMsgTimeoutMs",
    label: "Commit Message Timeout (ms)",
    description: "How long the commit-message generation call may run. 0 means no limit",
    type: "number",
    category: "git",
    impact: (v) =>
      Number(v) === 0
        ? "Commit-message generation runs without a time limit"
        : `Commit-message generation killed after ${Number(v) / 60000} minutes`,
  },
  {
    path: "git.checkpointThreshold",
    label: "Checkpoint Threshold (lines)",
    description: "Lines changed at/above which the pre-run gate defaults to committing a checkpoint. 0 disables",
    type: "number",
    category: "git",
    impact: (v) =>
      Number(v) === 0
        ? "Pre-run gate never escalates on change size"
        : `Pre-run gate escalates at ${v} changed lines`,
  },
  {
    path: "git.requireCleanTree",
    label: "Require Clean Tree",
    description: "Refuse to start runs against a dirty working tree",
    type: "boolean",
    category: "git",
    impact: (v) =>
      v ? "Runs abort on a dirty working tree" : "Runs may start against a dirty working tree",
  },

  // ── Guard settings ──
  {
    path: "guard.blockedPaths",
    label: "Blocked Paths",
    description: "Glob patterns for paths the agent cannot modify",
    type: "array",
    category: "guard",
    impact: (v) =>
      `Agent blocked from ${(v as string[]).length} path patterns`,
  },
  {
    path: "guard.allowedCommands",
    label: "Allowed Commands",
    description: "Shell commands the agent is permitted to execute",
    type: "array",
    category: "guard",
    impact: (v) =>
      `Agent can execute: ${(v as string[]).join(", ")}`,
  },
  {
    path: "guard.commandTimeout",
    label: "Command Timeout (ms)",
    description: "Maximum time for a single command execution",
    type: "number",
    category: "guard",
    impact: (v) => `Commands will be killed after ${Number(v) / 1000}s`,
  },
  {
    path: "guard.maxFileSize",
    label: "Max File Size (bytes)",
    description: "Maximum file size the agent can write",
    type: "number",
    category: "guard",
    impact: (v) =>
      `Agent limited to writing files under ${(Number(v) / 1024 / 1024).toFixed(1)}MB`,
  },
  {
    path: "guard.maxConcurrentProcesses",
    label: "Max Concurrent Processes",
    description: "Maximum simultaneous hench processes allowed (prevents memory exhaustion)",
    type: "number",
    category: "guard",
    impact: (v) =>
      `Up to ${v} hench processes can run simultaneously`,
  },
  {
    path: "guard.allowedGitSubcommands",
    label: "Git Subcommands",
    description: "Git subcommands the agent is permitted to execute",
    type: "array",
    category: "guard",
    impact: (v) =>
      `Agent can run git: ${(v as string[]).join(", ")}`,
  },
  {
    path: "guard.memoryThrottle.enabled",
    label: "Memory Throttle Enabled",
    description: "Enable memory-based throttling that delays/rejects runs when system memory is low",
    type: "boolean",
    category: "guard",
    impact: (v) =>
      v
        ? "Runs will be delayed or rejected when system memory is critically low"
        : "Memory throttling disabled — runs proceed regardless of system memory",
  },
  {
    path: "guard.memoryThrottle.rejectThreshold",
    label: "Memory Reject Threshold (%)",
    description: "System memory usage % at which new runs are rejected outright (0–100, default: 95)",
    type: "number",
    category: "guard",
    impact: (v) => `Runs rejected when system memory usage exceeds ${v}%`,
  },
  {
    path: "guard.memoryThrottle.delayThreshold",
    label: "Memory Delay Threshold (%)",
    description: "System memory usage % at which new runs are delayed with backoff (0–100, default: 80)",
    type: "number",
    category: "guard",
    impact: (v) => `Runs delayed with backoff when system memory usage exceeds ${v}%`,
  },
  {
    path: "guard.memoryThrottle.baseDelayMs",
    label: "Memory Throttle Base Delay (ms)",
    description: "Initial backoff before a throttled run is retried (doubles each attempt)",
    type: "number",
    category: "guard",
    impact: (v) => `First throttle backoff is ${Number(v) / 1000}s`,
  },
  {
    path: "guard.memoryThrottle.maxDelayMs",
    label: "Memory Throttle Max Delay (ms)",
    description: "Maximum backoff between throttled retries",
    type: "number",
    category: "guard",
    impact: (v) => `Throttle backoff capped at ${Number(v) / 1000}s`,
  },
  {
    path: "guard.memoryThrottle.maxRetries",
    label: "Memory Throttle Max Retries",
    description: "How many times a throttled run waits before it is rejected",
    type: "number",
    category: "guard",
    impact: (v) => `Throttled runs wait up to ${v} times before being rejected`,
  },
  {
    path: "guard.memoryMonitor.enabled",
    label: "Memory Monitor Enabled",
    description: "Check system memory before the agent spawns a process",
    type: "boolean",
    category: "guard",
    impact: (v) =>
      v ? "Process spawns are checked against system memory first" : "Process spawns are not memory-checked",
  },
  {
    path: "guard.memoryMonitor.spawnThreshold",
    label: "Memory Spawn Threshold (%)",
    description: "System memory usage % above which a process spawn is refused (0–100)",
    type: "number",
    category: "guard",
    impact: (v) => `Process spawns refused when system memory usage exceeds ${v}%`,
  },
  {
    path: "guard.spawnTimeout",
    label: "Spawn Timeout (ms)",
    description: "Maximum time a spawned vendor process may run",
    type: "number",
    category: "guard",
    impact: (v) => `Spawned processes killed after ${Number(v) / 1000}s`,
  },
  {
    path: "guard.policy.maxCommandsPerMinute",
    label: "Max Commands per Minute",
    description: "Rate limit on shell commands the agent may execute",
    type: "number",
    category: "guard",
    impact: (v) => `Agent limited to ${v} commands per minute`,
  },
  {
    path: "guard.policy.maxWritesPerMinute",
    label: "Max Writes per Minute",
    description: "Rate limit on file writes the agent may perform",
    type: "number",
    category: "guard",
    impact: (v) => `Agent limited to ${v} file writes per minute`,
  },
  {
    path: "guard.policy.maxTotalBytesWritten",
    label: "Max Total Bytes Written",
    description: "Ceiling on bytes the agent may write across one run",
    type: "number",
    category: "guard",
    impact: (v) => `Agent may write ${(Number(v) / 1024 / 1024).toFixed(1)}MB in total per run`,
  },
  {
    path: "guard.policy.maxTotalCommands",
    label: "Max Total Commands",
    description: "Ceiling on shell commands the agent may run across one run",
    type: "number",
    category: "guard",
    impact: (v) => `Agent may run ${v} commands in total per run`,
  },

  // ── General ──
  {
    path: "apiKeyEnv",
    label: "API Key Env Var",
    description: "Environment variable name for Anthropic API key",
    type: "string",
    category: "general",
    impact: (v) => `API key will be read from $${v}`,
  },
  {
    path: "claudePath",
    label: "Claude CLI Path",
    description: "Path to the Claude Code binary. Falls back to 'claude' on PATH",
    type: "string",
    category: "general",
    impact: (v) => `Claude Code will be invoked as "${v}"`,
  },
  {
    path: "language",
    label: "Project Language",
    description: "Project toolchain, which selects the guard defaults",
    type: "enum",
    enumValues: ["typescript", "javascript", "go", "swift"],
    category: "general",
    impact: (v) => `Guard defaults tuned for a ${v} toolchain`,
  },
];

// ── Value access helpers ─────────────────────────────────────────────

/** Get a nested value from config using dot-path notation. */
export function getConfigValue(config: HenchConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value in config using dot-path notation. Returns a new config object. */
export function setConfigValue(
  config: HenchConfig,
  path: string,
  value: unknown,
): HenchConfig {
  const clone = JSON.parse(JSON.stringify(config)) as HenchConfig;
  const parts = path.split(".");
  let current: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return clone;
}

// ── Value coercion ───────────────────────────────────────────────────

/** Coerce a string value to the appropriate type based on field metadata. */
export function coerceValue(
  raw: string,
  field: ConfigFieldMeta,
): unknown {
  switch (field.type) {
    case "number": {
      const n = Number(raw);
      if (isNaN(n)) {
        throw new CLIError(
          `Invalid value for ${field.label}: "${raw}"`,
          "Expected a number.",
        );
      }
      return n;
    }
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new CLIError(
        `Invalid value for ${field.label}: "${raw}"`,
        'Expected "true" or "false".',
      );
    case "enum":
      if (field.enumValues && !field.enumValues.includes(raw)) {
        throw new CLIError(
          `Invalid value for ${field.label}: "${raw}"`,
          `Valid values: ${field.enumValues.join(", ")}`,
        );
      }
      return raw;
    case "array":
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    default:
      return raw;
  }
}

// ── Impact preview ──────────────────────────────────────────────────

export interface ConfigChangePreview {
  field: ConfigFieldMeta;
  oldValue: unknown;
  newValue: unknown;
  impact: string;
}

/** Generate a preview of the impact of changing a config value. */
export function previewChange(
  config: HenchConfig,
  path: string,
  newValue: unknown,
): ConfigChangePreview | null {
  const field = CONFIG_FIELDS.find((f) => f.path === path);
  if (!field) return null;

  const oldValue = getConfigValue(config, path);
  return {
    field,
    oldValue,
    newValue,
    impact: field.impact(newValue),
  };
}

// ── Display formatters ──────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  // Most of the config is optional, and an absent key means "hench's own
  // default applies" — printing the literal "undefined" reads as a broken
  // value rather than an unset one.
  if (value === undefined || value === null) return "(unset)";
  return String(value);
}

const CATEGORY_LABELS: Record<ConfigFieldCategory, string> = {
  execution: "Execution Strategy",
  session: "Session Reuse",
  "task-selection": "Task Selection",
  retry: "Retry Policy",
  prune: "Context Prune",
  "test-gate": "Test Gate",
  git: "Git Safety",
  guard: "Guard Rails",
  general: "General",
};

/** Display order of the categories, and the full set of valid ones. */
export const CATEGORY_ORDER: ConfigFieldCategory[] = [
  "execution",
  "session",
  "task-selection",
  "retry",
  "prune",
  "test-gate",
  "git",
  "guard",
  "general",
];

/**
 * What hench applies to a config that omits a key.
 *
 * Not `DEFAULT_HENCH_CONFIG()` on its own: that factory only carries the keys
 * it writes at init time, and the rest of the defaults live on the schema
 * (`maxSpawnsPerTask`, `livelockThreshold`, `fullTestTimeoutMs`, the session
 * trio…). Comparing against the bare factory marked every one of those as
 * differing from a default it simply had not been told about.
 */
function appliedDefaults(): HenchConfig {
  const parsed = validateConfig(DEFAULT_HENCH_CONFIG());
  return parsed.ok ? (parsed.data as HenchConfig) : DEFAULT_HENCH_CONFIG();
}

/** Format the full config as a readable display. */
export function formatConfigDisplay(config: HenchConfig): string {
  const lines: string[] = [];
  const defaults = appliedDefaults();

  for (const category of CATEGORY_ORDER) {
    const fields = CONFIG_FIELDS.filter((f) => f.category === category);
    if (fields.length === 0) continue;

    lines.push(`\n  ${CATEGORY_LABELS[category] ?? category}`);
    lines.push(`  ${"─".repeat(40)}`);

    const maxLabel = Math.max(...fields.map((f) => f.label.length));
    for (const field of fields) {
      const value = getConfigValue(config, field.path);
      const defaultValue = getConfigValue(defaults, field.path);
      // An absent key is the default by definition — hench fills it in on load
      // — so it is never marked as differing, whatever the default happens
      // to be.
      const isDefault =
        value === undefined || JSON.stringify(value) === JSON.stringify(defaultValue);
      const marker = isDefault ? " " : "*";
      lines.push(
        `  ${marker} ${field.label.padEnd(maxLabel + 2)}${formatValue(value)}`,
      );
    }
  }

  lines.push("");
  lines.push("  Fields marked with * differ from defaults.");
  lines.push("  Use 'hench config <key> <value>' to change a setting.");
  lines.push("  Use 'hench config --interactive' for guided configuration.");
  return lines.join("\n");
}

// ── Interactive menu ─────────────────────────────────────────────────

async function promptUser(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();
  return answer.trim();
}

async function runInteractiveMenu(henchDir: string): Promise<void> {
  let config = await loadConfig(henchDir);
  let done = false;

  info("\nHench Workflow Configuration");
  info("═".repeat(40));

  while (!done) {
    info("\nCategories:");
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      info(`  ${i + 1}. ${CATEGORY_LABELS[CATEGORY_ORDER[i]]}`);
    }
    info(`  q. Save & exit`);

    const categoryChoice = await promptUser(
      `\nSelect category (1-${CATEGORY_ORDER.length}, q): `,
    );

    if (categoryChoice === "q" || categoryChoice === "quit") {
      done = true;
      continue;
    }

    const catIdx = parseInt(categoryChoice, 10) - 1;
    if (isNaN(catIdx) || catIdx < 0 || catIdx >= CATEGORY_ORDER.length) {
      info(`Invalid choice. Enter a number 1-${CATEGORY_ORDER.length} or 'q'.`);
      continue;
    }

    const category = CATEGORY_ORDER[catIdx];
    const fields = CONFIG_FIELDS.filter((f) => f.category === category);

    let categoryDone = false;
    while (!categoryDone) {
      info(`\n  ${CATEGORY_LABELS[category]}`);
      info(`  ${"─".repeat(40)}`);

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const value = getConfigValue(config, field.path);
        info(`  ${i + 1}. ${field.label}: ${formatValue(value)}`);
        info(`     ${field.description}`);
      }
      info(`  b. Back to categories`);

      const fieldChoice = await promptUser(`\nEdit field (1-${fields.length}, b): `);

      if (fieldChoice === "b" || fieldChoice === "back") {
        categoryDone = true;
        continue;
      }

      const fieldIdx = parseInt(fieldChoice, 10) - 1;
      if (isNaN(fieldIdx) || fieldIdx < 0 || fieldIdx >= fields.length) {
        info(`Invalid choice. Enter a number 1-${fields.length} or 'b'.`);
        continue;
      }

      const field = fields[fieldIdx];
      const currentValue = getConfigValue(config, field.path);

      let prompt = `\n  Current: ${formatValue(currentValue)}`;
      if (field.type === "enum" && field.enumValues) {
        prompt += `\n  Options: ${field.enumValues.join(", ")}`;
      }
      if (field.type === "array") {
        prompt += "\n  Enter comma-separated values";
      }
      prompt += `\n  New value (or 'cancel'): `;

      info(prompt.split("\n").slice(0, -1).join("\n"));
      const rawValue = await promptUser(prompt.split("\n").pop()!);

      if (rawValue === "cancel" || rawValue === "") {
        continue;
      }

      try {
        const newValue = coerceValue(rawValue, field);
        const preview = previewChange(config, field.path, newValue);

        if (preview) {
          info(`\n  Impact: ${preview.impact}`);
        }

        const confirm = await promptUser("  Apply change? (y/n): ");
        if (confirm === "y" || confirm === "yes") {
          config = setConfigValue(config, field.path, newValue);

          // Validate before saving
          const validation = validateConfig(config);
          if (!validation.ok) {
            const errors = formatValidationErrors(validation.errors);
            info(`  Validation failed: ${errors.join(", ")}`);
            info("  Change reverted.");
            config = await loadConfig(henchDir);
          } else {
            await saveConfig(henchDir, config);
            info("  Saved.");
          }
        } else {
          info("  Change cancelled.");
        }
      } catch (err) {
        if (err instanceof CLIError) {
          info(`  Error: ${err.message}`);
          if (err.suggestion) info(`  Hint: ${err.suggestion}`);
        } else {
          info(`  Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  info("\nConfiguration saved.");
}

// ── CLI entry point ─────────────────────────────────────────────────

export async function cmdConfig(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, ".hench");

  // Interactive mode
  if (flags.interactive === "true") {
    if (!process.stdin.isTTY) {
      throw new CLIError(
        "Interactive mode requires a terminal.",
        "Use 'hench config <key> <value>' for non-interactive configuration.",
      );
    }
    await runInteractiveMenu(henchDir);
    return;
  }

  // JSON output mode
  if (flags.format === "json") {
    const config = await loadConfig(henchDir);
    result(JSON.stringify(config, null, 2));
    return;
  }

  const key = positional[0];
  const value = positional[1];

  // No arguments — display all config
  if (!key) {
    const config = await loadConfig(henchDir);
    info("Hench Workflow Configuration");
    info(formatConfigDisplay(config));
    return;
  }

  // Get — single key
  if (key && !value) {
    const config = await loadConfig(henchDir);
    const field = CONFIG_FIELDS.find((f) => f.path === key);

    if (!field) {
      // Try direct path access even if not in metadata
      const val = getConfigValue(config, key);
      if (val === undefined) {
        throw new CLIError(
          `Unknown config key: "${key}"`,
          `Valid keys: ${CONFIG_FIELDS.map((f) => f.path).join(", ")}`,
        );
      }
      result(formatValue(val));
      return;
    }

    const val = getConfigValue(config, key);
    if (flags.format !== "json") {
      info(`${field.label}: ${formatValue(val)}`);
      info(`  ${field.description}`);
      info(`  Impact: ${field.impact(val)}`);
    } else {
      result(JSON.stringify(val));
    }
    return;
  }

  // Set — key + value
  const field = CONFIG_FIELDS.find((f) => f.path === key);
  if (!field) {
    throw new CLIError(
      `Unknown config key: "${key}"`,
      `Valid keys: ${CONFIG_FIELDS.map((f) => f.path).join(", ")}`,
    );
  }

  const config = await loadConfig(henchDir);
  const coerced = coerceValue(value, field);
  const preview = previewChange(config, key, coerced);
  const newConfig = setConfigValue(config, key, coerced);

  // Validate
  const validation = validateConfig(newConfig);
  if (!validation.ok) {
    const errors = formatValidationErrors(validation.errors);
    throw new CLIError(
      `Invalid value: ${errors.join(", ")}`,
      "Check the value and try again.",
    );
  }

  await saveConfig(henchDir, newConfig);

  info(`${field.label}: ${formatValue(getConfigValue(config, key))} → ${formatValue(coerced)}`);
  if (preview) {
    info(`Impact: ${preview.impact}`);
  }
  info("Saved to .hench/config.json");
}
