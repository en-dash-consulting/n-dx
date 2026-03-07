/**
 * Adapter registration system for rex store backends.
 *
 * Provides a registry for store adapter factories, config persistence,
 * and store creation from registered adapters. Built-in adapters (file, notion)
 * are registered automatically. Custom adapters can be registered at runtime.
 *
 * Adapter configurations are persisted in `.rex/adapters.json` so that
 * configured adapters survive across CLI invocations.
 *
 * @module store/adapter-registry
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCanonicalJSON } from "../core/canonical.js";
import { FileStore } from "./file-adapter.js";
import { NotionStore } from "./notion-adapter.js";
import { LiveNotionClient } from "./notion-client.js";
import type { PRDStore } from "./contracts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema for a single config field accepted by an adapter. */
export interface AdapterConfigField {
  /** Whether this field must be provided when creating the store. */
  required: boolean;
  /** Human-readable description shown in help output. */
  description: string;
  /** Whether this field contains sensitive data (tokens, secrets, passwords). */
  sensitive?: boolean;
}

/**
 * Factory function that creates a PRDStore instance.
 *
 * @param rexDir  The `.rex/` directory path.
 * @param config  Key-value config entries for this adapter (tokens, IDs, etc.).
 */
export type AdapterFactory = (
  rexDir: string,
  config: Record<string, unknown>,
) => PRDStore;

/**
 * A complete adapter definition: metadata + factory.
 *
 * Register one of these via {@link AdapterRegistry.register}.
 */
export interface AdapterDefinition {
  /** Unique adapter name (e.g. `"file"`, `"notion"`, `"postgres"`). */
  name: string;
  /** Short description for list/help output. */
  description: string;
  /** Config fields this adapter accepts. Used for validation and help. */
  configSchema: Record<string, AdapterConfigField>;
  /** Factory that produces a PRDStore from a rexDir and config. */
  factory: AdapterFactory;
}

/** Metadata returned by {@link AdapterRegistry.list}. */
export interface AdapterInfo {
  name: string;
  description: string;
  builtIn: boolean;
  configSchema: Record<string, AdapterConfigField>;
}

/** A persisted adapter configuration entry. */
export interface AdapterConfig {
  /** Adapter name (must match a registered adapter). */
  name: string;
  /** Key-value config for this adapter (tokens, database IDs, etc.). */
  config: Record<string, unknown>;
}

/** On-disk shape of adapters.json. */
interface AdaptersFile {
  adapters: AdapterConfig[];
}

// ---------------------------------------------------------------------------
// Sensitive field helpers
// ---------------------------------------------------------------------------

/** Key names that are always treated as sensitive, regardless of schema. */
const SENSITIVE_KEYS = new Set(["token", "secret", "apikey", "api_key", "password"]);

/**
 * Determine whether a config field holds sensitive data.
 *
 * A field is sensitive if:
 * 1. The adapter schema explicitly marks it `sensitive: true`, OR
 * 2. The field key matches a well-known sensitive name (case-insensitive).
 */
function fieldIsSensitive(
  key: string,
  schema?: Record<string, AdapterConfigField>,
): boolean {
  if (schema?.[key]?.sensitive) return true;
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Derive the environment variable name for a sensitive adapter config field.
 *
 * Convention: `REX_<ADAPTER>_<FIELD>` in upper-snake-case.
 *
 * @example envVarName("notion", "token") => "REX_NOTION_TOKEN"
 */
function envVarName(adapterName: string, field: string): string {
  const toUpper = (s: string) =>
    s.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/-/g, "_").toUpperCase();
  return `REX_${toUpper(adapterName)}_${toUpper(field)}`;
}

/**
 * Redact a sensitive value for on-disk storage.
 *
 * Shows first 4 and last 4 characters if long enough, otherwise `****`.
 */
function redactValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

/** Marker stored in adapters.json for sensitive fields. */
interface RedactedField {
  __redacted: true;
  /** Environment variable to read at runtime. */
  envVar: string;
  /** Masked preview for display purposes. */
  hint: string;
}

export function isRedactedField(v: unknown): v is RedactedField {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).__redacted === true &&
    typeof (v as Record<string, unknown>).envVar === "string"
  );
}

