/**
 * Per-vendor live model list and installed-CLI probe behind GET /api/llm/catalog.
 *
 * Neither the `claude` nor the `codex` CLI can list models, so the live list
 * comes from the vendor API (`listVendorModels` in `@n-dx/llm-client`) and needs
 * a key. Without one, or when the call fails, the caller keeps the built-in
 * list — this module only reports what it learned and never throws.
 *
 * Both the list and the `<binary> --version` probe cost a network round trip or
 * a process spawn, so the pair is cached per project and vendor for
 * {@link CATALOG_CACHE_TTL_MS}. `?refresh=true` refills it and a config save
 * clears it, because either can change which key or binary applies.
 */

import {
  LLM_VENDOR,
  exec,
  listVendorModels,
  loadLLMConfig,
  resolveApiKey,
  resolveGoogleApiKey,
  resolveVendorCliEnv,
} from "@n-dx/llm-client";
import type { LLMConfig, ListableVendor } from "@n-dx/llm-client";

/** How long a live list and CLI probe are served before they are fetched again. */
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

const CLI_PROBE_TIMEOUT_MS = 5000;

/** The installed CLI for a vendor, from `<binary> --version`. */
export interface CliInfo {
  found: boolean;
  version: string | null;
  path: string | null;
}

/** What one vendor's live lookup produced. */
export interface LiveVendorProbe {
  listing: { ok: true; models: string[] } | { ok: false; reason: string };
  /** ISO time the listing was fetched. */
  checkedAt: string;
  cli: CliInfo;
}

interface CacheEntry {
  expiresAt: number;
  probe: LiveVendorProbe;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (projectDir: string, vendor: ListableVendor): string => `${projectDir}\0${vendor}`;

/** Drop every cached probe for `projectDir` (after a config save). */
export function clearLlmCatalogCache(projectDir: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${projectDir}\0`)) cache.delete(key);
  }
}

/**
 * The binary a run would invoke for `vendor`: `CLAUDE_CLI_PATH`, then the
 * vendor's `cli_path`, else the bare name resolved on PATH. `config` is
 * `loadLLMConfig`'s, which drops a `cli_path` the shared project config sets
 * while the repository is untrusted, so the probe never spawns a binary the
 * repository chose; the user's `.n-dx.local.json` always applies.
 */
function resolveBinary(vendor: ListableVendor, config: LLMConfig): string {
  if (vendor === LLM_VENDOR.CLAUDE) {
    return process.env.CLAUDE_CLI_PATH || config.claude?.cli_path || "claude";
  }
  return config.codex?.cli_path || "codex";
}

/** First `1.2.3`-shaped token in `--version` output (`2.1.0 (Claude Code)`, `codex-cli 0.46.0`). */
function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(output)?.[0] ?? null;
}

/**
 * `<binary> --version`, with the vendor's filtered environment from
 * `resolveVendorCliEnv` (the agent loop's resolver), so no credential outside
 * the vendor's mode reaches the binary or anything it runs.
 */
async function probeCli(vendor: ListableVendor, projectDir: string, config: LLMConfig): Promise<CliInfo> {
  const binary = resolveBinary(vendor, config);
  const env = resolveVendorCliEnv({ ...config, vendor });
  const result = await exec(binary, ["--version"], { cwd: projectDir, timeout: CLI_PROBE_TIMEOUT_MS, env });
  if (!result.launched || result.exitCode !== 0) return { found: false, version: null, path: null };
  return { found: true, version: parseVersion(result.stdout) ?? parseVersion(result.stderr), path: binary };
}

async function probeVendor(
  vendor: ListableVendor,
  projectDir: string,
  config: LLMConfig,
): Promise<LiveVendorProbe> {
  const [listing, cli] = await Promise.all([
    listVendorModels(vendor, config),
    probeCli(vendor, projectDir, config),
  ]);
  return { listing, checkedAt: new Date().toISOString(), cli };
}

/**
 * The live list and CLI probe for `vendor`, from cache while fresh.
 * `refresh` bypasses the cache and refills it.
 */
export async function getLiveVendorProbe(
  vendor: ListableVendor,
  projectDir: string,
  options: { refresh?: boolean } = {},
): Promise<LiveVendorProbe> {
  const key = cacheKey(projectDir, vendor);
  const hit = cache.get(key);
  if (!options.refresh && hit && hit.expiresAt > Date.now()) return hit.probe;

  const probe = await probeVendor(vendor, projectDir, await loadLLMConfig(projectDir));
  cache.set(key, { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, probe });
  return probe;
}

/** Whether a vendor can run as configured, with the line its card shows as-is. */
export interface VendorReadiness {
  state: "ready" | "needs-setup" | "unreachable";
  summary: string;
  /** Whether an API key resolves. Presence only: the key never leaves the server. Omitted where no key applies. */
  apiKey?: boolean;
}

const cliReadiness = (cli: CliInfo): VendorReadiness =>
  cli.found
    ? { state: "ready", summary: cli.version ? `Ready · CLI ${cli.version}` : "Ready · CLI" }
    : { state: "needs-setup", summary: "CLI not found" };

const apiKeyReadiness = (hasKey: boolean): VendorReadiness =>
  hasKey
    ? { state: "ready", summary: "Ready · API key set", apiKey: true }
    : { state: "needs-setup", summary: "API key missing", apiKey: false };

/**
 * Claude's readiness on the provider `ndx work` would run it on: the CLI probe
 * for `cli`, a resolved API key for `api`. `apiKey` is reported either way.
 */
export function claudeReadiness(
  provider: "cli" | "api",
  cli: CliInfo,
  config: LLMConfig,
): VendorReadiness {
  const hasKey = Boolean(resolveApiKey(config.claude ?? {}));
  if (provider === "api") return apiKeyReadiness(hasKey);
  return { ...cliReadiness(cli), apiKey: hasKey };
}

/** Codex has no API provider, so only its CLI counts. */
export function codexReadiness(cli: CliInfo): VendorReadiness {
  return cliReadiness(cli);
}

/** Gemini runs on the API alone, from `llm.google.api_key` or `GEMINI_API_KEY` (config never carries an env-var name). */
export function googleReadiness(config: LLMConfig): VendorReadiness {
  return apiKeyReadiness(Boolean(resolveGoogleApiKey(config.google)));
}

/**
 * The local server is ready when it answers; `address` is `host:port`.
 *
 * `shapeError` is the message the saved host or port failed the shape check
 * with. That endpoint was never contacted, so it is a configuration to fix,
 * not a connection that failed: the card says `needs-setup` and carries the
 * shape error as its line, where `unreachable · host:port` would claim a
 * server that was never probed.
 */
export function localReadiness(reachable: boolean, address: string, shapeError: string | null = null): VendorReadiness {
  if (shapeError) return { state: "needs-setup", summary: shapeError };
  return reachable
    ? { state: "ready", summary: `Ready · ${address}` }
    : { state: "unreachable", summary: `Not reachable · ${address}` };
}
