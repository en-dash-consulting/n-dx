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
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSyncCli } from "./win-spawn.js";
import { relativeToRoot, resolveLayout } from "./layout.js";
import {
  describeUnrestrictedFile,
  restrictFileToOwner,
} from "./file-permissions.js";
export { quoteWindowsToken, buildWindowsCliCommandLine } from "./win-spawn.js";

/**
 * The two project config files, as selector tokens.
 *
 * These are *which file*, not *where it is*: on the `.ndx/` layout the shared
 * one is `.ndx/config.json` and the local one `.ndx/config.local.json`. Pass a
 * token to {@link projectConfigPath} to get the path, or to
 * {@link projectConfigLabel} to get the name to print. Nothing joins them to a
 * root directly — that is what made the layout a decision taken here rather
 * than by the resolver.
 */
export const PROJECT_CONFIG_FILE = "shared";

/**
 * The untracked file every API key `ndx config` writes ends up in.
 *
 * Exported because `ndx ci` checks that git is not tracking it: its whole
 * safety rests on being ignored, so the selector has to be the same token in
 * both places rather than two literals that can drift.
 */
export const LOCAL_CONFIG_FILE = "local";

/**
 * Where a project config file lives, for the layout this project is on.
 *
 * @param {string} dir  Project root.
 * @param {string} which  {@link PROJECT_CONFIG_FILE} or {@link LOCAL_CONFIG_FILE}.
 * @returns {string} Absolute path.
 */
export function projectConfigPath(dir, which) {
  const layout = resolveLayout(dir);
  return which === LOCAL_CONFIG_FILE ? layout.localConfigFile : layout.configFile;
}

/**
 * What to call a project config file in a message the operator reads.
 *
 * Root-relative, so it is a path they can act on: a warning that says to move a
 * key into `.n-dx.local.json` sends them to a file that does not exist on a
 * project whose config lives in `.ndx/`.
 *
 * @param {string} dir  Project root.
 * @param {string} which  {@link PROJECT_CONFIG_FILE} or {@link LOCAL_CONFIG_FILE}.
 * @returns {string}
 */
export function projectConfigLabel(dir, which) {
  return relativeToRoot(resolveLayout(dir), projectConfigPath(dir, which));
}

const LLM_VENDOR = {
  CLAUDE: "claude",
  CODEX: "codex",
  GOOGLE: "google",
  LOCAL: "local",
};

const LLM_VENDORS = Object.values(LLM_VENDOR);

/**
 * How the API-key file is actually protected on this platform.
 *
 * Stated per-platform because the help text used to promise "0600 (owner-only)"
 * everywhere. On Windows that was false: `fs.chmod` cannot express a POSIX mode
 * and leaves the DACL untouched, so the key stayed readable by other users while
 * the docs said otherwise. See file-permissions.js.
 */
const API_KEY_PERMISSION_NOTE = process.platform === "win32"
  ? "File ACL restricted to your user account (verified; warns if it cannot be)."
  : "File permissions set to 0600 (owner-only) for security.";

/**
 * Settings that are written to .n-dx.local.json instead of .n-dx.json.
 *
 * Two kinds live here, for two different reasons:
 *
 * - **Machine-specific paths** (`*.cli_path`) differ per developer machine, so
 *   sharing them through git would break a teammate's checkout.
 * - **Secrets** (`*.api_key`). `.n-dx.json` is meant to be committed — it
 *   carries zone pins, the vendor, the dashboard port — and `ndx init` never
 *   gitignores it. A key written there is one `git add -A` away from the
 *   remote. `.n-dx.local.json` is gitignored by init and by the shipped
 *   template, and every reader already merges it over the shared file.
 *
 * Keyed by section, then by the setting path within that section. `llm`
 * entries are matched by suffix so `llm.claude.api_key`, `llm.codex.api_key`
 * and `llm.google.api_key` all route without listing each vendor.
 */
const LOCAL_ONLY_SETTINGS = {
  claude: new Set(["cli_path", "api_key"]),
  llm: { suffixes: [".cli_path", ".api_key"] },
};

/** Setting-path leaf that marks a secret, for the shared-file scan. */
const SECRET_SETTING_LEAF = "api_key";

/**
 * The per-package config files, named by the {@link Layout} field that holds
 * each package's state directory rather than by the directory itself — `.rex`
 * is one layout's answer, and a config read that assumed it would report a
 * `.ndx/` project as uninitialized.
 */
const PACKAGES = {
  rex: { layoutField: "rexDir", file: "config.json" },
  hench: { layoutField: "henchDir", file: "config.json" },
  sourcevision: { layoutField: "sourcevisionDir", file: "manifest.json" },
};

/**
 * Path to a package's own config file inside a project.
 *
 * @param {string} dir  Project root.
 * @param {keyof typeof PACKAGES} pkg
 * @returns {string}
 */
function packageConfigPath(dir, pkg) {
  const meta = PACKAGES[pkg];
  return join(resolveLayout(dir)[meta.layoutField], meta.file);
}

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
  "selfHeal",
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
 * Save .n-dx.json restricted to its owner when it contains sensitive data like
 * API keys. Otherwise uses standard permissions.
 *
 * Restriction is attempted AND verified (see file-permissions.js): on Windows a
 * bare `chmod(path, 0o600)` changes nothing about who can read the file, so a
 * silent chmod would have left the key exposed while appearing to protect it.
 * When verification fails the user is told, because a false assurance about an
 * API key is worse than a stated limitation.
 */
async function saveProjectJSON(path, data) {
  await saveJSON(path, data);
  const hasSensitiveData =
    (data?.claude?.api_key && typeof data.claude.api_key === "string") ||
    (data?.llm?.claude?.api_key &&
      typeof data.llm.claude.api_key === "string") ||
    (data?.llm?.codex?.api_key && typeof data.llm.codex.api_key === "string") ||
    (data?.llm?.google?.api_key && typeof data.llm.google.api_key === "string");
  if (!hasSensitiveData) return;

  const result = await restrictFileToOwner(path);
  const warning = describeUnrestrictedFile(path, result);
  if (warning) process.stderr.write(`${warning}\n`);
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
async function loadProjectConfigFile(dir, which) {
  return loadOptionalJSON(projectConfigPath(dir, which));
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
  const configPath = projectConfigPath(dir, PROJECT_CONFIG_FILE);
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
  const rule = LOCAL_ONLY_SETTINGS[pkg];
  if (!rule) return false;
  if (rule instanceof Set) return rule.has(settingPath);
  return rule.suffixes.some((suffix) => settingPath.endsWith(suffix));
}

/**
 * Find API keys stored in the shared `.n-dx.json`.
 *
 * Returns dotted keys in the same `section.path` form `ndx config` accepts
 * (e.g. `llm.claude.api_key`), so the warning can tell the user exactly what
 * to re-run. Only the shared file is scanned — that is the one that gets
 * committed. Missing or unparseable file yields an empty list.
 *
 * @param {string} dir Project root.
 * @returns {Promise<string[]>}
 */
export async function findSharedSecrets(dir) {
  const shared = await loadProjectConfigFile(dir, PROJECT_CONFIG_FILE);
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (key === SECRET_SETTING_LEAF && typeof value === "string" && value.length > 0) {
        found.push(here);
      } else {
        walk(value, here);
      }
    }
  };
  walk(shared, "");
  return found;
}

/**
 * Format the stderr warning for keys that `findSharedSecrets` found.
 *
 * @param {string[]} keys
 * @param {string} dir  Project root — the warning names both files, and which
 *   paths those are is the layout's answer.
 * @returns {string[]} Lines, empty when there is nothing to warn about.
 */
export function formatSharedSecretsWarning(keys, dir) {
  if (keys.length === 0) return [];
  const shared = projectConfigLabel(dir, PROJECT_CONFIG_FILE);
  const local = projectConfigLabel(dir, LOCAL_CONFIG_FILE);
  return [
    `Warning: ${shared} contains ${keys.length === 1 ? "an API key" : "API keys"} (${keys.join(", ")}).`,
    `  That file is meant to be committed. Keys belong in ${local}, which is gitignored.`,
    `  Fix: re-run \`ndx config <key> <value>\` for each key above — it is written to ${local}`,
    `  and removed from ${shared}. If ${shared} was ever committed, rotate the key.`,
  ];
}

/**
 * Load the local .n-dx.local.json config from the project root.
 * Returns an empty object if the file doesn't exist or is invalid.
 * Missing file is a silent no-op.
 */
