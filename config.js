/**
 * Unified config command for n-dx.
 *
 * Usage:
 *   n-dx config [dir]                    Show all package configs
 *   n-dx config <key> [dir]              Get a specific value (e.g. hench.model)
 *   n-dx config <key> <value> [dir]      Set a specific value
 *   n-dx config --json [dir]             Output as JSON
 */

import { readFile, writeFile, access, constants, chmod, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const PROJECT_CONFIG_FILE = ".n-dx.json";

const PACKAGES = {
  rex: { dir: ".rex", file: "config.json" },
  hench: { dir: ".hench", file: "config.json" },
  sourcevision: { dir: ".sourcevision", file: "manifest.json" },
};

/**
 * Sections stored in .n-dx.json rather than package config files.
 * These are cross-cutting settings that apply to all packages.
 */
const PROJECT_SECTIONS = new Set(["claude", "llm", "web", "features"]);

/**
 * Valid values for the top-level `language` field in .n-dx.json.
 * "auto" (or omitting the field) triggers marker-based detection.
 */
const VALID_LANGUAGES = new Set(["typescript", "javascript", "go", "auto"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadJSON(path) {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

async function saveJSON(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Save .n-dx.json with owner-only permissions (0o600) when it contains
 * sensitive data like API keys. Otherwise uses standard permissions.
 */
async function saveProjectJSON(path, data) {
  await saveJSON(path, data);
  const hasSensitiveData =
    (data?.claude?.api_key && typeof data.claude.api_key === "string") ||
    (data?.llm?.claude?.api_key && typeof data.llm.claude.api_key === "string") ||
    (data?.llm?.codex?.api_key && typeof data.llm.codex.api_key === "string");
  if (hasSensitiveData) {
    await chmod(path, 0o600);
  }
}

/**
 * Deep merge source into target. Source values take precedence.
 * Arrays are replaced (not concatenated). Objects are recursively merged.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Load the project-level .n-dx.json config from the project root.
 * Returns an empty object if the file doesn't exist or is invalid.
 */
async function loadProjectConfig(dir) {
  const configPath = join(dir, PROJECT_CONFIG_FILE);
  if (!(await fileExists(configPath))) return {};
  try {
    return await loadJSON(configPath);
  } catch {
    return {};
  }
}

/**
 * Get a nested value from an object by dot-separated path.
 * Returns undefined if any segment is missing.
 */
function getByPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Set a nested value in an object by dot-separated path.
 * Creates intermediate objects as needed.
 */
function setByPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Coerce a string value to the appropriate JS type based on the existing value.
 * - If existing is a number, parse as number
 * - If existing is a boolean, parse as boolean
 * - If existing is an array, split on commas
 * - Otherwise keep as string
 */
function coerceValue(newValue, existingValue) {
  if (existingValue === undefined || existingValue === null) {
    return newValue;
  }
  if (typeof existingValue === "number") {
    const n = Number(newValue);
    if (isNaN(n)) {
      throw new Error(`Expected a number, got "${newValue}"`);
    }
    return n;
  }
  if (typeof existingValue === "boolean") {
    if (newValue === "true") return true;
    if (newValue === "false") return false;
    throw new Error(`Expected "true" or "false", got "${newValue}"`);
  }
  if (Array.isArray(existingValue)) {
    return newValue.split(",").map((s) => s.trim());
  }
  return newValue;
}

// ── Claude config validation ─────────────────────────────────────────────────

/**
 * Validate claude.cli_path: check the file exists and is executable.
 * Throws with a helpful message on failure.
 */
async function validateCliPath(value) {
  try {
    await access(value, constants.F_OK);
  } catch {
    throw new Error(
      `File not found: ${value}\n` +
        "  Provide an absolute path to the Claude Code CLI binary."
    );
  }
  try {
    await access(value, constants.X_OK);
  } catch {
    throw new Error(
      `File is not executable: ${value}\n` +
        "  Run: chmod +x " + value
    );
  }
}

/**
 * Validate llm.codex.cli_path.
 * Accepts either an absolute/relative file path or a binary name on PATH.
 */
async function validateCodexCliPath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("CLI path must be a non-empty string.");
  }

  if (!value.includes("/") && !value.includes("\\")) {
    const probe = testCliPath(value);
    if (!probe.ok) {
      throw new Error(
        `Command not found or not runnable: ${value}\n` +
          "  Install Codex CLI or set an absolute path with:\n" +
          "  n-dx config llm.codex.cli_path /path/to/codex",
      );
    }
    return;
  }

  try {
    await access(value, constants.F_OK);
  } catch {
    throw new Error(
      `File not found: ${value}\n` +
        "  Provide an absolute path to the Codex CLI binary.",
    );
  }

  try {
    await access(value, constants.X_OK);
  } catch {
    throw new Error(
      `File is not executable: ${value}\n` +
        "  Run: chmod +x " + value,
    );
  }
}

/**
 * Validate claude.api_key: check the format matches the Anthropic key pattern.
 * Throws with a helpful message on failure.
 */
function validateApiKey(value) {
  if (typeof value !== "string" || !value.startsWith("sk-ant-")) {
    throw new Error(
      `Invalid API key format. Anthropic keys start with "sk-ant-".\n` +
        "  Get your key at: https://console.anthropic.com/settings/keys"
    );
  }
}

/**
 * Test that an Anthropic API key works by making a lightweight API call.
 * Returns { ok: true } on success, { ok: false, error: string } on failure.
 *
 * @param apiKey  The API key to test
 * @param endpoint  Optional custom API endpoint (default: https://api.anthropic.com)
 * @param model  Optional model override for the test call
 */
async function testApiConnection(apiKey, endpoint, model) {
  try {
    const baseUrl = (endpoint || "https://api.anthropic.com").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (res.ok) {
      return { ok: true };
    }

    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `HTTP ${res.status}`;

    if (res.status === 401) {
      return { ok: false, error: `Authentication failed: ${msg}` };
    }
    if (res.status === 403) {
      return { ok: false, error: `Permission denied: ${msg}` };
    }
    // 400 with "credit balance is too low" still means the key is valid
    if (res.status === 400 && msg.includes("credit")) {
      return { ok: true };
    }
    // Overloaded / rate-limited — key is valid
    if (res.status === 429 || res.status === 529) {
      return { ok: true };
    }
    return { ok: false, error: msg };
  } catch (err) {
    return { ok: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Validate claude.api_endpoint: check the URL is well-formed.
 * Throws with a helpful message on failure.
 */
function validateApiEndpoint(value) {
  if (typeof value !== "string") {
    throw new Error("API endpoint must be a string URL.");
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error(
        `Invalid protocol "${url.protocol}". Use http:// or https://.`
      );
    }
  } catch (err) {
    if (err.message.startsWith("Invalid protocol")) throw err;
    throw new Error(
      `Invalid URL: "${value}"\n` +
        "  Provide a valid HTTP(S) URL (e.g., https://api.anthropic.com)."
    );
  }
}

/**
 * Validate claude.model: check the model name is non-empty and looks reasonable.
 * Throws with a helpful message on failure.
 */
function validateModel(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Model name must be a non-empty string.");
  }
  // Warn-level: allow any string but hint at common patterns
}

/**
 * Validate CLI path by trying to run `<binary> --version`.
 * Returns { ok, version?, error? }.
 */
function testCliPath(cliPath) {
  try {
    const output = execFileSync(cliPath, ["--version"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return { ok: true, version: output.trim() };
  } catch (err) {
    return {
      ok: false,
      error: err.code === "ENOENT"
        ? `File not found: ${cliPath}`
        : `Failed to run: ${err.message}`,
    };
  }
}

/**
 * Validators for specific claude config keys.
 * Each returns nothing on success or throws with a message.
 */
const CLAUDE_VALIDATORS = {
  cli_path: validateCliPath,
  api_key: validateApiKey,
  api_endpoint: validateApiEndpoint,
  model: validateModel,
};

/**
 * Validate llm.vendor.
 */
function validateLLMVendor(value) {
  if (value !== "claude" && value !== "codex") {
    throw new Error(
      `Invalid vendor "${value}". Expected one of: claude, codex.`,
    );
  }
}

/**
 * Validators for llm.* config keys in .n-dx.json.
 * Keys are setting paths relative to the llm section.
 */
const LLM_VALIDATORS = {
  vendor: validateLLMVendor,
  "claude.cli_path": validateCliPath,
  "claude.api_endpoint": validateApiEndpoint,
  "claude.model": validateModel,
  "codex.cli_path": validateCodexCliPath,
  "codex.api_endpoint": validateApiEndpoint,
  "codex.model": validateModel,
};

/**
 * Build provider-specific auth preflight command.
 * Returns binary + args for the selected vendor.
 */
function getVendorAuthPreflightCommand(vendor, llmConfig, legacyClaudeConfig) {
  if (vendor === "codex") {
    const binary = llmConfig?.codex?.cli_path || "codex";
    return {
      binary,
      args: [
        "exec",
        "--skip-git-repo-check",
        "Reply with exactly: ok",
      ],
    };
  }

  const binary = llmConfig?.claude?.cli_path || legacyClaudeConfig?.cli_path || "claude";
  return {
    binary,
    args: [
      "-p",
      "Reply with exactly: ok",
      "--output-format",
      "json",
    ],
  };
}

/**
 * Run provider auth preflight for the selected vendor.
 * Returns an object instead of throwing so callers can branch deterministically.
 */
function runVendorAuthPreflight(vendor, llmConfig, legacyClaudeConfig) {
  const { binary, args } = getVendorAuthPreflightCommand(vendor, llmConfig, legacyClaudeConfig);
  try {
    execFileSync(binary, args, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return { ok: true, binary, args };
  } catch (err) {
    const stderr = typeof err?.stderr === "string"
      ? err.stderr
      : Buffer.isBuffer(err?.stderr) ? err.stderr.toString("utf-8") : "";
    const stdout = typeof err?.stdout === "string"
      ? err.stdout
      : Buffer.isBuffer(err?.stdout) ? err.stdout.toString("utf-8") : "";
    const combined = stderr || stdout || err?.message || "";
    // Claude Code refuses to run nested inside another Claude Code session.
    // This error means the binary is present and the user is authenticated.
    if (combined.includes("cannot be launched inside another Claude Code session")) {
      return { ok: true, binary, args };
    }
    const detail = combined.trim() || "unknown error";
    return { ok: false, binary, args, detail };
  }
}

/**
 * Return the exact login command for the selected provider.
 */
function getVendorLoginCommand(vendor, llmConfig, legacyClaudeConfig) {
  const { binary } = getVendorAuthPreflightCommand(vendor, llmConfig, legacyClaudeConfig);
  return `${binary} login`;
}

// ── Display ──────────────────────────────────────────────────────────────────

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function flattenConfig(obj, prefix = "") {
  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      entries.push(...flattenConfig(value, path));
    } else {
      entries.push({ path, value });
    }
  }
  return entries;
}

function printSection(label, config, logFn = console.log) {
  logFn(`\n  ${label}`);
  const entries = flattenConfig(config);
  const maxPath = Math.max(...entries.map((e) => e.path.length));
  for (const { path, value } of entries) {
    logFn(`    ${path.padEnd(maxPath + 2)}${formatValue(value)}`);
  }
}

// ── Help text ────────────────────────────────────────────────────────────────

const HELP_TEXT = `n-dx config — view and edit settings across all packages

Usage:
  n-dx config [dir]                    Show all package configurations
  n-dx config <key> [dir]              Get a specific value
  n-dx config <key> <value> [dir]      Set a specific value

Keys use dot notation: <package>.<setting>

Rex settings (.rex/config.json):
  rex.project              string    Project name (default: directory name)
  rex.adapter              string    Storage adapter (default: "file")
  rex.validate             string    Validation command to run (optional)
  rex.test                 string    Test command to run (optional)
  rex.sourcevision         string    Sourcevision integration mode (default: "auto")
  rex.model                string    LLM model for analysis (optional)

Rex budget settings (token/cost usage limits):
  rex.budget.tokens        number    Max total tokens (input+output), 0 = unlimited
  rex.budget.cost          number    Max estimated cost in USD, 0 = unlimited
  rex.budget.warnAt        number    Warning threshold percentage (default: 80)
  rex.budget.abort         boolean   Abort operations when budget exceeded (default: false)

Rex LoE settings (level-of-effort estimation and decomposition):
  rex.loe.taskThresholdWeeks     number    Max task size in engineer-weeks before
                                           automatic decomposition (default: 2)
  rex.loe.maxDecompositionDepth  number    Max recursion depth for decomposition
                                           (default: 2)
  rex.loe.proposalCeiling        number    Max proposal tasks per input description
                                           before triggering consolidation (default: 10)

Hench settings (.hench/config.json):
  hench.provider           string    API provider: "cli" or "api" (default: "cli")
  hench.model              string    Claude model name (default: "sonnet")
  hench.maxTurns           number    Max conversation turns per run (default: 50)
  hench.maxTokens          number    Max tokens per API request (default: 8192)
  hench.rexDir             string    Path to .rex directory (default: ".rex")
  hench.apiKeyEnv          string    Env variable for API key (default: "ANTHROPIC_API_KEY")

Hench guard settings (security boundaries):
  hench.guard.blockedPaths       string[]  Glob patterns for blocked file paths
                                           (default: .hench/**, .rex/**, .git/**, node_modules/**)
  hench.guard.allowedCommands    string[]  Whitelisted shell commands
                                           (default: npm, npx, node, git, tsc, vitest)
  hench.guard.commandTimeout     number    Command timeout in ms (default: 30000)
  hench.guard.maxFileSize        number    Max file size in bytes (default: 1048576)

Sourcevision manifest (.sourcevision/manifest.json):
  sourcevision.*           (read-only, generated by analysis)

Claude settings (.n-dx.json — shared across all packages):
  claude.cli_path          string    Path to Claude Code CLI binary (optional)
                                    When set, hench uses this path instead of looking
                                    for "claude" on PATH. Validated: must exist and be
                                    executable. Use --force to skip validation.
  claude.api_key           string    Anthropic API key (optional)
                                    When set, packages use this key instead of reading
                                    from the ANTHROPIC_API_KEY environment variable.
                                    Validated: must start with "sk-ant-". Use --force
                                    to skip validation.
                                    Note: stored in .n-dx.json — add to .gitignore.
                                    File permissions set to 0600 (owner-only) for security.
  claude.api_endpoint      string    Anthropic API base URL (optional)
                                    Override the default API endpoint for proxies or
                                    compatible services.
                                    Default: https://api.anthropic.com
                                    Validated: must be a valid HTTP(S) URL.
  claude.model             string    Default Claude model for API calls (optional)
                                    Override the default model used by all packages.
                                    Examples: claude-sonnet-4-6, claude-opus-4-20250514
                                    Default: claude-sonnet-4-6

LLM vendor settings (.n-dx.json — preferred for multi-vendor setup):
  llm.vendor               string    Active LLM vendor: "claude" or "codex"
                                    Required for multi-vendor workflows.
  llm.claude.cli_path      string    Claude CLI path (optional; validated executable)
  llm.claude.api_key       string    Claude API key (optional)
  llm.claude.api_endpoint  string    Claude API endpoint (optional; validated URL)
  llm.claude.model         string    Claude default model (optional)
  llm.codex.cli_path       string    Codex CLI path (optional; validated executable)
  llm.codex.api_key        string    Codex API key (optional)
  llm.codex.api_endpoint   string    Codex API endpoint (optional; validated URL)
  llm.codex.model          string    Codex default model (optional)

Feature toggles (.n-dx.json — managed via web UI or ndx config):
  features.rex.showTokenBudget      boolean   Show token budget on task items (default: false)
  features.rex.autoComplete         boolean   Auto-complete parents when children done (default: true)
  features.rex.budgetEnforcement    boolean   Enforce token/cost budgets (default: false)
  features.rex.notionSync           boolean   Enable Notion two-way sync (default: false)
  features.sourcevision.callGraph   boolean   Enable call graph extraction (default: false)
  features.sourcevision.enrichment  boolean   AI enrichment passes (default: true)
  features.sourcevision.componentCatalog
                                    boolean   React component catalog (default: true)
  features.hench.autoRetry          boolean   Auto-retry on failure (default: true)
  features.hench.guardRails         boolean   Security guard rails (default: true)
  features.hench.adaptiveWorkflow   boolean   Adaptive workflow adjustment (default: false)

Web dashboard settings (.n-dx.json):
  web.port                 number    Dashboard server port (default: 3117)

Language detection override (.n-dx.json):
  language                 string    Primary project language (default: "auto")
                                    Valid values: typescript, javascript, go, auto
                                    When set to a specific language, overrides
                                    marker-based auto-detection in sourcevision.
                                    Use "auto" (or omit) to use the detection chain.

Project config (.n-dx.json):
  Place a .n-dx.json file at the project root to override package settings.
  Uses the same package-scoped keys (rex, hench, web, claude, llm). Project config
  takes precedence over individual package configs. Deep merges nested objects;
  arrays are replaced entirely. Example:

    {
      "rex":    { "validate": "pnpm typecheck" },
      "hench":  { "model": "opus", "guard": { "commandTimeout": 60000 } },
      "web":    { "port": 4000 },
      "claude": { "cli_path": "/usr/local/bin/claude" },
      "llm":    { "vendor": "claude" }
    }

Options:
  --json                   Output as JSON
  --force                  Skip validation when setting claude/llm config values
  --test-connection        Test configured claude.api_key and/or claude.cli_path
  --help, -h               Show this help

Type coercion:
  Values are automatically coerced to match the existing type:
  - Numbers: string is parsed as a number (errors if not a valid number)
  - Booleans: accepts "true" or "false"
  - Arrays: comma-separated values (e.g. "npm,git,pnpm")
  - Strings: kept as-is

Examples:
  n-dx config                                  Show all settings
  n-dx config rex.project                      Get the project name
  n-dx config hench.model opus                 Set the model to opus
  n-dx config hench.maxTurns 100               Set max turns (coerced to number)
  n-dx config hench.guard.allowedCommands \\
    "npm,git,pnpm,tsc"                         Set allowed commands (coerced to array)
  n-dx config rex.validate "pnpm typecheck"    Set validation command
  n-dx config rex.budget.tokens 500000         Set token budget to 500k
  n-dx config rex.budget.cost 10               Set cost budget to $10
  n-dx config rex.budget.abort true            Abort operations when exceeded
  n-dx config claude.cli_path /usr/local/bin/claude
                                               Set Claude CLI binary path (validates path)
  n-dx config claude.cli_path /path --force    Set without validation
  n-dx config claude.api_key sk-ant-...        Set Anthropic API key (validates format)
  n-dx config claude.api_endpoint https://proxy.example.com
                                               Set custom API endpoint
  n-dx config claude.model claude-opus-4-20250514
                                               Set default model for API calls
  n-dx config llm.vendor claude                Set active LLM vendor to Claude
  n-dx config llm.vendor codex                 Set active LLM vendor to Codex
  n-dx config llm.claude.api_key sk-ant-...    Set Claude API key (llm namespace)
  n-dx config llm.claude.model claude-opus-4-20250514
                                               Set Claude model (llm namespace)
  n-dx config llm.codex.cli_path /usr/local/bin/codex
                                               Set Codex CLI path
  n-dx config features.rex.showTokenBudget true
                                               Enable token budget display on tasks
  n-dx config language go                      Set primary project language to Go
  n-dx config language auto                    Reset to auto-detection
  n-dx config --test-connection                Test API key and/or CLI path
  n-dx config --json                           Show all settings as JSON
  n-dx config hench --json                     Show hench settings as JSON
  n-dx config claude --json                    Show Claude settings as JSON`;

// ── Arg parsing ──────────────────────────────────────────────────────────────

/** Parse CLI args into flags and positional args. */
function parseArgs(args) {
  const flags = {};
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = "true";
      }
    } else if (arg === "-h") {
      flags.help = "true";
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

/** Resolve dir, keyArg, and valueArg from positional args. */
async function resolvePositionalArgs(positional) {
  let dir = process.cwd();
  let keyArg = positional[0];
  let valueArg = positional[1];

  if (positional.length >= 3) {
    dir = resolve(positional[positional.length - 1]);
    valueArg = positional[positional.length - 2];
    keyArg = positional[0];
  } else if (positional.length === 2) {
    if (await fileExists(resolve(positional[1]))) {
      dir = resolve(positional[1]);
      keyArg = positional[0];
      valueArg = undefined;
    }
  } else if (positional.length === 1) {
    if (await fileExists(resolve(positional[0]))) {
      dir = resolve(positional[0]);
      keyArg = undefined;
    }
  }

  return { dir, keyArg, valueArg };
}

// ── Config loading ───────────────────────────────────────────────────────────

/** Load all package configs and project-level overrides. */
async function loadAllConfigs(dir) {
  const projectConfig = await loadProjectConfig(dir);
  const configs = {};
  const rawConfigs = {};

  for (const [pkg, meta] of Object.entries(PACKAGES)) {
    const configPath = join(dir, meta.dir, meta.file);
    if (await fileExists(configPath)) {
      try {
        const pkgConfig = await loadJSON(configPath);
        rawConfigs[pkg] = pkgConfig;
        configs[pkg] = projectConfig[pkg]
          ? deepMerge(pkgConfig, projectConfig[pkg])
          : pkgConfig;
      } catch (err) {
        configs[pkg] = { _error: err.message };
      }
    }
  }

  for (const section of PROJECT_SECTIONS) {
    if (projectConfig[section] && typeof projectConfig[section] === "object") {
      configs[section] = projectConfig[section];
    }
  }

  // Expose the top-level language field (scalar, not a section object)
  if (typeof projectConfig.language === "string") {
    configs.language = projectConfig.language;
  }

  return { configs, rawConfigs };
}

// ── Test connection handler ──────────────────────────────────────────────────

/** Handle --test-connection mode. */
async function handleTestConnection(configs) {
  const claudeConfig = configs.claude;
  if (!claudeConfig) {
    console.error("No Claude configuration set. Use 'n-dx config claude.api_key <key>' or 'n-dx config claude.cli_path <path>' first.");
    process.exit(1);
  }

  let tested = false;
  let hasFailure = false;

  if (claudeConfig.api_key) {
    tested = true;
    const result = await testApiConnection(
      claudeConfig.api_key,
      claudeConfig.api_endpoint,
      claudeConfig.model,
    );
    if (result.ok) {
      const endpoint = claudeConfig.api_endpoint || "https://api.anthropic.com";
      console.log(`Testing API key... ✓ API key is valid (endpoint: ${endpoint}).`);
    } else {
      console.error("Testing API key... ✗ " + result.error);
      hasFailure = true;
    }
  }

  if (claudeConfig.cli_path) {
    tested = true;
    const result = testCliPath(claudeConfig.cli_path);
    if (result.ok) {
      console.log("Testing CLI path... ✓ " + (result.version || "CLI is available."));
    } else {
      console.error("Testing CLI path... ✗ " + result.error);
      hasFailure = true;
    }
  }

  if (!tested) {
    console.error("No claude.api_key or claude.cli_path configured to test.");
    process.exit(1);
  }
  if (hasFailure) {
    process.exit(1);
  }
}

// ── SET mode handlers ────────────────────────────────────────────────────────

/** Coerce and validate a value for a project-level section key. */
async function coerceAndValidateProjectValue(pkg, settingPath, valueArg, keyArg, configs, flags) {
  const existing = getByPath(configs[pkg], settingPath);
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    console.error(`Cannot set "${keyArg}" — it's an object. Set individual keys instead.`);
    process.exit(1);
  }

  let coerced;
  try {
    coerced = coerceValue(valueArg, existing);
  } catch (err) {
    console.error(`Invalid value for "${keyArg}": ${err.message}`);
    process.exit(1);
  }

  // Validate section-specific settings (skip with --force)
  const validators = pkg === "claude" ? CLAUDE_VALIDATORS : pkg === "llm" ? LLM_VALIDATORS : null;
  if (validators && validators[settingPath] && flags.force !== "true") {
    try {
      await validators[settingPath](coerced);
    } catch (err) {
      console.error(`Invalid value for "${keyArg}": ${err.message}`);
      console.error("  Use --force to set this value anyway.");
      process.exit(1);
    }
  }

  return coerced;
}

/** Run vendor auth preflight when setting llm.vendor. */
function runLLMVendorPreflight(coerced, configs) {
  const currentLLM = configs.llm && typeof configs.llm === "object" ? configs.llm : {};
  const llmForPreflight = { ...currentLLM, vendor: coerced };
  const legacyClaude = configs.claude && typeof configs.claude === "object" ? configs.claude : undefined;

  const preflight = runVendorAuthPreflight(coerced, llmForPreflight, legacyClaude);
  if (!preflight.ok) {
    const loginCommand = getVendorLoginCommand(coerced, llmForPreflight, legacyClaude);
    console.error(
      `Provider auth preflight failed for "${coerced}" via: ${preflight.binary} ${preflight.args.join(" ")}`,
    );
    if (preflight.detail) {
      console.error(`Details: ${preflight.detail}`);
    }
    console.error(`Next step: run '${loginCommand}', then retry 'ndx config llm.vendor ${coerced}'.`);
    process.exit(1);
  }
}

/** Handle SET mode for a project-level section (claude, llm, web, features). */
async function handleSetProjectSection(dir, pkg, settingPath, keyArg, valueArg, configs, flags) {
  if (!configs[pkg]) configs[pkg] = {};

  const coerced = await coerceAndValidateProjectValue(pkg, settingPath, valueArg, keyArg, configs, flags);

  // Vendor auth preflight for llm.vendor
  if (pkg === "llm" && settingPath === "vendor") {
    runLLMVendorPreflight(coerced, configs);
  }

  setByPath(configs[pkg], settingPath, coerced);

  // Write back to .n-dx.json
  const configPath = join(dir, PROJECT_CONFIG_FILE);
  const current = await loadProjectConfig(dir);
  current[pkg] = configs[pkg];

  // Compatibility: keep legacy claude.* in sync when setting llm.claude.*
  if (pkg === "llm" && settingPath.startsWith("claude.")) {
    if (!current.claude || typeof current.claude !== "object") {
      current.claude = {};
    }
    const legacySetting = settingPath.slice("claude.".length);
    setByPath(current.claude, legacySetting, coerced);
  }

  await saveProjectJSON(configPath, current);
  console.log(`${keyArg} = ${formatValue(coerced)}`);
}

/** Handle SET mode for a package config (rex, hench). */
async function handleSetPackageConfig(dir, pkg, settingPath, keyArg, valueArg, configs, rawConfigs) {
  if (!PACKAGES[pkg]) {
    console.error(
      `Unknown package "${pkg}". Available: ${[...Object.keys(PACKAGES), ...PROJECT_SECTIONS].join(", ")}`,
    );
    process.exit(1);
  }

  if (pkg === "sourcevision") {
    console.error("Sourcevision manifest is read-only (generated by analysis).");
    process.exit(1);
  }

  if (!configs[pkg]) {
    console.error(`Package "${pkg}" is not initialized. Run 'n-dx init' first.`);
    process.exit(1);
  }

  if (configs[pkg]._error) {
    console.error(`Cannot load ${pkg} config: ${configs[pkg]._error}`);
    process.exit(1);
  }

  if (settingPath === "schema") {
    console.error("Cannot modify schema version.");
    process.exit(1);
  }

  const existing = getByPath(configs[pkg], settingPath);
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    console.error(`Cannot set "${keyArg}" — it's an object. Set individual keys instead.`);
    process.exit(1);
  }

  let coerced;
  try {
    coerced = coerceValue(valueArg, existing);
  } catch (err) {
    console.error(`Invalid value for "${keyArg}": ${err.message}`);
    process.exit(1);
  }

  // Write to raw (un-merged) config so project overrides don't leak
  setByPath(rawConfigs[pkg], settingPath, coerced);

  const meta = PACKAGES[pkg];
  const configPath = join(dir, meta.dir, meta.file);
  await saveJSON(configPath, rawConfigs[pkg]);

  console.log(`${keyArg} = ${formatValue(coerced)}`);
}

// ── GET mode handler ─────────────────────────────────────────────────────────

/** Handle GET mode: retrieve and display a single key or whole section. */
function handleGet(keyArg, configs, flags) {
  // Special handling for top-level language key
  if (keyArg === "language") {
    const value = configs.language || "auto";
    if (flags.json) {
      console.log(JSON.stringify(value));
    } else {
      console.log(value);
    }
    return;
  }

  const dotIdx = keyArg.indexOf(".");
  if (dotIdx === -1) {
    // Show whole package/section config
    const pkg = keyArg;
    if (!configs[pkg]) {
      if (PROJECT_SECTIONS.has(pkg)) {
        console.error(`No ${pkg} configuration set. Use 'n-dx config ${pkg}.<key> <value>' to add settings.`);
      } else {
        console.error(`Package "${pkg}" is not initialized or has no config.`);
      }
      process.exit(1);
    }

    if (flags.json) {
      console.log(JSON.stringify(configs[pkg], null, 2));
    } else {
      printSection(pkg, configs[pkg]);
      console.log();
    }
    return;
  }

  const pkg = keyArg.slice(0, dotIdx);
  const settingPath = keyArg.slice(dotIdx + 1);

  if (!configs[pkg]) {
    if (PROJECT_SECTIONS.has(pkg)) {
      console.error(`Key "${keyArg}" not found.`);
    } else {
      console.error(`Package "${pkg}" is not initialized or has no config.`);
    }
    process.exit(1);
  }

  const value = getByPath(configs[pkg], settingPath);
  if (value === undefined) {
    console.error(`Key "${keyArg}" not found.`);
    process.exit(1);
  }

  if (flags.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(formatValue(value));
  }
}

// ── SHOW mode handler ────────────────────────────────────────────────────────

/** Handle SHOW mode: display all configs. */
function handleShowAll(configs, flags) {
  if (flags.json) {
    console.log(JSON.stringify(configs, null, 2));
    return;
  }

  console.log("n-dx configuration:");
  for (const [pkg, config] of Object.entries(configs)) {
    if (config._error) {
      console.log(`\n  ${pkg} (error: ${config._error})`);
    } else if (typeof config === "string") {
      // Scalar top-level keys (e.g. language)
      console.log(`\n  ${pkg}  ${config}`);
    } else {
      printSection(pkg, config);
    }
  }
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runConfig(args) {
  const { flags, positional } = parseArgs(args);

  if (flags.help) {
    console.log(HELP_TEXT);
    return;
  }

  const { dir, keyArg, valueArg } = await resolvePositionalArgs(positional);
  const { configs, rawConfigs } = await loadAllConfigs(dir);

  const keyTargetsProjectSection = (() => {
    if (!keyArg) return false;
    if (keyArg === "language") return true;
    const dotIdx = keyArg.indexOf(".");
    if (dotIdx === -1) return PROJECT_SECTIONS.has(keyArg);
    return PROJECT_SECTIONS.has(keyArg.slice(0, dotIdx));
  })();

  if (Object.keys(configs).length === 0 && !keyTargetsProjectSection) {
    console.error("No n-dx configuration found. Run 'n-dx init' first.");
    process.exit(1);
  }

  // Test connection mode
  if (flags["test-connection"] === "true") {
    await handleTestConnection(configs);
    return;
  }

  // SET mode: key + value
  if (keyArg && valueArg !== undefined) {
    // Special handling for top-level language key (no dot notation needed)
    if (keyArg === "language") {
      if (!VALID_LANGUAGES.has(valueArg)) {
        console.error(
          `Invalid language "${valueArg}". Valid values: ${[...VALID_LANGUAGES].join(", ")}`,
        );
        process.exit(1);
      }
      const configPath = join(dir, PROJECT_CONFIG_FILE);
      const current = await loadProjectConfig(dir);
      current.language = valueArg;
      await saveProjectJSON(configPath, current);
      console.log(`language = ${valueArg}`);
      return;
    }

    const dotIdx = keyArg.indexOf(".");
    if (dotIdx === -1) {
      console.error(`Invalid key "${keyArg}". Use dot notation: <package>.<setting>`);
      process.exit(1);
    }

    const pkg = keyArg.slice(0, dotIdx);
    const settingPath = keyArg.slice(dotIdx + 1);

    if (PROJECT_SECTIONS.has(pkg)) {
      await handleSetProjectSection(dir, pkg, settingPath, keyArg, valueArg, configs, flags);
    } else {
      await handleSetPackageConfig(dir, pkg, settingPath, keyArg, valueArg, configs, rawConfigs);
    }
    return;
  }

  // GET mode: single key
  if (keyArg) {
    handleGet(keyArg, configs, flags);
    return;
  }

  // SHOW mode: all configs
  handleShowAll(configs, flags);
}
