/**
 * CLI command: rex adapter
 *
 * Manage store adapter registrations and configurations.
 *
 *   rex adapter list [dir]                     List registered adapters
 *   rex adapter add <name> [--key=val] [dir]   Configure an adapter
 *   rex adapter remove <name> [dir]            Remove adapter config
 *   rex adapter show <name> [dir]              Show adapter config
 */

import { join } from "node:path";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import { CLIError } from "../errors.js";
import { getDefaultRegistry } from "../../store/adapter-registry.js";
import type { AdapterConfig } from "../../store/adapter-registry.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function adapterList(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const registry = getDefaultRegistry();
  const rexDir = join(dir, REX_DIR);
  const adapters = registry.list();
  const configs = await registry.loadAdapterConfigs(rexDir);
  const configuredNames = new Set(configs.map((c) => c.name));

  if (flags.format === "json") {
    result(
      JSON.stringify(
        adapters.map((a) => ({
          ...a,
          configured: configuredNames.has(a.name),
        })),
        null,
        2,
      ),
    );
    return;
  }

  info("Registered adapters:\n");
  for (const adapter of adapters) {
    const tag = adapter.builtIn ? " (built-in)" : "";
    const configured = configuredNames.has(adapter.name) ? " ✓ configured" : "";
    result(`  ${adapter.name}${tag}${configured}`);
    info(`    ${adapter.description}`);

    const fields = Object.entries(adapter.configSchema);
    if (fields.length > 0) {
      info("    Config:");
      for (const [key, schema] of fields) {
        const req = schema.required ? "required" : "optional";
        info(`      ${key} (${req}) — ${schema.description}`);
      }
    }
    info("");
  }
}

async function adapterAdd(
  dir: string,
  name: string,
  flags: Record<string, string>,
): Promise<void> {
  const registry = getDefaultRegistry();
  const rexDir = join(dir, REX_DIR);

  // Validate adapter exists
  const def = registry.get(name);
  if (!def) {
    const available = registry.list().map((a) => a.name).join(", ");
    throw new CLIError(
      `Unknown adapter "${name}".`,
      `Available adapters: ${available}`,
    );
  }

  // Build config from flags (strip known non-config flags)
  const SKIP_FLAGS = new Set([
    "help",
    "quiet",
    "format",
  ]);
  const config: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(flags)) {
    if (!SKIP_FLAGS.has(key)) {
      config[key] = val;
    }
  }

  // Validate required fields
  const missing: string[] = [];
  for (const [field, schema] of Object.entries(def.configSchema)) {
    if (schema.required && (config[field] === undefined || config[field] === "")) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    const hints = missing
      .map((f) => `--${f}=<value>`)
      .join(" ");
    throw new CLIError(
      `Missing required config for "${name}": ${missing.join(", ")}`,
      `Usage: rex adapter add ${name} ${hints}`,
    );
  }

  const entry: AdapterConfig = { name, config };
  await registry.saveAdapterConfig(rexDir, entry);

  result(`Adapter "${name}" configured.`);
  info(`Config saved to ${rexDir}/adapters.json`);
}

async function adapterRemove(
  dir: string,
  name: string,
): Promise<void> {
  const registry = getDefaultRegistry();
  const rexDir = join(dir, REX_DIR);

  // Check if config exists
  const existing = await registry.getAdapterConfig(rexDir, name);
  if (!existing) {
    throw new CLIError(
      `No configuration found for adapter "${name}".`,
      "Run 'rex adapter list' to see configured adapters.",
    );
  }

  await registry.removeAdapterConfig(rexDir, name);
  result(`Adapter "${name}" configuration removed.`);
}

async function adapterShow(
  dir: string,
  name: string,
  flags: Record<string, string>,
): Promise<void> {
  const registry = getDefaultRegistry();
  const rexDir = join(dir, REX_DIR);

  const def = registry.get(name);
  const config = await registry.getAdapterConfig(rexDir, name);

  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          name,
          registered: !!def,
          configured: !!config,
          definition: def
            ? {
                description: def.description,
                builtIn: (new Set(["file", "notion"])).has(name),
                configSchema: def.configSchema,
              }
            : null,
          config: config?.config ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!def) {
    throw new CLIError(
      `Unknown adapter "${name}".`,
      "Run 'rex adapter list' to see registered adapters.",
    );
  }

  result(`Adapter: ${name}`);
  info(`  Description: ${def.description}`);
  info(`  Built-in: ${(new Set(["file", "notion"])).has(name) ? "yes" : "no"}`);

  if (config) {
    info("  Configuration:");
    for (const [key, val] of Object.entries(config.config)) {
      // Redact sensitive-looking values in display
      const display = isSensitive(key) ? redact(String(val)) : String(val);
      info(`    ${key}: ${display}`);
    }
  } else {
    info("  Not configured. Run 'rex adapter add " + name + "' to configure.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set(["token", "secret", "apikey", "api_key", "password"]);

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redact(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function cmdAdapter(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const subcommand = positional[0];

  if (!subcommand || flags.help === "true") {
    result(`rex adapter — manage store adapter registrations

Usage:
  rex adapter list [dir]                     List registered adapters
  rex adapter add <name> [--key=val] [dir]   Configure an adapter
  rex adapter remove <name> [dir]            Remove adapter config
  rex adapter show <name> [dir]              Show adapter config details

Examples:
  rex adapter list
  rex adapter add notion --token=secret_abc --databaseId=abc123
  rex adapter show notion
  rex adapter remove notion`);
    return;
  }

  switch (subcommand) {
    case "list":
      await adapterList(dir, flags);
      break;
    case "add": {
      const name = positional[1];
      if (!name) {
        throw new CLIError(
          "Missing adapter name.",
          "Usage: rex adapter add <name> [--key=val ...]",
        );
      }
      await adapterAdd(dir, name, flags);
      break;
    }
    case "remove": {
      const name = positional[1];
      if (!name) {
        throw new CLIError(
          "Missing adapter name.",
          "Usage: rex adapter remove <name>",
        );
      }
      await adapterRemove(dir, name);
      break;
    }
    case "show": {
      const name = positional[1];
      if (!name) {
        throw new CLIError(
          "Missing adapter name.",
          "Usage: rex adapter show <name>",
        );
      }
      await adapterShow(dir, name, flags);
      break;
    }
    default:
      throw new CLIError(
        `Unknown adapter subcommand: ${subcommand}`,
        "Run 'rex adapter --help' to see available subcommands.",
      );
  }
}