async function loadLocalConfig(dir) {
  const configPath = projectConfigPath(dir, LOCAL_CONFIG_FILE);
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
/**
 * Sections under `llm` that hold a flat map keyed by task class.
 *
 * Task classes contain dots (`agent.execute`, `prd.rename`), and so does the
 * config path syntax — so `llm.routes.agent.execute` must set the single key
 * `"agent.execute"` in a flat `routes` object, not nest `{agent: {execute}}`.
 * Nesting would write config that {@link loadLLMConfig}'s flat-map extractor
 * silently ignores, so the setting would appear to work and do nothing.
 */
const LLM_FLAT_MAP_SECTIONS = ["routes.", "effort."];

/**
 * Split a section-relative setting path into object keys.
 *
 * Identical to `path.split(".")` except inside the flat-map sections above,
 * where everything after the section name is one literal key.
 *
 * @param {string} settingPath Path within the section (no package prefix).
 * @param {string} [pkg] Owning section, when known.
 * @returns {string[]}
 */
function splitSettingPath(settingPath, pkg) {
  if (pkg === "llm") {
    for (const prefix of LLM_FLAT_MAP_SECTIONS) {
      if (settingPath.startsWith(prefix) && settingPath.length > prefix.length) {
        return [prefix.slice(0, -1), settingPath.slice(prefix.length)];
      }
    }
  }
  return settingPath.split(".");
}

function getByPath(obj, path, pkg) {
  const parts = splitSettingPath(path, pkg);
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
function setByPath(obj, path, value, pkg) {
  const parts = splitSettingPath(path, pkg);
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
 * Whether an executable-bit check is meaningful on this platform.
 *
 * SKIPPED BY DESIGN ON WINDOWS. NTFS has no executable bit, and Node documents
 * `fs.constants.X_OK` as having no effect there — it degrades to `F_OK`.
 * Measured: `access("key.json", X_OK)` SUCCEEDS for a plain JSON file, so the
 * check cannot reject anything and its "Run: chmod +x" hint is nonsense advice
 * on Windows.
 *
 * REJECTED ALTERNATIVE: requiring a PATHEXT extension (.exe/.cmd/.bat). It would
 * reject real binaries — as win-spawn.js documents, pnpm/npm global installs
 * place an extensionless POSIX script beside the `.CMD` shim, and users
 * legitimately point cli_path at either. A validation that rejects valid input is
 * worse than no validation, so existence (F_OK) is the honest limit here and
 * spawn-time diagnostics (diagnoseCliInvocation) cover the rest.
 */
function executableBitIsMeaningful(platform = process.platform) {
  return platform !== "win32";
}

/**
 * Validate claude.cli_path: check the file exists and — on POSIX — is executable.
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
  if (executableBitIsMeaningful()) {
    try {
      await access(value, constants.X_OK);
    } catch {
      throw new Error(
        `File is not executable: ${value}\n` + "  Run: chmod +x " + value,
      );
    }
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

  if (executableBitIsMeaningful()) {
    try {
      await access(value, constants.X_OK);
    } catch {
      throw new Error(
        `File is not executable: ${value}\n` + "  Run: chmod +x " + value,
      );
    }
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
        model: model || "claude-sonnet-5-5",
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
 * Validate llm.google.api_key: check the format matches the Google AI key pattern.
 * Google API keys start with "AIza" and are at least 30 characters.
 * Throws with a helpful message on failure.
 *
 * Exported for unit testing; internal use also via LLM_VALIDATORS.
 */
export function validateGoogleApiKey(value) {
  if (typeof value !== "string" || !isValidGoogleApiKeyFormat(value)) {
    throw new Error(
      `Invalid API key format. Google AI keys start with "AIza" or "AQ" and are at least 30 characters.\n` +
        "  Get your key at: https://aistudio.google.com/apikey",
    );
  }
}

/**
 * Check whether a string matches the expected Google AI / Gemini API key format.
 *
 * Google issues keys with two prefixes: the legacy "AIza" prefix and the newer
 * "AQ" prefix. Both are at least 30 characters.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidGoogleApiKeyFormat(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("AIza") || value.startsWith("AQ")) &&
    value.length >= 30
  );
}

/**
 * Run a lightweight preflight call to the Gemini API to validate the API key.
 *
 * Reads the API key from llmConfig.google.api_key or the GEMINI_API_KEY env var.
 * Returns { ok: true } on success, or { ok: false, detail, errorCode } on failure.
 *
 * Test bypass: set NDX_TEST_GOOGLE_PREFLIGHT=ok to skip the HTTP call (for integration
 * tests that cannot make real Gemini API requests).
 *
 * @param {object} llmConfig  Contents of .n-dx.json llm section
 * @returns {Promise<{ ok: boolean, vendor: "google", detail?: string, errorCode?: string }>}
 */
async function runGoogleApiPreflight(llmConfig) {
  // Test bypass: allows integration tests to simulate successful auth without HTTP
  if (process.env.NDX_TEST_GOOGLE_PREFLIGHT === "ok") {
    return { ok: true, vendor: LLM_VENDOR.GOOGLE };
  }

  const apiKeyEnvVar = llmConfig?.google?.apiKeyEnv || "GEMINI_API_KEY";
  const apiKey = llmConfig?.google?.api_key || process.env[apiKeyEnvVar];

  if (!apiKey) {
    return {
      ok: false,
      vendor: LLM_VENDOR.GOOGLE,
      detail:
        `No API key found. Set the ${apiKeyEnvVar} environment variable or store the key with: ` +
        "n-dx config llm.google.api_key <key>",
      errorCode: "NDX_GOOGLE_PREFLIGHT_NO_KEY",
    };
  }

  if (!isValidGoogleApiKeyFormat(apiKey)) {
    return {
      ok: false,
      vendor: LLM_VENDOR.GOOGLE,
      detail: `API key format is invalid. Google AI keys start with "AIza" or "AQ" and are at least 30 characters.`,
      errorCode: "NDX_GOOGLE_PREFLIGHT_INVALID_KEY_FORMAT",
    };
  }

  // Lightweight live call: list models (pageSize=1 minimises response size)
  try {
    // Send the key in the x-goog-api-key header, not the URL query string, so it
    // is not captured by proxies or egress logs. Matches google-api-provider.ts.
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1`;
    const resp = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      return { ok: true, vendor: LLM_VENDOR.GOOGLE };
    }
    let detail;
    if (resp.status === 400) {
      detail = "API key is invalid or malformed.";
    } else if (resp.status === 403) {
      detail = "API key is not authorised for the Generative Language API. Ensure the API is enabled in your Google Cloud project.";
    } else {
      detail = `Gemini API returned HTTP ${resp.status}.`;
    }
    return {
      ok: false,
      vendor: LLM_VENDOR.GOOGLE,
      detail,
      errorCode: (resp.status === 400 || resp.status === 403)
        ? "NDX_GOOGLE_PREFLIGHT_AUTH_FAILED"
        : "NDX_GOOGLE_PREFLIGHT_HTTP_ERROR",
      statusCode: resp.status,
    };
  } catch (err) {
    return {
      ok: false,
      vendor: LLM_VENDOR.GOOGLE,
      detail: err?.message || "Failed to connect to the Gemini API.",
      errorCode: "NDX_GOOGLE_PREFLIGHT_CONNECT_ERROR",
    };
  }
}

/**
 * Check reachability of a local LM Studio (or compatible) server.
 */
async function runLocalApiPreflight(llmConfig) {
  const host = llmConfig?.local?.host || "localhost";
  const port = llmConfig?.local?.port || 1234;
  const baseUrl = `http://${host}:${port}/v1`;

  try {
    const resp = await fetch(`${baseUrl}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      return { ok: true, vendor: LLM_VENDOR.LOCAL };
    }
    return {
      ok: false,
      vendor: LLM_VENDOR.LOCAL,
      detail: `Local server at ${baseUrl} returned HTTP ${resp.status}. Ensure LM Studio (or your local server) is running.`,
      errorCode: "NDX_LOCAL_PREFLIGHT_HTTP_ERROR",
    };
  } catch (err) {
    return {
      ok: false,
      vendor: LLM_VENDOR.LOCAL,
      detail: `Cannot connect to local server at ${baseUrl}. ` +
        `Start LM Studio and enable "Local Server" in the Developer tab, then try again.`,
      errorCode: "NDX_LOCAL_PREFLIGHT_CONNECT_ERROR",
    };
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
 * Validate llm.google.model: must be a non-empty string starting with "gemini-".
 *
 * Gemini model IDs all start with "gemini-" (e.g. "gemini-2.5-pro",
 * "gemini-3.7-flash"). IDs from other vendors (e.g. "gpt-5.6-terra", "claude-sonnet-*")
 * are rejected immediately.
 *
 * Canonical known models (from @n-dx/llm-client GOOGLE_MODELS):
 *   gemini-3.5-flash-lite  (light tier)
 *   gemini-3.7-flash       (standard tier)
 *   gemini-2.5-pro         (heavy tier)
 *
 * This list will grow as Google releases new models. The prefix check ("gemini-")
 * allows unknown future models while still catching clearly wrong values.
 */
function validateGeminiModelField(value, fieldKey) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid value for llm.google.${fieldKey}: model ID must be a non-empty string.\n` +
        "  Known models: gemini-3.5-flash-lite (light), gemini-3.7-flash (standard), gemini-2.5-pro (heavy)",
    );
  }
  if (!value.startsWith("gemini-")) {
    throw new Error(
      `Invalid value for llm.google.${fieldKey}: "${value}" is not a Gemini model ID.\n` +
        '  Gemini model IDs must start with "gemini-" (e.g. "gemini-2.5-pro", "gemini-3.7-flash").\n' +
        "  Known models: gemini-3.5-flash-lite (light), gemini-3.7-flash (standard), gemini-2.5-pro (heavy)",
    );
  }
}

function validateGoogleModel(value) {
  validateGeminiModelField(value, "model");
}

/**
 * Validate llm.google.lightModel: a Gemini model ID used for light-tier tasks
 * (analysis, classification). Same rules as llm.google.model.
 */
function validateGoogleLightModel(value) {
  validateGeminiModelField(value, "lightModel");
}

/**
 * Validate llm.google.apiKeyEnv: must be a non-empty string.
 * This is the name of the environment variable that holds the Google API key.
 */
function validateGoogleApiKeyEnv(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "llm.google.apiKeyEnv must be a non-empty string (environment variable name).\n" +
        "  Example: n-dx config llm.google.apiKeyEnv MY_GOOGLE_API_KEY",
    );
  }
}


/**
 * Validate CLI path by trying to run `<binary> --version`.
 * Returns { ok, version?, error? }.
 */
function testCliPath(cliPath) {
  try {
    const output = execFileSyncCli(cliPath, ["--version"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
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
/**
 * Environment additions that carry BETA experimental settings into spawned CLIs.
 *
 * Returns `{}` unless a flag is explicitly enabled, so the common case leaves a
 * child's environment untouched.
 *
 * This translation belongs to the orchestration tier: the foundation code that
 * acts on the flag (llm-client's `exec`) must not read `.n-dx.json` itself, and a
 * sub-CLI runs in its own process where an in-memory option could not reach it.
 * Kept as a pure function so the decision is testable without spawning anything.
 *
 * `experimental.posixFreezeTreeKill` must be boolean `true`. A truthy string does
 * NOT enable it: an experimental default-off switch should require a deliberate
 * value, and `ndx config` coerces "true" to a boolean anyway.
 *
 * @param {Record<string, unknown>} [projectConfig] Merged project config.
 * @returns {Record<string, string>} Env fragment to spread over a child's env.
 */
export function experimentalEnv(projectConfig) {
  const experimental = projectConfig?.experimental;
  if (experimental?.posixFreezeTreeKill === true) {
    return { NDX_POSIX_FREEZE_KILL: "1" };
  }
  return {};
}

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
  if (pkg === "llm") {
    return LLM_VALIDATORS[settingPath] ?? getLLMRoutingValidator(settingPath);
  }
  if (pkg === "cli") {
    if (settingPath === "timeoutMs") return validateTimeoutMs;
    if (settingPath.startsWith("timeouts.")) return validateTimeoutMs;
  }
  if (pkg === "selfHeal") return SELF_HEAL_VALIDATORS[settingPath] ?? null;
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
  if (!LLM_VENDORS.includes(value)) {
    throw new Error(
      `Invalid vendor "${value}". Expected one of: ${LLM_VENDORS.join(", ")}.`,
    );
  }
}

/**
 * Validate llm.autoFailover.
 */
function validateAutoFailover(value) {
  if (typeof value !== "boolean") {
    throw new Error(
      `Invalid autoFailover value. Expected "true" or "false", got "${value}"`,
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
  "google.api_key": validateGoogleApiKey,
  "google.api_endpoint": validateApiEndpoint,
  "google.model": validateGoogleModel,
  "google.lightModel": validateGoogleLightModel,
  "google.apiKeyEnv": validateGoogleApiKeyEnv,
  // local — LM Studio / OpenAI-compatible local server
  "local.host": (v) => {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`Invalid local.host "${v}". Expected a non-empty hostname.`);
    }
  },
  "local.port": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`Invalid local.port "${v}". Expected an integer between 1 and 65535.`);
    }
  },
  "local.model": validateModel,
  "local.lightModel": validateModel,
  "local.maxContextTokens": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Invalid local.maxContextTokens "${v}". Expected a positive integer (e.g. 32768).`);
    }
  },
  "local.timeoutMs": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Invalid local.timeoutMs "${v}". Expected a non-negative integer in milliseconds ` +
        `(e.g. 7200000 for 2 hours), or 0 for no timeout.`,
      );
    }
  },
  "local.verifier.host": (v) => {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`Invalid local.verifier.host "${v}". Expected a non-empty hostname.`);
    }
  },
  "local.verifier.port": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`Invalid local.verifier.port "${v}". Expected an integer between 1 and 65535.`);
    }
  },
  "local.verifier.model": validateModel,
  "local.verifier.maxCycles": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Invalid local.verifier.maxCycles "${v}". Expected a positive integer (e.g. 2).`);
    }
  },
  autoFailover: validateAutoFailover,
  "escalation.enabled": (v) => {
    if (v !== true && v !== false && v !== "true" && v !== "false") {
      throw new Error(
        `Invalid llm.escalation.enabled "${v}". Expected true or false.`,
      );
    }
  },
  "escalation.maxSteps": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Invalid llm.escalation.maxSteps "${v}". Expected a non-negative integer ` +
          "(0 disables escalation; 1 is the recommended single step).",
      );
    }
  },
};

