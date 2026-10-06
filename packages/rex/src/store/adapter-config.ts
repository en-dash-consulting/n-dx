/**
 * Credential redaction and `adapters.json` persistence.
 *
 * What is left of the former adapter registry after the Notion, Jira, Asana and
 * GitHub Projects store adapters were removed. The registry itself went with
 * them — there is exactly one store backend now ({@link FileStore}), so a
 * name→factory lookup had nothing left to resolve. These two concerns outlived
 * it because they are about *credentials on disk*, not about store backends:
 *
 * - **Redaction.** A secret handed to us is never written to `.rex/adapters.json`.
 *   A {@link RedactedField} marker goes there instead, naming the environment
 *   variable that supplies the real value at runtime plus a masked hint for
 *   display.
 * - **Environment resolution.** {@link resolveRedactedConfig} turns a stored
 *   config back into a usable one by reading those variables, and fails loudly
 *   naming the variable when one is unset.
 *
 * Nothing here imports a store, a client or a schema, which is the point: this
 * module is safe to keep while the integrations that motivated it come and go.
 *
 * @module store/adapter-config
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCanonicalJSON } from "../core/canonical.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema for a single config field accepted by an integration. */
export interface AdapterConfigField {
  /** Whether this field must be provided. */
  required: boolean;
  /** Human-readable description shown in help output. */
  description: string;
  /** Whether this field contains sensitive data (tokens, secrets, passwords). */
  sensitive?: boolean;
}

/** A persisted integration configuration entry. */
export interface AdapterConfig {
  /** Integration name, used as the `adapters.json` key and env-var prefix. */
  name: string;
  /** Key-value config (tokens, database IDs, …). Secrets are stored redacted. */
  config: Record<string, unknown>;
}

/** On-disk shape of `adapters.json`. */
interface AdaptersFile {
  adapters: AdapterConfig[];
}

/** Marker stored in `adapters.json` in place of a sensitive value. */
export interface RedactedField {
  __redacted: true;
  /** Environment variable to read at runtime. */
  envVar: string;
  /** Masked preview for display purposes. */
  hint: string;
}

// ---------------------------------------------------------------------------
// Sensitive field detection
// ---------------------------------------------------------------------------

/**
 * Suffixes that mark a config key as holding a secret.
 *
 * Matched against the key with separators stripped, and only at the *end*, so
 * `apiToken` and `api_token` are secrets while `projectKey` is not — a prefix
 * or substring test redacts `projectKey` on the strength of "key" and writes a
 * `__redacted` marker over a value that was never a secret, which then fails to
 * resolve because no one ever set `REX_JIRA_PROJECT_KEY`.
 *
 * This list is deliberately wider than the adapter schemas it replaced. Those
 * schemas carried an explicit `sensitive: true` per field; with them gone the
 * key name is the only signal left, so it has to be the cautious one. Redacting
 * a field that did not need it is a recoverable annoyance; writing a live token
 * into a committed file is not.
 */
const SENSITIVE_SUFFIXES = [
  "token",
  "secret",
  "password",
  "passphrase",
  "apikey",
  "credential",
] as const;

/** Lowercase a key and drop separators: `api_token` / `apiToken` → `apitoken`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Determine whether a config field holds sensitive data.
 *
 * A field is sensitive if the caller's schema marks it `sensitive: true`, or if
 * its key ends with one of {@link SENSITIVE_SUFFIXES}.
 */
export function isSensitiveField(
  key: string,
  schema?: Record<string, AdapterConfigField>,
): boolean {
  if (schema?.[key]?.sensitive) return true;
  const normalized = normalizeKey(key);
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * Derive the environment variable name for a sensitive config field.
 *
 * Convention: `REX_<INTEGRATION>_<FIELD>` in upper-snake-case.
 *
 * @example envVarName("notion", "token") => "REX_NOTION_TOKEN"
 */
export function envVarName(integrationName: string, field: string): string {
  const toUpper = (s: string) =>
    s.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/-/g, "_").toUpperCase();
  return `REX_${toUpper(integrationName)}_${toUpper(field)}`;
}

/**
 * Mask a sensitive value for display.
 *
 * Shows the first and last four characters when the value is long enough to
 * spare them, otherwise `****`.
 */
export function redactValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

/** Type guard for the on-disk {@link RedactedField} marker. */
export function isRedactedField(v: unknown): v is RedactedField {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).__redacted === true &&
    typeof (v as Record<string, unknown>).envVar === "string"
  );
}

/**
 * Resolve a stored config into a usable one by reading redacted fields from the
 * environment.
 *
 * @param integrationName  Name the config was saved under, used only in errors.
 * @param config           Config as read from `adapters.json`.
 * @throws If a redacted field names an environment variable that is not set.
 */
export function resolveRedactedConfig(
  integrationName: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (!isRedactedField(val)) {
      resolved[key] = val;
      continue;
    }
    const envVal = process.env[val.envVar];
    if (!envVal) {
      throw new Error(
        `Environment variable ${val.envVar} is required for ` +
        `"${integrationName}" field "${key}". Set it before continuing.`,
      );
    }
    resolved[key] = envVal;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// adapters.json persistence
// ---------------------------------------------------------------------------

function adaptersPath(rexDir: string): string {
  return join(rexDir, "adapters.json");
}

async function readAdaptersFile(rexDir: string): Promise<AdaptersFile> {
  try {
    const raw = await readFile(adaptersPath(rexDir), "utf-8");
    return JSON.parse(raw) as AdaptersFile;
  } catch {
    return { adapters: [] };
  }
}

async function writeAdaptersFile(rexDir: string, data: AdaptersFile): Promise<void> {
  await writeFile(adaptersPath(rexDir), toCanonicalJSON(data), "utf-8");
}

/** Load every saved integration configuration. */
export async function loadAdapterConfigs(rexDir: string): Promise<AdapterConfig[]> {
  const file = await readAdaptersFile(rexDir);
  return file.adapters;
}

/** Get the saved config for one integration, or `null` if there is none. */
export async function getAdapterConfig(
  rexDir: string,
  name: string,
): Promise<AdapterConfig | null> {
  const configs = await loadAdapterConfigs(rexDir);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * Save (or replace) an integration configuration.
 *
 * Sensitive fields are redacted before the entry reaches disk; the real values
 * must be supplied through the environment variables named in the markers.
 *
 * @param schema  Optional field schema, consulted for explicit `sensitive`
 *                flags on keys whose name does not give them away.
 */
export async function saveAdapterConfig(
  rexDir: string,
  entry: AdapterConfig,
  schema?: Record<string, AdapterConfigField>,
): Promise<void> {
  const persistedConfig: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(entry.config)) {
    if (isSensitiveField(key, schema) && typeof val === "string") {
      persistedConfig[key] = {
        __redacted: true,
        envVar: envVarName(entry.name, key),
        hint: redactValue(val),
      } satisfies RedactedField;
    } else {
      persistedConfig[key] = val;
    }
  }

  const file = await readAdaptersFile(rexDir);
  const persistedEntry: AdapterConfig = { name: entry.name, config: persistedConfig };
  const idx = file.adapters.findIndex((a) => a.name === entry.name);
  if (idx >= 0) {
    file.adapters[idx] = persistedEntry;
  } else {
    file.adapters.push(persistedEntry);
  }
  await writeAdaptersFile(rexDir, file);
}

/** Remove a saved integration configuration. */
export async function removeAdapterConfig(rexDir: string, name: string): Promise<void> {
  const file = await readAdaptersFile(rexDir);
  file.adapters = file.adapters.filter((a) => a.name !== name);
  await writeAdaptersFile(rexDir, file);
}
