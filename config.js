/**
 * Unified config command for n-dx.
 *
 * Usage:
 *   n-dx config [dir]                    Show all package configs
 *   n-dx config <key> [dir]              Get a specific value (e.g. hench.model)
 *   n-dx config <key> <value> [dir]      Set a specific value
 *   n-dx config --json [dir]             Output as JSON
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";

const PROJECT_CONFIG_FILE = ".n-dx.json";

const PACKAGES = {
  rex: { dir: ".rex", file: "config.json" },
  hench: { dir: ".hench", file: "config.json" },
  sourcevision: { dir: ".sourcevision", file: "manifest.json" },
};

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

function printSection(label, config) {
  console.log(`\n  ${label}`);
  const entries = flattenConfig(config);
  const maxPath = Math.max(...entries.map((e) => e.path.length));
  for (const { path, value } of entries) {
    console.log(`    ${path.padEnd(maxPath + 2)}${formatValue(value)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runConfig(args) {
  // Parse flags and positional args
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

  if (flags.help) {
    console.log(`n-dx config — view and edit settings across all packages

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

Project config (.n-dx.json):
  Place a .n-dx.json file at the project root to override package settings.
  Uses the same package-scoped keys (rex, hench). Project config takes
  precedence over individual package configs. Deep merges nested objects;
  arrays are replaced entirely. Example:

    {
      "rex":   { "validate": "pnpm typecheck" },
      "hench": { "model": "opus", "guard": { "commandTimeout": 60000 } }
    }

Options:
  --json                   Output as JSON
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
  n-dx config --json                           Show all settings as JSON
  n-dx config hench --json                     Show hench settings as JSON`);
    return;
  }

  // Resolve dir: last positional arg that looks like a directory
  let dir = process.cwd();
  let keyArg = positional[0];
  let valueArg = positional[1];

  // If there are 3 positional args, last is dir
  // If there are 2, check if last is a dir
  // If there is 1, check if it's a dir (show mode) or a key (get mode)
  if (positional.length >= 3) {
    dir = resolve(positional[positional.length - 1]);
    valueArg = positional[positional.length - 2];
    keyArg = positional[0];
  } else if (positional.length === 2) {
    // Could be: key value, OR key dir
    // If valueArg looks like a package key, treat as key+value
    // Otherwise try to detect if it's a directory
    if (await fileExists(resolve(positional[1]))) {
      // It's a directory — this is get mode
      dir = resolve(positional[1]);
      keyArg = positional[0];
      valueArg = undefined;
    }
    // Otherwise keep as key + value
  } else if (positional.length === 1) {
    if (await fileExists(resolve(positional[0]))) {
      // It's a directory — show mode
      dir = resolve(positional[0]);
      keyArg = undefined;
    }
    // Otherwise it's a key — get mode
  }

  // Load project-level .n-dx.json overrides
  const projectConfig = await loadProjectConfig(dir);

  // Load all available configs and merge with project overrides
  const configs = {};
  for (const [pkg, meta] of Object.entries(PACKAGES)) {
    const configPath = join(dir, meta.dir, meta.file);
    if (await fileExists(configPath)) {
      try {
        const pkgConfig = await loadJSON(configPath);
        // Merge project config overrides (project takes precedence)
        configs[pkg] = projectConfig[pkg]
          ? deepMerge(pkgConfig, projectConfig[pkg])
          : pkgConfig;
      } catch (err) {
        configs[pkg] = { _error: err.message };
      }
    }
  }

  if (Object.keys(configs).length === 0) {
    console.error("No n-dx configuration found. Run 'n-dx init' first.");
    process.exit(1);
  }

  // --- SET mode: key + value ---
  if (keyArg && valueArg !== undefined) {
    const dotIdx = keyArg.indexOf(".");
    if (dotIdx === -1) {
      console.error(
        `Invalid key "${keyArg}". Use dot notation: <package>.<setting>`,
      );
      process.exit(1);
    }

    const pkg = keyArg.slice(0, dotIdx);
    const settingPath = keyArg.slice(dotIdx + 1);

    if (!PACKAGES[pkg]) {
      console.error(
        `Unknown package "${pkg}". Available: ${Object.keys(PACKAGES).join(", ")}`,
      );
      process.exit(1);
    }

    if (pkg === "sourcevision") {
      console.error("Sourcevision manifest is read-only (generated by analysis).");
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

    // Prevent editing schema version
    if (settingPath === "schema") {
      console.error("Cannot modify schema version.");
      process.exit(1);
    }

    const existing = getByPath(configs[pkg], settingPath);
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
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

    setByPath(configs[pkg], settingPath, coerced);

    const meta = PACKAGES[pkg];
    const configPath = join(dir, meta.dir, meta.file);
    await saveJSON(configPath, configs[pkg]);

    console.log(`${keyArg} = ${formatValue(coerced)}`);
    return;
  }

  // --- GET mode: single key ---
  if (keyArg) {
    const dotIdx = keyArg.indexOf(".");
    if (dotIdx === -1) {
      // Show whole package config
      const pkg = keyArg;
      if (!configs[pkg]) {
        console.error(
          `Package "${pkg}" is not initialized or has no config.`,
        );
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
      console.error(
        `Package "${pkg}" is not initialized or has no config.`,
      );
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
    return;
  }

  // --- SHOW mode: all configs ---
  if (flags.json) {
    console.log(JSON.stringify(configs, null, 2));
    return;
  }

  console.log("n-dx configuration:");
  for (const [pkg, config] of Object.entries(configs)) {
    if (config._error) {
      console.log(`\n  ${pkg} (error: ${config._error})`);
    } else {
      printSection(pkg, config);
    }
  }
  console.log();
}