/**
 * Routing tiers a `llm.routes.<class>` value may name.
 *
 * Duplicated from `@n-dx/llm-client` rather than imported: orchestration-tier
 * scripts must not import from packages, which is why `LLM_VENDOR` above is
 * declared locally too. Keep in sync with `TaskTier` in `llm-client`.
 */
const TASK_TIERS = new Set(["light", "standard", "heavy", "free"]);

/**
 * Effort levels a `llm.effort.<class>` value may name — the vendor's
 * documented range for adaptive-thinking models. Light-tier models have no
 * effort parameter, so an effort entry for a light-routed class is inert
 * rather than invalid.
 */
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * Known task classes and the tier each routes to by default.
 *
 * Duplicated from `DEFAULT_ROUTES` in `@n-dx/llm-client` rather than imported:
 * orchestration-tier scripts must not import from packages, which is why
 * `LLM_VENDOR` and the tier/effort sets above are declared locally too. The
 * copy is not trusted to stay correct on its own — `tests/integration/
 * task-class-sync.test.js` fails when it drifts from the registry.
 *
 * Used for two things only, both advisory: listing the classes in `--help`,
 * and telling a user who mistypes one that their route will never match.
 * Routing itself never consults this — an unknown class is written as given,
 * because glob keys and classes newer than this copy must keep working.
 */
export const TASK_CLASSES = {
  // hench
  "agent.execute": "standard",
  "git.commit-message": "light",
  "context.summarize": "light",
  "context.distill": "standard",
  // rex
  "prd.propose": "standard",
  "prd.consolidate-check": "light",
  "prd.decompose": "light",
  "prd.rename": "light",
  "prd.merge": "light",
  "prd.assess": "light",
  "prd.modify": "standard",
  "prd.clarify": "light",
  "prd.spec": "standard",
  "prd.smart-add": "standard",
  "prd.restructure": "standard",
  // Placement of a change on the product layer; uncalibrated, so its pick only
  // auto-accepts when it agrees with the rules.
  "prd.place": "standard",
  // sourcevision
  "code.classify": "light",
  "zone.enrich-scan": "light",
  "zone.enrich-deep": "standard",
  "zone.meta-eval": "standard",
  // Judgment classes: answered by TypeSafe Jev when TYPESAFE_API_KEY is set
  // (llm.routes.<class> = "typesafe" names it explicitly); the tier is the
  // text-model fallback resolveTaskModel reports for them.
  "finding.judge": "light",
  "zone.judge": "light",
  // web
  "sourcevision.ask": "standard",
};

/**
 * Levenshtein distance, iterative with a single row.
 *
 * Local and tiny on purpose: the only consumer is the did-you-mean hint
 * below, and pulling a dependency into the orchestration tier for twenty
 * lines of arithmetic would cost more than it saves.
 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Maximum edit distance at which a suggestion is offered.
 *
 * Three catches the realistic typos — a transposition, a dropped or doubled
 * character, a wrong suffix — without pointing `zone.enrich-scan` at
 * `code.classify` and sending someone down the wrong path. Beyond it the note
 * still appears; only the suggestion is withheld.
 */
const TASK_CLASS_SUGGESTION_MAX_DISTANCE = 3;

/**
 * Nearest known task class to `candidate`, or null when nothing is close.
 */
export function nearestTaskClass(candidate) {
  let best = null;
  for (const known of Object.keys(TASK_CLASSES)) {
    const distance = editDistance(candidate, known);
    if (distance <= TASK_CLASS_SUGGESTION_MAX_DISTANCE && (!best || distance < best.distance)) {
      best = { known, distance };
    }
  }
  return best ? best.known : null;
}

/**
 * Advisory note for a `llm.routes.<class>` / `llm.effort.<class>` write whose
 * class this build does not recognize. Returns null when the class is known,
 * or is a glob pattern (which is a routing feature, not a typo).
 *
 * Deliberately advisory: rejecting would break glob keys and any class added
 * to the registry after this copy was written. The value is written either
 * way; the user simply learns that a route which will never match looks like
 * a mistake.
 */
export function describeUnknownTaskClass(settingPath) {
  const prefix = ["routes.", "effort."].find((p) => settingPath.startsWith(p));
  if (!prefix) return null;

  const taskClass = settingPath.slice(prefix.length);
  if (!taskClass || taskClass.includes("*")) return null;
  if (Object.hasOwn(TASK_CLASSES, taskClass)) return null;

  const suggestion = nearestTaskClass(taskClass);
  const lead = `Note: "${taskClass}" is not a task class this build knows about.`;
  return suggestion
    ? `${lead} Did you mean "${suggestion}"? Setting it anyway — ` +
        "run 'ndx config --help' for the full list."
    : `${lead} Setting it anyway, but it will not match any call site unless a ` +
        "newer n-dx defines it. Run 'ndx config --help' for the known classes.";
}

/**
 * Validators for the parameterized `llm.*` routing keys.
 *
 * These paths carry a variable segment (`llm.tiers.<vendor>.<tier>`,
 * `llm.routes.<class>`, `llm.effort.<class>`), so they cannot be looked up in
 * the exact-match {@link LLM_VALIDATORS} table.
 *
 * The strictness is deliberately asymmetric. Values are checked strictly, and
 * so is the *shape* of a tier path — an unrecognized vendor or tier there is
 * a typo, never a feature. Route and effort *class names* are left open:
 * glob keys (`prd.*`, `*`) are the documented routing design, and this tier
 * cannot see the task-class registry to tell a new class from a misspelled
 * one without importing from a package.
 *
 * @param {string} settingPath Path within the `llm` section (no `llm.` prefix).
 * @returns {((value: unknown) => void) | null}
 */
function getLLMRoutingValidator(settingPath) {
  if (settingPath.startsWith("tiers.")) {
    const rest = settingPath.slice("tiers.".length);
    const [vendor, tier, ...extra] = rest.split(".");
    return (value) => {
      if (!vendor || !Object.values(LLM_VENDOR).includes(vendor)) {
        throw new Error(
          `Invalid vendor "${vendor}" in llm.tiers.${rest}. ` +
            `Expected one of: ${Object.values(LLM_VENDOR).join(", ")}.`,
        );
      }
      if (!tier || !TASK_TIERS.has(tier)) {
        throw new Error(
          `Invalid tier "${tier ?? ""}" in llm.tiers.${rest}. ` +
            `Expected one of: ${[...TASK_TIERS].join(", ")}.`,
        );
      }
      if (extra.length > 0) {
        throw new Error(
          `Unexpected extra path segments in llm.tiers.${rest}. ` +
            "Expected llm.tiers.<vendor>.<tier>.",
        );
      }
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(
          `Invalid model for llm.tiers.${rest}: expected a non-empty model ID.\n` +
            `  Example: n-dx config llm.tiers.${vendor}.${tier} <model-id>`,
        );
      }
    };
  }

  if (settingPath.startsWith("routes.")) {
    const taskClass = settingPath.slice("routes.".length);
    return (value) => {
      if (!taskClass) {
        throw new Error("Missing task class in llm.routes.<class>.");
      }
      if (typeof value !== "string" || !TASK_TIERS.has(value)) {
        throw new Error(
          `Invalid tier "${value}" for llm.routes.${taskClass}. ` +
            `Expected one of: ${[...TASK_TIERS].join(", ")}.`,
        );
      }
    };
  }

  if (settingPath.startsWith("effort.")) {
    const taskClass = settingPath.slice("effort.".length);
    return (value) => {
      if (!taskClass) {
        throw new Error("Missing task class in llm.effort.<class>.");
      }
      if (typeof value !== "string" || !EFFORT_LEVELS.has(value)) {
        throw new Error(
          `Invalid effort "${value}" for llm.effort.${taskClass}. ` +
            `Expected one of: ${[...EFFORT_LEVELS].join(", ")}.`,
        );
      }
    };
  }

  return null;
}

/**
 * Build provider-specific auth preflight command.
 * Returns binary + args for the selected vendor.
 */
