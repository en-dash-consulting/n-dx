/**
 * Per-vendor live model list and installed-CLI probe behind GET /api/llm/catalog.
 *
 * Codex CLI uses its model/list catalog; direct API uses the OpenAI model list.
 * Neither proves inference access. Claude uses its vendor API. Codex probes are not cached:
 * account, CLI config and PATH changes must apply on the next request.
 */

import {
  ClaudeClientError,
  LLM_VENDOR,
  exec,
  listVendorModels,
  listCodexModels,
  loadLLMConfig,
  repoEnvPolicy,
  resolveGoogleApiKey,
  resolveVendorAuth,
  resolveVendorCliEnv,
} from "@n-dx/llm-client";
import type { LLMConfig, ListableVendor } from "@n-dx/llm-client";
import { isProjectRestricted } from "./trust-gate.js";

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
 * The environment the vendor's runs get, under the project's own
 * `llm.<vendor>.auth`. `--version` needs no credential, so where `api` has no
 * usable key — the one case `resolveVendorCliEnv` refuses — the probe runs as
 * `cli` instead of failing.
 */
function probeEnv(vendor: ListableVendor, projectDir: string, config: LLMConfig): NodeJS.ProcessEnv {
  const policy = repoEnvPolicy(projectDir);
  const vendorConfig: LLMConfig = { ...config, vendor };
  try {
    return resolveVendorCliEnv(vendorConfig, policy);
  } catch (err) {
    if (!(err instanceof ClaudeClientError) || err.reason !== "auth") throw err;
    return resolveVendorCliEnv({ ...vendorConfig, [vendor]: { ...config[vendor], auth: "cli" } }, policy);
  }
}

/**
 * `<binary> --version`, with the vendor's filtered environment from
 * `resolveVendorCliEnv` (the agent loop's resolver) under the project's
 * `guard.env` policy from `repoEnvPolicy` (the user's own deny entries, the
 * repository's allow only while trusted), so no credential outside the
 * vendor's mode, and none the user denied, reaches the binary or anything it runs.
 */
async function probeCli(vendor: ListableVendor, projectDir: string, config: LLMConfig): Promise<CliInfo> {
  const binary = resolveBinary(vendor, config);
  const env = probeEnv(vendor, projectDir, config);
  const result = await exec(binary, ["--version"], { cwd: projectDir, timeout: CLI_PROBE_TIMEOUT_MS, env });
  if (!result.launched || result.exitCode !== 0) return { found: false, version: null, path: null };
  return { found: true, version: parseVersion(result.stdout) ?? parseVersion(result.stderr), path: binary };
}

/**
 * The live list and the CLI probe, from `config` as `loadLLMConfig` returns
 * it. Neither needs a trust check of its own: the loader drops the `cli_path`
 * the shared project config sets until the repository is accepted (and clamps
 * a committed `.n-dx.local.json` the same way), so the probe runs only a
 * binary the operator chose; and the listing always goes to the vendor's own
 * models URL, never a configured `api_endpoint`, so the repository cannot
 * redirect the operator's key.
 */
async function probeVendor(
  vendor: ListableVendor,
  projectDir: string,
  config: LLMConfig,
  provider?: "cli" | "api",
): Promise<LiveVendorProbe> {
  if (vendor === LLM_VENDOR.CODEX && provider === "api") {
    // Catalog probes only contact the public vendor URL. A custom endpoint's
    // credential belongs to that endpoint and cannot be used for this probe.
    if (config.codex?.api_endpoint && config.codex.api_endpoint.replace(/\/+$/, "") !== "https://api.openai.com/v1") {
      return {
        listing: { ok: false, reason: "Live discovery is unavailable for custom OpenAI endpoints." },
        checkedAt: new Date().toISOString(), cli: { found: false, version: null, path: null },
      };
    }
    const auth = resolveVendorAuth(vendor, config);
    const listing: LiveVendorProbe["listing"] = auth.mode === "api" && auth.key
      ? await listVendorModels(vendor, { ...config, codex: { ...config.codex, api_key: auth.key.value } })
      : { ok: false, reason: "OpenAI API key unavailable under llm.codex.auth; configure API authentication before refreshing." };
    return { listing, checkedAt: new Date().toISOString(), cli: { found: false, version: null, path: null } };
  }
  if (vendor === LLM_VENDOR.CODEX) {
    const cli = await probeCli(vendor, projectDir, config);
    let listing: LiveVendorProbe["listing"];
    if (isProjectRestricted(projectDir)) {
      listing = { ok: false, reason: "Codex catalog not probed: accept this checkout with n-dx trust accept . before refreshing." };
    } else if (!cli.found) {
      listing = { ok: false, reason: "Codex CLI unavailable; check llm.codex.cli_path, install or update Codex, then refresh." };
    } else {
      try {
        const env = resolveVendorCliEnv({ ...config, vendor }, repoEnvPolicy(projectDir));
        listing = await listCodexModels({ binary: resolveBinary(vendor, config), cwd: projectDir, env });
      } catch (err) {
        if (!(err instanceof ClaudeClientError) || err.reason !== "auth") throw err;
        listing = { ok: false, reason: "Codex API authentication is configured without a key; configure the key or select CLI login, then refresh." };
      }
    }
    return { listing, checkedAt: new Date().toISOString(), cli };
  }
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
  options: { refresh?: boolean; provider?: "cli" | "api" } = {},
): Promise<LiveVendorProbe> {
  const key = cacheKey(projectDir, vendor);
  const hit = cache.get(key);
  if (vendor !== LLM_VENDOR.CODEX && !options.refresh && hit && hit.expiresAt > Date.now()) return hit.probe;

  const restricted = isProjectRestricted(projectDir);
  const probe = await probeVendor(vendor, projectDir, await loadLLMConfig(projectDir), options.provider);
  // A restricted answer is not cached: accepting the config must show the
  // probed result on the next request, not ten minutes later.
  if (!restricted && vendor !== LLM_VENDOR.CODEX) cache.set(key, { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, probe });
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
  // A key `llm.claude.auth` lets an API run use: a stored key counts only
  // under `api`, as hench and the client factory count it.
  const auth = resolveVendorAuth(LLM_VENDOR.CLAUDE, config);
  const hasKey = auth.mode === "api" && auth.key !== undefined;
  if (provider === "api") return apiKeyReadiness(hasKey);
  return { ...cliReadiness(cli), apiKey: hasKey };
}

/** Direct OpenAI execution needs an API key; CLI execution keeps its own readiness. */
export function codexReadiness(cli: CliInfo, provider = "cli", config: LLMConfig = {}): VendorReadiness {
  if (provider !== "api") return cliReadiness(cli);
  const auth = resolveVendorAuth(LLM_VENDOR.CODEX, config);
  return apiKeyReadiness(auth.mode === "api" && auth.key !== undefined);
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
