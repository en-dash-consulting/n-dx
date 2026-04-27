/**
 * Unified config command for n-dx.
 *
 * Usage:
 *   n-dx config [dir]                    Show all package configs
 *   n-dx config <key> [dir]              Get a specific value (e.g. hench.model)
 *   n-dx config <key> <value> [dir]      Set a specific value
 *   n-dx config --json [dir]             Output as JSON
 */

import {
  readFile,
  writeFile,
  access,
  constants,
  chmod,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

/**
 * Keys that are machine-specific and should be written to .n-dx.local.json
 * instead of .n-dx.json. These are settings that contain absolute paths or
 * other values that differ per developer machine.
 *
 * Format: "section.dotted.path" — the section is the top-level key
 * (e.g., "claude") and the dotted path is the setting within it.
 */
const MACHINE_LOCAL_KEYS = new Set([
  "claude.cli_path",
  "llm.claude.cli_path",
  "llm.codex.cli_path",
]);

const PACKAGES = {
  rex: { dir: ".rex", file: "config.json" },
  hench: { dir: ".hench", file: "config.json" },
  sourcevision: { dir: ".sourcevision", file: "manifest.json" },
};

/**
 * Sections stored in .n-dx.json rather than package config files.
 * These are cross-cutting settings that apply to all packages.
 */
const PROJECT_SECTIONS = new Set([
  "claude",
  "cli",
  "llm",
  "web",
  "features",
  "sourcevision",
]);

/**
 * Valid values for the top-level `language` field in .n-dx.json.
 * "auto" (or omitting the field) triggers marker-based detection.
 */
const VALID_LANGUAGES = new Set(["typescript", "javascript", "go", "auto"]);

/**
 * Regex matching integer or simple decimal strings (positive or negative).
 * Intentionally strict: rejects multi-dot strings like "1.2.3" so version
 * strings are left as strings.
 */
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

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

async function loadOptionalJSON(path) {
  if (!(await fileExists(path))) return {};
  try {
    return await loadJSON(path);
  } catch {
    return {};
  }
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
    (data?.llm?.claude?.api_key &&
      typeof data.llm.claude.api_key === "string") ||
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
async function loadProjectConfigFile(dir, fileName) {
  return loadOptionalJSON(join(dir, fileName));
}

async function loadProjectConfigLayers(dir) {
  const shared = await loadProjectConfigFile(dir, PROJECT_CONFIG_FILE);
  const local = await loadProjectConfigFile(dir, LOCAL_CONFIG_FILE);
  return {
    shared,
    local,
    merged: deepMerge(shared, local),
  };
}

export async function loadProjectConfig(dir) {
  const { merged } = await loadProjectConfigLayers(dir);
  return merged;
}

/**
 * Known config paths whose values must be finite numbers.
 * Used by repairProjectConfig() to re-type string values that should have
 * been stored as numbers (e.g. from first-time sets before coerceValue
 * auto-detected numeric strings).
 *
 * Paths may use "*" as a final segment to match any key under an object.
 */
const NUMERIC_CONFIG_PATHS = [
  "cli.timeoutMs",
  "cli.timeouts.*",
  "web.port",
];

/**
 * In-place: coerce string numeric values at known-numeric paths to numbers.
 * Returns a list of { path, from, to } entries describing each repair.
 */
function applyNumericRepairs(obj) {
  const repairs = [];
  for (const path of NUMERIC_CONFIG_PATHS) {
    const parts = path.split(".");
    const leaf = parts[parts.length - 1];
    const parent = getByPath(obj, parts.slice(0, -1).join("."));
    if (parent == null || typeof parent !== "object") continue;

    const entries = leaf === "*" ? Object.keys(parent) : [leaf];
    for (const key of entries) {
      const value = parent[key];
      if (typeof value !== "string") continue;
      if (!NUMERIC_STRING_RE.test(value)) continue;
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      const displayPath = leaf === "*"
        ? `${parts.slice(0, -1).join(".")}.${key}`
        : path;
      parent[key] = n;
      repairs.push({ path: displayPath, from: value, to: n });
    }
  }
  return repairs;
}

/**
 * Scan the project-level .n-dx.json for values stored with the wrong JSON
 * type (typically: numbers stored as strings by old write paths) and repair
 * them in place. Only rewrites the file when repairs are found.
 *
 * Returns { repairs } — a list of { path, from, to } entries. An empty list
 * means the config was already well-typed (or was missing).
 */
export async function repairProjectConfig(dir) {
  const configPath = join(dir, PROJECT_CONFIG_FILE);
  const current = await loadProjectConfigFile(dir, PROJECT_CONFIG_FILE);
  if (!current || Object.keys(current).length === 0) {
    return { repairs: [] };
  }
  const repairs = applyNumericRepairs(current);
  if (repairs.length > 0) {
    await saveProjectJSON(configPath, current);
  }
  return { repairs };
}

function isLocalProjectSetting(pkg, settingPath) {
  if (pkg === "claude") return settingPath === "cli_path";
  if (pkg === "llm") return settingPath.endsWith(".cli_path");
  return false;
}

/**
 * Load the local .n-dx.local.json config from the project root.
 * Returns an empty object if the file doesn't exist or is invalid.
 * Missing file is a silent no-op.
 */
async function loadLocalConfig(dir) {
  const configPath = join(dir, LOCAL_CONFIG_FILE);
  if (!(await fileExists(configPath))) return {};
  try {
    return await loadJSON(configPath);
  } catch {
    return {};
  }
}

/**
 * Load the effective project config: .n-dx.json deep-merged with
 * .n-dx.local.json (local wins).
 */
async function loadEffectiveProjectConfig(dir) {
  const projectConfig = await loadProjectConfig(dir);
  const localConfig = await loadLocalConfig(dir);
  if (Object.keys(localConfig).length === 0) return projectConfig;
  if (Object.keys(projectConfig).length === 0) return localConfig;
  return deepMerge(projectConfig, localConfig);
}

/**
 * Check if a key (in "section.path" format) should be written to .n-dx.local.json.
 */
function isMachineLocalKey(keyArg) {
  return MACHINE_LOCAL_KEYS.has(keyArg);
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
 * - If existing is undefined/null, auto-detect: numeric-shaped strings become
 *   numbers, "true"/"false" become booleans, anything else stays a string.
 *   This ensures first-time sets of numeric keys (e.g. cli.timeouts.work) are
 *   stored with the correct JSON type instead of as a string.
 * - Otherwise keep as string
 */
function coerceValue(newValue, existingValue) {
  if (existingValue === undefined || existingValue === null) {
    if (typeof newValue === "string") {
      if (NUMERIC_STRING_RE.test(newValue)) {
        const n = Number(newValue);
        if (Number.isFinite(n)) return n;
      }
      if (newValue === "true") return true;
      if (newValue === "false") return false;
    }
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
        "  Provide an absolute path to the Claude Code CLI binary.",
    );
  }
  try {
    await access(value, constants.X_OK);
  } catch {
    throw new Error(
      `File is not executable: ${value}\n` + "  Run: chmod +x " + value,
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
      `File is not executable: ${value}\n` + "  Run: chmod +x " + value,
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
        "  Get your key at: https://console.anthropic.com/settings/keys",
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
    const baseUrl = (endpoint || "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
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
        `Invalid protocol "${url.protocol}". Use http:// or https://.`,
      );
    }
  } catch (err) {
    if (err.message.startsWith("Invalid protocol")) throw err;
    throw new Error(
      `Invalid URL: "${value}"\n` +
        "  Provide a valid HTTP(S) URL (e.g., https://api.anthropic.com).",
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
      error:
        err.code === "ENOENT"
          ? `File not found: ${cliPath}`
          : `Failed to run: ${err.message}`,
    };
  }
}

/**
 * Default global CLI timeout in milliseconds (30 minutes).
 * Matches the value in cli-timeout.js — kept in sync manually.
 */
const CLI_TIMEOUT_DEFAULT_MS = 1800000;

/**
 * Known CLI timeout keys and their default values.
 * Used by handleGet to show defaults for unset keys.
 */
const CLI_TIMEOUT_DEFAULTS = {
  timeoutMs: CLI_TIMEOUT_DEFAULT_MS,
};

/**
 * Validate a CLI timeout value: must be a non-negative finite number.
 * Zero is valid and means "no timeout".
 * Exported for unit testing.
 */
export function validateTimeoutMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Timeout must be a number in milliseconds (0 = no timeout). Got: ${JSON.stringify(value)}`,
    );
  }
  if (value < 0) {
    throw new Error(
      `Timeout must be a non-negative number (0 = no timeout). Got: ${value}`,
    );
  }
}

/**
 * Look up the appropriate validator for a pkg + settingPath combination.
 * Returns null when no validator is registered for the path.
 */
function getValidator(pkg, settingPath) {
  if (pkg === "claude") return CLAUDE_VALIDATORS[settingPath] ?? null;
  if (pkg === "llm") return LLM_VALIDATORS[settingPath] ?? null;
  if (pkg === "cli") {
    if (settingPath === "timeoutMs") return validateTimeoutMs;
    if (settingPath.startsWith("timeouts.")) return validateTimeoutMs;
  }
  return null;
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
      args: ["exec", "--skip-git-repo-check", "Reply with exactly: ok"],
    };
  }

  const binary =
    llmConfig?.claude?.cli_path || legacyClaudeConfig?.cli_path || "claude";
  return {
    binary,
    args: ["-p", "Reply with exactly: ok", "--output-format", "json"],
  };
}

/**
 * Run provider auth preflight for the selected vendor.
 * Returns an object instead of throwing so callers can branch deterministically.
 */
function runVendorAuthPreflight(vendor, llmConfig, legacyClaudeConfig) {
  const { binary, args } = getVendorAuthPreflightCommand(
    vendor,
    llmConfig,
    legacyClaudeConfig,
  );
  try {
    // On Windows, shell: true is needed to resolve .cmd shims, but cmd.exe
    // re-parses arguments, splitting on spaces. Wrap args that contain spaces
    // in double-quotes so they survive the shell layer.
    const isWin = process.platform === "win32";
    const safeArgs = isWin
      ? args.map((a) => (a.includes(" ") ? `"${a}"` : a))
      : args;
    execFileSync(binary, safeArgs, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
      shell: isWin,
    });
    return { ok: true, binary, args };
  } catch (err) {
    const stderr =
      typeof err?.stderr === "string"
        ? err.stderr
        : Buffer.isBuffer(err?.stderr)
          ? err.stderr.toString("utf-8")
          : "";
    const stdout =
      typeof err?.stdout === "string"
        ? err.stdout
        : Buffer.isBuffer(err?.stdout)
          ? err.stdout.toString("utf-8")
          : "";
    const combined = stderr || stdout || err?.message || "";
    // Claude Code refuses to run nested inside another Claude Code session.
    // This error means the binary is present and the user is authenticated.
    if (
      combined.includes("cannot be launched inside another Claude Code session")
    ) {
      return { ok: true, binary, args };
    }
    const detail = combined.trim() || "unknown error";
    return {
      ok: false,
      binary,
      args,
      detail,
      errorCode: typeof err?.code === "string" ? err.code : undefined,
    };
  }
}

/**
 * Return the exact login command for the selected provider.
 */
function getVendorLoginCommand(vendor, llmConfig, legacyClaudeConfig) {
  const { binary } = getVendorAuthPreflightCommand(
    vendor,
    llmConfig,
    legacyClaudeConfig,
  );
  return `${binary} login`;
}

function isBareCommand(binary) {
  return (
    typeof binary === "string" &&
    binary.length > 0 &&
    !binary.includes("/") &&
    !binary.includes("\\")
  );
}

function hasClaudeAuthenticatedEvidence(detailLower) {
  return [
    "already authenticated",
    "already logged in",
    "logged in as",
    "authenticated as",
    "personal account authenticated",
    "enterprise account authenticated",
  ].some((phrase) => detailLower.includes(phrase));
}

function hasClaudeAuthRequiredEvidence(detailLower) {
  return (
    detailLower.includes("please login") ||
    detailLower.includes("not logged in") ||
    detailLower.includes("login required")
  );
}

function formatClaudePreflightFailure(preflight) {
  const detail = preflight.detail || "unknown error";
  const detailLower = detail.toLowerCase();
  const binary = preflight.binary;
  const retryCommand = "ndx config llm.vendor claude";

  if (preflight.errorCode === "ENOENT" || detail.includes("ENOENT")) {
    if (binary === "claude" || !isBareCommand(binary)) {
      return {
        code: "NDX_CLAUDE_PREFLIGHT_NOT_INSTALLED",
        lines: [
          "Install the Claude Code CLI before selecting Claude for this project.",
          "Install command: npm install -g @anthropic-ai/claude-code",
          `Verify installation: ${binary === "claude" ? "claude" : binary} --version`,
          `Retry after installation: ${retryCommand}`,
        ],
      };
    }

    return {
      code: "NDX_CLAUDE_PREFLIGHT_NOT_ON_PATH",
      lines: [
        "Verify what ndx can resolve from this shell and fix PATH resolution before retrying.",
        `Check PATH resolution: command -v ${binary}`,
        `If the binary exists elsewhere, either update PATH or set 'n-dx config llm.claude.cli_path /absolute/path/to/claude'.`,
        `Retry after fixing PATH: ${retryCommand}`,
      ],
    };
  }

  if (hasClaudeAuthenticatedEvidence(detailLower)) {
    return {
      code: "NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED",
      lines: [
        "Claude appears to be installed, but ndx could not launch a usable executable from this environment.",
        `Verify the executable ndx can launch: '${binary} --version'`,
        `If that succeeds, run the same binary directly with the preflight arguments and confirm it works outside ndx.`,
        "If ndx is resolving the wrong executable, update PATH or set 'n-dx config llm.claude.cli_path /absolute/path/to/claude'.",
        `Retry after fixing the executable resolution: ${retryCommand}`,
      ],
    };
  }

  if (hasClaudeAuthRequiredEvidence(detailLower)) {
    return {
      code: "NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED",
      lines: [
        `Next step: run '${getVendorLoginCommand("claude", { claude: { cli_path: binary } })}', then retry '${retryCommand}'.`,
      ],
    };
  }

  return {
    code: "NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED",
    lines: [
      "Claude appears to be installed, but ndx could not launch a usable executable from this environment.",
      `Verify the executable ndx can launch: '${binary} --version'`,
      `If that succeeds, run the same binary directly with the preflight arguments and confirm it works outside ndx.`,
      "If ndx is resolving the wrong executable, update PATH or set 'n-dx config llm.claude.cli_path /absolute/path/to/claude'.",
      `Retry after fixing the executable resolution: ${retryCommand}`,
    ],
  };
}

function printVendorPreflightFailure(
  vendor,
  preflight,
  llmConfig,
  legacyClaudeConfig,
) {
  console.error(
    `Provider auth preflight failed for "${vendor}" via: ${preflight.binary} ${preflight.args.join(" ")}`,
  );
  if (preflight.detail) {
    console.error(`Details: ${preflight.detail}`);
  }

  if (vendor !== "claude") {
    const loginCommand = getVendorLoginCommand(
      vendor,
      llmConfig,
      legacyClaudeConfig,
    );
    console.error(
      `Next step: run '${loginCommand}', then retry 'ndx config llm.vendor ${vendor}'.`,
    );
    return;
  }

  const classified = formatClaudePreflightFailure(preflight);
  console.error(`[${classified.code}]`);
  for (const line of classified.lines) {
    console.error(line);
  }
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
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
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
  hench.rollbackOnFailure  boolean   Revert uncommitted changes when a run fails (default: true)
                                     Set to false to keep changes in place on failure.
                                     The --no-rollback flag always overrides this for one run.
  hench.autoCommit         boolean   Let the agent commit itself at the end of a run (default: false)
                                     When false (default), hench stages changes and writes the
                                     proposed commit message to .hench-commit-msg.txt, then prompts
                                     you to approve before running 'git commit -F <file>'.
                                     Set to true for unattended 'ndx work --loop' runs — the agent
                                     runs 'git commit' directly so no approval prompt interrupts
                                     the loop.

Hench guard settings (security boundaries):
  hench.guard.blockedPaths       string[]  Glob patterns for blocked file paths
                                           (default: .hench/**, .rex/**, .git/**, node_modules/**)
  hench.guard.allowedCommands    string[]  Whitelisted shell commands
                                           (default: npm, npx, node, git, tsc, vitest)
  hench.guard.commandTimeout     number    Command timeout in ms (default: 30000)
  hench.guard.maxFileSize        number    Max file size in bytes (default: 1048576)

Sourcevision manifest (.sourcevision/manifest.json):
  sourcevision.*           (read-only, generated by analysis)

Claude settings (.n-dx.json / .n-dx.local.json — shared across all packages):
  claude.cli_path          string    Path to Claude Code CLI binary (optional)
                                    When set, hench uses this path instead of looking
                                    for "claude" on PATH. Validated: must exist and be
                                    executable. Use --force to skip validation.
                                    Stored in .n-dx.local.json.
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
  claude.lightModel        string    Model override for light-weight tasks (optional)
                                    When set, light-tier tasks use this model instead of
                                    the default haiku. Use for cost/latency optimization.
                                    Example: claude-haiku-4-20250414

LLM vendor settings (.n-dx.json / .n-dx.local.json — preferred for multi-vendor setup):
  llm.vendor               string    Active LLM vendor: "claude" or "codex"
                                    Required for multi-vendor workflows.
  llm.claude.cli_path      string    Claude CLI path (optional; validated executable)
                                    Stored in .n-dx.local.json.
  llm.claude.api_key       string    Claude API key (optional)
  llm.claude.api_endpoint  string    Claude API endpoint (optional; validated URL)
  llm.claude.model         string    Claude default model (optional)
  llm.claude.lightModel    string    Claude model for light-weight tasks (optional)
                                    When set, commands that explicitly opt into the
                                    light tier use this model. Falls back
                                    to claude-haiku-4-20250414 if not set.
  llm.codex.cli_path       string    Codex CLI path (optional; validated executable)
                                    Stored in .n-dx.local.json.
  llm.codex.api_key        string    Codex API key (optional)
  llm.codex.api_endpoint   string    Codex API endpoint (optional; validated URL)
  llm.codex.model          string    Codex default model (optional)
  llm.codex.lightModel     string    Codex model for light-weight tasks (optional)
                                    When set, commands that explicitly opt into the
                                    light tier use this model.
                                    Falls back to gpt-5.4-mini if not set.

Claude preflight error codes:
  NDX_CLAUDE_PREFLIGHT_NOT_INSTALLED  Claude CLI is not installed; install it before retrying
  NDX_CLAUDE_PREFLIGHT_NOT_ON_PATH    Configured Claude command is not resolvable on PATH
  NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED  Claude CLI is present but needs authentication
  NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED  Claude appears authenticated/installed, but ndx cannot launch a usable executable

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

Sourcevision zone overrides (.n-dx.json):
  sourcevision.zones.pins  object    Override zone assignments: {"file/path.ts": "zone-id"}
  sourcevision.zones.mergeThreshold
                           number    Min zone size for small-zone merge (default: 3)

CLI settings (.n-dx.json):
  cli.claudePath           string    Path to the Claude Code CLI binary (optional).
                                     Overrides all discovery heuristics (PATH, nvm,
                                     Homebrew, etc.). Set this when claude is installed
                                     in a non-standard location and ndx init cannot
                                     locate it automatically. The value is NOT validated
                                     on set — use --force to skip validation on other
                                     keys, or set directly in .n-dx.json.
                                     Example: n-dx config cli.claudePath /usr/local/bin/claude
  cli.timeoutMs            number    Global command timeout in milliseconds.
                                     Default: 1800000 (30 minutes). Commands that exceed
                                     this limit are terminated with an error suggesting how
                                     to raise the limit. Set to 0 to disable the global
                                     timeout entirely.
                                     Exceptions: "work" and "self-heal" default to 14400000
                                     (4 hours); "start", "web", and "dev" have no default
                                     timeout (they run until stopped).
                                     Validation: must be a non-negative integer.
                                     Example: n-dx config cli.timeoutMs 3600000
  cli.timeouts.<command>   number    Per-command timeout override in milliseconds.
                                     Overrides cli.timeoutMs for the named command.
                                     0 = no timeout for that command.
                                     Validation: must be a non-negative integer.
                                     Examples:
                                       n-dx config cli.timeouts.work 7200000
                                       n-dx config cli.timeouts.analyze 300000
                                       n-dx config cli.timeouts.start 0

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

Local overrides (.n-dx.local.json):
  Place a .n-dx.local.json file at the project root for machine-specific
  settings (e.g. CLI paths with absolute locations). This file is gitignored
  by default (added during ndx init) so each developer can have their own
  settings without conflicts. Deep-merged over .n-dx.json (local wins).

  Machine-specific keys (claude.cli_path, llm.claude.cli_path, llm.codex.cli_path)
  are automatically written to .n-dx.local.json instead of .n-dx.json.

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
  const projectConfig = await loadEffectiveProjectConfig(dir);
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
    console.error(
      "No Claude configuration set. Use 'n-dx config claude.api_key <key>' or 'n-dx config claude.cli_path <path>' first.",
    );
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
      console.log(
        `Testing API key... ✓ API key is valid (endpoint: ${endpoint}).`,
      );
    } else {
      console.error("Testing API key... ✗ " + result.error);
      hasFailure = true;
    }
  }

  if (claudeConfig.cli_path) {
    tested = true;
    const result = testCliPath(claudeConfig.cli_path);
    if (result.ok) {
      console.log(
        "Testing CLI path... ✓ " + (result.version || "CLI is available."),
      );
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
async function coerceAndValidateProjectValue(
  pkg,
  settingPath,
  valueArg,
  keyArg,
  configs,
  flags,
) {
  const existing = getByPath(configs[pkg], settingPath);
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    console.error(
      `Cannot set "${keyArg}" — it's an object. Set individual keys instead.`,
    );
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
  if (flags.force !== "true") {
    const validator = getValidator(pkg, settingPath);
    if (validator) {
      try {
        await validator(coerced);
      } catch (err) {
        console.error(`Invalid value for "${keyArg}": ${err.message}`);
        console.error("  Use --force to set this value anyway.");
        process.exit(1);
      }
    }
  }

  return coerced;
}