function getVendorAuthPreflightCommand(vendor, llmConfig, legacyClaudeConfig) {
  if (vendor === LLM_VENDOR.CODEX) {
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
 *
 * For google, performs a lightweight HTTP call to the Gemini API.
 * For claude/codex, spawns the vendor CLI synchronously.
 *
 * @returns {Promise<{ ok: boolean, binary?: string, args?: string[], detail?: string, errorCode?: string }>}
 */
async function runVendorAuthPreflight(vendor, llmConfig, legacyClaudeConfig) {
  if (vendor === LLM_VENDOR.GOOGLE) {
    return runGoogleApiPreflight(llmConfig);
  }

  if (vendor === LLM_VENDOR.LOCAL) {
    return runLocalApiPreflight(llmConfig);
  }

  const { binary, args } = getVendorAuthPreflightCommand(
    vendor,
    llmConfig,
    legacyClaudeConfig,
  );
  try {
    // Windows-safe: routes .cmd shims through cmd.exe with a self-quoted
    // verbatim command line (GH #37/#68/#69) — see execFileSyncCli.
    execFileSyncCli(binary, args, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
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

/**
 * Detect whether a CLI preflight failure detail indicates rejected/expired
 * credentials (as opposed to a missing binary or a launch/PATH problem).
 */
function isAuthFailureDetail(detail) {
  if (!detail) return false;
  return /\b40[13]\b|unauthorized|invalid[\s_-]*api[\s_-]*key|authentication[\s_-]*(error|failed|fail|invalid|expired)|token[\s_-]*expired|expired|oauth|credential|please\s*login|not\s*logged\s*in|login\s*required/i.test(
    detail,
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

/**
 * Print concise re-authentication guidance for a preflight auth failure.
 * Uses the canonical, JSON-free wording shared with the runtime providers so
 * every entry point (ndx init/work/plan/analyze) reads identically. The NDX
 * error code is emitted only as a dim, secondary diagnostic line.
 */
async function printAuthFailureGuidance(vendor, code) {
  const { authFailureGuidance } = await import("@n-dx/llm-client");
  const { red, yellow, dim } = await import("./cli-brand.js");
  const guidance = authFailureGuidance(vendor);
  console.error(red(`✗ ${guidance.headline}`));
  for (const line of guidance.remediation) {
    console.error(yellow(`  ${line}`));
  }
  console.error(`  Then retry: ndx config llm.vendor ${vendor}`);
  if (code) {
    console.error(dim(`  [${code}]`));
  }
}

async function printVendorPreflightFailure(
  vendor,
  preflight,
  llmConfig,
  legacyClaudeConfig,
) {
  const { red, yellow, dim } = await import("./cli-brand.js");
  // Google uses API-key auth — no binary / CLI args to display.
  if (vendor === LLM_VENDOR.GOOGLE) {
    const errorCode = preflight.errorCode || "NDX_GOOGLE_PREFLIGHT_FAILED";
    const apiKeyEnvVar = llmConfig?.google?.apiKeyEnv || "GEMINI_API_KEY";
    // A rejected or malformed key is an invalid-credentials problem →
    // canonical re-auth guidance.
    if (
      errorCode === "NDX_GOOGLE_PREFLIGHT_AUTH_FAILED" ||
      errorCode === "NDX_GOOGLE_PREFLIGHT_INVALID_KEY_FORMAT"
    ) {
      await printAuthFailureGuidance(LLM_VENDOR.GOOGLE, errorCode);
      return;
    }
    // No key configured yet → distinct "missing API key" root cause.
    if (errorCode === "NDX_GOOGLE_PREFLIGHT_NO_KEY") {
      console.error(red("✗ No API key configured for Google."));
      console.error(yellow("  Set your API key: ndx config llm.google.api_key <KEY>"));
      console.error(yellow(`  Or set the env var: export ${apiKeyEnvVar}=<KEY>`));
      console.error("  Get a key: https://aistudio.google.com/apikey");
      console.error(dim(`  [${errorCode}]`));
      return;
    }
    // Network / HTTP failure — concise, no raw payload.
    console.error(red("✗ Provider auth preflight failed for Google."));
    if (preflight.detail && !looksLikeJson(preflight.detail)) {
      console.error(`  ${preflight.detail}`);
    }
    console.error(yellow("  Retry after resolving the issue: ndx config llm.vendor google"));
    console.error(dim(`  [${errorCode}]`));
    return;
  }

  // CLI-based vendors (claude, codex): a rejected/expired credential is an
  // auth failure → canonical re-auth guidance, never a raw payload dump.
  if (isAuthFailureDetail(preflight.detail)) {
    const code =
      vendor === LLM_VENDOR.CODEX
        ? "NDX_CODEX_PREFLIGHT_AUTH_FAILED"
        : "NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED";
    await printAuthFailureGuidance(vendor, code);
    return;
  }

  // Local vendor: server connectivity failure — guide user to start their
  // local server rather than suggesting a login command.
  if (vendor === LLM_VENDOR.LOCAL) {
    const host = llmConfig?.local?.host || "localhost";
    const port = llmConfig?.local?.port || 1234;
    console.error(red(`✗ Cannot reach local LLM server at http://${host}:${port}.`));
    if (preflight.detail && !looksLikeJson(preflight.detail)) {
      console.error(`  ${preflight.detail}`);
    }
    console.error(yellow("  Start LM Studio (or Ollama) and enable its local server, then retry."));
    console.error(yellow(`  LM Studio: Developer tab → "Start Server". Ollama: 'ollama serve'.`));
    console.error(yellow(`  Configure host/port: ndx config llm.local.host <host> / ndx config llm.local.port <port>`));
    return;
  }

  if (vendor !== LLM_VENDOR.CLAUDE) {
    // codex (or other CLI vendor) non-auth launch failure.
    const loginCommand = getVendorLoginCommand(
      vendor,
      llmConfig,
      legacyClaudeConfig,
    );
    console.error(red(`✗ Provider auth preflight failed for "${vendor}".`));
    if (preflight.detail && !looksLikeJson(preflight.detail)) {
      console.error(`  ${preflight.detail}`);
    }
    console.error(
      yellow(`  Next step: run '${loginCommand}', then retry 'ndx config llm.vendor ${vendor}'.`),
    );
    return;
  }

  // claude non-auth failure (not installed / not on PATH / could not launch).
  const classified = formatClaudePreflightFailure(preflight);
  console.error(red(`✗ ${classified.lines[0]}`));
  for (const line of classified.lines.slice(1)) {
    console.error(yellow(`  ${line}`));
  }
  console.error(dim(`  [${classified.code}]`));
}

/** Detect a JSON-looking payload so raw blobs never reach user output. */
function looksLikeJson(detail) {
  if (!detail) return false;
  const trimmed = detail.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    /"[\w.-]+"\s*:/.test(trimmed)
  );
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

/**
 * Exported so `tests/e2e/hench-config-gate-contract.test.js` can read the
 * documented `hench.*` keys without spawning the CLI: the help text is the
 * documented surface of what `ndx config` accepts, and it has to name every key
 * `hench config` and the dashboard offer. Export only — nothing imports it at
 * runtime, so the orchestration tier's spawn-only rule is untouched.
 */
export const HELP_TEXT = `n-dx config — view and edit settings across all packages

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

Rex performance settings (both default false — the previous path stays the
default until the faster one is chosen deliberately; override either for a
single command with REX_FAST_READS / REX_FAST_WRITES):
  rex.performance.fastReads   boolean  Read the PRD once per command instead of
                                       three times. The extra parses came from a
                                       merge written when the store and the folder
                                       tree were different backends; they are the
                                       same parse now (default: false)
  rex.performance.fastWrites  boolean  Write only the files a single-item update
                                       changes — the item's index.md and its
                                       parent's children table — instead of
                                       re-serializing the whole tree. Falls back to
                                       the full write whenever the change could move
                                       a file, such as a retitle (default: false)

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
  hench.model              string    Deprecated and ignored (default: "sonnet"); use hench.models.<vendor>
  hench.models.<vendor>    string    Agent-only model for claude, codex, google or local
  hench.maxTurns           number    Max conversation turns per run (default: 50)
  hench.maxTokens          number    Max tokens per API request (default: 8192)
  hench.tokenBudget        number    Total tokens per run, input+cached+output (default: 0 —
                                     unlimited). A run stops once it crosses this.
  hench.rexDir             string    Path to the rex PRD directory (default: the project's
                                     resolved rex directory — .rex, or .ndx/rex on the new layout)
  hench.apiKeyEnv          string    Env variable for API key (default: "ANTHROPIC_API_KEY")
  hench.claudePath         string    Path to the Claude Code binary. Falls back to "claude" on
                                     PATH. Prefer claude.cli_path, which is shared across packages.
  hench.language           string    Project toolchain — "typescript", "javascript", "go" or
                                     "swift". Selects the hench.guard.* defaults.
  hench.loopPauseMs        number    Pause between consecutive runs in a loop (default: 2000)
  hench.maxFailedAttempts  number    Consecutive failures before a task is skipped as stuck
                                     (default: 3)
  hench.permissionMode     string    Permission mode the vendor CLI session starts in: "default",
                                     "acceptEdits", "bypassPermissions" or "plan". Autonomous
                                     'ndx work' runs default to "acceptEdits" so they do not stall
                                     in plan mode. The --permission-mode flag overrides this.
  hench.autonomous         boolean   Run without interactive prompts (default: false). Implies
                                     "acceptEdits" when hench.permissionMode is unset.
  hench.useEventPipeline   boolean   Capture the RuntimeEvent stream (default: false). Required by
                                     'hench show --events'.
  hench.useRegistryProvider boolean  Resolve the vendor through the provider registry rather than
                                     the built-in path (default: false)
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
  hench.sessionStrategy    string    How task spawns relate to vendor sessions (default: "fork"
                                     where supported, else "cold"):
                                       fork  — orient once, then fork that session per task, so no
                                               task re-pays cold-start context or re-explores the repo
                                       batch — run up to hench.tasksPerSession tasks in one session
                                       cold  — a fresh spawn per task
                                     Forking needs a CLI that resumes by session id (Claude today);
                                     other vendors and hench.provider=api fall back to "cold".
  hench.tasksPerSession    number    Tasks per session under the "batch" strategy (default: 4)
  hench.parentMaxAgeHours  number    How long a cached orientation session may be forked before it
                                     is rebuilt (default: 24). Re-analyzing the repo invalidates it
                                     sooner; 'ndx work --fresh' forces a new one.
  hench.batchMaxAgeHours   number    How long a "batch" chain may keep serving tasks, measured from
                                     the task that opened it (default: 8).
  hench.batchMaxIdleHours  number    How long a "batch" chain may sit unused before it is retired
                                     (default: 1). A chain is also retired whenever the worktree,
                                     branch, analysis fingerprint, permissions, vendor or model
                                     differ from the ones it was opened under.
  hench.maxSpawnsPerTask   number    Ceiling on vendor spawns for one task (default: 8). Counts
                                     every spawn — the first, failure retries, plan-mode re-spawns,
                                     and fallbacks — so the allowances add up rather than
                                     multiplying. Hitting it fails the task with the breakdown
                                     instead of continuing to spend.
  hench.livelockThreshold  number    Identical tool calls — same name, same arguments, nothing
                                     written to disk in between — before a run is stopped as
                                     livelocked (default: 6). 0 disables the check. Raise it if a
                                     legitimate workload repeats one read-only call many times
                                     without editing anything.
  hench.promptCache        boolean   Mark cache_control breakpoints on hench.provider=api Claude
                                     requests (default: true). Set to false when
                                     claude.api_endpoint points at a gateway or proxy that rejects
                                     the cache_control field (some OpenAI-to-Anthropic shims, some
                                     enterprise gateways, Bedrock's legacy InvokeModel path for
                                     models without caching) and turn 1 fails with a 400. With
                                     false, requests are sent exactly as before prompt caching was
                                     added: plain-string system prompt, untouched tools/messages.
  hench.promptCacheTtl     string    TTL for both cache_control breakpoints: "5m" or "1h"
                                     (default: "5m"). Raise to "1h" only when tool calls
                                     (e.g. a slow test gate) regularly push the gap between
                                     turns past 5 minutes, so the prefix would otherwise be
                                     re-written at the 1.25x-input rate instead of read at
                                     0.1x. "1h" writes cost 2x input, not 1.25x — pays off
                                     only when that turn gap regularly falls between 5 and
                                     60 minutes. Cost estimates price every write at 1.25x
                                     regardless of TTL (see llm-client's config.ts), so enabling
                                     "1h" under-reports estimated spend by that difference.

Hench retry policy (transient API errors):
  hench.retry.maxRetries   number    Retry attempts for a transient error (default: 3)
  hench.retry.baseDelayMs  number    Delay before the first retry; doubles each attempt
                                     (default: 2000)
  hench.retry.maxDelayMs   number    Cap on the exponential backoff (default: 30000)

Hench context-prune settings (hench.provider=api runs only; the CLI loops let the
vendor binary manage its own window). Every key trades the same two things: how much
of the run the agent can still read verbatim, against how often the cached prompt
prefix is thrown away.
  hench.prune.triggerPairs           number   Turn-pairs tolerated before a prune fires
                                              (default: 20). Sets peak context — the prompt
                                              grows by pure append until it crosses this, so
                                              raising it raises the largest request a run sends.
  hench.prune.retainPairs            number   Turn-pairs kept verbatim after a prune
                                              (default: 10); everything older becomes a summary.
                                              Must be at least 2 and below triggerPairs — the gap
                                              between the two is how many turns of cache-friendly
                                              append-only growth follow each prune, so raising
                                              retention buys verbatim history by resetting the
                                              cache more often.
  hench.prune.transcriptMessageChars number   Characters of each dropped message the summarizer
                                              is shown (default: 2000, matching the size at which
                                              hench truncates a tool result for the run record).
                                              Anything past the cap cannot reach the summary.
                                              Raising it gives the summarizer more to work from at
                                              the cost of a larger light-tier prompt per prune.

Hench test-gate settings (mandatory full-suite gate before commit):
  hench.fullTestCommand    string    Command that runs the whole suite. Resolved from this key,
                                     then .n-dx.json hench.fullTestCommand, then auto-detected
                                     from the project (Makefile validate target, package.json
                                     test:all/test, swift/cargo/go/pytest), then prompted for.
  hench.testGate.command   string    Gate command template. Outranks hench.fullTestCommand and
                                     auto-detection. {base} is replaced with the commit the run
                                     started from (a hex SHA), e.g.
                                     "node scripts/run-all-tests.mjs affected {base}". If the
                                     template has {base} and no start commit is known, the gate
                                     falls back to the untemplated command and records
                                     testGate.scopeFallback. A template without {base} runs as
                                     written. A "test-gate: selected-suites=a,b" line in its
                                     output is recorded as testGate.suites.
  hench.testGate.rerunCommand
                           string    Re-run template for unattended runs (--auto, --yes, no TTY).
                                     When the gate fails and its output has a
                                     "test-gate: failed-suites=a,b" line, {suites} is replaced
                                     with those labels and the command runs once, e.g.
                                     "node scripts/run-all-tests.mjs {suites}". A pass counts and
                                     is recorded as testGate.flakyRerun; a failure fails the run.
                                     No re-run after a timeout or on an interactive terminal.
  hench.fullTestTimeoutMs  number    How long that command may run before it is killed and the
                                     run fails (default: 900000 — 15 minutes; 0 means no limit).
                                     Raise it for a large monorepo: the gate runs while an agent
                                     is also using the machine, and a timeout aborts a task whose
                                     work is already done. Prefer raising this over skipping the
                                     gate.
  hench.commitMsgTimeoutMs number    Mid-run auto-commit timer, armed when the agent writes
                                     .hench-commit-msg.txt. On expiry it commits whatever is
                                     staged at that moment — before the test gate, the
                                     uncommitted-work gate, or the completion write. Default 0
                                     (disabled), so the only commit happens after the task is
                                     verified complete.
  hench.promptAgentToMarkInProgress
                           boolean   Keep the workflow step telling the agent to mark its task
                                     in_progress via rex_update_status (default: false). Hench
                                     makes that transition itself before the agent starts, so
                                     the step costs a tool round trip and rewrites a value
                                     already on disk. The completion step is unaffected — that
                                     call is a request rex parks on the task claim, and it
                                     carries the resolution hench applies after the test gate.

Hench git-safety settings (pre-run commit gate):
  hench.git.checkpointThreshold  number    Lines-changed threshold at/above which the pre-run
                                           commit gate escalates: the interactive prompt warns
                                           about the change size and defaults to committing a
                                           checkpoint instead of proceeding (default: 200,
                                           0 disables escalation)
  hench.git.requireCleanTree     boolean   Refuse to start runs against a dirty working tree:
                                           interactive prompts drop the "proceed" option and
                                           non-interactive runs abort (default: false)
                                           The --allow-dirty flag overrides both settings for
                                           one run (flag > config > defaults).
  hench.git.commitMessage        string    Where the gate's proposed commit subject comes
                                           from: "deterministic" (default) builds it from the
                                           dirty file list, e.g.
                                           "chore(rex,web): pre-run checkpoint, 12 files,
                                           340 lines"; "llm" asks a light-tier model to
                                           summarise the diff instead. Only reached on the
                                           attended path — the gate prompts, and so proposes
                                           a subject, solely in an interactive TTY session.

Hench guard settings (security boundaries):
  hench.guard.blockedPaths       string[]  Glob patterns for blocked file paths
                                           (default: .hench/**, .rex/**, .git/**, node_modules/**)
  hench.guard.allowedCommands    string[]  Whitelisted shell commands
                                           (default: npm, npx, node, git, tsc, vitest)
  hench.guard.commandTimeout     number    Command timeout in ms (default: 30000)
  hench.guard.maxFileSize        number    Max file size in bytes (default: 1048576)
  hench.guard.spawnTimeout       number    Timeout for a spawned vendor process in ms
                                           (default: 300000)
  hench.guard.maxConcurrentProcesses
                                 number    Simultaneous hench processes allowed (default: 3)
  hench.guard.allowedGitSubcommands
                                 string[]  Git subcommands the agent may run (default: status,
                                           add, commit, diff, log, branch, checkout, stash,
                                           show, rev-parse)
  hench.guard.policy.maxCommandsPerMinute
                                 number    Rate limit on shell commands (default: unlimited)
  hench.guard.policy.maxWritesPerMinute
                                 number    Rate limit on file writes (default: unlimited)
  hench.guard.policy.maxTotalBytesWritten
                                 number    Bytes the agent may write in one run
                                           (default: unlimited)
  hench.guard.policy.maxTotalCommands
                                 number    Commands the agent may run in one run
                                           (default: unlimited)

Hench memory settings (back off rather than exhaust the machine):
  hench.guard.memoryThrottle.enabled
                                 boolean   Delay or reject runs when system memory is low
  hench.guard.memoryThrottle.rejectThreshold
                                 number    System memory usage % at which a run is rejected
                                           outright, 0-100 (default: 95)
  hench.guard.memoryThrottle.delayThreshold
                                 number    System memory usage % at which a run is delayed with
                                           backoff, 0-100 (default: 80)
  hench.guard.memoryThrottle.baseDelayMs
                                 number    Initial backoff before a throttled run retries;
                                           doubles each attempt
  hench.guard.memoryThrottle.maxDelayMs
                                 number    Cap on the throttle backoff
  hench.guard.memoryThrottle.maxRetries
                                 number    How many times a throttled run waits before it is
                                           rejected
  hench.guard.memoryMonitor.enabled
                                 boolean   Check system memory before the agent spawns a process
  hench.guard.memoryMonitor.spawnThreshold
                                 number    System memory usage % above which a spawn is refused,
                                           0-100

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
                                    Stored in .n-dx.local.json (gitignored), never in
                                    the shared .n-dx.json.
                                    ${API_KEY_PERMISSION_NOTE}
  claude.api_endpoint      string    Anthropic API base URL (optional)
                                    Override the default API endpoint for proxies or
                                    compatible services.
                                    Default: https://api.anthropic.com
                                    Validated: must be a valid HTTP(S) URL.
  claude.model             string    Default Claude model for API calls (optional)
                                    Override the default model used by all packages.
                                    Examples: claude-sonnet-5-5, claude-opus-5-5
                                    Default: claude-sonnet-5-5
  claude.lightModel        string    Model override for light-weight tasks (optional)
                                    When set, light-tier tasks use this model instead of
                                    the default haiku. Use for cost/latency optimization.
                                    Example: claude-haiku-4-5

LLM vendor settings (.n-dx.json / .n-dx.local.json — preferred for multi-vendor setup):
  llm.vendor               string    Active LLM vendor: "claude", "codex", "google", or "local"
                                    Required for multi-vendor workflows.
  llm.claude.cli_path      string    Claude CLI path (optional; validated executable)
                                    Stored in .n-dx.local.json.
  llm.claude.api_key       string    Claude API key (optional)
                                    Stored in .n-dx.local.json.
  llm.claude.api_endpoint  string    Claude API endpoint (optional; validated URL)
  llm.claude.model         string    Claude default model (optional)
  llm.claude.lightModel    string    Claude model for light-weight tasks (optional)
                                    When set, commands that explicitly opt into the
                                    light tier use this model. Falls back
                                    to claude-haiku-4-5 if not set.
  llm.codex.cli_path       string    Codex CLI path (optional; validated executable)
                                    Stored in .n-dx.local.json.
  llm.codex.api_key        string    Codex API key (optional)
                                    Stored in .n-dx.local.json.
  llm.codex.api_endpoint   string    Codex API endpoint (optional; validated URL)
  llm.codex.model          string    Codex default model (optional)
  llm.codex.lightModel     string    Codex model for light-weight tasks (optional)
                                    When set, commands that explicitly opt into the
                                    light tier use this model.
                                    Falls back to gpt-5.6-luna if not set.
  llm.google.api_key       string    Google Gemini API key (optional; validated format)
                                    Stored in .n-dx.local.json.
                                    Preflight validates the key against the Gemini API.
                                    Set GEMINI_API_KEY env var as an alternative.
                                    Get a key at: https://aistudio.google.com/apikey
  llm.google.apiKeyEnv     string    Environment variable name for the Google API key
                                    (default: GEMINI_API_KEY). Override when your
                                    key is stored in a custom env var.
                                    Example: n-dx config llm.google.apiKeyEnv MY_GOOGLE_KEY
  llm.google.api_endpoint  string    Gemini API endpoint (optional; validated URL)
  llm.google.model         string    Gemini default model (optional)
                                    Must be a valid Gemini model ID starting with "gemini-".
                                    Known models: gemini-3.5-flash-lite (light),
                                    gemini-3.7-flash (standard), gemini-2.5-pro (heavy)
                                    Validation: rejects non-Gemini model IDs (e.g. "gpt-5.6-terra")
  llm.local.host           string    Hostname of the local LM Studio server (default: localhost)
  llm.local.port           number    Port of the local LM Studio server (default: 1234)
  llm.local.model          string    Model ID to request from the local server (optional)
                                    Leave unset to use whichever model is currently loaded
                                    in LM Studio.
  llm.local.lightModel     string    Local model for light-weight tasks (optional)
  llm.local.maxContextTokens number  Max context window (in tokens) for the local model (optional)
                                    When set, hench checks the assembled brief fits before
                                    sending it — failing fast instead of a cryptic HTTP 400.
                                    Match your local server's "Context Length" setting.
  llm.local.timeoutMs      number    Per-request timeout in ms for local completions
                                    (default: 300000 = 5 min; 0 = no timeout)
                                    Raise this when the model is slow to generate or load,
                                    e.g. 7200000 for 2 hours. This is separate from
                                    cli.timeoutMs / the CLI timeouts on the Workflow settings
                                    page, which bound the whole command rather than one
                                    HTTP request.
  llm.local.verifier.host  string    Hostname of a second local server used to review the
                                    primary model's output before finalizing a run (optional)
  llm.local.verifier.port  number    Port of the verifier server (optional)
  llm.local.verifier.model string    Model ID to request from the verifier server (optional)
  llm.local.verifier.maxCycles number Max FAIL-then-revise cycles per run (default: 2)
  llm.local.profiles       array     Saved local-server connection profiles, managed entirely
                                    by the web dashboard's LLM Provider page — not read by
                                    hench/rex/any CLI at runtime. Not meant to be hand-edited.
  llm.autoFailover         boolean   Enable automatic model/vendor failover on errors (default: false)
                                    When true, hench retries failed runs on fallback models
                                    before surfacing the original error. Disabled by default
                                    to preserve existing behavior.

Task routing (which model serves which kind of call):
  Call sites declare a task class — what kind of work a call is, never a model. Routes map
  a class to a tier, and the tier map resolves a tier to a model for the active vendor.

  llm.model                string    Standard-tier shorthand for the active vendor: sets the
                                    model used by every class routed "standard", and wins over
                                    llm.<vendor>.model. Light and heavy tiers are unaffected —
                                    use llm.tiers.* to change those.
  llm.tiers.<vendor>.<tier>
                           string    Model serving one tier for one vendor. <vendor> is claude,
                                    codex, google, or local; <tier> is light, standard, heavy,
                                    or free. Outranks llm.<vendor>.lightModel and llm.model.
                                    "free" has no built-in model — a class routed free falls
                                    through to light until you set one here.
                                      n-dx config llm.tiers.claude.light claude-haiku-4-5
  llm.routes.<class>       string    Tier a task class resolves to: light, standard, heavy, or
                                    free. Overrides the built-in default for that class.
                                    <class> may be exact ("prd.rename") or a glob prefix
                                    ("prd.*", "*"); an exact match wins over a glob, and among
                                    globs the longest prefix wins.
                                      n-dx config llm.routes.agent.execute heavy
                                      n-dx config "llm.routes.prd.*" standard
  Known task classes (<class> above), with the tier each routes to by default:
    hench        agent.execute (standard)      git.commit-message (light)
                 context.summarize (light)     context.distill (standard)
    rex          prd.propose (standard)        prd.consolidate-check (light)
                 prd.decompose (light)         prd.rename (light)
                 prd.merge (light)             prd.assess (light)
                 prd.modify (standard)         prd.clarify (light)
                 prd.spec (standard)           prd.smart-add (standard)
                 prd.restructure (standard)
    sourcevision code.classify (light)         zone.enrich-scan (light)
                 zone.enrich-deep (standard)   zone.meta-eval (standard)
                 finding.judge (light)         zone.judge (light)
    web          sourcevision.ask (standard)
  code.classify, finding.judge and zone.judge are judgments: with TYPESAFE_API_KEY set
  they go to TypeSafe Jev, and a route of "typesafe" names that explicitly.
  Setting a route for a class not listed here still works — it may be a glob, or a
  class a newer n-dx defines — but ndx says so, and suggests the closest match.

  llm.effort.<class>       string    Thinking effort for a class: low, medium, high, xhigh, or
                                    max. Matched with the same exact-then-glob rules as routes.
                                    Light-tier models have no effort parameter, so an entry for
                                    a light-routed class is inert rather than an error.
  llm.escalation.enabled   boolean   Retry a failed light-tier call once on the standard tier,
                                    with the validation error appended (default: true).
  llm.escalation.maxSteps  number    How many escalation steps a call may take (default: 1).
                                    0 disables escalation without clearing the config.

Local server preflight error codes:
  NDX_LOCAL_PREFLIGHT_HTTP_ERROR     Server is reachable but returned a non-200 response
  NDX_LOCAL_PREFLIGHT_CONNECT_ERROR  Cannot connect to the local server

Claude preflight error codes:
  NDX_CLAUDE_PREFLIGHT_NOT_INSTALLED  Claude CLI is not installed; install it before retrying
  NDX_CLAUDE_PREFLIGHT_NOT_ON_PATH    Configured Claude command is not resolvable on PATH
  NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED  Claude CLI is present but needs authentication
  NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED  Claude appears authenticated/installed, but ndx cannot launch a usable executable

Google preflight error codes:
  NDX_GOOGLE_PREFLIGHT_NO_KEY           No GEMINI_API_KEY env var or llm.google.api_key in config
  NDX_GOOGLE_PREFLIGHT_INVALID_KEY_FORMAT  Key does not match expected format (starts with "AIza" or "AQ", ≥30 chars)
  NDX_GOOGLE_PREFLIGHT_AUTH_FAILED      Gemini API rejected the key (HTTP 400 or 403)
  NDX_GOOGLE_PREFLIGHT_HTTP_ERROR       Gemini API returned an unexpected HTTP error
  NDX_GOOGLE_PREFLIGHT_CONNECT_ERROR    Could not connect to the Gemini API

Feature toggles (.n-dx.json — managed via web UI or ndx config):
  features.rex.showTokenBudget      boolean   Show token budget on task items (default: false)
  features.rex.autoComplete         boolean   Auto-complete parents when children done (default: true)
  features.rex.budgetEnforcement    boolean   Enforce token/cost budgets (default: false)
  features.sourcevision.callGraph   boolean   Enable call graph extraction (default: false)
  features.sourcevision.enrichment  boolean   AI enrichment passes (default: true)
  features.sourcevision.componentCatalog
                                    boolean   React component catalog (default: true)
  features.hench.autoRetry          boolean   Auto-retry on failure (default: true)
  features.hench.guardRails         boolean   Security guard rails (default: true)
  features.hench.adaptiveWorkflow   boolean   Adaptive workflow adjustment (default: false)

Sourcevision settings (.n-dx.json):
  sourcevision.zones.pins  object    Override zone assignments: {"file/path.ts": "zone-id"}
  sourcevision.zones.mergeThreshold
                           number    Min zone size for small-zone merge (default: 3)
  sourcevision.ask.timeoutMs
                           number    Wall-clock budget for one dashboard Ask request,
                                     in ms (default: 120000). A request that exceeds
                                     it fails as a named timeout rather than hanging.

CLI settings (.n-dx.json):
  cli.name                 string    The project's installed CLI command name.
                                     Auto-detected from the package.json bin field
                                     by ndx init (first bin key, or the package name
                                     for a string bin). Defaults to "n-dx" when no
                                     bin field exists. Set manually to override
                                     detection — a set value is never overwritten
                                     by ndx init.
                                     Example: n-dx config cli.name myapp
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

Self-heal settings (.n-dx.json):
  selfHeal.autoConfirm     boolean   Bypass the pre-execution confirmation
                                    prompt for every 'ndx self-heal' run
                                    (default: false). When true, the prompt
                                    is skipped without reading stdin — useful
                                    for scheduled / CI runs.
                                    Precedence: --auto and --yes always win
                                    over this setting (flag=true overrides
                                    config=false, and flag absence does not
                                    cancel config=true). When the prompt is
                                    bypassed via config, self-heal logs
                                    '(bypassed prompt via selfHeal.autoConfirm
                                    config)' so the source is auditable.
                                    Example: n-dx config selfHeal.autoConfirm true

Web dashboard settings (.n-dx.json):
  web.port                 number    Dashboard server port (default: 3117)
  web.auth                 boolean   Require the per-user dashboard token on the hub,
                                    dashboard and preview servers (default: true).
                                    'ndx start' creates <ndx home>/auth.token and prints
                                    a URL that sets it as a cookie once; false, or
                                    --no-auth, runs the servers without it
  web.mode                 string    "here" makes 'ndx start' run the single-project
                                    server that owns the port; "hub" registers with
                                    the per-user hub (served at /p/<id>/) — the
                                    default, so this key only has to be set to
                                    opt out

Experimental settings (.n-dx.json) — BETA, off by default:
  experimental.posixFreezeTreeKill
                           boolean   BETA. On POSIX, when a command hits its
                                    timeout, freeze its whole process tree with
                                    SIGSTOP and verify every process is stopped
                                    before killing it — so nothing can fork its
                                    way out from under the kill. Default: false.
                                    NOT RIGOROUSLY TESTED: the unit coverage
                                    injects its seams, and its behaviour against
                                    real POSIX processes is not yet proven in CI.
                                    The default path (signal, then sweep the
                                    process table) has far more mileage.
                                    No effect on Windows, which has no way to
                                    pause a process from pure JS.
                                    Equivalent one-off: NDX_POSIX_FREEZE_KILL=1
                                    Example: n-dx config experimental.posixFreezeTreeKill true

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
  n-dx config hench.models.claude opus         Pin the agent's Claude model
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
  n-dx config claude.model claude-opus-5-5     Set default model for API calls
  n-dx config llm.vendor claude                Set active LLM vendor to Claude
  n-dx config llm.vendor codex                 Set active LLM vendor to Codex
  n-dx config llm.vendor google                Set active LLM vendor to Google (Gemini)
  n-dx config llm.vendor local                 Set active LLM vendor to local (LM Studio)
  n-dx config llm.local.host 192.168.1.10      Set local server host (default: localhost)
  n-dx config llm.local.port 1234              Set local server port (default: 1234)
  n-dx config llm.local.model qwen2.5-14b      Set local model ID (optional)
  n-dx config llm.local.timeoutMs 7200000      Allow 2 hours per local request (0 = no limit)
  n-dx config llm.claude.api_key sk-ant-...    Set Claude API key (llm namespace)
  n-dx config llm.claude.model claude-opus-5-5 Set Claude model (llm namespace)
  n-dx config llm.codex.cli_path /usr/local/bin/codex
                                               Set Codex CLI path
  n-dx config llm.autoFailover true            Enable automatic model/vendor failover
  n-dx config llm.autoFailover false           Disable automatic failover
  n-dx config features.rex.showTokenBudget true
                                               Enable token budget display on tasks
  n-dx config language go                      Set primary project language to Go
  n-dx config language auto                    Reset to auto-detection
  n-dx config selfHeal.autoConfirm true        Bypass the self-heal pre-execution prompt
  n-dx config selfHeal.autoConfirm false       Re-enable the self-heal pre-execution prompt
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

/**
 * True when `arg` names a config key rather than a directory.
 *
 * The single-positional grammar is ambiguous — `n-dx config [dir]` and
 * `n-dx config <key>` occupy the same slot — so something has to break the tie.
 * Existence on disk alone is the wrong tiebreaker: in a project that happens to
 * contain a `hench/` subdirectory, `n-dx config hench` resolved to that
 * directory, silently discarded the key, and reported "No n-dx configuration
 * found" for a fully-initialized project.
 *
 * A known key wins instead, because a key is an exact match against a closed
 * set while a directory name is arbitrary. `./hench` and `../hench` remain
 * unambiguous ways to ask for the directory: their first dot sits at index 0,
 * so the root segment is empty and never matches a section.
 *
 * @param {string} arg
 * @returns {boolean}
 */
export function isConfigKey(arg) {
  if (arg === "language") return true;
  const dotIdx = arg.indexOf(".");
  const root = dotIdx === -1 ? arg : arg.slice(0, dotIdx);
  return PROJECT_SECTIONS.has(root) || Object.hasOwn(PACKAGES, root);
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
    if (!isConfigKey(positional[0]) && (await fileExists(resolve(positional[0])))) {
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

  for (const pkg of Object.keys(PACKAGES)) {
    const configPath = packageConfigPath(dir, pkg);
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

/**
 * The Claude settings in force, resolving `llm.claude.<field>` over the legacy
 * top-level `claude.<field>` one field at a time. Returns undefined when
 * neither location sets anything.
 *
 * Delegates to `resolveClaudeConfig` (@n-dx/llm-client) — the one
 * implementation of the per-field rule, also used by `loadLLMConfig`,
 * `GET /api/llm/config` and `GET /api/ndx-config` — so the CLI cannot
 * disagree with them about which value wins. config.js is the spawn-exempt
 * orchestration script and may not *statically* import packages
 * (`domain-isolation.test.js`), so this loads it the same way the
 * vendor-preflight and `runAuthCheck` paths already do: `await import(...)`.
 *
 * Reading only `configs.claude` worked while `ndx config llm.claude.<field>`
 * mirrored its value into the legacy key. That mirror is gone, so a reader
 * that does not resolve both locations now reports a project configured under
 * `llm.claude.*` as having no Claude configuration at all.
 */
async function resolveClaudeSettings(configs) {
  const { resolveClaudeConfig } = await import("@n-dx/llm-client");
  return resolveClaudeConfig(configs?.llm?.claude, configs?.claude).config;
}

/** Handle --test-connection mode. */
async function handleTestConnection(configs) {
  const claudeConfig = await resolveClaudeSettings(configs);
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
  const existing = getByPath(configs[pkg], settingPath, pkg);
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

/**
 * Run vendor auth preflight when setting llm.vendor.
 *
 * When `soft` is true (the `--soft-preflight` flag, used by `ndx init`), a failed
 * preflight is downgraded from a fatal abort to a visible warning: the failure
 * detail + remediation are printed, then the caller is allowed to persist the
 * vendor anyway. This lets init record the user's chosen vendor (so it applies to
 * all later commands) even before auth is configured — the auth error then surfaces
 * clearly at actual use rather than silently reverting to the Claude default.
 */
async function runLLMVendorPreflight(coerced, configs, soft = false) {
  const currentLLM =
    configs.llm && typeof configs.llm === "object" ? configs.llm : {};
  const llmForPreflight = { ...currentLLM, vendor: coerced };
  const legacyClaude =
    configs.claude && typeof configs.claude === "object"
      ? configs.claude
      : undefined;

  // Local vendor requires a running HTTP server. During soft-preflight (used
  // by `ndx init` and `ndx config llm.vendor local`), skip the connectivity
  // check — the server doesn't need to be running at config time, only at
  // execution time. Print an info line reminding the user to start it before
  // `ndx work`.
  if (coerced === LLM_VENDOR.LOCAL && soft) {
    const { dim } = await import("./cli-brand.js");
    const host = llmForPreflight?.local?.host || "localhost";
    const port = llmForPreflight?.local?.port || 1234;
    console.error(dim(`  Local vendor configured. Start your local server at http://${host}:${port} before running 'ndx work'.`));
    return;
  }

  const preflight = await runVendorAuthPreflight(
    coerced,
    llmForPreflight,
    legacyClaude,
  );
  if (!preflight.ok) {
    await printVendorPreflightFailure(
      coerced,
      preflight,
      llmForPreflight,
      legacyClaude,
    );
    if (!soft) {
      process.exit(1);
    }
    console.error(
      `Proceeding anyway — "${coerced}" is set but its auth was not validated. ` +
        `Resolve the issue above, then re-run any ndx command to use ${coerced}.`,
    );
  }
}

/** Handle SET mode for a project-level section (claude, llm, web, features). */
/**
 * Delete `[section, settingPath]` entries from the shared `.n-dx.json`.
 *
 * Returns the dotted keys that were actually present and removed. Emptied
 * objects are pruned so the file does not accumulate `{}`. The file is only
 * rewritten when something was removed.
 *
 * @param {string} dir
 * @param {Array<[string, string]>} entries
 * @returns {Promise<string[]>}
 */
async function removeFromSharedConfig(dir, entries) {
  const sharedPath = projectConfigPath(dir, PROJECT_CONFIG_FILE);
  if (!(await fileExists(sharedPath))) return [];
  const shared = await loadProjectConfigFile(dir, PROJECT_CONFIG_FILE);
  const removed = [];
  for (const [section, settingPath] of entries) {
    const container = shared[section];
    if (!container || typeof container !== "object") continue;
    const keys = splitSettingPath(settingPath, section);
    let node = container;
    for (const key of keys.slice(0, -1)) {
      node = node?.[key];
      if (!node || typeof node !== "object") break;
    }
    const leaf = keys[keys.length - 1];
    if (node && typeof node === "object" && leaf in node) {
      delete node[leaf];
      removed.push(`${section}.${settingPath}`);
    }
    pruneEmpty(shared, section);
  }
  if (removed.length > 0) {
    await saveProjectJSON(sharedPath, shared);
  }
  return removed;
}

/** Remove `obj[key]` when it is an object with no remaining keys, recursively. */
function pruneEmpty(obj, key) {
  const value = obj[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const child of Object.keys(value)) pruneEmpty(value, child);
  if (Object.keys(value).length === 0) delete obj[key];
}

async function handleSetProjectSection(
  dir,
  pkg,
  settingPath,
  keyArg,
  valueArg,
  configs,
  flags,
) {
  // A legacy `claude.<field>` write redirects to `llm.claude.<field>` — only
  // the storage location moves. Validation still keys off "claude" so
  // `CLAUDE_VALIDATORS` (which — unlike `LLM_VALIDATORS` — covers all of
  // cli_path/api_key/api_endpoint/model) keeps running exactly as it did
  // before the redirect existed.
  const legacyClaudeWrite = pkg === "claude";
  const storagePkg = legacyClaudeWrite ? "llm" : pkg;
  const storageSettingPath = legacyClaudeWrite ? `claude.${settingPath}` : settingPath;

  if (!configs[storagePkg]) configs[storagePkg] = {};

  const coerced = await coerceAndValidateProjectValue(
    pkg,
    settingPath,
    valueArg,
    keyArg,
    configs,
    flags,
  );

  // Vendor auth preflight for llm.vendor. `--soft-preflight` (used by `ndx init`)
  // downgrades a failed preflight from a fatal abort to a warning so the chosen
  // vendor is still persisted.
  if (pkg === "llm" && settingPath === "vendor") {
    await runLLMVendorPreflight(coerced, configs, flags["soft-preflight"] === "true");
  }

  // Advisory did-you-mean for routing keys. A mistyped class is accepted by
  // the validator on purpose (globs and newer classes must work), so without
  // this the write succeeds, matches nothing, and the user sees no signal.
  if (pkg === "llm") {
    const classNote = describeUnknownTaskClass(settingPath);
    if (classNote) console.error(classNote);
  }

  setByPath(configs[storagePkg], storageSettingPath, coerced, storagePkg);

  const targetFile = isLocalProjectSetting(storagePkg, storageSettingPath)
    ? LOCAL_CONFIG_FILE
    : PROJECT_CONFIG_FILE;
  const configPath = projectConfigPath(dir, targetFile);
  const current = await loadProjectConfigFile(dir, targetFile);
  if (!current[storagePkg] || typeof current[storagePkg] !== "object") {
    current[storagePkg] = {};
  }

  // Vendor-change model reset: capture old values before setting new vendor
  let warningMessages = [];
  let oldVendor, oldClaudeModel, oldCodexModel;
  if (pkg === "llm" && settingPath === "vendor") {
    // Capture old values before overwriting
    oldVendor = current[storagePkg].vendor;
    oldClaudeModel = current[storagePkg].claude?.model;
    oldCodexModel = current[storagePkg].codex?.model;
  }

  setByPath(current[storagePkg], storageSettingPath, coerced, storagePkg);

  // Now perform vendor-change model reset if needed
  if (pkg === "llm" && settingPath === "vendor") {
    const { resetStaleModel, formatVendorChangeWarning, NEWEST_MODELS } =
      await import("@n-dx/llm-client");

    // Check if Claude model needs to be reset
    const claudeReset = resetStaleModel(oldVendor, oldClaudeModel, coerced);
    if (claudeReset.changed) {
      if (current[storagePkg].claude) {
        delete current[storagePkg].claude.model;
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
      if (current[storagePkg].codex) {
        delete current[storagePkg].codex.model;
      }
      const warning = formatVendorChangeWarning(
        codexReset,
        NEWEST_MODELS.codex,
      );
      if (warning) warningMessages.push(warning);
    }
  }

  // Writing `llm.claude.*` used to also mirror the value into the legacy
  // top-level `claude.*` key. That mirror is gone: every reader now resolves
  // the two locations per field (`resolveClaudeConfig` in @n-dx/llm-client), so
  // the legacy copy bought nothing and cost a second place for the same setting
  // to be wrong. Existing `claude.*` values are deliberately left where they
  // are — they are still read until 1.0.0.

  // Write back to the appropriate file (local or project)
  await saveProjectJSON(configPath, current);
  console.log(`${keyArg} = ${formatValue(coerced)}`);

  // `ndx config claude.<field>` itself is deprecated — surfaced on stderr,
  // like the other advisories here, so `--json` stdout stays parseable.
  if (legacyClaudeWrite) {
    console.error(
      `Note: "claude.${settingPath}" is deprecated. Wrote "llm.claude.${settingPath}" instead — ` +
        `use that key directly to avoid this note.`,
    );
  }

  // A local-only setting that already exists in the shared file was written
  // before this routing existed. Setting it again is the documented migration:
  // the value now lives in the local file, so the shared copy is stale at best
  // and a committed secret at worst. Remove it, and any legacy `claude.*` copy
  // of an `llm.claude.*` key along with it — this one still fires, because a
  // secret mirrored into the shared file by an older version must not be left
  // committed just because the mirror that put it there is gone.
  if (targetFile === LOCAL_CONFIG_FILE) {
    const sharedPaths = [[storagePkg, storageSettingPath]];
    if (storagePkg === "llm" && storageSettingPath.startsWith("claude.")) {
      sharedPaths.push(["claude", storageSettingPath.slice("claude.".length)]);
    }
    const removed = await removeFromSharedConfig(dir, sharedPaths);
    if (removed.length > 0) {
      console.log(
        `  → moved ${removed.join(", ")} out of ${projectConfigLabel(dir, PROJECT_CONFIG_FILE)}`
        + ` into ${projectConfigLabel(dir, LOCAL_CONFIG_FILE)}`,
      );
    }
  }

  // Print warnings for cleared models
  for (const warning of warningMessages) {
    console.log(`  ⚠ ${warning.split("\n").join("\n  ")}`);
  }

  // Cascade: local and google vendors require API mode — no CLI binary exists.
  // Automatically persist hench.provider=api so `ndx work` never emits the
  // "vendor=local requires API mode — To persist: ndx config hench.provider api" hint.
  if (pkg === "llm" && settingPath === "vendor" && (coerced === LLM_VENDOR.LOCAL || coerced === LLM_VENDOR.GOOGLE)) {
    const henchConfigPath = join(resolveLayout(dir).henchDir, "config.json");
    try {
      if (await fileExists(henchConfigPath)) {
        const henchConfig = await loadJSON(henchConfigPath);
        if (henchConfig.provider !== "api") {
          henchConfig.provider = "api";
          await saveJSON(henchConfigPath, henchConfig);
          console.log(`  → hench.provider = "api"  (${coerced} vendor requires API mode)`);
        }
      }
    } catch {
      // Best-effort — don't block the vendor write if hench config is missing or invalid.
    }
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

  const existing = getByPath(configs[pkg], settingPath, pkg);
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
  setByPath(rawConfigs[pkg], settingPath, coerced, pkg);

  const configPath = packageConfigPath(dir, pkg);
  await saveJSON(configPath, rawConfigs[pkg]);

  console.log(`${keyArg} = ${formatValue(coerced)}`);
}

// ── GET mode handler ─────────────────────────────────────────────────────────

/** Handle GET mode: retrieve and display a single key or whole section. */
async function handleGet(keyArg, configs, flags) {
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
    // `claude` resolves `llm.claude.*` over the legacy block per field — a
    // project configured entirely under the modern key must not report "no
    // configuration set" just because the legacy section was never written.
    const sectionConfig = pkg === "claude" ? await resolveClaudeSettings(configs) : configs[pkg];
    if (!sectionConfig) {
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
      console.log(JSON.stringify(sectionConfig, null, 2));
    } else {
      printSection(pkg, sectionConfig);
      console.log();
    }
    return;
  }

  const pkg = keyArg.slice(0, dotIdx);
  const settingPath = keyArg.slice(dotIdx + 1);
  const sectionConfig = pkg === "claude" ? await resolveClaudeSettings(configs) : configs[pkg];

  if (!sectionConfig) {
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

  const value = getByPath(sectionConfig, settingPath, pkg);
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
async function handleShowAll(configs, flags) {
  // Resolve `llm.claude.*` over the legacy block per field so a project
  // configured entirely under the modern key still shows a `claude` section,
  // and one with legacy fields beside a partial modern block shows the merge
  // rather than whichever location happened to load into `configs.claude`.
  const claude = await resolveClaudeSettings(configs);
  const displayConfigs = { ...configs };
  if (claude !== undefined) {
    displayConfigs.claude = claude;
  } else {
    delete displayConfigs.claude;
  }

  if (flags.json) {
    console.log(JSON.stringify(displayConfigs, null, 2));
    return;
  }

  console.log("n-dx configuration:");
  for (const [pkg, config] of Object.entries(displayConfigs)) {
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

  // Every config invocation checks the shared file for keys that predate
  // local-only routing. stderr, so `--json` output stays parseable.
  for (const line of formatSharedSecretsWarning(await findSharedSecrets(dir), dir)) {
    console.error(line);
  }

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
      const configPath = projectConfigPath(dir, PROJECT_CONFIG_FILE);
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
    await handleGet(keyArg, configs, flags);
    return;
  }

  // SHOW mode: all configs
  await handleShowAll(configs, flags);
}

/**
 * `ndx auth` — verify the active vendor's credentials on demand.
 *
 * Re-runs the same provider auth preflight used by `ndx init` /
 * `ndx config llm.vendor` so users have a clear, repeatable way to confirm
 * credentials after fixing them (the canonical auth-failure guidance ends
 * with "Verify credentials: ndx auth" pointing here). Works without an
 * initialized project — with no config the default vendor (claude) is
 * checked.
 *
 * On success prints the active vendor, resolved model, and "credentials
 * valid". On failure prints the same structured, JSON-free failure guidance
 * as the config preflight path.
 *
 * @returns {Promise<number>} Exit code: 0 = credentials valid, 1 = failure.
 */
export async function runAuthCheck(args) {
  const { positional } = parseArgs(args);

  // The only meaningful positional is an optional project directory.
  const dir =
    positional[0] && (await fileExists(resolve(positional[0])))
      ? resolve(positional[0])
      : process.cwd();
  const { configs } = await loadAllConfigs(dir);

  const llmConfig =
    configs.llm && typeof configs.llm === "object" ? configs.llm : {};
  const legacyClaude =
    configs.claude && typeof configs.claude === "object"
      ? configs.claude
      : undefined;
  const vendor =
    typeof llmConfig.vendor === "string" && llmConfig.vendor
      ? llmConfig.vendor
      : LLM_VENDOR.CLAUDE;

  const { resolveVendorModel } = await import("@n-dx/llm-client");
  const { green, dim } = await import("./cli-brand.js");
  let model;
  try {
    model = resolveVendorModel(vendor, llmConfig);
  } catch {
    model = "unknown";
  }

  console.log(dim(`Checking ${vendor} credentials…`));
  const preflight = await runVendorAuthPreflight(vendor, llmConfig, legacyClaude);
  if (preflight.ok) {
    console.log(green(`✓ Credentials valid — vendor: ${vendor}, model: ${model}`));
    return 0;
  }

  await printVendorPreflightFailure(vendor, preflight, llmConfig, legacyClaude);
  console.error("Re-run 'ndx auth' after fixing the issue above to verify.");
  return 1;
}
