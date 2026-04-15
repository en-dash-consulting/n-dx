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
import type { HenchConfig, GuardConfig, RetryConfig, Provider } from "../../schema/v1.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

// ── Config field metadata ─────────────────────────────────────────────

export interface ConfigFieldMeta {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  category: "execution" | "retry" | "guard" | "task-selection" | "general";
  /** Human-readable impact description shown when value changes. */
  impact: (value: unknown) => string;
}

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
    description: "Total token budget per run (input+output). 0 = unlimited",
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

  // ── General ──
  {
    path: "apiKeyEnv",
    label: "API Key Env Var",
    description: "Environment variable name for Anthropic API key",
    type: "string",
    category: "general",
    impact: (v) => `API key will be read from $${v}`,
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
  return String(value);
}

const CATEGORY_LABELS: Record<string, string> = {
  execution: "Execution Strategy",
  retry: "Retry Policy",
  guard: "Guard Rails",
  "task-selection": "Task Selection",
  general: "General",
};

const CATEGORY_ORDER = ["execution", "task-selection", "retry", "guard", "general"];

/** Format the full config as a readable display. */
export function formatConfigDisplay(config: HenchConfig): string {
  const lines: string[] = [];
  const defaults = DEFAULT_HENCH_CONFIG();

  for (const category of CATEGORY_ORDER) {
    const fields = CONFIG_FIELDS.filter((f) => f.category === category);
    if (fields.length === 0) continue;

    lines.push(`\n  ${CATEGORY_LABELS[category] ?? category}`);
    lines.push(`  ${"─".repeat(40)}`);

    const maxLabel = Math.max(...fields.map((f) => f.label.length));
    for (const field of fields) {
      const value = getConfigValue(config, field.path);
      const defaultValue = getConfigValue(defaults, field.path);
      const isDefault = JSON.stringify(value) === JSON.stringify(defaultValue);
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

    const categoryChoice = await promptUser("\nSelect category (1-5, q): ");

    if (categoryChoice === "q" || categoryChoice === "quit") {
      done = true;
      continue;
    }

    const catIdx = parseInt(categoryChoice, 10) - 1;
    if (isNaN(catIdx) || catIdx < 0 || catIdx >= CATEGORY_ORDER.length) {
      info("Invalid choice. Enter a number 1-5 or 'q'.");
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