/** Run vendor auth preflight when setting llm.vendor. */
function runLLMVendorPreflight(coerced, configs) {
  const currentLLM =
    configs.llm && typeof configs.llm === "object" ? configs.llm : {};
  const llmForPreflight = { ...currentLLM, vendor: coerced };
  const legacyClaude =
    configs.claude && typeof configs.claude === "object"
      ? configs.claude
      : undefined;

  const preflight = runVendorAuthPreflight(
    coerced,
    llmForPreflight,
    legacyClaude,
  );
  if (!preflight.ok) {
    printVendorPreflightFailure(
      coerced,
      preflight,
      llmForPreflight,
      legacyClaude,
    );
    process.exit(1);
  }
}

/** Handle SET mode for a project-level section (claude, llm, web, features). */
async function handleSetProjectSection(
  dir,
  pkg,
  settingPath,
  keyArg,
  valueArg,
  configs,
  flags,
) {
  if (!configs[pkg]) configs[pkg] = {};

  const coerced = await coerceAndValidateProjectValue(
    pkg,
    settingPath,
    valueArg,
    keyArg,
    configs,
    flags,
  );

  // Vendor auth preflight for llm.vendor
  if (pkg === "llm" && settingPath === "vendor") {
    runLLMVendorPreflight(coerced, configs);
  }

  setByPath(configs[pkg], settingPath, coerced);

  const targetFile = isLocalProjectSetting(pkg, settingPath)
    ? LOCAL_CONFIG_FILE
    : PROJECT_CONFIG_FILE;
  const configPath = join(dir, targetFile);
  const current = await loadProjectConfigFile(dir, targetFile);
  if (!current[pkg] || typeof current[pkg] !== "object") {
    current[pkg] = {};
  }

  // Vendor-change model reset: capture old values before setting new vendor
  let warningMessages = [];
  let oldVendor, oldClaudeModel, oldCodexModel;
  if (pkg === "llm" && settingPath === "vendor") {
    // Capture old values before overwriting
    oldVendor = current[pkg].vendor;
    oldClaudeModel = current[pkg].claude?.model;
    oldCodexModel = current[pkg].codex?.model;
  }

  setByPath(current[pkg], settingPath, coerced);

  // Now perform vendor-change model reset if needed
  if (pkg === "llm" && settingPath === "vendor") {
    const { resetStaleModel, formatVendorChangeWarning, NEWEST_MODELS } =
      await import("@n-dx/llm-client");

    // Check if Claude model needs to be reset
    const claudeReset = resetStaleModel(oldVendor, oldClaudeModel, coerced);
    if (claudeReset.changed) {
      if (current[pkg].claude) {
        delete current[pkg].claude.model;
      }
      const warning = formatVendorChangeWarning(
        claudeReset,
        NEWEST_MODELS.claude,
      );
      if (warning) warningMessages.push(warning);
    }

    // Check if Codex model needs to be reset
    const codexReset = resetStaleModel(oldVendor, oldCodexModel, coerced);
    if (codexReset.changed) {
      if (current[pkg].codex) {
        delete current[pkg].codex.model;
      }
      const warning = formatVendorChangeWarning(
        codexReset,
        NEWEST_MODELS.codex,
      );
      if (warning) warningMessages.push(warning);
    }
  }

  // Compatibility: keep legacy claude.* in sync when setting llm.claude.*
  if (pkg === "llm" && settingPath.startsWith("claude.")) {
    if (!current.claude || typeof current.claude !== "object") {
      current.claude = {};
    }
    const legacySetting = settingPath.slice("claude.".length);
    setByPath(current.claude, legacySetting, coerced);
  }

  // Write back to the appropriate file (local or project)
  await saveProjectJSON(configPath, current);
  console.log(`${keyArg} = ${formatValue(coerced)}`);

  // Print warnings for cleared models
  for (const warning of warningMessages) {
    console.log(`  ⚠ ${warning.split("\n").join("\n  ")}`);
  }
}