// ---------------------------------------------------------------------------
// Built-in adapter definitions
// ---------------------------------------------------------------------------

const BUILT_IN_NAMES = new Set(["file", "notion"]);

function fileAdapterDef(): AdapterDefinition {
  return {
    name: "file",
    description: "Local filesystem storage (default)",
    configSchema: {},
    factory: (rexDir) => new FileStore(rexDir),
  };
}

function notionAdapterDef(): AdapterDefinition {
  return {
    name: "notion",
    description: "Notion database backend",
    configSchema: {
      token: { required: true, sensitive: true, description: "Notion integration token (secret_xxx or ntn_xxx)" },
      databaseId: { required: true, description: "Notion database ID" },
    },
    factory: (rexDir, config) => {
      const token = config.token as string;
      const databaseId = config.databaseId as string;
      const client = new LiveNotionClient(token);
      return new NotionStore(rexDir, client, { token, databaseId });
    },
  };
}

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for store adapter definitions.
 *
 * Built-in adapters (`file`, `notion`) are always available.
 * Custom adapters can be registered at runtime for extensibility.
 */
export class AdapterRegistry {
  private adapters = new Map<string, AdapterDefinition>();

  constructor() {
    this.adapters.set("file", fileAdapterDef());
    this.adapters.set("notion", notionAdapterDef());
  }

  // ---- Registration ------------------------------------------------------

  /**
   * Register a new store adapter.
   *
   * @throws If `name` is empty or already registered.
   */
  register(def: AdapterDefinition): void {
    if (!def.name || def.name.trim().length === 0) {
      throw new Error("Adapter name must not be empty");
    }
    if (this.adapters.has(def.name)) {
      throw new Error(`Adapter "${def.name}" is already registered`);
    }
    this.adapters.set(def.name, def);
  }

  /**
   * Remove a previously registered adapter.
   *
   * Built-in adapters (`file`, `notion`) cannot be unregistered.
   *
   * @throws If the adapter is built-in or not found.
   */
  unregister(name: string): void {
    if (BUILT_IN_NAMES.has(name)) {
      throw new Error(`Cannot unregister built-in adapter "${name}"`);
    }
    if (!this.adapters.has(name)) {
      throw new Error(`Adapter "${name}" not found`);
    }
    this.adapters.delete(name);
  }

  // ---- Lookup ------------------------------------------------------------

  /** Get a registered adapter definition by name, or `undefined` if unknown. */
  get(name: string): AdapterDefinition | undefined {
    return this.adapters.get(name);
  }

  /** List all registered adapters with metadata. */
  list(): AdapterInfo[] {
    return Array.from(this.adapters.values()).map((def) => ({
      name: def.name,
      description: def.description,
      builtIn: BUILT_IN_NAMES.has(def.name),
      configSchema: def.configSchema,
    }));
  }

  // ---- Store creation ----------------------------------------------------

  /**
   * Create a PRDStore from a registered adapter.
   *
   * Validates required config fields before calling the factory.
   *
   * @throws If the adapter is unknown or required config fields are missing.
   */
  create(
    adapterName: string,
    rexDir: string,
    config: Record<string, unknown>,
  ): PRDStore {
    const def = this.adapters.get(adapterName);
    if (!def) {
      const available = Array.from(this.adapters.keys()).join(", ");
      throw new Error(
        `Unknown adapter "${adapterName}". Available adapters: ${available}`,
      );
    }

    // Validate required fields
    const missing: string[] = [];
    for (const [field, schema] of Object.entries(def.configSchema)) {
      if (schema.required && (config[field] === undefined || config[field] === "")) {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Required config fields missing for adapter "${adapterName}": ${missing.join(", ")}`,
      );
    }

    return def.factory(rexDir, config);
  }

  /**
   * Create a store using a saved adapter config from `adapters.json`.
   *
   * Redacted sensitive fields are resolved from environment variables
   * before passing the config to the adapter factory.
   *
   * @throws If no config exists for the adapter, or the adapter is unknown,
   *         or required env vars for sensitive fields are not set.
   */
  async createFromConfig(rexDir: string, adapterName: string): Promise<PRDStore> {
    const adapterConfig = await this.getAdapterConfig(rexDir, adapterName);
    if (!adapterConfig) {
      throw new Error(
        `No config found for adapter "${adapterName}". ` +
        `Run 'rex adapter add ${adapterName}' to configure it.`,
      );
    }

    // Resolve redacted fields from environment variables
    const resolvedConfig: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(adapterConfig.config)) {
      if (isRedactedField(val)) {
        const envVal = process.env[val.envVar];
        if (!envVal) {
          throw new Error(
            `Environment variable ${val.envVar} is required for ` +
            `adapter "${adapterName}" field "${key}". ` +
            `Set it before running sync.`,
          );
        }
        resolvedConfig[key] = envVal;
      } else {
        resolvedConfig[key] = val;
      }
    }

    return this.create(adapterName, rexDir, resolvedConfig);
  }

  // ---- Config persistence ------------------------------------------------

  private adaptersPath(rexDir: string): string {
    return join(rexDir, "adapters.json");
  }

  private async readAdaptersFile(rexDir: string): Promise<AdaptersFile> {
    try {
      const raw = await readFile(this.adaptersPath(rexDir), "utf-8");
      return JSON.parse(raw) as AdaptersFile;
    } catch {
      return { adapters: [] };
    }
  }

  private async writeAdaptersFile(
    rexDir: string,
    data: AdaptersFile,
  ): Promise<void> {
    await writeFile(this.adaptersPath(rexDir), toCanonicalJSON(data), "utf-8");
  }

  /**
   * Save (or overwrite) an adapter configuration.
   *
   * If an entry for the same adapter name already exists, it is replaced.
   * Sensitive fields (tokens, secrets) are redacted on disk and must be
   * provided via environment variables at runtime.
   */
  async saveAdapterConfig(rexDir: string, entry: AdapterConfig): Promise<void> {
    const def = this.adapters.get(entry.name);
    const schema = def?.configSchema;

    // Redact sensitive fields before persisting
    const persistedConfig: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entry.config)) {
      if (fieldIsSensitive(key, schema) && typeof val === "string") {
        persistedConfig[key] = {
          __redacted: true,
          envVar: envVarName(entry.name, key),
          hint: redactValue(val),
        } satisfies RedactedField;
      } else {
        persistedConfig[key] = val;
      }
    }

    const persistedEntry: AdapterConfig = {
      name: entry.name,
      config: persistedConfig,
    };

    const file = await this.readAdaptersFile(rexDir);
    const idx = file.adapters.findIndex((a) => a.name === entry.name);
    if (idx >= 0) {
      file.adapters[idx] = persistedEntry;
    } else {
      file.adapters.push(persistedEntry);
    }
    await this.writeAdaptersFile(rexDir, file);
  }

  /** Remove a saved adapter configuration. */
  async removeAdapterConfig(rexDir: string, name: string): Promise<void> {
    const file = await this.readAdaptersFile(rexDir);
    file.adapters = file.adapters.filter((a) => a.name !== name);
    await this.writeAdaptersFile(rexDir, file);
  }

  /** Load all saved adapter configurations. */
  async loadAdapterConfigs(rexDir: string): Promise<AdapterConfig[]> {
    const file = await this.readAdaptersFile(rexDir);
    return file.adapters;
  }

  /** Get saved config for a specific adapter, or `null` if not found. */
  async getAdapterConfig(
    rexDir: string,
    name: string,
  ): Promise<AdapterConfig | null> {
    const configs = await this.loadAdapterConfigs(rexDir);
    return configs.find((c) => c.name === name) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Singleton — shared across the process
// ---------------------------------------------------------------------------

let _defaultRegistry: AdapterRegistry | null = null;

/**
 * Get the default (process-wide) adapter registry.
 *
 * Lazily created on first call. Custom adapters registered here are
 * available to `createStore` and the CLI.
 */
export function getDefaultRegistry(): AdapterRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new AdapterRegistry();
  }
  return _defaultRegistry;
}

/**
 * Reset the default registry (for testing only).
 * @internal
 */
export function resetDefaultRegistry(): void {
  _defaultRegistry = null;
}