/** Handle SET mode for a package config (rex, hench). */
async function handleSetPackageConfig(
  dir,
  pkg,
  settingPath,
  keyArg,
  valueArg,
  configs,
  rawConfigs,
) {
  if (!PACKAGES[pkg]) {
    console.error(
      `Unknown package "${pkg}". Available: ${[...Object.keys(PACKAGES), ...PROJECT_SECTIONS].join(", ")}`,
    );
    process.exit(1);
  }

  if (pkg === "sourcevision") {
    console.error(
      "Sourcevision manifest is read-only (generated by analysis).",
    );
    process.exit(1);
  }

  if (!configs[pkg]) {
    console.error(
      `Package "${pkg}" is not initialized. Run 'n-dx init' first.`,
    );
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
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    console.error(
      `Cannot set "${keyArg}" — it's an object. Set individual keys instead.`,
    );
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
        console.error(
          `No ${pkg} configuration set. Use 'n-dx config ${pkg}.<key> <value>' to add settings.`,
        );
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
    const defaultValue = getProjectKeyDefault(pkg, settingPath);
    if (defaultValue !== null) {
      printKeyDefault(defaultValue, flags);
      return;
    }
    if (PROJECT_SECTIONS.has(pkg)) {
      console.error(`Key "${keyArg}" not found.`);
    } else {
      console.error(`Package "${pkg}" is not initialized or has no config.`);
    }
    process.exit(1);
  }

  const value = getByPath(configs[pkg], settingPath);
  if (value === undefined) {
    const defaultValue = getProjectKeyDefault(pkg, settingPath);
    if (defaultValue !== null) {
      printKeyDefault(defaultValue, flags);
      return;
    }
    console.error(`Key "${keyArg}" not found.`);
    process.exit(1);
  }

  if (flags.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(formatValue(value));
  }
}

/**
 * Return the known default value for a project-section key, or null if unknown.
 * Used to show helpful defaults when a key hasn't been set yet.
 */
function getProjectKeyDefault(pkg, settingPath) {
  if (pkg === "cli" && settingPath in CLI_TIMEOUT_DEFAULTS) {
    return CLI_TIMEOUT_DEFAULTS[settingPath];
  }
  return null;
}

/**
 * Print a default value for an unset key, noting that it's the default.
 */
function printKeyDefault(defaultValue, flags) {
  if (flags.json) {
    console.log(JSON.stringify(defaultValue));
  } else {
    console.log(`${formatValue(defaultValue)}  (default, not set in config)`);
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
      const current = await loadProjectConfigFile(dir, PROJECT_CONFIG_FILE);
      current.language = valueArg;
      await saveProjectJSON(configPath, current);
      console.log(`language = ${valueArg}`);
      return;
    }

    const dotIdx = keyArg.indexOf(".");
    if (dotIdx === -1) {
      console.error(
        `Invalid key "${keyArg}". Use dot notation: <package>.<setting>`,
      );
      process.exit(1);
    }

    const pkg = keyArg.slice(0, dotIdx);
    const settingPath = keyArg.slice(dotIdx + 1);

    if (PROJECT_SECTIONS.has(pkg)) {
      await handleSetProjectSection(
        dir,
        pkg,
        settingPath,
        keyArg,
        valueArg,
        configs,
        flags,
      );
    } else {
      await handleSetPackageConfig(
        dir,
        pkg,
        settingPath,
        keyArg,
        valueArg,
        configs,
        rawConfigs,
      );
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
